import { CYCLE_SECONDS, segmentAt, segmentScreens, SEGMENTS } from '../config/stages';
import { clamp, damp } from '../core/math';

/**
 * StoryProgressController：叙事进度的唯一来源。
 *
 *  - target：用户输入（滚轮 / 触摸 / 键盘）与自动播放共同推动的目标进度（累计值，含圈数）；
 *  - shown：实际用于渲染的进度，以受限速度追赶 target。关键镜头处最高速度更低，
 *    因此快速滚动也会“快放”经过关键镜头，而不会直接跳过；
 *  - 进度是累计值：shown 越过整数即完成一圈，取小数部分即 storyProgress，首尾天然无缝。
 */

export interface ProgressEvents {
  onLoop?: (cycles: number) => void;
}

export { SCREENS_PER_CYCLE } from '../config/stages';
/** 用户停止输入后多久恢复自动播放（秒） */
const RESUME_DELAY = 1.6;
/** target 领先 shown 的最大距离（避免输入“攒”太多） */
const MAX_LEAD = 0.045;

export class StoryProgressController {
  shown = 0;
  target = 0;
  playing = true;
  /** 实际推进速度（进度 / 秒，平滑后） */
  velocity = 0;
  private autoRate = 0;
  private idle = 99;
  private loops = 0;

  constructor(private readonly events: ProgressEvents = {}) {}

  /** 当前循环内的进度 [0,1) */
  get p(): number {
    return this.shown - Math.floor(this.shown);
  }

  get cycles(): number {
    return Math.floor(this.shown);
  }

  /** 用户滚动：delta 为进度增量（正值向前）。 */
  scrollBy(delta: number): void {
    this.target += delta;
    this.idle = 0;
    this.clampTarget();
  }

  /** 用户滚动：以屏幕高度为单位（正值向前）。每一段按各自的滚动长度换算成进度。 */
  scrollScreens(screens: number): void {
    this.scrollBy(StoryProgressController.advance(this.target, screens) - this.target);
  }

  /** 从累计进度 total 出发滚动 screens 个屏幕高度后的累计进度（不低于 0）。 */
  static advance(total: number, screens: number): number {
    const t0 = Math.max(0, total);
    let base = Math.floor(t0);
    let p = t0 - base;
    let i = SEGMENTS.findIndex((x) => p >= x.from && p < x.to);
    if (i < 0) i = SEGMENTS.length - 1;
    let rem = screens;
    // 逐段推进；用段序号而不是进度值查找下一段，避免浮点误差停在段边界上
    for (let guard = 0; guard < 400; guard++) {
      const g = SEGMENTS[i];
      const perScreen = (g.to - g.from) / segmentScreens(g);
      if (rem >= 0) {
        const room = (g.to - p) / perScreen;
        if (rem <= room) return base + p + rem * perScreen;
        rem -= room;
        if (++i >= SEGMENTS.length) {
          i = 0;
          base += 1;
        }
        p = SEGMENTS[i].from;
      } else {
        const room = (p - g.from) / perScreen;
        if (-rem <= room) return Math.max(0, base + p + rem * perScreen);
        rem += room;
        if (--i < 0) {
          if (base === 0) return 0;
          i = SEGMENTS.length - 1;
          base -= 1;
        }
        p = SEGMENTS[i].to;
      }
    }
    return Math.max(0, base + p);
  }

  /** 立即跳转（配合画面溶解过渡使用）。 */
  jumpTo(p: number, keepCycle = true): void {
    const base = keepCycle ? Math.floor(this.shown) : 0;
    this.shown = this.target = Math.max(0, base + p);
    this.velocity = 0;
    this.idle = 0;
  }

  restart(): void {
    this.shown = this.target = 0;
    this.velocity = 0;
    this.loops = 0;
    this.idle = 99;
  }

  setPlaying(v: boolean): void {
    this.playing = v;
    if (v) this.idle = RESUME_DELAY;
    else {
      // 暂停：立即停止自动推进，只保留极短的缓停
      this.autoRate = 0;
      this.target = this.shown + Math.max(0, this.velocity) * 0.12;
    }
  }

  /** 自动播放速度（进度 / 秒） */
  static rateAt(p: number): number {
    const s = segmentAt(p);
    return (s.to - s.from) / s.seconds;
  }

  /** 快速滚动时允许的最高速度（进度 / 秒） */
  static maxSpeedAt(p: number): number {
    const s = segmentAt(p);
    const minSeconds = s.seconds * (s.key ? 0.3 : 0.16);
    return Math.max(1 / 140, (s.to - s.from) / Math.max(0.6, minSeconds));
  }

  private clampTarget(): void {
    if (this.target > this.shown + MAX_LEAD) this.target = this.shown + MAX_LEAD;
    if (this.target < this.shown - MAX_LEAD) this.target = this.shown - MAX_LEAD;
    if (this.target < 0) this.target = 0;
  }

  update(dt: number): void {
    this.idle += dt;
    const p = this.p;
    // 自动播放：按每段设定的节奏推进，速度平滑变化
    const wantAuto = this.playing && this.idle > RESUME_DELAY ? StoryProgressController.rateAt(p) : 0;
    this.autoRate = damp(this.autoRate, wantAuto, 1.6, dt);
    if (this.autoRate > 1e-6) this.target += this.autoRate * dt;
    this.clampTarget();

    const diff = this.target - this.shown;
    const maxV = StoryProgressController.maxSpeedAt(p);
    // 追赶：指数逼近 + 限速
    let v = diff * 3.2;
    if (Math.abs(diff) < 1e-5) v = 0;
    v = clamp(v, -maxV, maxV);
    // 自动播放时保证速度不低于自动速度（避免追赶滞后造成的减速）
    if (this.autoRate > 0 && diff > 0 && v < this.autoRate) v = Math.min(this.autoRate, diff / Math.max(dt, 1e-3));
    const before = this.shown;
    this.shown = Math.max(0, this.shown + v * dt);
    this.velocity = damp(this.velocity, (this.shown - before) / Math.max(dt, 1e-4), 6, dt);
    const loops = Math.floor(this.shown);
    if (loops > this.loops) {
      this.loops = loops;
      this.events.onLoop?.(loops);
    }
  }

  /** 把像素滚动量换算为屏幕高度。 */
  static pixelsToScreens(px: number, viewportH: number): number {
    return px / Math.max(320, viewportH);
  }
}

export const TOTAL_AUTOPLAY_SECONDS = CYCLE_SECONDS;
export const SEGMENT_COUNT = SEGMENTS.length;
