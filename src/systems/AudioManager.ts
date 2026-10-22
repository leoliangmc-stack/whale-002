import { clamp, smoothstep } from '../core/math';

/**
 * AudioManager：全部声音由 WebAudio 实时合成（无需音频文件），并预留正式音频的替换接口。
 *  - 海洋环境声：棕噪声经低通滤波，越深越闷；
 *  - 海面：浪声与风声；喷气：带通噪声的“噗——”；
 *  - 鲸鱼：低沉、克制的滑音鸣叫，经混响后显得空旷；
 *  - 深海：极低频的持续氛围声；
 *  - 提示音：探索中有新发现时的轻柔铃声。
 * 声音只用于增强沉浸感，所有叙事都能通过画面完整理解。
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
}

/** 叙事中触发的声音事件（只在正向经过时触发） */
const CUES: Array<{ at: number; kind: 'call' | 'callFar' | 'spout' | 'spoutFar' | 'farewell' | 'bubbles' }> = [
  // 开场保持克制：只有两声远处传来的低吟，给安静观察留出空间
  { at: 0.018, kind: 'callFar' },
  { at: 0.042, kind: 'callFar' },
  { at: 0.118, kind: 'bubbles' },
  { at: 0.171, kind: 'spoutFar' },
  { at: 0.204, kind: 'spout' },
  { at: 0.257, kind: 'farewell' },
  { at: 0.935, kind: 'callFar' },
];

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private ambFilter!: BiquadFilterNode;
  private surf!: GainNode;
  private surfFilter!: BiquadFilterNode;
  private drone!: GainNode;
  private wet!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private lastP = -1;
  private nextCreak = 6;
  muted = false;
  volume = 0.7;
  /** 正式音频资源（可选）：key → AudioBuffer，由 AssetRegistry 注入 */
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
    this.reverb.buffer = this.impulse(3.6, 2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    this.noiseBuf = this.brownNoise(6);
    // 水下环境声
    const amb = ctx.createBufferSource();
    amb.buffer = this.noiseBuf;
    amb.loop = true;
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 900;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    amb.connect(this.ambFilter).connect(this.amb).connect(this.master);
    amb.start();
    // 海面浪声：较亮的噪声 + 缓慢起伏
    const surf = ctx.createBufferSource();
    surf.buffer = this.whiteNoise(5);
    surf.loop = true;
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'bandpass';
    this.surfFilter.frequency.value = 700;
    this.surfFilter.Q.value = 0.4;
    this.surf = ctx.createGain();
    this.surf.gain.value = 0;
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.35;
    lfo.connect(lfoGain).connect(swell.gain);
    lfo.start();
    surf.connect(this.surfFilter).connect(swell).connect(this.surf).connect(this.master);
    surf.start();
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
      const l = ctx.createOscillator();
      l.frequency.value = 0.05 + f * 0.0007;
      const lg = ctx.createGain();
      lg.gain.value = 1.4;
      l.connect(lg).connect(o.frequency);
      l.start();
      o.connect(og).connect(this.drone);
      o.start();
    }
    this.applyVolume();
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
    const deep = smoothstep(30, 1400, f.depth);
    const near = f.mode === 'intro' ? 0.4 : f.surface;
    this.amb.gain.setTargetAtTime(0.22 + 0.12 * (1 - deep), t, 0.8);
    this.ambFilter.frequency.setTargetAtTime(1500 * (1 - deep) + 160 + near * 1200, t, 0.8);
    this.surf.gain.setTargetAtTime(0.16 * near, t, 0.6);
    this.surfFilter.frequency.setTargetAtTime(500 + near * 500, t, 0.6);
    this.drone.gain.setTargetAtTime(0.03 + 0.11 * deep * (f.mode === 'intro' ? 0.3 : 1), t, 1.2);

    if (f.mode === 'story' && !f.paused) {
      const p = f.p;
      if (this.lastP >= 0 && p > this.lastP && p - this.lastP < 0.02) {
        for (const c of CUES) if (this.lastP < c.at && p >= c.at) this.cue(c.kind);
      }
      this.lastP = p;
    } else {
      this.lastP = f.mode === 'story' ? f.p : -1;
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

  cue(kind: (typeof CUES)[number]['kind']): void {
    switch (kind) {
      case 'call':
        this.whaleCall(0.9, 1, false);
        break;
      case 'callFar':
        this.whaleCall(0.45, 0.85, true);
        break;
      case 'farewell':
        this.whaleCall(0.6, 0.75, true, true);
        break;
      case 'spout':
        this.spout(1);
        break;
      case 'spoutFar':
        this.spout(0.45);
        break;
      case 'bubbles':
        for (let i = 0; i < 6; i++) setTimeout(() => this.bubble(), i * 90 + Math.random() * 60);
        break;
    }
  }

  /** 座头鲸的低沉滑音（带颤音与混响）。 */
  whaleCall(gain: number, pitch: number, distant: boolean, falling = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const ov = this.overrides.get('whaleCall');
    if (ov) return this.playBuffer(ov, gain);
    const t = ctx.currentTime + 0.05;
    const dur = falling ? 5.5 : 3.6;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 140 * pitch;
    if (falling) {
      o.frequency.setValueAtTime(f0 * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 1.2);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + dur);
    } else {
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 2.4, t + dur * 0.45);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + dur);
    }
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = f0 * 0.02;
    vib.connect(vg).connect(o.frequency);
    // 共振峰滤波让锯齿波变得柔和、像“歌声”
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420 * pitch;
    bp.Q.value = 2.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = distant ? 700 : 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * gain, t + 0.6);
    g.gain.setValueAtTime(0.22 * gain, t + dur - 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(lp).connect(g);
    const dry = ctx.createGain();
    dry.gain.value = distant ? 0.25 : 0.6;
    g.connect(dry).connect(this.master);
    g.connect(this.reverb);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }

  /** 喷气：短促上升的“噗——”与随后的水雾嘶声。 */
  spout(gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const ov = this.overrides.get('spout');
    if (ov) return this.playBuffer(ov, gain);
    const t = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoise(3);
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
  }

  bubble(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const f = 500 + Math.random() * 700;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
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
