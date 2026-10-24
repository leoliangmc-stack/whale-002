import { smoothstep } from '../core/math';

/**
 * 鲸落上的进食（阶段 6「身体逐渐分解」）：食腐动物在哪里、什么时候咬开身体。
 *
 * 移动食腐阶段发生在海床上：鲸鱼沉到海底之后，几天之内盲鳗、睡鲨、长尾鳕和成群的端足类循着气味赶来，
 * 每天能吃掉几十公斤软组织。睡鲨咬住之后扭转身体，一点一点把肉撕下来；盲鳗用锉刀般的齿板刮食，
 * 常常把头钻进伤口，甚至把身体打成结借力撕扯；端足类成群覆盖在伤口与体表上。
 *
 * 伤口按鲸鱼谱系进度 u（开场鲸鱼即叙事进度 p）出现，位置用身体坐标：s 沿体轴（0 吻端 ~ 1 尾叶缺刻），
 * v 为离体轴的相对高度（正值在上方——肚子朝上时是柔软的腹部与喉腹褶）。
 * 鲸鱼的伤口绘制（Whale）与食腐动物的动作（systems/Feast）都读这张表，所以咬下去的那一刻伤口才出现。
 */

export interface Wound {
  /** 出现的进度 */
  p: number;
  s: number;
  v: number;
  /** 最终的半径（米，沿体轴方向；上下方向约为 0.7 倍） */
  r: number;
  kind: 'shark' | 'hag';
  /** 钻进这个伤口进食的盲鳗数量（最多） */
  hag: number;
}

/** 睡鲨的三次撕咬（见 Feast 中的动作）。后来的撕咬放在身体中段——尾部与头部的软组织那时已经被吃空 */
export const SHARK_BITES: ReadonlyArray<Wound> = [
  { p: 0.581, s: 0.5, v: 0.46, r: 1.0, kind: 'shark', hag: 7 },
  { p: 0.614, s: 0.31, v: 0.58, r: 0.95, kind: 'shark', hag: 8 },
  { p: 0.652, s: 0.44, v: 0.3, r: 1.0, kind: 'shark', hag: 6 },
];

/** 盲鳗自己钻开的小洞 */
export const HAG_HOLES: ReadonlyArray<Wound> = [
  { p: 0.561, s: 0.43, v: 0.62, r: 0.42, kind: 'hag', hag: 3 },
  { p: 0.566, s: 0.56, v: 0.2, r: 0.36, kind: 'hag', hag: 2 },
  { p: 0.571, s: 0.37, v: 0.3, r: 0.4, kind: 'hag', hag: 3 },
  { p: 0.586, s: 0.24, v: 0.66, r: 0.45, kind: 'hag', hag: 3 },
  { p: 0.593, s: 0.68, v: 0.55, r: 0.4, kind: 'hag', hag: 2 },
  { p: 0.6, s: 0.47, v: -0.08, r: 0.34, kind: 'hag', hag: 2 },
  { p: 0.62, s: 0.37, v: 0.56, r: 0.38, kind: 'hag', hag: 2 },
  { p: 0.628, s: 0.41, v: 0.02, r: 0.4, kind: 'hag', hag: 2 },
];

export const WOUNDS: ReadonlyArray<Wound> = [...SHARK_BITES, ...HAG_HOLES];

/** 进食阶段结束（之后软组织几乎吃光，只剩骨骼上的残余） */
export const FEAST_END = 0.715;

/**
 * 伤口在 u 时的大小（0~1，乘以 r 得到半径）。睡鲨一口咬下约 0.4 倍的伤口，撕扯时再扩大一点，
 * 之后盲鳗与端足类沿伤口边缘继续啃食，伤口慢慢扩大；盲鳗的洞从很小开始。
 */
export function woundSize(w: Wound, u: number): number {
  const age = u - w.p;
  if (age <= 0 || u > FEAST_END + 0.03) return 0;
  if (w.kind === 'shark') return 0.3 + 0.12 * smoothstep(0, 0.012, age) + 0.58 * smoothstep(0.012, 0.075, age);
  return 0.18 + 0.82 * smoothstep(0, 0.06, age);
}

/** 正在这个伤口里进食的盲鳗数量（随时间增加，进食阶段末尾逐渐离开） */
export function hagCount(w: Wound, u: number): number {
  const age = u - w.p;
  if (age <= 0) return 0;
  const k = smoothstep(w.kind === 'shark' ? 0.006 : 0, w.kind === 'shark' ? 0.03 : 0.02, age) * (1 - smoothstep(0.682, 0.705, u));
  return w.hag * k;
}
