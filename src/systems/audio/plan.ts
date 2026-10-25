import { HAG_HOLES, SHARK_BITES } from '../../config/feast';
import { BONE_CLOSEUPS, progressAtSeconds, secondsAt } from '../../config/stages';
import { clamp, smoothstep, window4 } from '../../core/math';

/**
 * 声音的“剪辑表”（docs/sound/cue-sheet.md 的代码版本）：全部是数据与纯函数。
 *
 *  - 连续层（循环床 A01–A10）的电平与低通是叙事进度 p、相机深度等画面数据的纯函数，
 *    正放、倒放、跳转都得到同一个状态（cue sheet 1.1 第 6 条）；
 *  - 一次性音效（F）与鲸鸣（V）按 p 排好，只在正向经过时触发（见 director.ts）。
 *
 * 电平一律写成“目标短时响度”（LUFS-S，界面音量 100% 时单独测量）。素材的实测响度记录在 manifest 里，
 * 运行时增益 = 目标 − 素材响度（素材都归一化到约 −18 LUFS，见 scripts/sound-build.py）。
 */

/** “关”：插值时当作 −60 dB，低于 OFF_DB 的电平直接静音 */
export const OFF = -60;
export const OFF_DB = -59;

export type BedId = 'A01' | 'A02' | 'A03' | 'A04' | 'A05' | 'A07' | 'A08' | 'A09' | 'A10';
export const BEDS: BedId[] = ['A01', 'A02', 'A03', 'A04', 'A05', 'A07', 'A08', 'A09', 'A10'];
/** 空气中的床（旁白时压得更多，并在 2.5 kHz 让出人声的频段） */
export const AIR_BEDS: ReadonlySet<BedId> = new Set<BedId>(['A04', 'A05']);

export interface BedLevel {
  /** 目标 LUFS-S（≤ OFF_DB 为关） */
  db: number;
  /** 视角权重（振幅系数 0~1） */
  w: number;
  /** 低通（Hz） */
  lpf: number;
}

export interface EcoLevels {
  scav: number;
  amph: number;
  crabs: number;
  dwellers: number;
}

export interface BedInput {
  mode: 'story' | 'explore' | 'intro';
  p: number;
  /** 相机深度（米，正值在水下） */
  depth: number;
  /** 下沉时鲸鱼相对水体的速度（m/s） */
  sink: number;
  eco: EcoLevels | null;
}

/** 关键帧插值：dB 按线性插值，“关”记为 OFF；超出两端取端点 */
export function curve(pts: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-9, x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** 频率按对数插值 */
export function logCurve(pts: ReadonlyArray<readonly [number, number]>, x: number): number {
  const lp = pts.map(([a, b]) => [a, Math.log(b)] as const);
  return Math.exp(curve(lp, x));
}

export function logLerp(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * clamp(t));
}

// ------------------------------------------------------------------ 深度曲线（2.1）

const DEPTH = {
  A01: { db: [[0, -27], [40, -27], [120, -31], [250, -40], [300, OFF]], lpf: [[0, 5000], [10, 4000], [40, 3200], [120, 2200], [250, 1500]] },
  A02: { db: [[0, -26], [5, -29], [15, -33], [30, -40], [45, OFF]], lpf: [[0, 1500], [15, 900], [45, 500]] },
  // 深渊端 −32（原 −34）：手机外放（300 Hz 以上）时海床与鲸骨段的环境只剩约 −41 dBFS，听起来像没声音了
  A03: { db: [[100, OFF], [200, -38], [400, -32], [1300, -32], [1790, -32]], lpf: [[200, 1600], [800, 1000], [1300, 800], [1790, 650]] },
  A07: { db: [[0, -36], [200, -36], [600, -31], [1000, -30], [1300, -32], [1790, -37]], lpf: [[0, 1800], [800, 1200], [1790, 800]] },
} as const;

// ------------------------------------------------------------------ 按 p 驱动的层

/** A08 水流 · 游动 */
const A08_SWIM: ReadonlyArray<readonly [number, number]> = [
  [0, OFF], [0.01, OFF], [0.014, -40], [0.026, -34], [0.034, -31], [0.042, -29], [0.047, -31], [0.061, -32], [0.072, -30],
  [0.08, -31], [0.095, -34], [0.112, -36], [0.125, -35], [0.148, -36], [0.1535, OFF], [0.2195, OFF], [0.226, -40],
  [0.245, -42], [0.285, -46], [0.297, -44], [0.31, -46], [0.322, OFF], [1, OFF],
];
/** A08 水流 · 上升（磷虾群带着镜头升向海面） */
const A08_RISE: ReadonlyArray<readonly [number, number]> = [
  [0.85, OFF], [0.86, -40], [0.875, -32], [0.92, -30], [0.94, -36], [0.955, OFF],
];
const A08_RISE_LPF: ReadonlyArray<readonly [number, number]> = [[50, 3000], [200, 2000], [1750, 500]];
/** A09 磷虾群纹理 */
const A09: ReadonlyArray<readonly [number, number]> = [
  [0, OFF], [0.061, OFF], [0.066, -44], [0.07, -37], [0.074, -33], [0.1, -32], [0.11, -34], [0.13, -40], [0.15, OFF],
  [0.806, OFF], [0.815, -44], [0.835, -38], [0.85, -34], [0.87, -32], [0.935, -32], [0.96, -38], [0.98, OFF], [1, OFF],
];
const A09_LPF: ReadonlyArray<readonly [number, number]> = [[50, 6000], [1700, 2500]];

/** 叙事偏移（作用于全部 BED，dB）：闭眼的主观收拢、着地前的屏息、鲸骨特写 */
export function bedOffset(p: number): number {
  return -3 * window4(p, 0.245, 0.25, 0.297, 0.305) - 2 * window4(p, 0.488, 0.494, 0.497, 0.503) - 1 * window4(p, 0.708, 0.716, 0.782, 0.79);
}

/** A07 在海床段 −4 dB（鲸骨岛屿周围几乎听不到远方的鲸群） */
function chorusOffset(p: number): number {
  return -4 * window4(p, 0.515, 0.53, 0.8, 0.84);
}

/** A10 伤口近景 +3 dB，拉开后 −2 dB；镜头离开鲸骨、升向磷虾群时（0.805–0.845）淡出，不与磷虾群的窸窣叠在一起 */
function woundOffset(p: number): number {
  return curve([[0.564, 0], [0.576, 3], [0.631, 3], [0.643, 0], [0.675, -2], [0.7, 0], [0.805, 0], [0.845, -20]], p) * (p >= 0.564 ? 1 : 0);
}

// ------------------------------------------------------------------ 视角（1.5）

export interface Views {
  /** 空中（高空俯视）：A04 的权重 */
  air: number;
  /** 水线中景：A05 的权重 */
  wl: number;
  /** 水下层的振幅系数 */
  uw: number;
  /** 出水与入水时水下层低通的覆盖值（Hz，Infinity 为不覆盖） */
  uwLpf: number;
}

/**
 * 叙事中的视角。出水以画面的水线扫过中央（p ≈ 0.1545）为准，水下层在 0.4 s 内交叉淡出；
 * 高空 → 水线在 0.190–0.199；入水在 0.2183–0.2192（相机 0.2185 穿过水面），之后 1 s 内水下低通从 1200 Hz 打开。
 */
export function views(p: number): Views {
  const emerge = smoothstep(0.154, 0.155, p);
  // 高空 → 水线：两边用同一个窗口互补交叉（浪花水雾扫过镜头），水下层在交叉中不会冒出来
  const wipe = smoothstep(0.191, 0.199, p);
  const air = emerge * (1 - wipe);
  const wl = wipe * (1 - smoothstep(0.2178, 0.2192, p));
  // 出水前 1 → 空中 0 → 水线 0.2（下半画面的水下底）→ 入水后 1
  const uw = clamp(1 - air - wl) + 0.2 * wl;
  let uwLpf = Infinity;
  if (p > 0.1525 && p < 0.1555) uwLpf = logLerp(4000, 400, smoothstep(0.1535, 0.155, p));
  if (p >= 0.2183 && p < 0.2207) uwLpf = logLerp(1200, 4000, (p - 0.2185) / 0.0022);
  return { air, wl, uw, uwLpf };
}

/** 空气中的总权重（空中 + 水线），用于判断一次性音效属于哪个视角 */
export function airWeight(v: Views): number {
  return Math.max(v.air, v.wl);
}

// ------------------------------------------------------------------ 连续层

function bed(db: number, w: number, lpf: number): BedLevel {
  return { db: w <= 1e-4 || db <= OFF_DB ? OFF : db, w: clamp(w), lpf };
}

/** 全部循环床在某一帧的目标（2.1 / 2.13） */
export function bedLevels(f: BedInput): Record<BedId, BedLevel> {
  const d = Math.max(0, f.depth);
  const out = {} as Record<BedId, BedLevel>;
  for (const id of BEDS) out[id] = { db: OFF, w: 0, lpf: 1000 };
  if (f.mode === 'intro') return out;

  const eco = f.eco;
  const x = eco ? Math.max(eco.amph, 0.7 * eco.scav, 0.4 * eco.crabs) : 0;
  const a10 = x < 0.05 ? OFF : -44 + 14 * x;

  if (f.mode === 'explore') {
    out.A03 = bed(curve(DEPTH.A03.db, d), 1, logCurve(DEPTH.A03.lpf, d));
    out.A07 = bed(-42, 1, 800);
    out.A10 = bed(a10, 1, 3000);
    return out;
  }

  const p = f.p;
  const v = views(p);
  const off = bedOffset(p);
  const uwLpf = (hz: number) => Math.min(hz, v.uwLpf);

  // A01 开阔水下：闭眼时（0.27–0.297）低通再乘 0.6，世界的高频慢慢退去
  const close = 1 - 0.4 * window4(p, 0.265, 0.275, 0.297, 0.305);
  out.A01 = bed(curve(DEPTH.A01.db, d) + off, v.uw, uwLpf(logCurve(DEPTH.A01.lpf, d) * close));
  out.A02 = bed(curve(DEPTH.A02.db, d) + off, v.uw, uwLpf(logCurve(DEPTH.A02.lpf, d)));
  out.A03 = bed(curve(DEPTH.A03.db, d) + off, v.uw, uwLpf(logCurve(DEPTH.A03.lpf, d)));
  out.A07 = bed(curve(DEPTH.A07.db, d) + off + chorusOffset(p), v.uw, uwLpf(logCurve(DEPTH.A07.lpf, d)));
  out.A04 = bed(-27 + off, v.air, 20000);
  out.A05 = bed(-25 + off, v.wl, 20000);

  // A08：游动、下沉、上升三段不重叠，取最大值
  let flow = curve(A08_SWIM, p);
  let flowLpf = 800;
  if (p >= 0.322 && p < 0.5) {
    const s = Math.max(0, f.sink);
    const sinkDb = s > 0 ? Math.min(-28, -28 + 40 * Math.log10(s / 2.3)) : OFF;
    if (sinkDb > flow) {
      flow = sinkDb < -48 ? OFF : sinkDb;
      flowLpf = 250 + 300 * Math.min(1, s / 2.3);
    }
  }
  if (p >= 0.85 && p < 0.955) {
    const r = curve(A08_RISE, p);
    if (r > flow) {
      flow = r;
      flowLpf = logCurve(A08_RISE_LPF, d);
    }
  }
  out.A08 = bed(flow + off, v.uw, uwLpf(flowLpf));
  out.A09 = bed(curve(A09, p) + off, v.uw, uwLpf(logCurve(A09_LPF, d)));
  out.A10 = bed(a10 === OFF ? OFF : a10 + off + woundOffset(p), v.uw, 3000);
  return out;
}

// ------------------------------------------------------------------ 拍尾（F01）的远近表

/** 拍尾触发时的电平（不含幅度项）；null 表示这一段不触发 */
export function strokeLevel(p: number): number | null {
  if (p >= 0.1535 && p < 0.2195) return null;
  if (p >= 0.322 && p < 0.95) return null;
  if (p < 0.012) return -44;
  if (p >= 0.97) return -44;
  return curve(
    [[0.012, -44], [0.016, -32], [0.03, -28], [0.047, -26], [0.061, -27], [0.075, -28], [0.11, -31], [0.125, -33], [0.15, -35], [0.1535, -35],
      [0.2195, -40], [0.245, -40], [0.285, -42], [0.297, -34], [0.31, -32], [0.322, -32], [0.95, -46], [0.97, -44]],
    p,
  );
}

// ------------------------------------------------------------------ 一次性音效与鲸鸣（2.14）

/**
 * 压低（ducking）的类别（4.3）。free：F11 喷气与 F15 着地主击，开始后的前 1.2 s 不压低
 * （这里简化为整段不压低：之后的 −2 dB 与尾巴相比可以忽略）。
 */
export type DuckClass = 'sfx' | 'hero' | 'free' | 'whale' | 'gull' | 'sperm' | 'ui';
/** 一次性音效所属的视角：在播放中视角翻转时 0.3 s 淡出 */
export type View = 'uw' | 'air' | 'any';

export interface Cue {
  p: number;
  /** 素材编号（manifest 的键） */
  id: string;
  /** 目标 LUFS-S */
  db: number;
  duck: DuckClass;
  view: View;
  /** 速度比 1.6 < r ≤ 3.5 时仍触发、且彼此间隔 ≥ 2 s 的主角音效（1.7） */
  hero?: boolean;
  /** 鲸鸣：旁白在说话时等待，最晚到这个 p */
  latest?: number;
  pan?: number;
  /** 声像在 panDur 秒内移动到 panTo */
  panTo?: number;
  panDur?: number;
  /** 审听用的说明 */
  label: string;
}

function bites(): Cue[] {
  const lv = [[-24, -24], [-23, -23], [-27, -27]];
  const out: Cue[] = [];
  SHARK_BITES.forEach((b, i) => {
    out.push({ p: b.p + 0.001, id: i % 2 ? 'F17b' : 'F17a', db: lv[i][0], duck: 'hero', view: 'uw', label: `咬合 ${i + 1}` });
    out.push({ p: b.p + 0.016, id: i % 2 ? 'F18d' : 'F18c', db: lv[i][1], duck: 'hero', view: 'uw', label: `撕下 ${i + 1}` });
  });
  return out;
}

/** 甩头（F18 的“被搅动的水”）比同一次撕咬的咬合低 4 dB */
export function shakeLevel(bite: number): number {
  return [-24, -23, -27][bite] - 4;
}

/**
 * 阶段 7 骨骼特写中的细碎声（F21）：按“故事秒”确定的间隔排成固定的 cue（不随机），4 个变体按序号轮换。
 * 椎骨：每 6–8 s 一下极轻的“嗒”（路过的端足类，−38）；肋骨：每 2.5–4 s，−34…−36，声像轻微左右；头骨：每 4–6 s，−36。
 */
function boneTicks(): Cue[] {
  const plan = {
    vertebrae: { gaps: [6.5, 7.6, 6.2, 7.9], db: [-38], pan: [0.1, -0.15] },
    ribs: { gaps: [2.6, 3.4, 2.9, 3.9, 2.5, 3.6], db: [-34, -36, -35, -36], pan: [-0.3, 0.25, -0.1, 0.35, 0.05] },
    skull: { gaps: [4.4, 5.6, 4.9, 5.9], db: [-36], pan: [0.2, -0.2] },
  } as const;
  const out: Cue[] = [];
  let k = 0;
  for (const c of BONE_CLOSEUPS) {
    const pl = plan[c.subject];
    let t = secondsAt(c.from) + 1.2;
    const end = secondsAt(c.to) - 0.5;
    let i = 0;
    while (t < end) {
      const id = ['F21a', 'F21c', 'F21b', 'F21d'][k % 4];
      out.push({ p: progressAtSeconds(t), id, db: pl.db[i % pl.db.length], duck: 'sfx', view: 'uw', pan: pl.pan[i % pl.pan.length], label: `F21 ${c.subject}` });
      t += pl.gaps[i % pl.gaps.length];
      i++;
      k++;
    }
  }
  return out;
}

const TABLE: Cue[] = [
  // 鲸鱼入场：超远景里它还只是雾蓝中的一个小影子，先听见远处传来的一声叫声（同一声 B 叫声的远处版本，
  // 与闭眼前最后的那一声首尾呼应）；第一句旁白等它唱完才开始
  { p: 0.0062, id: 'V03', db: -22, duck: 'whale', view: 'uw', hero: true, latest: 0.012, label: 'Q00 入场：远处的鲸鸣' },
  // F02 的峰值在素材开始后约 3.8 s：从 0.030 开始，峰值落在鲸鱼正从头顶经过的 p ≈ 0.0425
  { p: 0.03, id: 'F02', db: -27, duck: 'sfx', view: 'uw', label: 'Q01 巨体滑过' },
  // 近处的鲸鸣：第一句旁白说完之后，镜头升回与鲸鱼相近的高度、头部与前半身在画面中时
  { p: 0.0485, id: 'V01', db: -19, duck: 'whale', view: 'uw', hero: true, latest: 0.055, label: 'Q02 鲸鸣（近）' },
  { p: 0.077, id: 'F03', db: -19, duck: 'hero', view: 'uw', hero: true, label: 'Q03 吞水' },
  { p: 0.104, id: 'F04', db: -25, duck: 'sfx', view: 'uw', label: 'Q04 滤水' },
  { p: 0.1125, id: 'F05a', db: -27, duck: 'sfx', view: 'uw', label: 'Q05 气泡' },
  { p: 0.118, id: 'F05b', db: -32, duck: 'sfx', view: 'uw', label: 'Q06 小气泡' },
  { p: 0.153, id: 'F06', db: -20, duck: 'hero', view: 'any', hero: true, label: 'Q07 出水' },
  { p: 0.1595, id: 'F09a', db: -30, duck: 'gull', view: 'air', pan: -0.5, label: 'Q09 海鸥 a' },
  { p: 0.172, id: 'F10', db: -28, duck: 'sfx', view: 'air', pan: 0.15, label: 'Q11 远处喷气' },
  { p: 0.175, id: 'F09b', db: -28, duck: 'gull', view: 'air', pan: 0.5, label: 'Q12 海鸥 b' },
  { p: 0.183, id: 'F09c', db: -30, duck: 'gull', view: 'air', pan: -0.2, label: 'Q13 海鸥 c' },
  { p: 0.1875, id: 'F09d', db: -33, duck: 'gull', view: 'air', pan: 0.1, label: 'Q14 海鸥 d（远）' },
  { p: 0.1915, id: 'F13', db: -24, duck: 'sfx', view: 'air', pan: -0.6, panTo: 0.6, panDur: 3, label: 'Q15 浪花扫过' },
  // cue sheet 写的是 −16；实测 −16 LUFS-S 时瞬时响度约 −10 LUFS-M，超过“主角 ≤ −12 LUFS-M”的上限，取 −18
  { p: 0.202, id: 'F11', db: -18, duck: 'free', view: 'air', hero: true, label: 'Q16 喷气' },
  { p: 0.2082, id: 'F12', db: -24, duck: 'sfx', view: 'air', label: 'Q17 吸气' },
  { p: 0.218, id: 'F14', db: -22, duck: 'hero', view: 'any', hero: true, label: 'Q18 入水' },
  // 闭眼之前，这头蓝鲸一生中最后的一声（近处、略放慢、尾音渐弱）：排在“漫长的一生”这句旁白之后，眼睑在叫声渐弱时才开始合上。
  // 之后不再安排远方同伴的鲸鸣——闭眼之后的第一声鲸鸣容易被听成这头鲸鱼自己
  { p: 0.2425, id: 'V05', db: -18, duck: 'whale', view: 'uw', hero: true, latest: 0.2455, label: 'Q19 最后的一声' },
  { p: 0.4205, id: 'F23', db: -33, duck: 'sperm', view: 'uw', pan: -0.25, label: 'Q20 抹香鲸' },
  { p: 0.445, id: 'V02', db: -27, duck: 'whale', view: 'uw', hero: true, latest: 0.46, label: 'Q21 深海鲸鸣' },
  { p: 0.497, id: 'F15a', db: -18, duck: 'free', view: 'uw', hero: true, label: 'Q22 着地' },
  { p: 0.4975, id: 'F16', db: -28, duck: 'sfx', view: 'uw', label: 'Q23 沉积物' },
  { p: 0.5045, id: 'F15b', db: -26, duck: 'sfx', view: 'uw', label: 'Q24 头部落下' },
  { p: 0.5125, id: 'F15c', db: -30, duck: 'sfx', view: 'uw', label: 'Q25 尾部落下' },
  { p: HAG_HOLES[0].p + 0.0005, id: 'F19', db: -30, duck: 'sfx', view: 'uw', pan: -0.2, label: 'Q26 盲鳗' },
  { p: HAG_HOLES[6].p + 0.0005, id: 'F19', db: -31, duck: 'sfx', view: 'uw', pan: 0.2, label: 'Q30 盲鳗' },
  { p: 0.918, id: 'V04', db: -23, duck: 'whale', view: 'uw', hero: true, latest: 0.935, label: 'Q34 新鲸鱼' },
];

/** 全部一次性 cue（按 p 排序）：上表 + 三次撕咬 + 骨骼特写中的细碎声 */
export const CUES: ReadonlyArray<Cue> = [...TABLE, ...bites(), ...boneTicks()].sort((a, b) => a.p - b.p);

/** 接缝两侧不安排任何一次性音效（1.7） */
export function inSeamGuard(p: number): boolean {
  return p >= 0.985 || p < 0.006;
}

/** 当前进度所在的睡鲨撕咬（咬住到撕下之后），没有则为 −1 */
export function biteAt(p: number): number {
  for (let i = 0; i < SHARK_BITES.length; i++) {
    const b = SHARK_BITES[i].p;
    if (p >= b && p < b + 0.02) return i;
  }
  return -1;
}

// ------------------------------------------------------------------ 旁白压低（4.3）

/** 各类别在旁白说话时压低的分贝数 */
export const DUCK_DB: Record<DuckClass | 'bed' | 'air', number> = {
  bed: -7,
  air: -9,
  sfx: -5,
  hero: -2,
  free: 0,
  whale: -8,
  gull: -8,
  sperm: -10,
  ui: 0,
};

/** 探索模式：远方的鲸鸣每 100 / 130 / 160 s 一声，三段轮流，全部“极远”处理 */
export const EXPLORE_CALLS = { gaps: [100, 130, 160], ids: ['V03', 'V02', 'V04'], db: -30, lpf: 800 } as const;
