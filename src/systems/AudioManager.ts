import { clamp, lerp, smoothstep, window4 } from '../core/math';

/**
 * AudioManager：整段叙事的声音（WebAudio）。
 *
 * 真实的录音（public/assets/audio/，由 scripts/whale-audio.py 从 MBARI 的水听器录音中截取，见 README）：
 *  - 蓝鲸的歌声：脉冲状的 A 叫声与长而平稳、缓缓下滑的 B 叫声。蓝鲸的叫声在 10~90 赫兹，
 *    和 NOAA、MBARI 公开展示时一样整体加速了 6 倍才能听见；
 *  - 远处许多蓝鲸与长须鲸的合唱：开阔海域的背景声，深海里变得低沉、遥远。
 * 录音没有加载成功时，鲸鸣与合唱退回到实时合成的声音。
 *
 * 其余声音实时合成，按叙事进度分层混合：
 *  - 环境：水下的低沉水声（越深越闷）、海面的浪声与风声、深海的极低频氛围；
 *  - 动作：近景里每一次拍尾推开海水的闷响、冲进虾团时张嘴吞水的涌流、闭嘴后海水从鲸须间滤出的嘶声、
 *    冲出水面与潜回水下的水声、喷气与随后的吸气、闭眼时越来越慢的心跳（蓝鲸潜水时心率只有每分钟两三次）、
 *    下沉时沿身体流过的水声、着地的闷响与扬起的沉积物、分解时食腐动物的细碎声响、磷虾群上升时的水流。
 * 所有叙事都能通过画面完整理解，声音只用于增强沉浸感；倒放与跳转时不触发一次性的音效。
 */

export interface AudioFrame {
  mode: 'story' | 'explore' | 'intro';
  p: number;
  depth: number;
  /** 0~1：靠近海面（含高空与分屏镜头） */
  surface: number;
  paused: boolean;
  /** 叙事推进速度（进度 / 秒） */
  velocity: number;
  /** 下沉时鲸鱼相对海水的下沉速度（m/s，其余时间为 0） */
  sink?: number;
  /** 近景中的拍尾：相位（弧度）、幅度与镜头远近（0~1，越近越响） */
  stroke?: { phase: number; amp: number; near: number };
  /** 分解阶段：食腐动物与端足类的数量（0~1） */
  scav?: number;
  amph?: number;
}

type CueKind =
  | 'callFar'
  | 'callNear'
  | 'farewell'
  | 'deepCall'
  | 'newWhale'
  | 'engulf'
  | 'filter'
  | 'bubbles'
  | 'emerge'
  | 'plunge'
  | 'spout'
  | 'spoutFar'
  | 'thud'
  | 'rise';

/** 叙事中的一次性声音（只在正向经过时触发） */
const CUES: Array<{ at: number; kind: CueKind }> = [
  // 开场保持克制：两声远处传来的蓝鲸歌声
  { at: 0.016, kind: 'callFar' },
  { at: 0.043, kind: 'callNear' },
  // 冲刺滤食：张开的大嘴吞下一大口海水；闭嘴后海水从鲸须间被挤出
  { at: 0.077, kind: 'engulf' },
  { at: 0.103, kind: 'filter' },
  { at: 0.118, kind: 'bubbles' },
  // 返回海面：冲出水面、高空中远远的喷气、近处的喷气，再潜回水下
  { at: 0.152, kind: 'emerge' },
  { at: 0.171, kind: 'spoutFar' },
  { at: 0.204, kind: 'spout' },
  { at: 0.226, kind: 'plunge' },
  // 闭眼：远处传来的最后一段歌声
  { at: 0.257, kind: 'farewell' },
  // 深海里，遥远的同伴仍在歌唱（声音在深海声道里能传得很远）
  { at: 0.405, kind: 'deepCall' },
  // 着地
  { at: 0.4975, kind: 'thud' },
  // 磷虾群上升、新的鲸鱼从远处游来
  { at: 0.862, kind: 'rise' },
  { at: 0.932, kind: 'newWhale' },
];

/** 心跳：闭眼时越来越慢、越来越轻，生命结束时停止（进度 → 两次心跳之间的秒数） */
const HEART_FROM = 0.236;
const HEART_TO = 0.296;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private ambFilter!: BiquadFilterNode;
  private surf!: GainNode;
  private surfFilter!: BiquadFilterNode;
  private wind!: GainNode;
  private drone!: GainNode;
  private flow!: GainNode;
  private flowFilter!: BiquadFilterNode;
  private chorus: GainNode | null = null;
  private chorusFilter: BiquadFilterNode | null = null;
  private wet!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private whiteBuf!: AudioBuffer;
  private lastP = -1;
  private nextCreak = 6;
  private nextHeart = 0;
  private nextCrunch = 2;
  private lastStroke = 0;
  muted = false;
  volume = 0.7;
  /** 声音素材：key → AudioBuffer，由 AssetRegistry 按 manifest.json 注入（whaleAB / whaleAB2 / whaleB / chorus，以及可选的 spout） */
  readonly overrides = new Map<string, AudioBuffer>();

  get ready(): boolean {
    return !!this.ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 必须在用户手势中调用。 */
  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.2, 2.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    this.noiseBuf = this.brownNoise(6);
    this.whiteBuf = this.whiteNoise(5);
    // 水下环境声
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 900;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    this.loop(this.noiseBuf).connect(this.ambFilter).connect(this.amb).connect(this.master);
    // 海面浪声：较亮的噪声 + 缓慢起伏
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'bandpass';
    this.surfFilter.frequency.value = 700;
    this.surfFilter.Q.value = 0.4;
    this.surf = ctx.createGain();
    this.surf.gain.value = 0;
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    this.lfo(0.13, 0.35, swell.gain);
    this.loop(this.whiteBuf).connect(this.surfFilter).connect(swell).connect(this.surf).connect(this.master);
    // 海面上的风：很高、很淡的气流声，慢慢起伏
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 1900;
    windF.Q.value = 0.6;
    this.lfo(0.07, 500, windF.frequency);
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    this.loop(this.whiteBuf, 1.7).connect(windF).connect(this.wind).connect(this.master);
    // 下沉时沿身体流过的水声
    this.flowFilter = ctx.createBiquadFilter();
    this.flowFilter.type = 'bandpass';
    this.flowFilter.frequency.value = 260;
    this.flowFilter.Q.value = 0.7;
    this.flow = ctx.createGain();
    this.flow.gain.value = 0;
    this.lfo(0.11, 0.25, this.flow.gain);
    this.loop(this.noiseBuf, 2.3).connect(this.flowFilter).connect(this.flow).connect(this.master);
    // 深海低频氛围
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 220;
    this.drone.connect(dl).connect(this.master);
    dl.connect(this.reverb);
    for (const [f, g] of [
      [48, 0.5],
      [72.3, 0.28],
      [96.7, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      this.lfo(0.05 + f * 0.0007, 1.4, o.frequency);
      o.connect(og).connect(this.drone);
      o.start();
    }
    this.startChorus();
    this.applyVolume();
  }

  /** 声音素材加载完成后调用：开始循环播放远处的合唱 */
  samplesReady(): void {
    this.startChorus();
  }

  private startChorus(): void {
    const ctx = this.ctx;
    const buf = this.overrides.get('chorus');
    if (!ctx || !buf || this.chorus) return;
    this.chorusFilter = ctx.createBiquadFilter();
    this.chorusFilter.type = 'lowpass';
    this.chorusFilter.frequency.value = 1400;
    this.chorus = ctx.createGain();
    this.chorus.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.chorusFilter).connect(this.chorus).connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    this.chorus.connect(send).connect(this.reverb);
    src.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  setVolume(v: number): void {
    this.volume = clamp(v);
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.volume * 0.9;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.25);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const story = f.mode === 'story';
    const p = f.p;
    const deep = smoothstep(30, 1400, f.depth);
    const near = f.mode === 'intro' ? 0.4 : f.surface;
    // 在空中（高空俯视、水线以上的中景）时，水下的声音只剩一点
    const air = story ? window4(p, 0.155, 0.162, 0.188, 0.196) + 0.6 * window4(p, 0.196, 0.2, 0.218, 0.226) : 0;
    this.amb.gain.setTargetAtTime((0.22 + 0.12 * (1 - deep)) * (1 - 0.7 * air), t, 0.8);
    this.ambFilter.frequency.setTargetAtTime(1500 * (1 - deep) + 160 + near * 1200, t, 0.8);
    this.surf.gain.setTargetAtTime(0.16 * near + 0.1 * air, t, 0.6);
    this.surfFilter.frequency.setTargetAtTime(500 + near * 500 + air * 300, t, 0.6);
    this.wind.gain.setTargetAtTime(0.05 * air, t, 1);
    this.drone.gain.setTargetAtTime(0.03 + 0.11 * deep * (f.mode === 'intro' ? 0.3 : 1), t, 1.2);
    // 远处的合唱：开阔海域里最清楚；海面上几乎听不到；深海里低沉、遥远；鲸骨周围几乎没有
    if (this.chorus && this.chorusFilter) {
      let c = 0.5;
      if (story) {
        c = 0.55 * (1 - smoothstep(0.1, 0.15, p)) + 0.4 * window4(p, 0.225, 0.26, 0.33, 0.37) + 0.3 * window4(p, 0.38, 0.41, 0.46, 0.5);
        c += 0.08 * window4(p, 0.5, 0.55, 0.8, 0.84) + 0.55 * smoothstep(0.86, 0.93, p);
      } else if (f.mode === 'explore') c = 0.08;
      this.chorus.gain.setTargetAtTime(c * (1 - air), t, 1.5);
      this.chorusFilter.frequency.setTargetAtTime(1400 - 1000 * deep, t, 1.5);
    }
    // 下沉时沿身体流过的水声（随下沉速度）
    const sink = clamp((f.sink ?? 0) / 2.4);
    this.flow.gain.setTargetAtTime(0.32 * sink * sink, t, 0.8);
    this.flowFilter.frequency.setTargetAtTime(180 + 160 * sink, t, 0.8);

    const forward = story && !f.paused && this.lastP >= 0 && p > this.lastP && p - this.lastP < 0.02;
    if (forward) {
      for (const c of CUES) if (this.lastP < c.at && p >= c.at) this.cue(c.kind);
      this.heart(p);
      this.strokes(f);
    }
    if (story && !f.paused) this.lastP = p;
    else this.lastP = story ? p : -1;

    // 分解时食腐动物撕咬、端足类成群爬过的细碎声响
    const crunch = clamp((f.scav ?? 0) * 0.8 + (f.amph ?? 0) * 0.5);
    if (story && !f.paused && crunch > 0.15) {
      this.nextCrunch -= dt * crunch;
      if (this.nextCrunch <= 0) {
        this.nextCrunch = 0.5 + Math.random() * 1.6;
        this.crackle(0.5 + 0.5 * crunch);
      }
    }
    // 深海中偶尔的细微声响（生物活动）
    if (deep > 0.6 && !f.paused) {
      this.nextCreak -= dt;
      if (this.nextCreak <= 0) {
        this.nextCreak = 4 + Math.random() * 7;
        this.click();
      }
    }
  }

  cue(kind: CueKind): void {
    switch (kind) {
      case 'callFar':
        this.whale('whaleB', { gain: 0.5, cutoff: 700, wet: 0.8, dry: 0.35 });
        break;
      case 'callNear':
        this.whale('whaleAB', { gain: 0.75, cutoff: 1600, wet: 0.5, dry: 0.7 });
        break;
      case 'farewell':
        this.whale('whaleB', { gain: 0.45, cutoff: 600, wet: 0.9, dry: 0.3, rate: 0.88 });
        break;
      case 'deepCall':
        this.whale('whaleAB2', { gain: 0.42, cutoff: 450, wet: 1, dry: 0.25, rate: 0.92 });
        break;
      case 'newWhale':
        this.whale('whaleAB2', { gain: 0.6, cutoff: 1100, wet: 0.7, dry: 0.45 });
        break;
      case 'engulf':
        this.engulf();
        break;
      case 'filter':
        this.filterOut();
        break;
      case 'bubbles':
        for (let i = 0; i < 6; i++) setTimeout(() => this.bubble(), i * 90 + Math.random() * 60);
        break;
      case 'emerge':
        this.splash(0.8, false);
        break;
      case 'plunge':
        this.splash(0.6, true);
        break;
      case 'spout':
        this.spout(1);
        break;
      case 'spoutFar':
        this.spout(0.45);
        break;
      case 'thud':
        this.thud();
        break;
      case 'rise':
        this.rise();
        break;
    }
  }

  // ------------------------------------------------------------------ 真实录音

  /**
   * 播放一段蓝鲸的录音：低通（越远越闷）、直达声与混响按距离分配。
   * 录音没有加载成功时退回到合成的鸣叫。
   */
  private whale(key: string, o: { gain: number; cutoff: number; wet: number; dry: number; rate?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = this.overrides.get(key) ?? this.overrides.get('whaleCall');
    if (!buf) {
      this.whaleCall(o.gain, o.rate ?? 1, o.dry < 0.5, key === 'whaleB' && (o.rate ?? 1) < 1);
      return;
    }
    const t = ctx.currentTime + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.cutoff;
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = o.gain;
    const dry = ctx.createGain();
    dry.gain.value = o.dry;
    const wet = ctx.createGain();
    wet.gain.value = o.wet;
    src.connect(lp).connect(g);
    g.connect(dry).connect(this.master);
    g.connect(wet).connect(this.reverb);
    src.start(t);
  }

  /**
   * 合成的蓝鲸叫声（没有录音时使用）：先是一段低沉、缓慢脉动的“A 叫声”，再接一段长而平稳、缓缓下滑的“B 叫声”。
   * falling 为告别时的叫声：只有更长、更低、更弱的下滑。
   */
  whaleCall(gain: number, pitch: number, distant: boolean, falling = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const f0 = 72 * pitch;
    const aDur = falling ? 0 : 2.6;
    const bDur = falling ? 7 : 5.2;
    const dur = aDur + bDur;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    if (aDur > 0) {
      o.frequency.setValueAtTime(f0 * 1.22, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.19, t + aDur - 0.3);
      o.frequency.exponentialRampToValueAtTime(f0, t + aDur + 0.3);
    } else o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.88, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (distant ? 260 : 420) * pitch;
    lp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * gain, t + 0.9);
    g.gain.setValueAtTime(0.3 * gain, t + dur - 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pulse = ctx.createGain();
    pulse.gain.value = 1;
    let lfo: OscillatorNode | null = null;
    if (aDur > 0) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = 2.2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0.45, t);
      depth.gain.setValueAtTime(0.45, t + aDur - 0.4);
      depth.gain.linearRampToValueAtTime(0, t + aDur + 0.2);
      lfo.connect(depth).connect(pulse.gain);
    }
    o.connect(lp).connect(pulse).connect(g);
    const dry = ctx.createGain();
    dry.gain.value = distant ? 0.25 : 0.6;
    g.connect(dry).connect(this.master);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + dur + 0.1);
    if (lfo) {
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
  }

  // ------------------------------------------------------------------ 动作的声音

  /** 近景里每一次有力的拍尾：尾叶推开海水的一声低沉闷响 */
  private strokes(f: AudioFrame): void {
    const s = f.stroke;
    if (!s) return;
    // 上拍最用力的时刻（strokeWarp 之后约在相位 π/2 附近）
    const k = Math.floor((s.phase - Math.PI / 2) / (2 * Math.PI));
    if (k !== this.lastStroke) {
      const fresh = k === this.lastStroke + 1;
      this.lastStroke = k;
      const g = s.amp * s.near;
      if (fresh && g > 0.12) this.whump(0.35 * g);
    }
  }

  private whump(gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 1.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(gain, t + 0.18);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(og).connect(this.master);
    og.connect(this.reverb);
    o.start(t);
    o.stop(t + 1.5);
    // 被推开的海水：一阵很低的气流般的涌动
    this.noiseSwell({ at: t, attack: 0.25, hold: 0.2, release: 1.2, gain: gain * 0.7, f0: 160, f1: 320, q: 0.8, brown: true });
  }

  /** 张开的大嘴吞下一大口海水：低沉的涌流越来越响，最后被喉囊兜住 */
  private engulf(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    this.noiseSwell({ at: t, attack: 2.2, hold: 1.4, release: 2.4, gain: 0.55, f0: 140, f1: 520, q: 0.6, brown: true });
    this.noiseSwell({ at: t + 0.6, attack: 1.8, hold: 0.8, release: 2, gain: 0.12, f0: 900, f1: 1600, q: 0.8, brown: false });
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(42, t);
    o.frequency.linearRampToValueAtTime(30, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 2.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 5.6);
  }

  /** 闭嘴之后，喉囊收缩，海水从鲸须的缝隙间被挤出去：一段带着细碎气泡的嘶声 */
  private filterOut(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    this.noiseSwell({ at: t, attack: 0.8, hold: 2.6, release: 2.2, gain: 0.16, f0: 2400, f1: 1300, q: 1.2, brown: false });
    this.noiseSwell({ at: t, attack: 1.2, hold: 2, release: 2, gain: 0.25, f0: 300, f1: 200, q: 0.7, brown: true });
    for (let i = 0; i < 14; i++) setTimeout(() => this.bubble(0.035), 300 + i * 260 + Math.random() * 200);
  }

  /** 冲出水面（false）或潜回水下（true）：一阵水声，潜入时随后变闷 */
  private splash(gain: number, under: boolean): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    this.noiseSwell({ at: t, attack: 0.08, hold: 0.25, release: under ? 1.6 : 1.1, gain: 0.35 * gain, f0: under ? 1800 : 900, f1: under ? 300 : 2600, q: 0.5, brown: false });
    this.noiseSwell({ at: t, attack: 0.05, hold: 0.2, release: 1.4, gain: 0.3 * gain, f0: 220, f1: 140, q: 0.6, brown: true });
    if (under) for (let i = 0; i < 8; i++) setTimeout(() => this.bubble(0.05), 200 + i * 120 + Math.random() * 90);
  }

  /** 喷气：短促上升的“噗——”与随后的水雾嘶声，停一下，再是一声更短、更轻的吸气 */
  spout(gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const ov = this.overrides.get('spout');
    if (ov) return this.playBuffer(ov, gain);
    const t = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(900, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.12 * gain, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(bp).connect(g).connect(this.master);
    g.connect(this.reverb);
    src.start(t);
    src.stop(t + 2.8);
    // 胸腔里低沉的气流
    this.noiseSwell({ at: t, attack: 0.1, hold: 0.4, release: 1.4, gain: 0.3 * gain, f0: 160, f1: 110, q: 0.7, brown: true });
    // 吸气
    this.noiseSwell({ at: t + 3.1, attack: 0.5, hold: 0.25, release: 0.5, gain: 0.16 * gain, f0: 700, f1: 1300, q: 0.9, brown: false });
  }

  /** 心跳：低沉的“扑通”两声。闭眼的过程中越来越慢、越来越轻 */
  private heart(p: number): void {
    const ctx = this.ctx!;
    if (p < HEART_FROM || p > HEART_TO) {
      this.nextHeart = 0;
      return;
    }
    const now = ctx.currentTime;
    if (this.nextHeart > now + 20) this.nextHeart = 0;
    if (now < this.nextHeart) return;
    const k = (p - HEART_FROM) / (HEART_TO - HEART_FROM);
    const gap = lerp(2.2, 9, k * k);
    const gain = 0.32 * (1 - smoothstep(0.55, 1, k)) * smoothstep(0, 0.08, k);
    this.nextHeart = now + gap;
    if (gain < 0.01) return;
    for (const [dt, g] of [
      [0, 1],
      [0.32, 0.6],
    ] as const) {
      const t = now + 0.03 + dt;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(64, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(gain * g, t + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  /** 着地：极低的闷响，接着是沉积物被挤出、翻涌的低沉声响 */
  private thud(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(46, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    o.connect(g).connect(this.master);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + 3.1);
    this.noiseSwell({ at: t + 0.1, attack: 0.9, hold: 2.5, release: 6, gain: 0.32, f0: 260, f1: 120, q: 0.6, brown: true });
  }

  /** 磷虾群上升、镜头随之升向明亮的海面：一阵越来越亮的水流 */
  private rise(): void {
    const t = this.ctx!.currentTime + 0.02;
    this.noiseSwell({ at: t, attack: 4, hold: 3, release: 5, gain: 0.18, f0: 200, f1: 900, q: 0.6, brown: true });
  }

  /** 食腐动物撕咬、端足类爬过：几下很轻、很短的碎响 */
  private crackle(gain: number): void {
    const ctx = this.ctx!;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + 0.02 + i * (0.05 + Math.random() * 0.12);
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 2200;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035 * gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.05);
      src.connect(bp).connect(g).connect(this.reverb);
      g.connect(this.master);
      src.start(t, Math.random() * 3);
      src.stop(t + 0.12);
    }
  }

  bubble(gain = 0.06): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const f = 500 + Math.random() * 700;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  click(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 2500;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp).connect(g).connect(this.reverb);
    src.start(t, Math.random() * 4);
    src.stop(t + 0.1);
  }

  /** 新发现的轻柔提示音。 */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [880, 1318.5, 1760].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.4);
      o.connect(g).connect(this.master);
      g.connect(this.reverb);
      o.start(s);
      o.stop(s + 1.5);
    });
  }

  // ------------------------------------------------------------------ 工具

  /** 一段滤波噪声的起伏：起音、保持、释音（秒），带通的中心频率从 f0 滑到 f1 */
  private noiseSwell(o: { at: number; attack: number; hold: number; release: number; gain: number; f0: number; f1: number; q: number; brown: boolean }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.noiseBuf : this.whiteBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = o.q;
    const end = o.at + o.attack + o.hold + o.release;
    bp.frequency.setValueAtTime(o.f0, o.at);
    bp.frequency.exponentialRampToValueAtTime(o.f1, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + o.attack);
    g.gain.setValueAtTime(Math.max(0.0002, o.gain), o.at + o.attack + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(bp).connect(g).connect(this.master);
    g.connect(this.reverb);
    src.start(o.at, Math.random() * 2);
    src.stop(end + 0.1);
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start();
    return src;
  }

  private lfo(freq: number, depth: number, target: AudioParam): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
  }

  private playBuffer(buf: AudioBuffer, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
  }

  private brownNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    // 首尾淡化，避免循环处的爆音
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      d[i] *= i / fade;
      d[len - 1 - i] *= i / fade;
    }
    return buf;
  }

  private whiteNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    return buf;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
}
