import { clamp, lerp, noise1, sampleProfile, smoothstep, TAU } from '../core/math';
import { Track, type Keys } from '../core/Track';
import { secondsAt, SEGMENTS, WORLD } from '../config/stages';
import { finNeutral, finNormal, type Vec3 } from '../entities/FinGeometry';
import { S_REF, UPPER, WHALE_LEN } from '../entities/WhaleBody';

/**
 * DescentMotion：鲸鱼从停止游动、失去平衡、稳定下沉到落上海床的一整段连续动作。
 *
 * 设计要点：
 *  1. 动作来自一个简化的物理模型（推力、浮力变化、二次阻力、头重力矩、水流、海床接触），
 *     在“故事时间”（自动播放时的秒数）上积分一次并制成查找表。查表只依赖叙事进度，
 *     因此前进、倒退、暂停和任意跳转都得到同一个位置、姿态与镜头状态；
 *  2. 尾柄、尾叶、胸鳍和头部是独立的被动动画层，由二阶阻尼跟随产生不同程度的惯性与滞后；
 *     胸鳍是以肩关节为铰链的被动硬桨（见 entities/FinGeometry.ts）：水动力把它像风向标一样转向相对水流，
 *     水流把它推向身体时才被体侧挡住、顺着体侧向后。肚子朝上低头下沉时，海水从吻端流向尾部、同时自下而上
 *     流过，朝上的胸鳍被托离身体、顺着水流斜向后上方，并随涡旋脱落与水流扰动不停地轻轻摆动；
 *     接近海床、下沉放缓时水流变弱，胸鳍回到画中的姿态；
 *  3. 停止游动、开始下沉之后，身体一边下沉一边缓缓翻过来（约 35 秒），之后保持肚子朝上，背部先着地，
 *     肚子朝上躺在海床上；
 *  4. 1800 米的下沉被艺术化压缩：鲸鱼相对周围水体的“可见下沉”只有约 3.5 m/s，
 *     其余的深度（hidden）由镜头与鲸鱼一起整体带走。海洋雪与途中的生物跟随“水体参照系”，
 *     因此画面里是一头巨大的身体在水中缓慢下沉，而深度计、光照与水色仍按真实深度变化。
 *     海床同样锚定在水体参照系中（锚点是接触海床的那一刻），压缩在接触之前结束，
 *     所以海床从幽暗中显现、迎上来的速度，就是鲸鱼相对水体的下沉速度。
 */

/** 下沉动作覆盖的进度范围（之前与之后由普通关键帧轨道接管） */
export const DESCENT_START = 0.262;
export const DESCENT_END = 0.512;
/** 腹部接触海床的时刻（沉积物云从这里扬起） */
export const CONTACT_P = 0.497;
/** 最后与静卧姿态精确对齐的过渡段 */
const SETTLE_P = 0.503;

// ------------------------------------------------------------------ 动作脚本（按进度给出的控制量）
// 每条轨道都是平滑插值，物理模型在其上积分，所以控制量的变化不会直接变成姿态的突变。

/** 尾叶摆动幅度：闭眼时接过游动，侧面中远景中最后几次摆动渐弱 */
const BEAT_AMP: Keys = [
  [DESCENT_START, 0], [0.272, 0.22], [0.282, 0.4], [0.298, 0.42], [0.304, 0.33], [0.309, 0.2],
  [0.314, 0.09], [0.318, 0.03], [0.322, 0],
];
/** 摆动频率（Hz）：一次比一次慢 */
const BEAT_FREQ: Keys = [[DESCENT_START, 0.15], [0.292, 0.16], [0.302, 0.14], [0.31, 0.11], [0.32, 0.075]];
/**
 * 失去浮力后的净下沉加速度（m/s²）。不是坠落，而是缓慢、安静地漂向深海：
 * 终端下沉速度只有约 2.3 m/s，低头的身体同时顺着体轴向前滑行（见 GLIDE）。
 */
const SINK: Keys = [
  [DESCENT_START, 0], [0.326, 0], [0.332, 0.05], [0.339, 0.26], [0.347, 0.46], [0.365, 0.5], [0.41, 0.47],
  [0.45, 0.43], [0.475, 0.37], [0.492, 0.3], [DESCENT_END, 0.3],
];
/**
 * 身体的弓形程度（0~1，见 WhaleBody.archAngle）：失去肌张力之后，身体从浮力最大的胸腹部“挂”下来，
 * 沉重的头部与前半身斜向下方，尾柄顺着一道长弧垂下。弓形随低头一起形成（尾部因此几乎留在原来的高度），
 * 在深海中保持；接近海床时随下沉放缓而舒展开，交给静卧姿态。
 */
const ARC: Keys = [
  [DESCENT_START, 0], [0.322, 0], [0.328, 0.03], [0.334, 0.14], [0.34, 0.38], [0.346, 0.63], [0.352, 0.83],
  [0.36, 0.95], [0.368, 1], [0.44, 1], [0.452, 0.9], [0.462, 0.66], [0.472, 0.37], [0.48, 0.17], [0.487, 0.06],
  [CONTACT_P, 0.02], [DESCENT_END, 0],
];
/**
 * 低头的目标角度（弧度，胸部体轴的俯仰）：头部更重，身体慢慢转成约 43° 的低头姿态并保持，
 * 接近海床时，水垫让下沉放缓，身体缓缓放平，前腹先触底。
 * 力矩 = PITCH_K ×（目标 − 当前），所以姿态是被“拉”过去的，带着惯性与滞后，而不是直接设定。
 */
const TILT: Keys = [
  [DESCENT_START, 0], [0.322, 0], [0.328, 0.05], [0.334, 0.2], [0.34, 0.42], [0.346, 0.61], [0.352, 0.71],
  [0.36, 0.775], [0.41, 0.77], [0.44, 0.74], [0.452, 0.62], [0.462, 0.43], [0.472, 0.24], [0.482, 0.09],
  [0.49, 0.035], [0.497, 0.02], [DESCENT_END, 0],
];
/**
 * 翻身（弧度，0 背部朝上，π 肚子朝上）：开始下沉的同时，失去控制的身体一边下沉一边慢慢翻过来
 * （约 35 秒，开始与结束时转得最慢，转到一半时腹部朝向镜头）；之后一直保持肚子朝上（参考画面），
 * 不再翻回来，背部先触底，肚子朝上躺在海床上。
 */
const ROLL: Keys = [
  [DESCENT_START, 0], [0.327, 0], [0.333, 0.1], [0.34, 0.34], [0.348, 0.72], [0.357, 1.2], [0.367, 1.75],
  [0.377, 2.28], [0.387, 2.72], [0.396, 3.0], [0.404, Math.PI], [DESCENT_END, Math.PI],
];
/** 胸鳍：水流速度为 FIN_U0 时，水动力与回到自然姿态的趋势（重力、关节）各占一半 */
const FIN_U0 = 0.6;
/** 胸鳍根部的形状让它离开体侧一点（外法线方向的偏置），被水流压向身体时也留出的最小夹角 */
const FIN_OUT = 0.3;
const FIN_GAP = 0.08;
/** 贴近海床时被挤压的水垫阻力（线性阻尼） */
const CUSHION: Keys = [[DESCENT_START, 0], [0.464, 0], [0.478, 0.22], [0.488, 0.7], [0.495, 1.5], [DESCENT_END, 2.2]];
/** 深度压缩的速度形状（0~1）：离开海面光区之后才开始，接触海床之前结束 */
const HIDE: Keys = [[DESCENT_START, 0], [0.342, 0], [0.356, 1], [0.415, 1], [0.462, 0], [DESCENT_END, 0]];
/** 水流扰动强度：稳定下沉时最明显，深海中更安静，着陆后消失 */
const STIR: Keys = [
  [DESCENT_START, 0.25], [0.31, 0.35], [0.34, 0.8], [0.365, 1], [0.4, 0.8], [0.45, 0.65], [0.49, 0.3],
  [CONTACT_P, 0], [DESCENT_END, 0],
];

// ------------------------------------------------------------------ 物理参数（单位质量）
// 24 米的身体：长度与速度一起按体长放大，节奏（秒）不变，所以二次阻力系数按体长缩小、推力按体长放大

const DRAG_X2 = 0.175;
const DRAG_X1 = 0.25;
const DRAG_Y2 = 0.064;
const DRAG_Y1 = 0.06;
/** 尾叶推力系数：幅度 × 频率 → 推力 */
const THRUST = 4.3;
/** 低头下沉时顺着体轴向前滑一点：低垂的头部带着身体斜斜地沉向深处，但仍然是在下沉，而不是游下去 */
const GLIDE = 0.26;
/** 俯仰：自然频率约 9 秒、接近临界阻尼，只会有一次很轻的回摆 */
const PITCH_K = 0.49;
const PITCH_C = 1.26;
/** 绕身体参考点的转动惯量（≈ L²/12） */
const INERTIA = (WHALE_LEN * WHALE_LEN) / 12;

const SIM_DT = 1 / 120;
const SAMPLE_HZ = 60;

/** 着地一侧轮廓上的接触采样点（局部坐标，+y 向下）：肚子朝上落在海床上，着地的是背侧 */
const CONTACTS = [0.02, 0.06, 0.1, 0.16, 0.22, 0.28, 0.34, 0.4, 0.46, 0.54, 0.62, 0.7, 0.8, 0.9, 0.97].map((s) => ({
  x: WHALE_LEN * (S_REF - s),
  y: sampleProfile(UPPER, s),
}));

/** 二阶阻尼跟随：被动部件的惯性与滞后（ζ < 1 时有一次轻微回摆） */
class Lag2 {
  x = 0;
  v = 0;
  constructor(
    private readonly w: number,
    private readonly z: number,
  ) {}

  reset(x: number): void {
    this.x = x;
    this.v = 0;
  }

  step(target: number, dt: number, targetVel = 0, feed = 0): number {
    const a = this.w * this.w * (target - this.x) + 2 * this.z * this.w * (feed * targetVel - this.v);
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const CHANNELS = [
  'x', 'y', 'pitch', 'beat', 'beatPh', 'flex', 'nod', 'fluke', 'fnA', 'fnH', 'fnZ', 'ffA', 'ffH', 'ffZ', 'arc', 'roll', 'fin',
  'vx', 'vy', 'lagX', 'lagY', 'hidden', 'waterX', 'waterY',
] as const;
type Channel = (typeof CHANNELS)[number];

/** 某一进度下的完整动作状态 */
export type DescentSample = Record<Channel, number>;

/**
 * 一侧胸鳍（以肩关节为铰链的被动硬桨）：目标方向是相对水流的方向（被体侧挡住时贴着体侧顺向后方），
 * 水流越弱越接近画中的自然姿态；叠加缓慢的水流扰动与涡旋脱落引起的轻微颤动。
 * 方向向量的三个分量各自做二阶跟随，得到惯性与滞后，采样时归一化。
 */
class FinSim {
  private readonly la = new Lag2(TAU / 2.5, 0.4);
  private readonly lh = new Lag2(TAU / 2.5, 0.4);
  private readonly lz = new Lag2(TAU / 2.5, 0.4);
  private readonly n: Vec3 = { a: 0, h: 0, z: 0 };
  private readonly g: Vec3 = { a: 0, h: 0, z: 0 };
  readonly t: Vec3 = { a: 0, h: 0, z: 0 };
  readonly out: Vec3 = { a: 0, h: 0, z: 0 };

  constructor(
    private readonly side: number,
    private readonly seed: number,
  ) {}

  /**
   * wa / wh：相对水流（m/s）沿体轴流向尾部、垂直于体轴流向局部上方的分量；
   * k：水动力的权重上限（开始与着陆时为 0，回到画中的姿态）；stir：水流扰动强度。
   */
  target(rho: number, wa: number, wh: number, k: number, stir: number, t: number): Vec3 {
    const n = finNormal(this.side, rho, this.n);
    const T = finNeutral(rho, this.t);
    const U = Math.hypot(wa, wh);
    const g = this.g;
    const w = U > 1e-4 ? ((U * U) / (U * U + FIN_U0 * FIN_U0)) * k : 0;
    if (w > 0) {
      g.a = wa / U + FIN_OUT * n.a;
      g.h = wh / U + FIN_OUT * n.h;
      g.z = FIN_OUT * n.z;
      unit(g);
      push(g, n, FIN_GAP);
      T.a += (g.a - T.a) * w;
      T.h += (g.h - T.h) * w;
      T.z += (g.z - T.z) * w;
      unit(T);
    }
    // 扰动：e1 是离开身体的方向（外法线中垂直于目标方向的部分），e2 = T × e1
    const d = n.a * T.a + n.h * T.h + n.z * T.z;
    const e1 = { a: n.a - d * T.a, h: n.h - d * T.h, z: n.z - d * T.z };
    unit(e1);
    const sd = this.seed;
    const slow = stir * (0.17 * noise1(t * 0.19, sd) + 0.08 * noise1(t * 0.43, sd + 1));
    const flutter = w * 0.075 * Math.sin(TAU * 0.55 * t + 2.5 * noise1(t * 0.11, sd + 2));
    const lat = stir * 0.1 * noise1(t * 0.23, sd + 3) + w * 0.03 * Math.sin(TAU * 0.71 * t + 1.7 * noise1(t * 0.09, sd + 4));
    const u1 = slow + flutter;
    T.a += u1 * e1.a + lat * (T.h * e1.z - T.z * e1.h);
    T.h += u1 * e1.h + lat * (T.z * e1.a - T.a * e1.z);
    T.z += u1 * e1.z + lat * (T.a * e1.h - T.h * e1.a);
    unit(T);
    push(T, n, FIN_GAP * 0.5);
    return T;
  }

  reset(v: Vec3): void {
    this.la.reset(v.a);
    this.lh.reset(v.h);
    this.lz.reset(v.z);
  }

  step(v: Vec3, dt: number): void {
    this.la.step(v.a, dt);
    this.lh.step(v.h, dt);
    this.lz.step(v.z, dt);
  }

  /** 当前方向（跟随的滞后可能让它略微压向体侧，这里同样挡住） */
  sample(rho: number): Vec3 {
    const o = this.out;
    o.a = this.la.x;
    o.h = this.lh.x;
    o.z = this.lz.x;
    unit(o);
    push(o, finNormal(this.side, rho, this.n), FIN_GAP * 0.5);
    return o;
  }
}

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v.a, v.h, v.z) || 1;
  v.a /= l;
  v.h /= l;
  v.z /= l;
  return v;
}

/** 不让方向穿进身体：与外法线的夹角余弦至少为 gap */
function push(v: Vec3, n: Vec3, gap: number): void {
  const d = v.a * n.a + v.h * n.h + v.z * n.z;
  if (d >= gap) return;
  v.a += (gap - d) * n.a;
  v.h += (gap - d) * n.h;
  v.z += (gap - d) * n.z;
  unit(v);
}

export interface DescentInit {
  x: number;
  y: number;
  pitch: number;
  /** 初始速度（每秒） */
  vx: number;
  vy: number;
  vp: number;
}

export function makeDescentSample(): DescentSample {
  const o = {} as DescentSample;
  for (const c of CHANNELS) o[c] = 0;
  return o;
}

/** 给定俯仰角时，身体最低点在参考点下方的距离 */
export function lowestBelow(pitch: number): number {
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  let m = -1e9;
  for (const p of CONTACTS) m = Math.max(m, p.x * s + p.y * c);
  return m;
}

export class DescentMotion {
  /** 故事时间（秒）的起点与长度 */
  readonly t0 = secondsAt(DESCENT_START);
  readonly duration = secondsAt(DESCENT_END) - secondsAt(DESCENT_START);
  private readonly n: number;
  private readonly tab = {} as Record<Channel, Float64Array>;
  /** 鲸鱼在水体参照系中的深度（用于把途中的生物锚定在水中） */
  private readonly wy: Float64Array;
  /** 压缩速度的幅度（m/s），由“准时接触海床”反求 */
  readonly hideSpeed: number;
  readonly restX = WORLD.restX;
  readonly restY: number;

  constructor(
    private readonly init: DescentInit,
    restY: number,
  ) {
    this.restY = restY;
    this.n = Math.ceil(this.duration * SAMPLE_HZ) + 2;
    for (const c of CHANNELS) this.tab[c] = new Float64Array(this.n);
    this.wy = new Float64Array(this.n);

    // 第一遍：不考虑压缩与海床，得到可见下沉与姿态，据此求出压缩幅度
    const pre = this.simulate(0, false, false);
    const tc = secondsAt(CONTACT_P) - this.t0;
    const k = Math.min(this.n - 1, Math.round(tc * SAMPLE_HZ));
    const need = WORLD.seabedY - lowestBelow(pre.pitch[k]) - pre.y[k];
    this.hideSpeed = need / Math.max(1e-6, pre.hideInt[k]);
    // 第二遍：完整模拟
    this.simulate(this.hideSpeed, true, true);
    this.finish();
  }

  /** 进度 → 故事时间（秒，相对起点） */
  tau(p: number): number {
    return secondsAt(p) - this.t0;
  }

  /** 故事时间 → 进度（时间单调增加时按段顺序推进，比逐次查找快） */
  private progressMapper(): (t: number) => number {
    let i = SEGMENTS.findIndex((s) => DESCENT_START >= s.from && DESCENT_START < s.to);
    let base = secondsAt(SEGMENTS[i].from);
    return (t: number) => {
      const sec = this.t0 + Math.min(t, this.duration);
      while (i < SEGMENTS.length - 1 && sec > base + SEGMENTS[i].seconds) base += SEGMENTS[i++].seconds;
      const g = SEGMENTS[i];
      return g.from + ((sec - base) / g.seconds) * (g.to - g.from);
    };
  }

  /**
   * 在故事时间上积分动作，并按 SAMPLE_HZ 采样写入查找表。
   * passive=false 时只计算主体运动（用于第一遍求压缩幅度）。
   */
  private simulate(hideSpeed: number, contact: boolean, passive: boolean): { y: Float64Array; pitch: Float64Array; hideInt: Float64Array } {
    const tr = (k: Keys) => new Track(k);
    const beatAmp = tr(BEAT_AMP);
    const beatFreq = tr(BEAT_FREQ);
    const sinkT = tr(SINK);
    const tiltT = tr(TILT);
    const cushT = tr(CUSHION);
    const hideT = tr(HIDE);
    const stirT = tr(STIR);
    const arcT = tr(ARC);
    const rollT = tr(ROLL);

    const T = this.tab;
    const hideInt = new Float64Array(this.n);
    const { init } = this;
    let x = init.x;
    let y = init.y;
    let vx = init.vx;
    let vy = init.vy;
    let th = init.pitch;
    let om = init.vp;
    let ph = 0;
    let hidden = 0;
    let hidePos = 0;
    let curX = 0;
    let curY = 0;

    // 被动层：频率越低越“软”，阻尼越小回摆越明显
    const flexL = new Lag2(TAU / 3.2, 0.5);
    const flukeL = new Lag2(TAU / 2.4, 0.45);
    const nodL = new Lag2(TAU / 2.2, 0.7);
    const finN = new FinSim(1, 31);
    const finF = new FinSim(-1, 37);
    // 身体的弓形：缓慢的二阶跟随，形成与舒展都是一个舒缓的过程
    const arcL = new Lag2(TAU / 5, 0.85);
    // 翻身：沉重的身体慢慢转过去，略带一点惯性
    const rollL = new Lag2(TAU / 4.5, 0.8);

    const steps = Math.ceil(this.duration / SIM_DT);
    const every = Math.round(1 / (SIM_DT * SAMPLE_HZ));
    const pOf = this.progressMapper();
    for (let i = 0; i <= steps + every; i++) {
      const t = i * SIM_DT;
      const p = pOf(t);
      const stir = stirT.at(p);

      // 水流：两层不相关的缓慢噪声，周期十几秒
      const uc = stir * (0.12 * noise1(t * 0.071, 3) + 0.06 * noise1(t * 0.17, 4));
      const wc = stir * (0.086 * noise1(t * 0.063, 5) + 0.034 * noise1(t * 0.19, 6));
      const amp = clamp(beatAmp.at(p), 0, 1);

      // 被动层的驱动：相对水流（下沉 → 自下而上的水流托起尾叶与胸鳍）、角速度（尾部与胸鳍滞后）
      let flexT = 0;
      let flukeT = 0;
      let nodT = 0;
      let fnT: Vec3 | null = null;
      let ffT: Vec3 | null = null;
      if (passive) {
        const flow = vy - wc;
        const n1 = 0.65 * noise1(t * 0.23, 21) + 0.35 * noise1(t * 0.53, 24);
        flexT = 0.11 * flow - 4.1 * om + stir * 0.19 * n1;
        // 尾叶：下沉时自下而上的水流把它托向尾柄的延长线；比尾柄更软，随尾柄的运动反向滞后
        flukeT = 0.11 * flow - 0.32 * flexL.v + stir * 0.06 * n1;
        nodT = 1.7 * om + 0.012 * flow;
        // 胸鳍：相对水流换到体轴坐标——沿体轴流向尾部 wa、垂直于体轴流向局部上方 wh
        const cth = Math.cos(th);
        const sth = Math.sin(th);
        const wa = -((uc - vx) * cth + (wc - vy) * sth);
        const wh = -(-(uc - vx) * sth + (wc - vy) * cth);
        const rho = clamp(rollL.x, 0, Math.PI);
        // 闭眼特写之后才开始（那时胸鳍不在画面里）；接近海床时下沉放缓、水流变弱，胸鳍回到画中的姿态，
        // 着地时与静卧（以及之后的骨骼）一致
        const kf = smoothstep(DESCENT_START, 0.3, p) * (1 - smoothstep(0.482, 0.495, p));
        fnT = finN.target(rho, wa, wh, kf, stir * kf, t);
        ffT = finF.target(rho, wa, wh, kf, stir * kf, t);
        if (i === 0) {
          flexL.reset(flexT);
          flukeL.reset(flukeT);
          nodL.reset(nodT);
          finN.reset(fnT);
          finF.reset(ffT);
        }
      }

      // 采样：记录时刻 t 的状态（第 0 个样本正好是交接处的关键帧状态）
      if (i % every === 0) {
        const k = i / every;
        if (k >= this.n) break;
        T.y[k] = y + hidden;
        T.pitch[k] = th;
        hideInt[k] = hidePos;
        if (passive) {
          T.x[k] = x;
          T.beat[k] = amp;
          T.beatPh[k] = ph;
          T.flex[k] = flexL.x;
          T.nod[k] = nodL.x;
          T.fluke[k] = flukeL.x;
          const rho = clamp(rollL.x, 0, Math.PI);
          const fn = finN.sample(rho);
          const ff = finF.sample(rho);
          T.fnA[k] = fn.a;
          T.fnH[k] = fn.h;
          T.fnZ[k] = fn.z;
          T.ffA[k] = ff.a;
          T.ffH[k] = ff.h;
          T.ffZ[k] = ff.z;
          T.arc[k] = arcL.x;
          T.roll[k] = clamp(rollL.x, 0, Math.PI);
          // 画中胸鳍的平面内转动（游动时使用）：下沉途中胸鳍按上面的三维方向单独绘制
          T.fin[k] = 0;
          T.vx[k] = vx - uc;
          T.vy[k] = vy - wc;
          T.hidden[k] = hidden;
          T.waterX[k] = curX;
          T.waterY[k] = curY + hidden;
        }
      }

      // 尾叶：频率带一点不规则，避免机械般的等速摆动
      const f = beatFreq.at(p) * (1 + 0.08 * noise1(t * 0.21, 7));
      const thrust = THRUST * amp * f * (1 + 0.45 * Math.cos(2 * ph - 0.6));
      ph += TAU * f * SIM_DT;

      const rx = vx - uc;
      const ry = vy - wc;
      let ax = thrust - DRAG_X2 * rx * Math.abs(rx) - DRAG_X1 * rx + GLIDE * Math.max(0, vy) * Math.sin(th);
      let ay = sinkT.at(p) - DRAG_Y2 * ry * Math.abs(ry) - (DRAG_Y1 + cushT.at(p)) * ry;
      // 俯仰：被拉向低头的目标角度（头重力矩与水动力回正之差）− 阻尼，叠加极轻的水流扰动
      let aw = PITCH_K * (tiltT.at(p) - th) - PITCH_C * om + stir * (0.013 * noise1(t * 0.071, 9) + 0.005 * noise1(t * 0.19, 10));

      const yTrue = y + hidden;
      // 只在接近海床时检测接触（身体最低点不会低于参考点下方 5 米）
      if (contact && yTrue + 5 > WORLD.seabedY) {
        const c = Math.cos(th);
        const s = Math.sin(th);
        for (const q of CONTACTS) {
          const ox = q.x * c - q.y * s;
          const oy = q.x * s + q.y * c;
          const pen = yTrue + oy - WORLD.seabedY;
          if (pen <= 0) continue;
          const pvx = vx - om * oy;
          const pvy = vy + om * ox;
          // 柔软的沉积物：弹性很小、阻尼很大，不会弹起
          const fy = -Math.max(0, 6 * pen + 5 * pvy);
          const fx = -1.2 * pvx * Math.min(1, pen * 12);
          ax += fx / CONTACTS.length;
          ay += fy;
          aw += (ox * fy - oy * fx) / INERTIA;
        }
      }

      vx += ax * SIM_DT;
      vy += ay * SIM_DT;
      om += aw * SIM_DT;
      x += vx * SIM_DT;
      y += vy * SIM_DT;
      th += om * SIM_DT;
      curX += uc * SIM_DT;
      curY += wc * SIM_DT;
      const hs = hideT.at(p);
      hidePos += hs * SIM_DT;
      hidden += hideSpeed * hs * SIM_DT;
      if (passive) {
        flexL.step(flexT, SIM_DT);
        flukeL.step(flukeT, SIM_DT);
        nodL.step(nodT, SIM_DT);
        finN.step(fnT!, SIM_DT);
        finF.step(ffT!, SIM_DT);
        arcL.step(arcT.at(p) * (1 + 0.06 * noise1(t * 0.09, 27)), SIM_DT);
        rollL.step(rollT.at(p), SIM_DT);
      }
    }
    return { y: T.y, pitch: T.pitch, hideInt };
  }

  /** 横向落点校正、与静卧姿态对齐、镜头跟随点。 */
  private finish(): void {
    const T = this.tab;
    const n = this.n;
    const dt = 1 / SAMPLE_HZ;
    const kOf = (p: number) => clamp(this.tau(p) * SAMPLE_HZ, 0, n - 1);

    // 落点必须是 restX：差值作为一股极缓慢的水流在整个下沉过程中逐渐补上（海洋雪也随之漂移）
    const dx = this.restX - T.x[Math.round(kOf(CONTACT_P))];
    const k0 = kOf(0.32);
    const k1 = kOf(CONTACT_P - 0.004);
    for (let k = 0; k < n; k++) {
      const s = smoothstep(k0, k1, k) * dx;
      T.x[k] += s;
      T.waterX[k] += s;
    }

    // 静卧：着陆后很短的一段里，位置、俯仰与被动层精确收敛到静卧状态（肚子朝上）
    const ks = kOf(SETTLE_P);
    const ke = kOf(DESCENT_END);
    for (let k = 0; k < n; k++) {
      const w = smoothstep(ks, ke, k);
      if (w <= 0) continue;
      T.x[k] = lerp(T.x[k], this.restX, w);
      T.y[k] = lerp(T.y[k], this.restY, w);
      T.pitch[k] = lerp(T.pitch[k], 0, w);
      T.roll[k] = lerp(T.roll[k], Math.PI, w);
      for (const c of ['flex', 'nod', 'fluke', 'arc', 'fin', 'vx', 'vy'] as const) T[c][k] *= 1 - w;
      // 胸鳍回到画中的姿态（肚子朝上）
      const f0 = finNeutral(Math.PI, { a: 0, h: 0, z: 0 });
      for (const [A, H, Z] of [['fnA', 'fnH', 'fnZ'], ['ffA', 'ffH', 'ffZ']] as const) {
        const v = unit({ a: lerp(T[A][k], f0.a, w), h: lerp(T[H][k], f0.h, w), z: lerp(T[Z][k], f0.z, w) });
        T[A][k] = v.a;
        T[H][k] = v.h;
        T[Z][k] = v.z;
      }
    }

    // 镜头跟随点：在水体参照系中对鲸鱼位置做带速度前馈的二阶跟随。
    // 匀速时几乎不落后，只有在起动、减速与转向时才产生滞后——这让镜头感到鲸鱼的质量。
    const fx = new Lag2(TAU / 10, 1.05);
    const fy = new Lag2(TAU / 10, 1.05);
    for (let k = 0; k < n; k++) {
      this.wy[k] = T.y[k] - T.waterY[k];
      const vxk = k > 0 ? (T.x[k] - T.x[k - 1]) / dt : 0;
      const visY = T.y[k] - T.hidden[k];
      const vyk = k > 0 ? (visY - (T.y[k - 1] - T.hidden[k - 1])) / dt : 0;
      if (k === 0) {
        fx.reset(T.x[0]);
        fy.reset(visY);
      }
      // 两个子步，保证 60Hz 采样下的数值稳定
      for (let j = 0; j < 2; j++) {
        fx.step(T.x[k], dt / 2, vxk, 1);
        fy.step(visY, dt / 2, vyk, 1);
      }
      // 镜头在开头（眼睛特写）与结尾（静卧）都没有滞后
      const fade = smoothstep(0, kOf(0.3), k) * (1 - smoothstep(ks - 2 * SAMPLE_HZ, ke, k));
      T.lagX[k] = (fx.x - T.x[k]) * fade;
      T.lagY[k] = (fy.x - visY) * fade;
    }
  }

  /** 进度是否在下沉动作内 */
  static covers(p: number): boolean {
    return p > DESCENT_START && p < DESCENT_END;
  }

  /** 查表（线性插值）：进度 p 的完整动作状态。 */
  sample(p: number, out: DescentSample): DescentSample {
    const k = clamp(this.tau(p) * SAMPLE_HZ, 0, this.n - 1);
    const i = Math.min(this.n - 2, Math.floor(k));
    const f = k - i;
    for (const c of CHANNELS) {
      const a = this.tab[c];
      out[c] = a[i] + (a[i + 1] - a[i]) * f;
    }
    return out;
  }

  private at(arr: Float64Array, p: number): number {
    const k = clamp(this.tau(p) * SAMPLE_HZ, 0, this.n - 1);
    const i = Math.min(this.n - 2, Math.floor(k));
    return arr[i] + (arr[i + 1] - arr[i]) * (k - i);
  }

  /** 水体参照系在世界坐标中的偏移（m）。下沉动作之外保持端点值。 */
  waterOffset(p: number, out: { x: number; y: number }): { x: number; y: number } {
    const q = clamp(p, DESCENT_START, DESCENT_END);
    out.x = this.at(this.tab.waterX, q);
    out.y = this.at(this.tab.waterY, q);
    return out;
  }

  /**
   * 海床相对其真实位置的偏移：海床锚定在水体参照系中，锚点是接触海床的那一刻，
   * 因此偏移在接触时恰好为 0；下沉动作之外为 0。
   */
  seabedShift(p: number, out: { x: number; y: number }): { x: number; y: number } {
    if (!DescentMotion.covers(p)) {
      out.x = out.y = 0;
      return out;
    }
    out.x = this.at(this.tab.waterX, p) - this.at(this.tab.waterX, DESCENT_END);
    out.y = this.at(this.tab.waterY, p) - this.at(this.tab.waterY, DESCENT_END);
    return out;
  }

  /**
   * 途中的生物：鲸鱼经过深度 depth 的那一刻，把它锚定在水体参照系中。
   * 返回锚点信息，供 shiftFor 每帧计算偏移。不在下沉途中的深度返回 null。
   */
  anchorFor(depth: number): { ox: number; oy: number; wy: number } | null {
    const T = this.tab;
    const n = this.n;
    if (depth <= T.y[0] || depth >= T.y[n - 1]) return null;
    // 真实深度在开始下沉之后单调增加：从末端向前找第一次越过该深度的位置
    let k = n - 1;
    while (k > 0 && T.y[k - 1] >= depth) k--;
    if (k === 0) return null;
    const f = (depth - T.y[k - 1]) / Math.max(1e-9, T.y[k] - T.y[k - 1]);
    const lerpK = (a: Float64Array) => a[k - 1] + (a[k] - a[k - 1]) * f;
    return { ox: lerpK(T.waterX), oy: lerpK(T.waterY), wy: lerpK(this.wy) };
  }

  /**
   * 生物在进度 p 时相对其名义位置的偏移。离鲸鱼较远（水体参照系中 > 100 m）时逐渐回到名义位置——
   * 那时它早已在画面之外，所以过渡不可见；下沉动作之外偏移为 0。
   */
  shiftFor(a: { ox: number; oy: number; wy: number }, p: number, out: { x: number; y: number }): { x: number; y: number } {
    if (!DescentMotion.covers(p)) {
      out.x = out.y = 0;
      return out;
    }
    const rel = Math.abs(a.wy - this.at(this.wy, p));
    const w = 1 - smoothstep(100, 160, rel);
    out.x = (this.at(this.tab.waterX, p) - a.ox) * w;
    out.y = (this.at(this.tab.waterY, p) - a.oy) * w;
    return out;
  }

  /** 水体参照系中鲸鱼的位置（调试与测试用） */
  waterDepth(p: number): number {
    return this.at(this.wy, p);
  }
}
