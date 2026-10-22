import { clamp, sampleProfile, smoothstep } from '../core/math';

/**
 * 座头鲸（Megaptera novaeangliae）侧视几何模型。
 *
 * 局部坐标：原点位于身体参考点（沿体长 S_REF 处的脊线），+x 指向吻端，+y 向下，单位为米。
 * 身体由一条可弯曲的“脊线”加上背侧 / 腹侧剖面构成：
 *  - 游动：尾鳍上下摆动（须鲸靠尾叶上下拍水推进）；
 *  - 滤食：下颌绕颌关节张开，喉腹褶向下鼓起；
 *  - 静卧：脊线顺着腹部贴合海床。
 * 鲸鱼骨骼使用同一条脊线定位，保证分解时骨骼与身体严格对齐。
 */

export const WHALE_LEN = 14;
export const S_REF = 0.42;
/** 口角（颌关节）位置 */
export const S_GAPE = 0.26;
/** 眼睛位置 */
export const S_EYE = 0.282;
/** 胸鳍根部 */
export const S_FIN = 0.335;
/** 喷气孔 */
export const S_BLOW = 0.19;

type Profile = ReadonlyArray<readonly [number, number]>;

/** 背侧剖面（脊线上方的高度，米） */
export const UPPER: Profile = [
  [0, 0.16],
  [0.015, 0.34],
  [0.05, 0.54],
  [0.1, 0.77],
  [0.16, 0.98],
  [0.22, 1.16],
  [0.3, 1.36],
  [0.4, 1.48],
  [0.5, 1.44],
  [0.58, 1.3],
  [0.66, 1.08],
  [0.74, 0.84],
  [0.82, 0.6],
  [0.88, 0.45],
  [0.93, 0.34],
  [0.97, 0.27],
  [1, 0.22],
];

/** 腹侧剖面（脊线下方的深度，米） */
export const LOWER: Profile = [
  [0, 0.1],
  [0.015, 0.34],
  [0.05, 0.64],
  [0.1, 0.98],
  [0.16, 1.24],
  [0.22, 1.44],
  [0.3, 1.66],
  [0.38, 1.75],
  [0.46, 1.68],
  [0.54, 1.5],
  [0.62, 1.27],
  [0.7, 1.0],
  [0.78, 0.74],
  [0.85, 0.52],
  [0.9, 0.39],
  [0.95, 0.3],
  [1, 0.22],
];

export const LOWER_MAX = 1.75;

/** 背鳍：前缘缓升、后缘陡降的小镰刀形 */
function dorsalFin(s: number): number {
  if (s < 0.6 || s > 0.7) return 0;
  if (s < 0.668) return 0.3 * Math.pow((s - 0.6) / 0.068, 1.6);
  return 0.3 * Math.pow(1 - (s - 0.668) / 0.032, 0.7);
}

/** 嘴线：在脊线下方的距离（米），从吻端微微拱起后落向口角 */
export function mouthY(s: number): number {
  const t = clamp(s / S_GAPE);
  return 0.06 + 0.2 * t - 0.16 * Math.sin(Math.PI * t);
}

export interface WhaleShape {
  /** 尾鳍摆动幅度 0~1 */
  swim: number;
  phase: number;
  mouth: number;
  throat: number;
  /** 静卧海床程度 0~1 */
  rest: number;
  /** 下沉时的轻微弯曲 */
  bend: number;
  /** 软组织收缩（分解）0~1 */
  shrink: number;
}

export class WhaleBody {
  readonly n: number;
  readonly s: Float32Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  /** 向上的法线 */
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly up: Float32Array;
  readonly lo: Float32Array;
  /** 外轮廓点：背侧与腹侧（已含张嘴、鼓喉） */
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly bx: Float32Array;
  readonly by: Float32Array;
  /** 嘴唇：上颌唇线与（旋转后的）下颌唇线 */
  readonly gapeCount: number;
  readonly mux: Float32Array;
  readonly muy: Float32Array;
  readonly mlx: Float32Array;
  readonly mly: Float32Array;
  hingeX = 0;
  hingeY = 0;
  jawAngle = 0;
  tailAngle = 0;
  flukeAngle = 0;

  constructor(n = 52) {
    this.n = n;
    const mk = () => new Float32Array(n);
    this.s = mk();
    this.px = mk();
    this.py = mk();
    this.nx = mk();
    this.ny = mk();
    this.up = mk();
    this.lo = mk();
    this.ux = mk();
    this.uy = mk();
    this.bx = mk();
    this.by = mk();
    // 两端加密的采样
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.s[i] = 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(t, 0.92));
    }
    let g = 0;
    for (let i = 0; i < n; i++) if (this.s[i] <= S_GAPE) g = i + 1;
    this.gapeCount = g;
    this.mux = new Float32Array(g);
    this.muy = new Float32Array(g);
    this.mlx = new Float32Array(g);
    this.mly = new Float32Array(g);
  }

  /** 脊线的竖向位移（局部坐标） */
  static spineDY(s: number, sh: WhaleShape): number {
    const env = 0.04 + 0.96 * Math.pow(smoothstep(0.32, 1, s), 1.5);
    let dy = 0.62 * sh.swim * env * Math.sin(sh.phase - Math.PI * 2 * 0.72 * s);
    dy -= 0.07 * sh.swim * Math.sin(sh.phase + 0.7) * (1 - smoothstep(0, 0.45, s));
    // 惯性：每次拍尾后，整个身体随之轻微起伏（滞后于尾叶），并带有很小的俯仰
    dy += sh.swim * (0.09 * Math.sin(sh.phase - 1.3) + 0.035 * Math.sin(sh.phase - 0.9) * (s - S_REF) * 2.2);
    if (sh.rest > 0) {
      const lo = sampleProfile(LOWER, s);
      dy += sh.rest * (LOWER_MAX - lo) * 0.82;
    }
    if (sh.bend !== 0) dy += sh.bend * (s - 0.45) * (s - 0.45) * 3.2;
    return dy;
  }

  compute(sh: WhaleShape): void {
    const { n, s, px, py, nx, ny, up, lo } = this;
    const L = WHALE_LEN;
    for (let i = 0; i < n; i++) {
      px[i] = L * (S_REF - s[i]);
      py[i] = WhaleBody.spineDY(s[i], sh);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      // 沿 s 增大的切线方向（指向尾部）
      let tx = px[b] - px[a];
      let ty = py[b] - py[a];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      // 向上的法线：(−ty, tx) 对 tx≈−1 得到 (0,−1)
      nx[i] = -ty;
      ny[i] = tx;
      if (ny[i] > 0) {
        nx[i] = -nx[i];
        ny[i] = -ny[i];
      }
    }
    const shrinkU = sh.shrink;
    for (let i = 0; i < n; i++) {
      const si = s[i];
      let u = sampleProfile(UPPER, si) + dorsalFin(si);
      let l = sampleProfile(LOWER, si);
      if (shrinkU > 0) {
        // 软组织减少：轮廓向骨骼收缩（但保留整体形状）
        u = u * (1 - 0.42 * shrinkU);
        l = l * (1 - 0.3 * shrinkU);
      }
      up[i] = u;
      lo[i] = l;
    }

    // 颌关节与张嘴
    const jaw = sh.mouth * 0.74;
    this.jawAngle = jaw;
    const gi = this.indexAt(S_GAPE);
    const gm = mouthY(S_GAPE);
    this.hingeX = px[gi] - nx[gi] * gm;
    this.hingeY = py[gi] - ny[gi] * gm;
    const hx = this.hingeX;
    const hy = this.hingeY;

    for (let i = 0; i < n; i++) {
      const si = s[i];
      this.ux[i] = px[i] + nx[i] * up[i];
      this.uy[i] = py[i] + ny[i] * up[i];
      let bxv = px[i] - nx[i] * lo[i];
      let byv = py[i] - ny[i] * lo[i];
      let dnx = -nx[i];
      let dny = -ny[i];
      if (jaw > 0 && si < 0.56) {
        const w = si <= S_GAPE ? 1 : 1 - smoothstep(S_GAPE, 0.52, si);
        const a = jaw * w;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const rx = bxv - hx;
        const ry = byv - hy;
        bxv = hx + rx * c - ry * sn;
        byv = hy + rx * sn + ry * c;
        const ndx = dnx * c - dny * sn;
        const ndy = dnx * sn + dny * c;
        dnx = ndx;
        dny = ndy;
      }
      if (sh.throat > 0 && si > 0.03 && si < 0.58) {
        const t = (si - 0.03) / (0.58 - 0.03);
        const infl = sh.throat * 2.05 * Math.pow(Math.sin(Math.PI * t), 0.85) * (0.75 + 0.25 * t);
        bxv += dnx * infl;
        byv += dny * infl;
      }
      this.bx[i] = bxv;
      this.by[i] = byv;
    }

    for (let i = 0; i < this.gapeCount; i++) {
      const m = mouthY(s[i]);
      const x = px[i] - nx[i] * m;
      const y = py[i] - ny[i] * m;
      this.mux[i] = x;
      this.muy[i] = y;
      if (jaw > 0) {
        const c = Math.cos(jaw);
        const sn = Math.sin(jaw);
        const rx = x - hx;
        const ry = y - hy;
        this.mlx[i] = hx + rx * c - ry * sn;
        this.mly[i] = hy + rx * sn + ry * c;
      } else {
        this.mlx[i] = x;
        this.mly[i] = y;
      }
    }

    const tA = n - 3;
    this.tailAngle = Math.atan2(py[n - 1] - py[tA], px[n - 1] - px[tA]);
    const lead = 0.55 * sh.swim * Math.cos(sh.phase - Math.PI * 2 * 0.72);
    this.flukeAngle = this.tailAngle - lead;
  }

  indexAt(sv: number): number {
    const s = this.s;
    let lo = 0;
    let hi = this.n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (s[m] <= sv) lo = m;
      else hi = m;
    }
    return sv - s[lo] < s[hi] - sv ? lo : hi;
  }

  /**
   * 身体表面坐标 → 局部坐标。v∈[-1,1]：+1 为背侧轮廓，−1 为腹侧（未鼓起时）轮廓，0 为脊线。
   */
  point(sv: number, v: number, out: { x: number; y: number }): { x: number; y: number } {
    const s = this.s;
    let i = 0;
    while (i < this.n - 2 && s[i + 1] < sv) i++;
    const t = clamp((sv - s[i]) / (s[i + 1] - s[i] || 1));
    const px = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    const py = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    const nx = this.nx[i] + (this.nx[i + 1] - this.nx[i]) * t;
    const ny = this.ny[i] + (this.ny[i + 1] - this.ny[i]) * t;
    const h = v >= 0 ? this.up[i] + (this.up[i + 1] - this.up[i]) * t : this.lo[i] + (this.lo[i + 1] - this.lo[i]) * t;
    out.x = px + nx * h * v;
    out.y = py + ny * h * v;
    return out;
  }

  /** 脊线上 s 处偏移 off 米（正值向上）的点，以及该处切线角。 */
  frame(sv: number, off: number, out: { x: number; y: number; a: number }): { x: number; y: number; a: number } {
    const s = this.s;
    let i = 0;
    while (i < this.n - 2 && s[i + 1] < sv) i++;
    const t = clamp((sv - s[i]) / (s[i + 1] - s[i] || 1));
    const px = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    const py = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    const nx = this.nx[i] + (this.nx[i + 1] - this.nx[i]) * t;
    const ny = this.ny[i] + (this.ny[i + 1] - this.ny[i]) * t;
    out.x = px + nx * off;
    out.y = py + ny * off;
    // 头部朝向（指向 −s 方向）
    out.a = Math.atan2(nx, -ny);
    return out;
  }
}
