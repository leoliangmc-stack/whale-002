import { clamp } from '../core/math';
import { AudioDirector, type AudioFrame, type FadeCmd, type MixPlan, type PlayCmd } from './audio/director';
import { AIR_BEDS, BEDS, DUCK_DB, OFF_DB, type BedId, type DuckClass } from './audio/plan';

export type { AudioFrame } from './audio/director';

/**
 * AudioManager：整段叙事的声音（WebAudio 执行层）。
 *
 * 全部声音都是真实录音（public/assets/audio/，由 scripts/sound-build.py 生成，来源与许可见 README「声音」与
 * docs/sound/sources.md）：MBARI 与 NOAA SanctSound 的水听器录音、ESC-50 中单独标为 CC0 / CC BY 的实地录音等，
 * 只做过滤波、变速、拼接、包络与离线的短混响。运行时不合成任何叙事声音、不用卷积混响；素材没有加载好时
 * 对应的声音直接跳过。唯一的合成声音是界面的“新发现”提示音（chime，不属于叙事）。
 *
 * 决定“什么时候、多响”的逻辑都在 audio/director.ts 与 audio/plan.ts（docs/sound/cue-sheet.md 的代码版本）；
 * 这里只把它的指令变成 WebAudio 节点：
 *
 *   循环床 → 低通 → 增益 ─┬→ BED 母线（旁白时 −7 dB）────────────┬→ 暂停（−6 dB）─┐
 *                         └→ 空气床母线（−9 dB，2.5 kHz −3 dB）───┘                  │
 *   一次性音效 → 增益 → 声像 → SFX / 主角 / 鲸鸣 / 海鸥 / 抹香鲸 母线（各自的压低）──────┤
 *   旁白（voiceBus，不压低）、界面提示音 ───────────────────────────────────────────────┴→ 主增益 → 安全限幅器 → 输出
 *
 * 素材按批次加载（manifest 的 batch）：0 常驻；1 开场；2 海面；3 深海；4 海床。离开对应段落后释放解码后的数据，
 * 让常驻的 PCM 不超过约 50 MB。
 */

export interface AudioEntry {
  file: string;
  batch?: number;
  /** 循环区间（秒） */
  loop?: [number, number];
  /** 实测响度（循环床为积分响度，一次性素材为短时响度最大值） */
  lufs?: number;
}

export type AudioLoader = (key: string, entry: AudioEntry) => Promise<AudioBuffer | null>;

interface BedNode {
  id: BedId;
  src: AudioBufferSourceNode | null;
  filter: BiquadFilterNode;
  gain: GainNode;
  silentFor: number;
  startedAt: number;
}

interface ShotNode {
  src: AudioBufferSourceNode;
  gain: GainNode;
  id: string;
}

/** 每一批素材需要常驻的叙事区间（1.7 / 4.5） */
function wantedBatches(mode: AudioFrame['mode'], p: number): Set<number> {
  const s = new Set([0]);
  if (mode === 'explore') {
    s.add(3);
    s.add(4);
    return s;
  }
  if (mode === 'intro' || p < 0.125 || p >= 0.94) s.add(1);
  if (mode === 'story' && p >= 0.06 && p < 0.226) s.add(2);
  if (mode === 'story' && p >= 0.226 && p < 0.93) s.add(3);
  if (mode === 'story' && p >= 0.35 && p < 0.945) s.add(4);
  return s;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private voice: GainNode | null = null;
  private ui!: GainNode;
  private bedBus!: GainNode;
  private airBus!: GainNode;
  private airEq!: BiquadFilterNode;
  private pause!: GainNode;
  private buses = new Map<DuckClass, GainNode>();
  private beds = new Map<BedId, BedNode>();
  private shots = new Map<number, ShotNode>();
  private catalog = new Map<string, AudioEntry>();
  private loader: AudioLoader | null = null;
  private loading = new Map<string, Promise<void>>();
  private wanted = new Set([0, 1]);
  private batchCheck = 0;
  private snap = false;
  private readonly director = new AudioDirector(
    (id) => this.overrides.get(id)?.duration,
    (id) => this.overrides.has(id),
  );
  /** 最近一次的混音计划（调试用：window.__wf.app.audio.lastPlan） */
  lastPlan: MixPlan | null = null;
  muted = false;
  volume = 0.7;
  /** 解码后的声音素材：编号 → AudioBuffer（由 AssetRegistry 按 manifest.json 分批注入） */
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
    // iPhone 侧面的静音开关打开时仍然出声（与视频播放一致）
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = 'playback';
      } catch {
        /* 不支持 */
      }
    }
    const ctx = new AC();
    this.ctx = ctx;

    // 主增益 → 安全限幅器（阈值 −2 dBFS，20:1，起音 3 ms，释放 250 ms）→ 输出
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);

    this.pause = ctx.createGain();
    this.pause.connect(this.master);
    this.bedBus = ctx.createGain();
    this.bedBus.connect(this.pause);
    this.airEq = ctx.createBiquadFilter();
    this.airEq.type = 'peaking';
    this.airEq.frequency.value = 2500;
    this.airEq.Q.value = 0.8;
    this.airEq.gain.value = 0;
    this.airBus = ctx.createGain();
    this.airBus.connect(this.airEq).connect(this.pause);
    for (const k of ['sfx', 'hero', 'free', 'whale', 'gull', 'sperm', 'ui'] as DuckClass[]) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses.set(k, g);
    }
    this.ui = this.buses.get('ui')!;
    for (const id of BEDS) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.707;
      filter.frequency.value = 2000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      filter.connect(gain).connect(AIR_BEDS.has(id) ? this.airBus : this.bedBus);
      this.beds.set(id, { id, src: null, filter, gain, silentFor: 0, startedAt: 0 });
    }
    this.voice = ctx.createGain();
    this.voice.connect(this.master);
    this.applyVolume();
  }

  /** 旁白的输出（见 Narration）：跟随静音与音量，不被压低、不加混响。声音解锁之前为 null */
  get voiceBus(): AudioNode | null {
    return this.voice;
  }

  /** 没有旁白状态（AudioFrame.vo）时的后备：旁白说话的程度 0~1 */
  setDuck(amount: number): void {
    this.director.externalDuck = clamp(amount);
  }

  /** 由 AssetRegistry 调用：登记素材清单与加载函数，加载第 0 批（常驻），返回时第 0 批已就绪 */
  async attachCatalog(entries: Record<string, AudioEntry>, loader: AudioLoader): Promise<void> {
    this.catalog = new Map(Object.entries(entries));
    this.loader = loader;
    await this.loadBatch(0);
    void this.loadBatch(1);
  }

  /** 声音素材的第 0 批加载完成后调用（保留的接口；循环床在素材就绪后自行淡入） */
  samplesReady(): void {
    this.batchCheck = 0;
  }

  private loadBatch(batch: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [key, e] of this.catalog) {
      if ((e.batch ?? 0) !== batch || this.overrides.has(key)) continue;
      let job = this.loading.get(key);
      if (!job && this.loader) {
        const loader = this.loader;
        job = loader(key, e)
          .then((buf) => {
            if (buf && this.wanted.has(e.batch ?? 0)) this.overrides.set(key, buf);
          })
          .catch(() => undefined)
          .finally(() => this.loading.delete(key));
        this.loading.set(key, job);
      }
      if (job) jobs.push(job);
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /** 按进度加载需要的批次，释放离开的批次（没有正在播放的声音时） */
  private manageBatches(f: AudioFrame): void {
    this.wanted = wantedBatches(f.mode, f.p);
    for (const b of this.wanted) void this.loadBatch(b);
    for (const [key, e] of this.catalog) {
      const b = e.batch ?? 0;
      if (this.wanted.has(b) || !this.overrides.has(key)) continue;
      if ([...this.shots.values()].some((s) => s.id === key)) continue;
      const bed = this.beds.get(key as BedId);
      if (bed?.src) this.stopBed(bed);
      this.overrides.delete(key);
    }
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
    // 主增益 = 界面音量；静音时 0.25 s 归零（含旁白）
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    // 回到前台：直接设到当前目标值，不从旧值渐变
    this.snap = true;
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.batchCheck -= dt;
    if (this.batchCheck <= 0) {
      this.batchCheck = 0.5;
      this.manageBatches(f);
    }
    const plan = this.director.step(dt, f, now);
    this.lastPlan = plan;
    const snap = this.snap;
    this.snap = false;

    this.applyBeds(plan, dt, now, snap);
    // 旁白压低与暂停（包络已由导演按 4.3 的起落时间算好，这里只做很短的平滑）
    const d = plan.duck;
    const set = (param: AudioParam, v: number, tau: number) => (snap ? param.setValueAtTime(v, now) : param.setTargetAtTime(v, now, tau));
    set(this.bedBus.gain, dbToGain(DUCK_DB.bed * d), 0.03);
    set(this.airBus.gain, dbToGain(DUCK_DB.air * d), 0.03);
    set(this.airEq.gain, -3 * d, 0.03);
    for (const [k, g] of this.buses) set(g.gain, dbToGain(DUCK_DB[k] * d), 0.03);
    set(this.pause.gain, dbToGain(plan.pauseDb), plan.pauseTau);

    for (const c of plan.fade) this.fadeShot(c, now);
    for (const c of plan.play) this.playShot(c, now);
  }

  private applyBeds(plan: MixPlan, dt: number, now: number, snap: boolean): void {
    const nyq = this.ctx!.sampleRate * 0.45;
    for (const node of this.beds.values()) {
      const lv = plan.beds[node.id];
      const buf = this.overrides.get(node.id);
      const entry = this.catalog.get(node.id);
      const on = !!buf && lv.db > OFF_DB && lv.w > 1e-4;
      // 单声道素材以双声道播放时响度高 3 dB（BS.1770 按声道功率相加），这里补偿回来
      const mono = buf && buf.numberOfChannels === 1 ? MONO_DB : 0;
      const g = on ? lv.w * dbToGain(lv.db - (entry?.lufs ?? -18) - mono) : 0;
      if (on && !node.src && buf) this.startBed(node, buf, entry, now);
      if (node.src) {
        // 素材就绪后约 1.5 s 淡入
        const tau = now - node.startedAt < 2 ? Math.max(plan.bedTau, 0.5) : plan.bedTau;
        if (snap) node.gain.gain.setValueAtTime(g, now);
        else node.gain.gain.setTargetAtTime(g, now, tau);
        const hz = Math.min(nyq, lv.lpf);
        if (snap) node.filter.frequency.setValueAtTime(hz, now);
        else node.filter.frequency.setTargetAtTime(hz, now, plan.bedTau);
        // 长时间静音的循环床停掉（同时活动的音源 ≤ 16）；需要时从循环中的另一处重新开始
        node.silentFor = g > 0 ? 0 : node.silentFor + dt;
        if (node.silentFor > 3) this.stopBed(node);
      }
    }
  }

  private startBed(node: BedNode, buf: AudioBuffer, entry: AudioEntry | undefined, now: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const [a, b] = entry?.loop ?? [0, buf.duration];
    src.loopStart = a;
    src.loopEnd = Math.min(b, buf.duration);
    src.connect(node.filter);
    // 从循环中由时钟决定的位置开始（不随机；也不会每次都从开头开始）
    const len = Math.max(0.1, src.loopEnd - a);
    src.start(now, a + ((now * 0.618) % len));
    node.gain.gain.cancelScheduledValues(now);
    node.gain.gain.setValueAtTime(0, now);
    node.src = src;
    node.silentFor = 0;
    node.startedAt = now;
  }

  private stopBed(node: BedNode): void {
    const src = node.src;
    node.src = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      /* 已停止 */
    }
    src.disconnect();
  }

  private playShot(c: PlayCmd, now: number): void {
    const ctx = this.ctx!;
    const buf = this.overrides.get(c.id);
    if (!buf) return;
    const at = Math.max(now, c.at);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let head: AudioNode = src;
    if (c.lpf) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = c.lpf;
      head = head.connect(lp);
    }
    const gain = ctx.createGain();
    // 声像：StereoPanner 对单声道素材是等功率的（居中时每声道 −3 dB，正好等于素材自身的响度）；
    // 不支持 StereoPanner 的浏览器上，单声道素材手动 −3 dB
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const mono = !panner && buf.numberOfChannels === 1 ? MONO_DB : 0;
    gain.gain.value = dbToGain(c.db - (this.catalog.get(c.id)?.lufs ?? -18) - mono);
    head = head.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(c.pan, at);
      if (c.panTo !== undefined) panner.pan.linearRampToValueAtTime(c.panTo, at + (c.panDur ?? 2));
      head = head.connect(panner);
    }
    head.connect(this.buses.get(c.duck) ?? this.buses.get('sfx')!);
    src.start(at);
    this.shots.set(c.vid, { src, gain, id: c.id });
    src.onended = () => {
      this.shots.delete(c.vid);
      src.disconnect();
    };
  }

  private fadeShot(c: FadeCmd, now: number): void {
    const s = this.shots.get(c.vid);
    if (!s) return;
    const g = s.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + c.dur);
    try {
      s.src.stop(now + c.dur + 0.05);
    } catch {
      /* 还没开始或已停止 */
    }
  }

  /** “新发现”的界面提示音（UI，不属于叙事，不被旁白压低；保留原来的三音轻钟，单独注明为合成） */
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
      g.gain.exponentialRampToValueAtTime(0.05, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.4);
      o.connect(g).connect(this.ui);
      o.start(s);
      o.stop(s + 1.5);
    });
  }
}

/** 单声道素材按双声道播放时多出来的响度（dB） */
const MONO_DB = 3.01;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
