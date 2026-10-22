import type { ShotParams } from '../core/Camera';
import { clamp, lerp, smoothstep } from '../core/math';
import { makeTracks, Track, type Keys, type TrackSet } from '../core/Track';
import { CAPTIONS, stageAt, TIME_LABELS, WORLD, type Caption, type StageDef } from '../config/stages';
import { makeWhaleState, type WhaleState } from '../entities/Whale';

/**
 * StoryTimeline：把 storyProgress 映射为整个世界的状态。
 *
 * 关键设计：
 *  1. 所有叙事状态都是进度的纯函数（关键帧轨道），正放、倒放、重播完全一致；
 *  2. 镜头轨道是“循环轨道”，在 p=1 与 p=0 处 C1 连续；
 *  3. 新鲸鱼（p≥0.875）与开场鲸鱼共用同一条“鲸鱼谱系”轨道（u = p−1），
 *     因此循环衔接时位置、大小、朝向、速度与姿态天然一致；
 *  4. 磷虾群同理（v = p−1）。
 */

export const Y_REST = WORLD.seabedY - 1.72;
export const WHALE_SWITCH = 0.875;

export interface KrillState {
  visible: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  heading: number;
  agg: number;
  feed: number;
  scatter: number;
  deep: number;
  /** 眼睛特写时从镜头前漂过的零星磷虾（0~1） */
  stray: number;
  /** 零星磷虾的锚点（世界坐标，由时间线计算） */
  sx: number;
  sy: number;
  sz: number;
}

export interface SurfaceState {
  /** 高空俯视镜头的混合权重 */
  aerial: number;
  alt: number;
  rot: number;
  surfacing: number;
  breath1: number;
  breath2: number;
  /** 海面时间（秒），用于水波 */
  t: number;
}

export interface EnvState {
  vis: number;
  focusLight: number;
  bioGlow: number;
  vignette: number;
  /** 着陆扬起的沉积物云 0~1 */
  sediment: number;
}

export interface EcoState {
  scav: number;
  amph: number;
  crabs: number;
  enrich: number;
  sulfo: number;
  dwellers: number;
}

export interface CameraFollow {
  fw: number;
  fk: number;
  fe: number;
  ax: number;
  ay: number;
  ox: number;
  oy: number;
  frameH: number;
  needW: number;
  sx: number;
  sy: number;
  elev: number;
  lat: number;
  wcy: number;
  cyAbs: number;
}

export interface StoryFrame {
  p: number;
  stage: StageDef;
  stageLocal: number;
  whale1: WhaleState;
  whale2: WhaleState;
  krill: KrillState;
  surface: SurfaceState;
  env: EnvState;
  eco: EcoState;
  cam: CameraFollow;
  /** 开阔海域构图旋转角（已乘以权重） */
  comp: number;
  captions: Array<{ c: Caption; a: number }>;
  timeLabel: { text: string; a: number } | null;
}

// --------------------------------------------------------------- 鲸鱼谱系轨道（定义域 u ∈ [−0.13, 0.88]）

const whaleKeys: Record<keyof Omit<WhaleState, 'visible'>, Keys> = {
  // 开场：从远处缓缓游来（约 2 m/s），接近磷虾群时减速
  x: [
    [-0.13, -104], [-0.1, -97], [-0.07, -88], [-0.035, -70], [0, -52.4], [0.014, -43], [0.03, -33], [0.047, -23],
    [0.061, -15], [0.068, -11.4], [0.075, -7.2], [0.078, -5.4], [0.095, 1.6], [0.11, 6.4], [0.12, 9], [0.135, 13], [0.15, 17], [0.16, 19], [0.2, 22], [0.22, 24],
    [0.245, 26.4], [0.3, 28.5], [0.4, 29.6], [0.5, WORLD.restX], [0.88, WORLD.restX],
  ],
  y: [
    [-0.13, 40], [-0.07, 43], [-0.035, 45], [0, 46.5], [0.03, 48], [0.047, 49.5], [0.061, 51.5], [0.075, 54.2],
    [0.095, 53.6], [0.11, 53.2], [0.12, 52], [0.135, 44], [0.15, 22], [0.156, 8], [0.16, 2.8], [0.166, 1.15], [0.2, 1.05], [0.216, 1.1],
    [0.226, 3.2], [0.245, 6.4], [0.28, 8], [0.3, 9], [0.32, 28], [0.35, 170], [0.39, 620], [0.43, 1160],
    [0.46, 1600], [0.475, 1752], [0.49, 1793], [0.505, Y_REST], [0.88, Y_REST],
  ],
  z: [[-0.13, 155], [-0.1, 125], [-0.07, 92], [-0.035, 60], [0, 33], [0.014, 15.5], [0.026, 3.5], [0.035, 0], [0.88, 0]],
  pitch: [
    [-0.13, 0], [0, 0], [0.03, 0.02], [0.047, 0.06], [0.058, 0.16], [0.068, 0.19], [0.074, 0.1], [0.08, 0], [0.086, -0.07], [0.11, -0.02], [0.12, -0.12], [0.135, -0.42], [0.15, -0.38],
    [0.158, -0.15], [0.166, -0.06], [0.2, -0.05], [0.216, -0.04], [0.226, 0.05], [0.245, 0.04], [0.29, 0.02],
    [0.32, 0.08], [0.36, 0.13], [0.44, 0.1], [0.48, 0.05], [0.505, 0], [0.88, 0],
  ],
  swim: [
    [-0.13, 0.85], [0.06, 0.85], [0.075, 1], [0.088, 1], [0.11, 0.55], [0.125, 1], [0.15, 1], [0.166, 0.3], [0.2, 0.25], [0.22, 0.35],
    [0.245, 0.3], [0.27, 0.12], [0.29, 0], [0.88, 0],
  ],
  mouth: [[-0.13, 0], [0.074, 0], [0.083, 0.55], [0.088, 1], [0.098, 1], [0.106, 0.3], [0.112, 0], [0.88, 0]],
  throat: [[-0.13, 0], [0.076, 0], [0.086, 0.6], [0.096, 1], [0.104, 1], [0.113, 0.7], [0.125, 0.25], [0.14, 0], [0.88, 0]],
  eye: [[-0.13, 1], [0.248, 1], [0.262, 0.62], [0.27, 0.58], [0.279, 0.25], [0.288, 0], [0.88, 0]],
  life: [[-0.13, 1], [0.255, 1], [0.3, 0], [0.88, 0]],
  tissue: [[-0.13, 1], [0.555, 1], [0.58, 0.92], [0.605, 0.8], [0.63, 0.64], [0.655, 0.46], [0.68, 0.26], [0.7, 0.08], [0.715, 0], [0.88, 0]],
  collapse: [[-0.13, 0], [0.6, 0], [0.66, 0.3], [0.72, 0.75], [0.78, 1], [0.88, 1]],
  rest: [[-0.13, 0], [0.48, 0], [0.505, 1], [0.88, 1]],
  bend: [[-0.13, 0], [0.3, 0], [0.34, 0.25], [0.45, 0.22], [0.49, 0.05], [0.505, 0], [0.88, 0]],
  mats: [[-0.13, 0], [0.665, 0], [0.72, 0.4], [0.77, 0.85], [0.8, 1], [0.88, 1]],
  osedax: [[-0.13, 0], [0.64, 0], [0.7, 0.5], [0.76, 0.9], [0.8, 1], [0.88, 1]],
  burial: [[-0.13, 0], [0.68, 0], [0.8, 0.35], [0.88, 0.4]],
};

// --------------------------------------------------------------- 磷虾谱系轨道（定义域 v ∈ [−0.2, 0.2]）

const krillKeys: Record<Exclude<keyof KrillState, 'sx' | 'sy' | 'sz'>, Keys> = {
  // 循环末尾：磷虾群升入上层海洋后渐渐远去、隐没在蓝色中；开场第五个镜头再从远处出现，越聚越多
  visible: [
    [-0.2, 0], [-0.192, 0.04], [-0.18, 0.18], [-0.165, 0.45], [-0.15, 0.8], [-0.13, 1], [-0.065, 1], [-0.04, 0.45],
    [-0.018, 0], [0.06, 0], [0.062, 0.035], [0.066, 0.2], [0.07, 0.6], [0.074, 1], [0.11, 1], [0.13, 0.75], [0.16, 0], [0.2, 0],
  ],
  x: [[-0.2, 40], [-0.15, 38], [-0.13, 36], [-0.11, 33], [-0.09, 28], [-0.07, 24], [-0.04, 30], [-0.018, 40], [0.04, 22], [0.062, 16], [0.075, 9], [0.095, 7.5], [0.12, 9], [0.2, 12]],
  y: [[-0.2, 1784], [-0.17, 1782], [-0.15, 1776], [-0.14, 1755], [-0.13, 1650], [-0.11, 1000], [-0.09, 360], [-0.075, 120], [-0.06, 76], [-0.04, 58], [-0.018, 40], [0.04, 50], [0.062, 51], [0.075, 52.2], [0.095, 53], [0.12, 53], [0.2, 53]],
  z: [[-0.2, 10], [-0.15, 6], [-0.07, 4], [-0.04, 22], [-0.018, 55], [0.04, 50], [0.062, 32], [0.068, 14], [0.075, 0.6], [0.08, 0.4], [0.12, 0.5], [0.2, 0]],
  rx: [[-0.2, 22], [-0.17, 16], [-0.15, 10], [-0.12, 9], [-0.06, 8.5], [-0.03, 12], [0.04, 14], [0.062, 11], [0.072, 6], [0.075, 5], [0.1, 6], [0.12, 9], [0.2, 12]],
  ry: [[-0.2, 10], [-0.15, 5], [-0.06, 4.6], [-0.03, 6], [0.04, 7], [0.062, 6], [0.075, 3.4], [0.12, 6], [0.2, 8]],
  rz: [[-0.2, 14], [-0.15, 6], [0, 6], [0.062, 6], [0.075, 3.5], [0.12, 6], [0.2, 8]],
  heading: [[-0.2, -1.2], [-0.13, -1.45], [-0.07, -1.25], [-0.03, -1.0], [0.04, -2.6], [0.062, -2.95], [0.075, -2.95], [0.12, -3.6], [0.2, -3.6]],
  agg: [[-0.2, 0], [-0.18, 0.1], [-0.16, 0.5], [-0.14, 0.85], [-0.12, 1], [-0.06, 1], [-0.03, 0.6], [0.04, 0.4], [0.062, 0.45], [0.07, 0.85], [0.074, 1], [0.1, 1], [0.12, 0.6], [0.16, 0.3], [0.2, 0.3]],
  feed: [[-0.2, 0], [0.079, 0], [0.09, 0.45], [0.1, 0.85], [0.108, 1], [0.2, 1]],
  scatter: [[-0.2, 0], [0.09, 0], [0.105, 0.5], [0.12, 1], [0.2, 1]],
  deep: [[-0.2, 1], [-0.12, 0.9], [-0.06, 0.2], [0, 0], [0.2, 0]],
  stray: [[-0.2, 0], [0.05, 0], [0.055, 1], [0.07, 1], [0.077, 0], [0.2, 0]],
};

// --------------------------------------------------------------- 镜头（循环轨道）
// 列：p, fw, fk, fe, ox, oy, frameH, needW, sx, sy, elev, lat, wcy, cyAbs
type CamRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number];
const CAM_ROWS: CamRow[] = [
  // 1 超远景：鲸鱼很小，海洋辽阔，镜头缓慢推近
  [0.0, 1, 0, 0, 22, -10, 100, 64, 0.5, 0.5, 4, 0, 0, 0],
  [0.008, 1, 0, 0, 16, -8, 80, 52, 0.5, 0.5, 3, 0, 0, 0],
  // 2 侧面全景跟拍：与鲸鱼平行移动，完整展示头、身体与尾鳍（needW 保证竖屏也能放下整条鲸鱼）
  [0.016, 1, 0, 0, 8, -3, 46, 35, 0.5, 0.5, 1.5, 0, 0, 0],
  [0.024, 1, 0, 0, 2.5, -0.5, 27, 24, 0.5, 0.5, 0.8, 0, 0, 0],
  [0.031, 1, 0, 0, 0.5, 0.3, 23, 20.5, 0.5, 0.5, 0.3, 0, 0, 0],
  // 3 低角度仰拍：镜头沉到鲸鱼下方，庞大的身体从画面上方缓缓经过
  [0.0365, 1, 0, 0, -2, 3, 19.8, 18.5, 0.5, 0.5, -2.8, 0, 0, 0],
  [0.042, 1, 0, 0, -0.5, 5.2, 16, 17.6, 0.5, 0.5, -6, 0, 0, 0],
  [0.047, 1, 0, 0, 2, 4.5, 14, 15.5, 0.5, 0.5, -5.5, 0, 0, 0],
  // 4 眼睛与皮肤细节：缓慢升起并靠近眼睛
  [0.0525, 0.35, 0, 0.65, 0.8, 1.6, 8.4, 7.5, 0.5, 0.5, -1.6, 0, 0, 0],
  [0.0575, 0, 0, 1, 0, 0, 4.6, 3.1, 0.5, 0.5, 0, 0, 0, 0],
  [0.0605, 0, 0, 1, 0, 0, 4, 2.7, 0.5, 0.5, 0, 0, 0, 0],
  // 5 磷虾群揭示：缓慢拉远，前方的磷虾越聚越多，鲸鱼转向它们
  [0.0645, 0.75, 0, 0.25, 1.2, 0, 6.2, 7, 0.5, 0.5, 0.3, 0, 0, 0],
  [0.0685, 0.88, 0.12, 0, 0.6, 0, 10.5, 14, 0.5, 0.5, 0.7, 0, 0, 0],
  [0.072, 0.75, 0.25, 0, 0.4, 0.1, 15, 22, 0.5, 0.51, 1, 0, 0, 0],
  [0.075, 0.6, 0.4, 0, 1.5, 0.3, 18, 26, 0.5, 0.52, 1, 0, 0, 0],
  [0.09, 0.88, 0.12, 0, 3.2, 0.6, 14, 20, 0.5, 0.5, 0.6, 0, 0, 0],
  [0.108, 1, 0, 0, 2.2, 0.4, 15, 21, 0.5, 0.5, 0.5, 0, 0, 0],
  [0.125, 1, 0, 0, 1, -2, 20, 24, 0.5, 0.5, -1, 0, 0, 0],
  [0.145, 1, 0, 0, 2, -3.5, 24, 26, 0.5, 0.56, -4, 0, 0, 0],
  [0.158, 1, 0, 0, 1, -3, 22, 24, 0.5, 0.55, -2, 0, 0, 0],
  [0.19, 1, 0, 0, -0.5, -0.8, 17, 21, 0.5, 0.58, 0, 0, 1, 0.0],
  [0.205, 1, 0, 0, 0.5, -1.2, 15, 19, 0.5, 0.6, 0, 0, 1, -0.15],
  [0.218, 1, 0, 0, 1.2, -0.8, 14, 18, 0.5, 0.58, 0, 0, 1, 0.1],
  [0.232, 0.4, 0, 0.6, 0.6, 0.2, 8, 11, 0.5, 0.5, 0, 0, 0, 3],
  [0.248, 0, 0, 1, 0, 0, 2.6, 1.6, 0.5, 0.5, 0, 0, 0, 0],
  [0.27, 0, 0, 1, 0, 0, 2.25, 1.4, 0.5, 0.5, 0, 0, 0, 0],
  [0.288, 0, 0, 1, 0, 0, 2.0, 1.25, 0.5, 0.5, 0, 0, 0, 0],
  [0.296, 0, 0, 1, 0, 0, 2.0, 1.25, 0.5, 0.5, 0, 0, 0, 0],
  [0.306, 0.6, 0, 0.4, 0.4, 0.2, 7, 9, 0.5, 0.5, 0, 0, 0, 0],
  [0.318, 1, 0, 0, 0, 0.5, 22, 22, 0.5, 0.47, 0, 0, 0, 0],
  [0.34, 1, 0, 0, 0, 3, 26, 24, 0.5, 0.42, -5, 0, 0, 0],
  [0.37, 1, 0, 0, -1, 1, 28, 26, 0.5, 0.45, -2, -3, 0, 0],
  [0.41, 1, 0, 0, 0, 0, 26, 24, 0.5, 0.48, 2, 2, 0, 0],
  [0.45, 1, 0, 0, 0, 2, 30, 26, 0.5, 0.42, 5, 0, 0, 0],
  [0.49, 1, 0, 0, 0, 1.5, 28, 24, 0.5, 0.45, 6, 0, 0, 0],
  [0.52, 1, 0, 0, 0, 1.2, 25, 22, 0.5, 0.48, 5.5, 0, 0, 0],
  [0.55, 1, 0, 0, -0.5, 1, 24, 22, 0.5, 0.5, 6, 1, 0, 0],
  [0.585, 1, 0, 0, -0.5, 0.8, 22, 21, 0.5, 0.52, 5, 2, 0, 0],
  [0.625, 1, 0, 0, 1.5, 0.5, 18, 18, 0.5, 0.52, 4, 1, 0, 0],
  [0.665, 1, 0, 0, 0, 0.6, 21, 20, 0.5, 0.52, 5.5, -1, 0, 0],
  [0.7, 1, 0, 0, 0, 0.5, 23, 21, 0.5, 0.52, 6, 0, 0, 0],
  [0.72, 1, 0, 0, -4, 0.6, 14, 14, 0.5, 0.52, 4, -1, 0, 0],
  [0.745, 1, 0, 0, -1.2, 0.8, 8.5, 9, 0.5, 0.52, 2.5, 0, 0, 0],
  [0.77, 1, 0, 0, 3.6, 0.8, 7.5, 8, 0.5, 0.52, 2.2, 0.5, 0, 0],
  [0.8, 1, 0, 0, 0, -0.5, 26, 22, 0.5, 0.55, 7, 0, 0, 0],
  [0.825, 0.55, 0.45, 0, 0, -2, 30, 26, 0.5, 0.5, 5, 0, 0, 0],
  [0.85, 0, 1, 0, 0, 1, 30, 26, 0.5, 0.45, 0, 0, 0, 0],
  [0.868, 0, 1, 0, 0, 0, 34, 28, 0.5, 0.45, -3, 0, 0, 0],
  [0.9, 0, 1, 0, 0, 0, 40, 30, 0.5, 0.45, -4, 0, 0, 0],
  [0.925, 0, 1, 0, 0, 0, 50, 36, 0.5, 0.48, -2, 0, 0, 0],
  // 磷虾群向上远去，镜头转向深蓝中远远游来的新鲸鱼，最终停在开场的超远景
  [0.945, 0.45, 0.55, 0, 6, -2, 90, 58, 0.5, 0.5, 2, 0, 0, 0],
  [0.97, 0.85, 0.15, 0, 16, -8, 100, 62, 0.5, 0.5, 3.5, 0, 0, 0],
];

function camTracks(): TrackSet<keyof CameraFollow> {
  const cols: Array<keyof CameraFollow> = ['fw', 'fk', 'fe', 'ox', 'oy', 'frameH', 'needW', 'sx', 'sy', 'elev', 'lat', 'wcy', 'cyAbs'];
  const ch = {} as Record<keyof CameraFollow, Array<[number, number]>>;
  for (const c of cols) ch[c] = [];
  ch.ax = [[0, 0]];
  ch.ay = [[0, 0]];
  for (const row of CAM_ROWS) cols.forEach((c, i) => ch[c].push([row[0], row[i + 1]]));
  const set = makeTracks(ch, { cyclic: true }) as TrackSet<keyof CameraFollow>;
  // 景别使用对数插值更自然：先换算成 log 再建轨道
  set.frameH = new Track(ch.frameH.map(([p, v]) => [p, Math.log(v)] as const), { cyclic: true });
  set.needW = new Track(ch.needW.map(([p, v]) => [p, Math.log(v)] as const), { cyclic: true });
  return set;
}

// --------------------------------------------------------------- 其他循环轨道
const envKeys = {
  vis: [[0, 72], [0.03, 75], [0.12, 70], [0.3, 65], [0.45, 50], [0.55, 48], [0.8, 48], [0.87, 60], [0.92, 75], [0.95, 80], [0.98, 72]] as Keys,
  focusLight: [[0, 0], [0.4, 0], [0.47, 0.55], [0.55, 0.75], [0.8, 0.75], [0.85, 0.35], [0.9, 0]] as Keys,
  bioGlow: [[0, 0], [0.33, 0], [0.4, 0.5], [0.46, 0.8], [0.55, 0.4], [0.7, 0.7], [0.8, 0.9], [0.87, 0.6], [0.92, 0.1], [0.95, 0]] as Keys,
  vignette: [[0, 0.32], [0.24, 0.4], [0.28, 0.55], [0.3, 0.42], [0.45, 0.5], [0.8, 0.5], [0.9, 0.38]] as Keys,
  comp: [[0, 0], [0.058, 0], [0.074, 1], [0.112, 1], [0.135, 0]] as Keys,
};

const ecoKeys: Record<keyof EcoState, Keys> = {
  scav: [[0, 0], [0.552, 0], [0.57, 0.6], [0.59, 1], [0.64, 1], [0.68, 0.5], [0.72, 0.15], [0.8, 0.1], [0.86, 0]],
  amph: [[0, 0], [0.56, 0], [0.585, 1], [0.66, 1], [0.7, 0.2], [0.75, 0.05], [0.86, 0]],
  crabs: [[0, 0], [0.565, 0], [0.6, 1], [0.8, 0.8], [0.86, 0.6], [0.9, 0]],
  enrich: [[0, 0], [0.6, 0], [0.66, 0.8], [0.72, 1], [0.86, 1], [0.9, 0]],
  sulfo: [[0, 0], [0.69, 0], [0.75, 0.8], [0.8, 1], [0.86, 1], [0.9, 0]],
  dwellers: [[0, 0], [0.7, 0], [0.76, 1], [0.86, 1], [0.9, 0]],
};

const surfaceKeys: Record<Exclude<keyof SurfaceState, 't'>, Keys> = {
  aerial: [[0, 0], [0.15, 0], [0.159, 1], [0.19, 1], [0.199, 0]],
  alt: [[0, 55], [0.15, 55], [0.158, 75], [0.168, 230], [0.178, 210], [0.19, 70], [0.2, 48]],
  rot: [[0, -0.42], [0.15, -0.42], [0.17, -0.3], [0.2, -0.02]],
  surfacing: [[0, 0], [0.152, 0], [0.163, 1], [0.24, 1]],
  breath1: [[0, 0], [0.17, 0], [0.186, 1], [0.3, 1]],
  breath2: [[0, 0], [0.203, 0], [0.218, 1], [0.3, 1]],
};

export class StoryTimeline {
  private readonly whaleT = makeTracks(whaleKeys);
  private readonly krillT = makeTracks(krillKeys);
  private readonly camT = camTracks();
  private readonly envT = makeTracks(envKeys, { cyclic: true });
  private readonly ecoT = makeTracks(ecoKeys);
  private readonly surfT = makeTracks(surfaceKeys, { mode: 'linear' });
  private readonly altT = new Track(surfaceKeys.alt, { mode: 'smooth' });
  private readonly rotT = new Track(surfaceKeys.rot, { mode: 'smooth' });
  private readonly sedT = new Track([[0, 0], [0.497, 0], [0.56, 1]], { mode: 'linear' });

  readonly frame: StoryFrame = {
    p: 0,
    stage: stageAt(0),
    stageLocal: 0,
    whale1: makeWhaleState(),
    whale2: makeWhaleState(),
    krill: { visible: 0, x: 0, y: 0, z: 0, rx: 1, ry: 1, rz: 1, heading: 0, agg: 1, feed: 0, scatter: 0, deep: 0, stray: 0, sx: 0, sy: 0, sz: 0 },
    surface: { aerial: 0, alt: 300, rot: 0, surfacing: 0, breath1: 0, breath2: 0, t: 0 },
    env: { vis: 70, focusLight: 0, bioGlow: 0, vignette: 0.3, sediment: 0 },
    eco: { scav: 0, amph: 0, crabs: 0, enrich: 0, sulfo: 0, dwellers: 0 },
    cam: { fw: 0, fk: 0, fe: 0, ax: 0, ay: 0, ox: 0, oy: 0, frameH: 20, needW: 20, sx: 0.5, sy: 0.5, elev: 0, lat: 0, wcy: 0, cyAbs: 0 },
    comp: 0,
    captions: [],
    timeLabel: null,
  };

  /** 鲸鱼谱系在 u 处的状态 */
  whaleAt(u: number, out: WhaleState): WhaleState {
    const t = this.whaleT;
    for (const k in t) (out as unknown as Record<string, number>)[k] = t[k as keyof typeof t].at(u);
    out.visible = 1;
    return out;
  }

  krillAt(v: number, out: KrillState): KrillState {
    const t = this.krillT;
    for (const k in t) (out as unknown as Record<string, number>)[k] = t[k as keyof typeof t].at(v);
    // 零星磷虾停在鲸鱼眼睛前方数米处：鲸鱼游过时，它们从特写镜头中缓缓漂过
    const u = 0.056;
    const pitch = this.whaleT.pitch.at(u);
    out.sx = this.whaleT.x.at(u) + 1.93 * Math.cos(pitch) + 1;
    out.sy = this.whaleT.y.at(u) + 1.93 * Math.sin(pitch) + 0.05;
    out.sz = 0;
    return out;
  }

  /** 求出进度 p（已取模到 [0,1)）时的完整世界状态。compAngle 为当前设备的构图倾角。 */
  evaluate(pIn: number, compAngle: number): StoryFrame {
    const p = pIn - Math.floor(pIn);
    const f = this.frame;
    f.p = p;
    f.stage = stageAt(p);
    f.stageLocal = clamp((p - f.stage.start) / (f.stage.end - f.stage.start));

    const comp = compAngle * this.envT.comp.at(p);
    f.comp = comp;

    // 鲸鱼：开场鲸鱼 / 新鲸鱼
    this.whaleAt(Math.min(p, 0.88), f.whale1);
    f.whale1.visible = p < 0.9 ? 1 : 0;
    this.whaleAt(p - 1, f.whale2);
    f.whale2.visible = p >= 0.86 ? smoothstep(-0.125, -0.105, p - 1) : 0;

    const v = p < 0.5 ? p : p - 1;
    this.krillAt(v, f.krill);

    // 开阔海域构图旋转（绕开场锚点）
    if (Math.abs(comp) > 1e-4) {
      rotateAbout(f.whale1, comp);
      rotateAbout(f.whale2, comp);
      const k = f.krill;
      const c = Math.cos(comp);
      const s = Math.sin(comp);
      const dx = k.x - WORLD.anchorX;
      const dy = k.y - WORLD.anchorY;
      k.x = WORLD.anchorX + dx * c - dy * s;
      k.y = WORLD.anchorY + dx * s + dy * c;
      k.heading += comp;
      const sdx = k.sx - WORLD.anchorX;
      const sdy = k.sy - WORLD.anchorY;
      k.sx = WORLD.anchorX + sdx * c - sdy * s;
      k.sy = WORLD.anchorY + sdx * s + sdy * c;
    }

    const ct = this.camT;
    const cam = f.cam;
    for (const key in ct) (cam as unknown as Record<string, number>)[key] = ct[key as keyof CameraFollow].at(p);
    cam.frameH = Math.exp(cam.frameH);
    cam.needW = Math.exp(cam.needW);

    const s = f.surface;
    s.aerial = this.surfT.aerial.at(p);
    s.alt = this.altT.at(p);
    s.rot = this.rotT.at(p);
    s.surfacing = this.surfT.surfacing.at(p);
    s.breath1 = this.surfT.breath1.at(p);
    s.breath2 = this.surfT.breath2.at(p);
    s.t = (p - 0.15) * 360;

    const e = f.env;
    e.vis = this.envT.vis.at(p);
    e.focusLight = this.envT.focusLight.at(p);
    e.bioGlow = this.envT.bioGlow.at(p);
    e.vignette = this.envT.vignette.at(p);
    e.sediment = this.sedT.at(p);

    const eco = f.eco;
    for (const k in this.ecoT) (eco as unknown as Record<string, number>)[k] = clamp(this.ecoT[k as keyof EcoState].at(p));

    // 字幕
    f.captions.length = 0;
    for (const c of CAPTIONS) {
      const a = smoothstep(c.from, c.from + 0.004, p) * (1 - smoothstep(c.to - 0.004, c.to, p));
      if (a > 0.001) f.captions.push({ c, a });
    }
    // 时间流逝提示
    f.timeLabel = null;
    if (p > 0.495 && p < 0.8) {
      let cur = TIME_LABELS[0];
      let next = 0.8;
      for (let i = 0; i < TIME_LABELS.length; i++) {
        if (p >= TIME_LABELS[i].at) {
          cur = TIME_LABELS[i];
          next = i + 1 < TIME_LABELS.length ? TIME_LABELS[i + 1].at : 0.8;
        }
      }
      const a = smoothstep(cur.at, cur.at + 0.004, p) * (1 - smoothstep(next - 0.003, next, p));
      f.timeLabel = { text: cur.text, a: a * (1 - smoothstep(0.79, 0.8, p)) };
    }
    return f;
  }

  /** 镜头目标点：由鲸鱼、磷虾、眼睛的跟随权重混合。 */
  static shotFrom(
    f: StoryFrame,
    whale: { x: number; y: number },
    eye: { x: number; y: number },
    aspect: number,
    out: ShotParams,
  ): ShotParams {
    const c = f.cam;
    const k = f.krill;
    // 各列独立插值后权重之和可能略偏离 1，这里归一化，避免特写时目标点被拉偏
    const sum = c.fw + c.fk + c.fe;
    const n = sum > 1e-4 ? 1 / sum : 0;
    const wa = sum > 1e-4 ? 0 : 1;
    let tx = c.ax * wa + (whale.x * c.fw + k.x * c.fk + eye.x * c.fe) * n;
    let ty = c.ay * wa + (whale.y * c.fw + k.y * c.fk + eye.y * c.fe) * n;
    // 偏移量在构图坐标系中，随构图一起旋转
    const cs = Math.cos(f.comp);
    const sn = Math.sin(f.comp);
    tx += c.ox * cs - c.oy * sn;
    ty += c.ox * sn + c.oy * cs;
    out.tx = tx;
    out.ty = ty;
    // 竖屏：保证所需宽度可见
    out.frameH = Math.max(c.frameH, c.needW / Math.max(0.3, aspect));
    if (aspect < 1) out.frameH = Math.min(out.frameH, c.frameH * 2.6);
    // 竖屏的开阔海域构图：目标点略偏右，给左下方的鲸鱼留出空间
    const compW = Math.abs(f.comp) > 0.3 ? Math.min(1, Math.abs(f.comp) / 0.7) : 0;
    out.sx = c.sx + (aspect < 0.8 ? 0.07 * compW : 0);
    out.sy = c.sy;
    out.elev = lerp(c.elev, ty - c.cyAbs, c.wcy);
    out.lat = c.lat;
    return out;
  }
}

function rotateAbout(w: WhaleState, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = w.x - WORLD.anchorX;
  const dy = w.y - WORLD.anchorY;
  w.x = WORLD.anchorX + dx * c - dy * s;
  w.y = WORLD.anchorY + dx * s + dy * c;
  w.pitch += a;
}
