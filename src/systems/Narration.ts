import { clamp } from '../core/math';
import { CAPTIONS, secondsAt } from '../config/stages';

/**
 * Narration：旁白——一位女声朗读叙事字幕（public/assets/narration/，由 scripts/narration-tts.py 用开源的
 * 本地语音合成模型生成，见 docs/narration.md）。
 *
 *  - 每条字幕一段录音。故事正向播放、进入一条新字幕时开始朗读；从字幕中途进入（跳章节、滚动经过）时，
 *    只在还没过去太多的情况下才读，否则等下一条；
 *  - 暂停时旁白停在原处，继续播放时从停下的地方接着读；倒放、跳转时立即停止；
 *  - 上一条还没读完时，下一条等它读完再开始（等得太久就跳过）；
 *  - 说话时把环境声与音效压低（AudioManager.setDuck），让人声清楚。
 * 录音按需加载：第一次打开旁白（并且声音已解锁）时才下载。
 */

interface Clip {
  i: number;
  file: string;
  duration: number;
}

interface Playing {
  i: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** 在录音中的起点（秒）与开始的 AudioContext 时间 */
  offset: number;
  at: number;
}

export interface NarrationFrame {
  story: boolean;
  p: number;
  paused: boolean;
  /** 叙事推进速度（进度 / 秒） */
  velocity: number;
}

/** 进入一条字幕之后，最多过去这个比例的显示时间还会开始朗读 */
const LATE = 0.45;
/** 等上一条读完，最多等这么久（秒） */
const WAIT = 3.5;

export class Narration {
  enabled = true;
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private index: Clip[] | null = null;
  private readonly buffers = new Map<number, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private playing: Playing | null = null;
  /** 暂停时停下的位置 */
  private held: { i: number; offset: number } | null = null;
  /** 等待上一条读完的字幕与开始等待的时间 */
  private queued: { i: number; since: number } | null = null;
  private lastCap = -1;
  private lastP = -1;
  /** 0~1：正在说话（供压低环境声） */
  level = 0;
  /** 是否正在说话，与下一句旁白还有多少秒开始（按自动播放的节奏估计；不会开始时为 Infinity） */
  readonly state = { speaking: false, nextStartIn: Infinity };

  constructor(private readonly base = './assets/narration/') {}

  /** 声音解锁之后调用：旁白接在这个输出上（跟随静音与音量） */
  attach(ctx: AudioContext, out: AudioNode): void {
    this.ctx = ctx;
    this.out = out;
    if (this.enabled) void this.load();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop(0.25);
    else {
      // 打开时，如果正处在一条字幕的前半段，就从这条开始读
      this.lastCap = -1;
      void this.load();
    }
  }

  private load(): Promise<void> {
    if (this.loading || !this.ctx) return this.loading ?? Promise.resolve();
    const ctx = this.ctx;
    this.loading = (async () => {
      try {
        const res = await fetch(this.base + 'index.json');
        if (!res.ok) return;
        this.index = (await res.json()) as Clip[];
        // 按出场顺序逐个解码，先用到的先就绪
        for (const c of this.index) {
          try {
            const r = await fetch(this.base + c.file);
            if (!r.ok) continue;
            const buf = await ctx.decodeAudioData(await r.arrayBuffer());
            this.buffers.set(c.i, buf);
          } catch {
            /* 单条失败：跳过这一条 */
          }
        }
      } catch {
        /* 没有旁白资源：保持安静，字幕照常显示 */
      }
    })();
    return this.loading;
  }

  /** 当前进度所在的字幕（重叠时取后开始的那一条） */
  private captionAt(p: number): number {
    let k = -1;
    for (let i = 0; i < CAPTIONS.length; i++) if (p >= CAPTIONS[i].from && p < CAPTIONS[i].to) k = i;
    return k;
  }

  update(dt: number, f: NarrationFrame): void {
    const ctx = this.ctx;
    const speaking = !!this.playing && !!ctx && ctx.currentTime < this.playing.at + (this.playing.src.buffer!.duration - this.playing.offset) - 0.05;
    this.level = clamp(this.level + (speaking ? dt / 0.25 : -dt / 0.8));
    this.state.speaking = speaking && this.enabled;
    this.state.nextStartIn = this.nextIn(f, speaking);
    if (!ctx || !this.out) return;
    if (!this.enabled || !f.story) {
      if (this.playing) this.stop(0.3);
      this.held = null;
      this.queued = null;
      this.lastP = -1;
      return;
    }
    const p = f.p;
    const jumped = this.lastP >= 0 && (p < this.lastP - 1e-5 || p - this.lastP > 0.02);
    this.lastP = p;
    if (this.playing && !speaking) this.playing = null;

    // 倒放、跳转：立即停止，直到进入下一条新的字幕
    if (jumped || f.velocity < -1e-6) {
      if (this.playing) this.stop(0.2);
      this.held = null;
      this.queued = null;
      this.lastCap = this.captionAt(p);
      return;
    }
    // 暂停：停在原处
    if (f.paused) {
      if (this.playing) {
        const pl = this.playing;
        this.held = { i: pl.i, offset: pl.offset + (ctx.currentTime - pl.at) };
        this.stop(0.15);
      }
      return;
    }
    if (this.held) {
      const h = this.held;
      this.held = null;
      this.start(h.i, h.offset);
      return;
    }
    const cap = this.captionAt(p);
    if (cap !== this.lastCap && cap >= 0) {
      this.lastCap = cap;
      const c = CAPTIONS[cap];
      const into = (secondsAt(p) - secondsAt(c.from)) / Math.max(0.5, secondsAt(c.to) - secondsAt(c.from));
      if (into <= LATE) {
        if (this.playing) this.queued = { i: cap, since: ctx.currentTime };
        else this.start(cap, 0);
      }
    } else if (cap < 0) this.lastCap = -1;
    // 上一条读完之后接着读排队的那一条
    if (this.queued && !this.playing) {
      const q = this.queued;
      this.queued = null;
      if (ctx.currentTime - q.since < WAIT) this.start(q.i, 0);
    } else if (this.queued && ctx.currentTime - this.queued.since > WAIT) this.queued = null;
  }

  private nextIn(f: NarrationFrame, speaking: boolean): number {
    if (!this.enabled || !f.story || f.paused || f.velocity <= 0 || !this.ctx) return Infinity;
    if (this.queued && this.playing && speaking) {
      const pl = this.playing;
      return Math.max(0, pl.at + pl.src.buffer!.duration - pl.offset - this.ctx.currentTime);
    }
    let best = Infinity;
    for (let i = 0; i < CAPTIONS.length; i++) {
      const c = CAPTIONS[i];
      if (c.from > f.p && this.buffers.has(i)) best = Math.min(best, secondsAt(c.from) - secondsAt(f.p));
    }
    return best;
  }

  private start(i: number, offset: number): void {
    const ctx = this.ctx!;
    const buf = this.buffers.get(i);
    if (!buf || offset >= buf.duration - 0.1) return;
    if (this.playing) this.stop(0.2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + (offset > 0 ? 0.12 : 0.03));
    src.connect(gain).connect(this.out!);
    src.start(t, offset);
    this.playing = { i, src, gain, offset, at: t };
  }

  private stop(fade: number): void {
    const pl = this.playing;
    if (!pl || !this.ctx) return;
    this.playing = null;
    const t = this.ctx.currentTime;
    pl.gain.gain.cancelScheduledValues(t);
    pl.gain.gain.setValueAtTime(pl.gain.gain.value, t);
    pl.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      pl.src.stop(t + fade + 0.02);
    } catch {
      /* 已经停止 */
    }
  }
}
