import { clamp, lerp, noise1, smoothstep, TAU } from '../core/math';
import { Track, type Keys } from '../core/Track';
import { CYCLE_SECONDS, progressAtSeconds, secondsAt } from '../config/stages';
import { strokeWarp } from '../entities/WhaleBody';

/**
 * SwimMotion：开场到滤食（第一幕）中一头活着的蓝鲸的游动。
 *
 * 与下沉动作（DescentMotion）相同的思路：动作在“故事时间”（自动播放的秒数）上积分一次并制成查找表，
 * 查表只依赖叙事进度，所以前进、倒退、跳转都得到同一个姿态。设计要点：
 *  1. 节奏而不是匀速：几次缓慢有力的拍尾之后是一段滑行（尾叶伸直、胸鳍微微张开），
 *     每一次拍尾的幅度、频率都略有不同；冲刺滤食前加快拍尾，张嘴后靠惯性滑行、减速；
 *  2. 惯性：推力（幅度² × 频率²，每个周期上下两次峰值）减去阻力驱动一个很慢的速度变化，
 *     拍尾时略微加速、滑行时略微减速——几十吨的身体不会立即响应；
 *  3. 路径在时间上平滑：关键帧按秒（而不是按进度）插值，镜头段之间没有速度的突变；
 *     深度先保持、再缓缓下潜、在磷虾群前放平，俯仰角始终跟着路径方向（并略微领先），不会“横着滑”；
 *  4. 胸鳍、尾柄与头部是被动层：转向、上浮、滑行时胸鳍调整角度，尾柄随转动滞后；
 *  5. 镜头跟随点带一点质量感：匀速时几乎不落后，加速、减速、调整深度时才稍稍滞后。
 *
 * 谱系参数 u 与 StoryTimeline 相同：u ≥ 0 为开场鲸鱼，u < 0 为上一圈末尾从远处游来的新鲸鱼，
 * 两头鲸鱼查的是同一张表，所以循环衔接处天然一致。
 */

/** 游动动作表覆盖的谱系范围；SWIM_BLEND 之后逐渐交还给普通关键帧轨道（返回海面） */
export const SWIM_START = -0.13;
export const SWIM_END = 0.124;
const SWIM_BLEND = 0.108;
/** 拍尾相位表覆盖到闭眼之后（之后的主动游动幅度为 0） */
const PHASE_END = 0.3;

/** 谱系 u 对应的故事时间（秒，u = 0 为开场）：u < 0 是上一圈的末尾 */
export function lineageSeconds(u: number): number {
  return u >= 0 ? secondsAt(u) : secondsAt(u + 1) - CYCLE_SECONDS;
}

export function lineageAt(t: number): number {
  return t >= 0 ? progressAtSeconds(t) : progressAtSeconds(t + CYCLE_SECONDS) - 1;
}

// ------------------------------------------------------------------ 动作脚本（按故事时间，秒）
// 开场五个镜头：0–5 超远景、5–10 侧面跟拍、10–15 仰拍、15–20 眼睛、20–25.5 磷虾群；25.5–38.5 滤食

/** 拍尾幅度：开场的侧面跟拍里是一次完整有力的拍尾，仰拍时身体从上方静静滑过 */
const STROKE: Keys = [
  [-34, 0.85], [-17.5, 0.86], [-15.6, 0.22], [-12, 0.2], [-10.2, 0.84], [-3, 0.82],
  [2.5, 0.88], [6, 0.98], [9.4, 0.95], [11.3, 0.13], [14.2, 0.12], [16, 0.66],
  [19.5, 0.7], [21.8, 0.84], [24, 1.06], [25.6, 1.06],
  // 张嘴之后不再拍尾：张开的大嘴与鼓起的喉囊让身体迅速减速，滑行着把磷虾和海水一起吞下
  [27.4, 0.14], [33.4, 0.14], [36.8, 0.42], [39, 0.5], [44.5, 1],
];
/** 拍尾频率（Hz）：蓝鲸巡游时约 5–6 秒拍一次；冲刺前加快，滤水时放慢 */
const FREQ: Keys = [
  [-34, 0.17], [0, 0.176], [6, 0.186], [10, 0.18], [16, 0.165], [20, 0.17], [23, 0.2], [25.6, 0.215],
  [28, 0.17], [34, 0.14], [38, 0.15], [44.5, 0.16],
];
/** 前进速度（m/s，侧视平面内）：巡游、看见磷虾时放慢、冲刺、张嘴后减速 */
const SPEED: Keys = [
  [-34, 2.0], [-22, 2.3], [-11, 2.75], [0, 3.2], [6, 3.35], [12, 3.35], [16, 3.0], [20, 2.55], [22.5, 2.6],
  [25, 3.1], [26, 3.05], [28, 2.3], [30.5, 1.65], [36, 1.4], [42.5, 1.1], [44.5, 1.3],
];
/**
 * 深度（m）：远处缓缓游来 → 侧面跟拍时开始下潜 → 仰拍时以约 12° 平缓下潜 → 侧面中景里渐渐放平，
 * 磷虾群出现之前已经水平；冲刺与张嘴滤食时保持深度（身体不再一会儿低头、一会儿抬头），
 * 闭嘴之后才开始返回海面（交还关键帧）
 */
const DEPTH: Keys = [
  [-34, 25.7], [-22, 31.3], [-11.5, 35.0], [0, 38.0], [6, 40.1], [10, 42.7], [14, 45.75], [17, 47.95], [19.5, 49.2],
  [22, 49.75], [25.5, 49.9], [27, 49.92], [33, 49.8], [36.6, 49.55], [38.5, 49.2], [40.5, 48.3], [42.5, 46.6],
  [44.5, 43.7],
];
/** 离镜头的距离（与关键帧轨道相同的点，按秒重新插值） */
const DEPTH_Z: Keys = [[-34, 265.7], [-28, 214.3], [-22, 157.7], [-11.5, 102.9], [0, 56.6], [5, 26.6], [9.35, 6], [11.5, 0], [44.5, 0]];
/** 位置锚点：开场、冲刺滤食与交还关键帧处与原来的构图一致 */
const ANCHORS: Array<[number, number]> = [[SWIM_START, -178.3], [0, -89.8], [0.075, -12.3], [SWIM_END, 0]];
/** 俯仰在滤食之后逐渐交还关键帧（开始返回海面） */
const PITCH_KEYED_FROM = 0.098;
const PITCH_KEYED_TO = 0.114;

/** 胸鳍：张嘴之前回到画中的姿态（张嘴的画里胸鳍是画上去的） */
const FIN_OFF_FROM = 0.0688;
const FIN_OFF_TO = 0.0728;

// ------------------------------------------------------------------ 物理参数
/** 巡游时的“基准”拍尾：推力与阻力平衡 */
const A0 = 0.85;
const F0 = 0.18;
/** 推力变化对速度的影响（比例）与身体的惯性时间常数（秒） */
const SURGE = 0.07;
const SURGE_TAU = 5;
/** 俯仰领先路径的时间与平滑宽度（秒） */
const PITCH_LEAD = 0.8;
const PITCH_SIGMA = 1.1;

const SAMPLE_HZ = 60;

/** 二阶阻尼跟随（与 DescentMotion 中的相同） */
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

const CHANNELS = ['x', 'y', 'z', 'pitch', 'swim', 'fin', 'flex', 'nod', 'vx', 'vy', 'lagX', 'lagY', 'wake'] as const;
type Channel = (typeof CHANNELS)[number];
export type SwimSample = Record<Channel, number>;

export function makeSwimSample(): SwimSample {
  const o = {} as SwimSample;
  for (const c of CHANNELS) o[c] = 0;
  return o;
}

/** 关键帧轨道（按进度）：交还处的混合目标 */
export interface KeyedPath {
  x: Track;
  y: Track;
  z: Track;
  pitch: Track;
  swim: Track;
}

export class SwimMotion {
  readonly t0 = lineageSeconds(SWIM_START);
  readonly t1 = lineageSeconds(SWIM_END);
  private readonly n: number;
  private readonly tab = {} as Record<Channel, Float64Array>;
  /** 拍尾相位（覆盖到 PHASE_END） */
  private readonly ph: Float64Array;
  private readonly nPh: number;

  constructor(private readonly keyed: KeyedPath) {
    this.n = Math.ceil((this.t1 - this.t0) * SAMPLE_HZ) + 2;
    for (const c of CHANNELS) this.tab[c] = new Float64Array(this.n);
    this.nPh = Math.ceil((lineageSeconds(PHASE_END) - this.t0) * SAMPLE_HZ) + 2;
    this.ph = new Float64Array(this.nPh);
    this.simulate();
  }

  static covers(u: number): boolean {
    return u > SWIM_START && u < SWIM_END;
  }

  private simulate(): void {
    const T = this.tab;
    const n = this.n;
    const dt = 1 / SAMPLE_HZ;
    const stroke = new Track(STROKE);
    const freq = new Track(FREQ);
    const speed = new Track(SPEED);
    const depth = new Track(DEPTH);
    const depthZ = new Track(DEPTH_Z);
    const K = this.keyed;
    const tAt = (k: number) => this.t0 + k * dt;

    // 1. 拍尾相位与幅度（每一次拍尾都略有不同）
    let ph = 0;
    const amp = new Float64Array(n);
    const fq = new Float64Array(n);
    for (let k = 0; k < this.nPh; k++) {
      const t = tAt(k);
      const u = lineageAt(t);
      this.ph[k] = ph;
      const f = (t < this.t1 ? freq.at(t) : 0.16) * (1 + 0.05 * noise1(t * 0.08, 12));
      if (k < n) {
        fq[k] = f;
        const cyc = ph / TAU;
        let a = stroke.at(t) * (1 + 0.1 * noise1(cyc * 0.9, 11));
        // 交还给关键帧的主动游动幅度
        const w = smoothstep(SWIM_BLEND, SWIM_END, u);
        a = lerp(a, K.swim.at(u), w);
        amp[k] = a;
      }
      ph += TAU * f * dt;
    }

    // 2. 推力与惯性：速度相对“脚本速度”的缓慢起伏
    const surge = new Float64Array(n);
    let e = 0;
    for (let k = 0; k < n; k++) {
      const g = Math.pow((amp[k] * fq[k]) / (A0 * F0), 2) * (1 + 0.4 * Math.cos(2 * strokeWarp(this.ph[k])));
      e += ((SURGE * clamp(g - 1, -1, 1.5) - e) / SURGE_TAU) * dt;
      surge[k] = e;
    }

    // 3. 前进：速度积分，并在锚点之间用两端为零的平滑修正，准确到达构图锚点
    const vx = new Float64Array(n);
    for (let k = 0; k < n; k++) vx[k] = speed.at(tAt(k)) * (1 + surge[k]);
    const kOf = (u: number) => clamp(Math.round((lineageSeconds(u) - this.t0) * SAMPLE_HZ), 0, n - 1);
    const anchorX = (u: number, x: number) => (u >= SWIM_END ? K.x.at(SWIM_END) : x);
    for (let a = 0; a + 1 < ANCHORS.length; a++) {
      const ka = kOf(ANCHORS[a][0]);
      const kb = kOf(ANCHORS[a + 1][0]);
      let dist = 0;
      for (let k = ka; k < kb; k++) dist += vx[k] * dt;
      const want = anchorX(ANCHORS[a + 1][0], ANCHORS[a + 1][1]) - anchorX(ANCHORS[a][0], ANCHORS[a][1]);
      const span = (kb - ka) * dt;
      const r = (want - dist) / span;
      for (let k = ka; k < kb; k++) vx[k] += r * (1 - Math.cos((TAU * (k - ka)) / (kb - ka)));
    }
    let x = ANCHORS[0][1];
    for (let k = 0; k < n; k++) {
      T.x[k] = x;
      x += vx[k] * dt;
    }

    // 4. 深度：脚本深度 + 很轻的自然起伏（周期十几秒，只有几十厘米）
    for (let k = 0; k < n; k++) {
      const t = tAt(k);
      const wob = 0.28 * noise1(t * 0.065 + 3.1, 31) * (1 - smoothstep(18, 26, t));
      T.y[k] = depth.at(t) + wob;
      T.z[k] = depthZ.at(t);
    }

    // 5. 俯仰：跟随路径方向，并略微领先（身体先转、路径随后）；零相位高斯平滑
    // 远处游来时鲸鱼同时向镜头靠近：下潜角按水平面内的总速度计算
    const path = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(n - 1, k + 1);
      path[k] = Math.atan2(T.y[b] - T.y[a], Math.hypot(T.x[b] - T.x[a], T.z[b] - T.z[a]));
    }
    const lead = Math.round(PITCH_LEAD * SAMPLE_HZ);
    const rad = Math.round(PITCH_SIGMA * 3 * SAMPLE_HZ);
    for (let k = 0; k < n; k++) {
      let sum = 0;
      let wsum = 0;
      for (let j = -rad; j <= rad; j++) {
        const q = clamp(k + lead + j, 0, n - 1);
        const w = Math.exp(-0.5 * Math.pow(j / (PITCH_SIGMA * SAMPLE_HZ), 2));
        sum += path[q] * w;
        wsum += w;
      }
      const u = lineageAt(tAt(k));
      T.pitch[k] = lerp(sum / wsum, K.pitch.at(u), smoothstep(PITCH_KEYED_FROM, PITCH_KEYED_TO, u));
    }

    // 6. 被动层：胸鳍、尾柄、头部
    const finL = new Lag2(TAU / 1.7, 0.8);
    const flexL = new Lag2(TAU / 3.2, 0.5);
    const nodL = new Lag2(TAU / 2.2, 0.7);
    for (let k = 0; k < n; k++) {
      const t = tAt(k);
      const a = Math.max(0, k - 1);
      const b = Math.min(n - 1, k + 1);
      const om = (T.pitch[b] - T.pitch[a]) / ((b - a) * dt);
      const vy = (T.y[b] - T.y[a]) / ((b - a) * dt);
      const glide = clamp(1 - amp[k] / 0.8);
      const power = clamp((amp[k] - 0.86) / 0.2);
      const psi = strokeWarp(this.ph[k]);
      // 滑行时张开、转向与上浮时调整角度、用力拍尾时贴近身体，并随身体的起伏轻轻摆动
      const finT =
        0.03 + 0.11 * glide + 1.4 * Math.abs(om) - 0.5 * om + 0.05 * Math.max(0, -vy) - 0.035 * power +
        0.022 * amp[k] * Math.sin(psi - 2.2) + 0.015 * noise1(t * 0.13, 41);
      const flexT = -3.5 * om + 0.05 * glide * noise1(t * 0.21, 42);
      const nodT = 1.6 * om;
      if (k === 0) {
        finL.reset(finT);
        flexL.reset(flexT);
        nodL.reset(nodT);
      }
      for (let j = 0; j < 2; j++) {
        finL.step(finT, dt / 2);
        flexL.step(flexT, dt / 2);
        nodL.step(nodT, dt / 2);
      }
      const u = lineageAt(t);
      T.fin[k] = finL.x * (1 - smoothstep(FIN_OFF_FROM, FIN_OFF_TO, u));
      T.flex[k] = flexL.x;
      T.nod[k] = nodL.x;
      T.swim[k] = amp[k];
      T.vx[k] = vx[k];
      T.vy[k] = vy;
    }

    // 7. 交还关键帧（返回海面）：位置、俯仰与被动层平滑收敛
    for (let k = 0; k < n; k++) {
      const u = lineageAt(tAt(k));
      const w = smoothstep(SWIM_BLEND, SWIM_END, u);
      if (w <= 0) continue;
      T.x[k] = lerp(T.x[k], K.x.at(u), w);
      T.y[k] = lerp(T.y[k], K.y.at(u), w);
      T.z[k] = lerp(T.z[k], K.z.at(u), w);
      T.pitch[k] = lerp(T.pitch[k], K.pitch.at(u), w);
      for (const c of ['fin', 'flex', 'nod'] as const) T[c][k] *= 1 - w;
    }

    // 8. 镜头跟随点：前进方向几乎没有滞后（速度前馈），深度变化时稍稍落后
    const fx = new Lag2(TAU / 8, 1);
    const fy = new Lag2(TAU / 9, 1);
    for (let k = 0; k < n; k++) {
      const vxk = k > 0 ? (T.x[k] - T.x[k - 1]) / dt : vx[0];
      const vyk = k > 0 ? (T.y[k] - T.y[k - 1]) / dt : 0;
      if (k === 0) {
        fx.reset(T.x[0]);
        fy.reset(T.y[0]);
      }
      for (let j = 0; j < 2; j++) {
        fx.step(T.x[k], dt / 2, vxk, 0.97);
        fy.step(T.y[k], dt / 2, vyk, 0.75);
      }
      const u = lineageAt(tAt(k));
      const fade = smoothstep(SWIM_START, SWIM_START + 0.02, u) * (1 - smoothstep(0.1, 0.118, u));
      T.lagX[k] = (fx.x - T.x[k]) * fade;
      T.lagY[k] = (fy.x - T.y[k]) * fade;
      // 尾流与绕流：只在鲸鱼离镜头所在的平面足够近时才看得出来
      T.wake[k] = 0.75 * (1 - smoothstep(6, 22, T.z[k])) * (1 - smoothstep(0.1, SWIM_END, u));
    }
  }

  private kAt(u: number): number {
    return clamp((lineageSeconds(u) - this.t0) * SAMPLE_HZ, 0, this.n - 1);
  }

  /** 查表（线性插值） */
  sample(u: number, out: SwimSample): SwimSample {
    const k = this.kAt(u);
    const i = Math.min(this.n - 2, Math.floor(k));
    const f = k - i;
    for (const c of CHANNELS) {
      const a = this.tab[c];
      out[c] = a[i] + (a[i + 1] - a[i]) * f;
    }
    return out;
  }

  /** 主动游动的拍尾相位（弧度）：由故事时间决定，两头鲸鱼共用 */
  phaseAt(u: number): number {
    const k = clamp((lineageSeconds(u) - this.t0) * SAMPLE_HZ, 0, this.nPh - 1);
    const i = Math.min(this.nPh - 2, Math.floor(k));
    return this.ph[i] + (this.ph[i + 1] - this.ph[i]) * (k - i);
  }
}
