import { mod, smootherstep } from './math';

/** 关键帧：[进度, 数值] */
export type Keys = ReadonlyArray<readonly [number, number]>;

export type TrackMode = 'smooth' | 'linear' | 'ease' | 'step';

export interface TrackOptions {
  /** 循环轨道：定义域为 [0,1)，首尾按 C1 连续衔接。 */
  cyclic?: boolean;
  /**
   * smooth：单调三次 Hermite（C1 连续、不过冲），适合镜头与位移；
   * ease：每段两端速度为 0，适合“到点停住”的动作；
   * linear / step：线性与阶跃。
   */
  mode?: TrackMode;
}

/**
 * 关键帧轨道。叙事中所有随进度变化的量（镜头、鲸鱼位置、光照……）都由轨道求值，
 * 因此正向播放、反向回退和重播天然得到完全一致的画面。
 */
export class Track {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly ms: number[];
  private readonly cyclic: boolean;
  private readonly mode: TrackMode;

  constructor(keys: Keys, opts: TrackOptions = {}) {
    if (keys.length === 0) throw new Error('Track requires at least one key');
    this.cyclic = !!opts.cyclic;
    this.mode = opts.mode ?? 'smooth';
    const sorted = [...keys].sort((a, b) => a[0] - b[0]);
    let xs = sorted.map((k) => k[0]);
    let ys = sorted.map((k) => k[1]);
    if (this.cyclic) {
      // 前后各复制一圈，使边界处的切线由相邻周期决定。
      const preX = xs.map((x) => x - 1);
      const postX = xs.map((x) => x + 1);
      xs = [...preX, ...xs, ...postX];
      ys = [...ys, ...ys, ...ys];
    }
    this.xs = xs;
    this.ys = ys;
    this.ms = Track.tangents(xs, ys);
  }

  static constant(v: number): Track {
    return new Track([[0, v]]);
  }

  /** Fritsch–Butland 单调切线。 */
  private static tangents(xs: number[], ys: number[]): number[] {
    const n = xs.length;
    const ms = new Array<number>(n).fill(0);
    if (n < 2) return ms;
    const d: number[] = [];
    const h: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1] - xs[i];
      d[i] = h[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / h[i];
    }
    ms[0] = d[0];
    ms[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      const d0 = d[i - 1];
      const d1 = d[i];
      if (d0 * d1 <= 0) {
        ms[i] = 0;
      } else {
        const h0 = h[i - 1];
        const h1 = h[i];
        ms[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
      }
    }
    return ms;
  }

  at(p: number): number {
    const xs = this.xs;
    const ys = this.ys;
    const n = xs.length;
    if (n === 1) return ys[0];
    let x = this.cyclic ? mod(p, 1) : p;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    // 二分查找所在区间
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const x0 = xs[lo];
    const x1 = xs[hi];
    const y0 = ys[lo];
    const y1 = ys[hi];
    const hgap = x1 - x0;
    if (hgap <= 0) return y1;
    const t = (x - x0) / hgap;
    switch (this.mode) {
      case 'step':
        return y0;
      case 'linear':
        return y0 + (y1 - y0) * t;
      case 'ease':
        return y0 + (y1 - y0) * smootherstep(0, 1, t);
      default: {
        const t2 = t * t;
        const t3 = t2 * t;
        return (
          (2 * t3 - 3 * t2 + 1) * y0 +
          (t3 - 2 * t2 + t) * hgap * this.ms[lo] +
          (-2 * t3 + 3 * t2) * y1 +
          (t3 - t2) * hgap * this.ms[hi]
        );
      }
    }
  }

  /** 数值导数（单位：数值 / 进度）。 */
  slope(p: number, eps = 1e-4): number {
    return (this.at(p + eps) - this.at(p - eps)) / (2 * eps);
  }
}

export type TrackSet<K extends string> = Record<K, Track>;

/** 由多通道关键帧一次性构建轨道组。 */
export function makeTracks<K extends string>(
  channels: Record<K, Keys>,
  opts: TrackOptions = {},
): TrackSet<K> {
  const out = {} as TrackSet<K>;
  for (const k of Object.keys(channels) as K[]) out[k] = new Track(channels[k], opts);
  return out;
}

export function evalTracks<K extends string>(set: TrackSet<K>, p: number, out: Record<K, number>): Record<K, number> {
  for (const k in set) out[k] = set[k].at(p);
  return out;
}
