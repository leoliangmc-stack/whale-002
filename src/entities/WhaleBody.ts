import { clamp, sampleProfile, smoothstep } from '../core/math';
import { ART_EYE_S } from './WhaleArt';

/**
 * 蓝鲸（Balaenoptera musculus）侧视几何模型。
 *
 * 局部坐标：原点位于身体参考点（沿体长 S_REF 处的脊线），+x 指向吻端，+y 向下，单位为米。
 * 身体由一条可弯曲的“脊线”加上背侧 / 腹侧剖面构成；脊线就是绘画中吻端尖到尾叶缺刻的体轴，
 * 剖面是从绘画（entities/WhaleArt.ts）的轮廓量出来的，所以碰撞、着陆与分解都与画面一致：
 *  - 游动：尾鳍上下摆动（须鲸靠尾叶上下拍水推进）；
 *  - 滤食：下颌绕颌关节张开，喉腹褶向下鼓起（画面在游动与张嘴两张画之间过渡）；
 *  - 下沉：尾柄、尾叶与头部的被动弯曲（由下沉动作层给出，见 systems/DescentMotion.ts）；
 *  - 静卧：躯干压入海底软泥，头部微微放低，尾柄顺着重量缓缓垂向海床，身体略向镜头一侧侧倾
 *    （见 restSpineDY / restRoll）。
 * 鲸鱼骨骼使用同一条脊线定位，保证分解时骨骼与身体严格对齐。
 */

/** 体长（米，吻端尖到尾叶缺刻）：一头成年的南极蓝鲸 */
export const WHALE_LEN = 24;
export const S_REF = 0.42;
/** 口角（颌关节）位置：嘴线从吻端一直延伸到眼睛下方稍后 */
export const S_GAPE = 0.255;
/** 眼睛位置（瞳孔，取自绘画） */
export const S_EYE = ART_EYE_S;
/** 胸鳍根部 */
export const S_FIN = 0.35;
/** 喷气孔：体长的 16%，头顶的防溅脊之后 */
export const S_BLOW = 0.16;

type Profile = ReadonlyArray<readonly [number, number]>;

/** 背侧剖面（脊线上方的高度，米），含很小、很靠后的背鳍（约在体长的四分之三处） */
export const UPPER: Profile = [
  [0, 0.08],
  [0.01, 0.265],
  [0.02, 0.397],
  [0.04, 0.558],
  [0.06, 0.691],
  [0.08, 0.814],
  [0.1, 0.908],
  [0.12, 1.05],
  [0.14, 1.173],
  [0.16, 1.362],
  [0.18, 1.523],
  [0.2, 1.589],
  [0.22, 1.57],
  [0.24, 1.618],
  [0.26, 1.712],
  [0.28, 1.816],
  [0.3, 1.901],
  [0.33, 1.987],
  [0.36, 2.043],
  [0.4, 2.129],
  [0.44, 2.204],
  [0.48, 2.242],
  [0.52, 2.261],
  [0.56, 2.251],
  [0.6, 2.204],
  [0.64, 2.157],
  [0.68, 2.072],
  [0.72, 1.987],
  [0.74, 1.949],
  [0.76, 1.977],
  [0.78, 2.091],
  [0.8, 2.176],
  [0.81, 1.722],
  [0.83, 1.58],
  [0.86, 1.41],
  [0.9, 1.239],
  [0.93, 1.05],
  [0.95, 0.908],
  [0.97, 0.7],
  [0.99, 0.445],
  [1, 0.293],
];

/** 腹侧剖面（脊线下方的深度，米）：修长的身体，喉腹褶一直延伸到腹部中段；不含胸鳍 */
export const LOWER: Profile = [
  [0, 0.12],
  [0.01, 0.426],
  [0.02, 0.624],
  [0.04, 0.88],
  [0.06, 1.05],
  [0.08, 1.258],
  [0.1, 1.447],
  [0.12, 1.599],
  [0.14, 1.703],
  [0.16, 1.807],
  [0.18, 1.883],
  [0.2, 1.977],
  [0.22, 2.091],
  [0.24, 2.176],
  [0.26, 2.251],
  [0.28, 2.299],
  [0.3, 2.346],
  [0.33, 2.403],
  [0.36, 2.422],
  [0.4, 2.422],
  [0.44, 2.4],
  [0.48, 2.318],
  [0.52, 2.242],
  [0.56, 2.119],
  [0.6, 1.977],
  [0.64, 1.797],
  [0.68, 1.674],
  [0.72, 1.495],
  [0.76, 1.277],
  [0.8, 1.154],
  [0.84, 1.126],
  [0.88, 1.126],
  [0.92, 1.135],
  [0.95, 1.041],
  [0.98, 0.937],
  [1, 0.842],
];

export const LOWER_MAX = 2.422;

/**
 * 张嘴滤食的那张画在头部的轮廓（米，脊线上方 / 下方）：吻部微微抬起，下颌落下，
 * 喉腹褶像气球一样鼓起，一直到胸鳍前方（s ≈ 0.44 之后与游动的画相同）。
 */
export const LUNGE_UP: Profile = [
  [0, 0.9],
  [0.01, 0.98],
  [0.02, 1.06],
  [0.04, 1.17],
  [0.06, 1.24],
  [0.08, 1.3],
  [0.1, 1.36],
  [0.12, 1.45],
  [0.14, 1.52],
  [0.16, 1.65],
  [0.18, 1.77],
  [0.2, 1.81],
  [0.22, 1.73],
  [0.24, 1.72],
  [0.26, 1.78],
  [0.28, 1.87],
  [0.3, 1.93],
  [0.32, 1.99],
  [0.34, 2.03],
  [0.36, 2.06],
  [0.38, 2.11],
  [0.4, 2.14],
  [0.42, 2.18],
  [0.44, 2.204],
];

export const LUNGE_LO: Profile = [
  [0, 1.7],
  [0.01, 1.9],
  [0.02, 2.09],
  [0.04, 2.45],
  [0.06, 2.74],
  [0.08, 2.98],
  [0.1, 3.16],
  [0.12, 3.27],
  [0.14, 3.32],
  [0.16, 3.32],
  [0.18, 3.29],
  [0.2, 3.26],
  [0.22, 3.22],
  [0.24, 3.15],
  [0.26, 3.07],
  [0.28, 2.97],
  [0.3, 2.87],
  [0.32, 2.74],
  [0.34, 2.65],
  [0.36, 2.59],
  [0.38, 2.51],
  [0.4, 2.45],
  [0.42, 2.39],
  [0.44, 2.4],
];

/** 嘴线（闭嘴时，在脊线下方的距离，米）：从吻端尖略高于体轴向后延伸，到眼睛下方急转向下，止于口角 */
const MOUTH: Profile = [
  [0, 0],
  [0.03, -0.095],
  [0.1, -0.12],
  [0.13, -0.18],
  [0.17, -0.24],
  [0.19, -0.15],
  [0.2, -0.06],
  [0.21, 0.1],
  [0.23, 0.3],
  [S_GAPE, 0.42],
];

// ------------------------------------------------------------------ 静卧姿态
// 一头几十吨重的身体落在软泥上：最重的胸腹部压进沉积物，头部顺着重量微微放低（下颌接近海床），
// 窄而长的尾柄缓缓垂向海床，在尾柄下方留下一道逐渐变窄的缝隙，尾叶贴近海床。
// 所有弯曲都是平滑的长弧线，躯干保持完整的解剖轮廓，不做压扁或拉伸。

/** 静卧时海床在鲸鱼局部坐标中的 y（参考点到海床的距离，米） */
export const REST_GROUND = 2.41;
/** 胸腹部压入沉积物的深度（米） */
const REST_SINK = 0.34;
/** 整体极轻的低头（每米体长的下沉量）：头骨更重，前半身压得更深 */
const REST_TILT = 0.01;
/** 头部在颈部附近平滑放低（米，吻端处） */
const REST_HEAD = 0.77;
/** 尾柄下垂（米，尾端处）：尾柄像一道低矮的拱，下方留出逐渐变窄的缝隙，尾叶落在海床上 */
const REST_TAIL = 1.4;
/** 身体向镜头一侧的侧倾（弧度）：近侧着地，背部稍稍转向镜头 */
export const REST_ROLL = 0.2;

/**
 * 静卧姿态的脊线位移（+y 向下）。r 为静卧程度 0~1，各部分按着陆的先后顺序完成：
 * 躯干先压入沉积物 → 头部放低 → 尾部最后落下（带极轻、很快消失的过冲）。
 */
export function restSpineDY(s: number, r = 1): number {
  if (r <= 0) return 0;
  const eb = smoothstep(0, 0.55, r);
  const eh = smoothstep(0.12, 0.72, r);
  const et = smoothstep(0.3, 0.9, r) + 0.04 * Math.sin(Math.PI * smoothstep(0.75, 1, r));
  const head = 1 - smoothstep(0.04, 0.42, s);
  // 尾柄：大部分是平缓的长弧，末端仍略向下倾斜（不在尾叶前急转），尾叶自己顺着关节平放在海床上
  const u = clamp((s - 0.42) / 0.58);
  const tail = 0.7 * Math.pow(u * u * (3 - 2 * u), 2.6) + 0.3 * u * u * u;
  return (
    eb * (REST_SINK + REST_TILT * (S_REF - s) * WHALE_LEN) +
    eh * REST_HEAD * head * head +
    et * REST_TAIL * tail
  );
}

/** 静卧侧倾（弧度）：头部略多、尾柄略少，形成一点自然的扭转 */
export function restRoll(s: number, r = 1): number {
  if (r <= 0) return 0;
  return REST_ROLL * smoothstep(0.25, 0.95, r) * (1.15 - 0.85 * smoothstep(0.35, 1, s));
}

/**
 * 侧倾后的表面位置：v = sin φ（φ 为横截面上的角度，近侧中线 φ=0），
 * 背部转向镜头 ρ 后，同一表面点在侧视中的高度为 sin(φ − ρ)。
 */
export function rollV(v: number, rho: number): number {
  if (rho === 0) return v;
  return Math.sin(Math.asin(clamp(v, -1, 1)) - rho);
}

/** 嘴线：在脊线下方的距离（米） */
export function mouthY(s: number): number {
  return sampleProfile(MOUTH, clamp(s, 0, S_GAPE));
}

/**
 * 滤食时下颌张开的最大角度（弧度，上下颌张角接近 90°）与喉腹褶鼓起的最大幅度（米）、范围。
 * 这里只给出近似的下缘轮廓与嘴唇线；画面上的张嘴见 Whale.drawLunge。
 */
const JAW_MAX = 1.3;
const THROAT_MAX = 1.35;
const THROAT_END = 0.44;

/**
 * 拍尾的不对称：尾叶上拍（鲸类主要的推进动作）比回程快一些，显得有力而不机械。
 * 输入为匀速前进的相位，输出为身体波动使用的相位（单调，平均速度不变）。
 */
export function strokeWarp(ph: number): number {
  return ph + 0.2 * Math.sin(ph - 1.38);
}

/**
 * 弓形的形状：以体轴中部（参考点）为顶，向头尾两端平滑下垂，参考点处位移与斜率都为零。
 * 尾端下垂 1，头部较短、较重，下垂 0.75；曲率沿身体连续变化，没有折角。
 */
export function archShape(s: number): number {
  if (s >= S_REF) {
    const t = (s - S_REF) / (1 - S_REF);
    return t * t * (1.15 - 0.15 * t);
  }
  const t = (S_REF - s) / S_REF;
  return 0.75 * t * t;
}

export interface WhaleShape {
  /** 尾鳍摆动幅度 0~1（氛围时钟驱动的主动游动） */
  swim: number;
  phase: number;
  /** 由叙事进度驱动的尾叶摆动（停止游动前最后几次渐弱的摆动） */
  beat: number;
  beatPh: number;
  mouth: number;
  throat: number;
  /** 静卧海床程度 0~1 */
  rest: number;
  /** 尾柄被动弯曲（米，正值上抬）：下沉时被自下而上的水流托起，转动时滞后 */
  flex: number;
  /** 头部被动俯仰（米，正值向下），幅度很小 */
  nod: number;
  /** 尾叶被动偏转（弧度，正值尾叶上翘） */
  fluke: number;
  /** 身体的弓形（米，头尾相对体轴中部下垂的量）：下沉时失去肌张力后的舒展弧线 */
  arc: number;
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
  /** 每个采样处的侧倾（弧度，静卧时） */
  readonly rl: Float32Array;
  /** 未收缩（分解前）的腹侧深度：鲸鱼在海床上压出的印痕始终按完整的身体计算 */
  readonly lo0: Float32Array;
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
    this.rl = mk();
    this.lo0 = mk();
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

  /** 尾叶上下摆动引起的脊线位移：幅度 amp、相位 ph。 */
  static beatDY(s: number, amp: number, ph: number): number {
    if (amp === 0) return 0;
    const env = 0.04 + 0.96 * Math.pow(smoothstep(0.32, 1, s), 1.5);
    let dy = 1.06 * amp * env * Math.sin(ph - Math.PI * 2 * 0.72 * s);
    dy -= 0.12 * amp * Math.sin(ph + 0.7) * (1 - smoothstep(0, 0.45, s));
    // 惯性：每次拍尾后，整个身体随之轻微起伏（滞后于尾叶），并带有很小的俯仰
    dy += amp * (0.15 * Math.sin(ph - 1.3) + 0.13 * Math.sin(ph - 0.9) * (s - S_REF));
    return dy;
  }

  /** 脊线的竖向位移（局部坐标） */
  static spineDY(s: number, sh: WhaleShape): number {
    let dy = WhaleBody.beatDY(s, sh.swim, sh.phase) + WhaleBody.beatDY(s, sh.beat, sh.beatPh);
    if (sh.rest > 0) dy += restSpineDY(s, sh.rest);
    // 被动弯曲沿身体平滑分布：尾柄从身体中后部开始逐渐弯起，头部只在眼睛之前有极轻的点头，
    // 躯干保持不动，因此头、躯干与尾柄之间始终是一条连续的曲线
    if (sh.flex !== 0) {
      const t = smoothstep(0.42, 1, s);
      dy -= sh.flex * t * t;
    }
    if (sh.nod !== 0) {
      const h = 1 - smoothstep(0, 0.38, s);
      dy += sh.nod * h * h;
    }
    if (sh.arc !== 0) dy += sh.arc * archShape(s);
    return dy;
  }

  compute(sh: WhaleShape): void {
    const { n, s, px, py, nx, ny, up, lo } = this;
    const L = WHALE_LEN;
    for (let i = 0; i < n; i++) {
      px[i] = L * (S_REF - s[i]);
      py[i] = WhaleBody.spineDY(s[i], sh);
    }
    // 静卧时的弯曲是“弯”而不是“拉长”：沿脊线保持每一段的长度，从参考点向两端重新排布 x
    if (sh.rest > 0) {
      const k = smoothstep(0, 0.3, sh.rest);
      const iRef = this.indexAt(S_REF);
      let x = px[iRef];
      for (let i = iRef + 1; i < n; i++) {
        const seg = L * (s[i] - s[i - 1]);
        const dy = py[i] - py[i - 1];
        x -= Math.sqrt(Math.max(seg * seg * 0.25, seg * seg - dy * dy));
        px[i] += (x - px[i]) * k;
      }
      x = px[iRef];
      for (let i = iRef - 1; i >= 0; i--) {
        const seg = L * (s[i + 1] - s[i]);
        const dy = py[i] - py[i + 1];
        x += Math.sqrt(Math.max(seg * seg * 0.25, seg * seg - dy * dy));
        px[i] += (x - px[i]) * k;
      }
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
      let u = sampleProfile(UPPER, si);
      let l = sampleProfile(LOWER, si);
      this.lo0[i] = l;
      if (shrinkU > 0) {
        // 软组织减少：轮廓向骨骼收缩（但保留整体形状）
        u = u * (1 - 0.42 * shrinkU);
        l = l * (1 - 0.3 * shrinkU);
      }
      up[i] = u;
      lo[i] = l;
      this.rl[i] = restRoll(si, sh.rest);
    }

    // 颌关节与张嘴
    const jaw = sh.mouth * JAW_MAX;
    this.jawAngle = jaw;
    const gi = this.indexAt(S_GAPE);
    const gm = this.rolledOff(gi, -mouthY(S_GAPE));
    this.hingeX = px[gi] + nx[gi] * gm;
    this.hingeY = py[gi] + ny[gi] * gm;
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
      if (jaw > 0 && si < 0.45) {
        const w = si <= S_GAPE ? 1 : 1 - smoothstep(S_GAPE, 0.42, si);
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
      if (sh.throat > 0 && si > 0.03 && si < THROAT_END) {
        const t = (si - 0.03) / (THROAT_END - 0.03);
        const infl = sh.throat * THROAT_MAX * Math.pow(Math.sin(Math.PI * t), 0.85) * (0.75 + 0.25 * t);
        bxv += dnx * infl;
        byv += dny * infl;
      }
      this.bx[i] = bxv;
      this.by[i] = byv;
    }

    for (let i = 0; i < this.gapeCount; i++) {
      // 嘴线是侧面的表面线：随侧倾一起移动（静卧时）
      const m = this.rolledOff(i, -mouthY(s[i]));
      const x = px[i] + nx[i] * m;
      const y = py[i] + ny[i] * m;
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
    const lead = 0.55 * (sh.swim * Math.cos(sh.phase - Math.PI * 2 * 0.72) + sh.beat * Math.cos(sh.beatPh - Math.PI * 2 * 0.72));
    // 静卧时尾叶如何落在海床上由 Whale 按画中尾叶的形状约束（见 Whale.flukeFor）
    this.flukeAngle = this.tailAngle - lead + sh.fluke;
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
    const rho = this.rl[i] + (this.rl[i + 1] - this.rl[i]) * t;
    const vr = rollV(v, rho);
    const h = vr >= 0 ? this.up[i] + (this.up[i + 1] - this.up[i]) * t : this.lo[i] + (this.lo[i + 1] - this.lo[i]) * t;
    out.x = px + nx * h * vr;
    out.y = py + ny * h * vr;
    return out;
  }

  /** 采样 i 处、离脊线 off 米（正值向上）的表面点在侧倾后的离脊线距离 */
  private rolledOff(i: number, off: number): number {
    const rho = this.rl[i];
    if (rho === 0) return off;
    const v = rollV(off >= 0 ? off / this.up[i] : off / this.lo[i], rho);
    return v * (v >= 0 ? this.up[i] : this.lo[i]);
  }

  /** 与 frame 相同，但 off 表示身体侧面的表面点（随侧倾移动，用于眼睛等侧面特征） */
  surfaceFrame(sv: number, off: number, out: { x: number; y: number; a: number }): { x: number; y: number; a: number } {
    const i = Math.min(this.n - 1, this.indexAt(sv));
    const rho = this.rl[i];
    if (rho !== 0) {
      const v = rollV(off >= 0 ? off / this.up[i] : off / this.lo[i], rho);
      off = v * (v >= 0 ? this.up[i] : this.lo[i]);
    }
    return this.frame(sv, off, out);
  }

  /** 局部坐标中，s 处腹侧轮廓（未鼓喉）的点 */
  belly(sv: number, out: { x: number; y: number }): { x: number; y: number } {
    const s = this.s;
    let i = 0;
    while (i < this.n - 2 && s[i + 1] < sv) i++;
    const t = clamp((sv - s[i]) / (s[i + 1] - s[i] || 1));
    const l = this.lo[i] + (this.lo[i + 1] - this.lo[i]) * t;
    out.x = this.px[i] + (this.px[i + 1] - this.px[i]) * t - (this.nx[i] + (this.nx[i + 1] - this.nx[i]) * t) * l;
    out.y = this.py[i] + (this.py[i + 1] - this.py[i]) * t - (this.ny[i] + (this.ny[i + 1] - this.ny[i]) * t) * l;
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
