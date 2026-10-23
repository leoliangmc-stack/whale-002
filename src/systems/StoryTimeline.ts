import type { ShotParams } from '../core/Camera';
import { clamp, lerp, smoothstep } from '../core/math';
import { makeTracks, Track, type Keys, type TrackSet } from '../core/Track';
import { CAPTIONS, CYCLE_SECONDS, secondsAt, stageAt, TIME_LABELS, WORLD, type Caption, type StageDef } from '../config/stages';
import { makeWhaleState, type WhaleState } from '../entities/Whale';
import { REST_GROUND, S_EYE, S_REF, WHALE_LEN } from '../entities/WhaleBody';
import { ART_EYE_OFF } from '../entities/WhaleArt';
import { CONTACT_P, DESCENT_START, DescentMotion, makeDescentSample } from './DescentMotion';
import { makeSwimSample, SwimMotion } from './SwimMotion';

/**
 * StoryTimeline：把 storyProgress 映射为整个世界的状态。
 *
 * 关键设计：
 *  1. 所有叙事状态都是进度的纯函数（关键帧轨道），正放、倒放、重播完全一致；
 *  2. 镜头轨道是“循环轨道”，在 p=1 与 p=0 处 C1 连续；
 *  3. 新鲸鱼（p≥0.875）与开场鲸鱼共用同一条“鲸鱼谱系”轨道（u = p−1），
 *     因此循环衔接时位置、大小、朝向、速度与姿态天然一致；
 *  4. 磷虾群同理（v = p−1）；
 *  5. 从停止游动到落上海床的一段（DESCENT_START ~ DESCENT_END）由 DescentMotion 的
 *     确定性动作表给出：位置、姿态、尾叶 / 胸鳍 / 头部的被动层、镜头跟随的滞后与水体参照系；
 *  6. 开场到滤食（SWIM_START ~ SWIM_END）由 SwimMotion 的动作表给出：拍尾与滑行的节奏、
 *     速度的惯性、深度调整、跟随路径的俯仰、胸鳍与镜头跟随。拍尾相位同样由故事时间决定。
 */

export const Y_REST = WORLD.seabedY - REST_GROUND;
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
  /** 着陆扬起的沉积物：接触海床后的秒数（之前为 0） */
  sediment: number;
  /** 下沉时的光：光束衰减长度（米）、自上而下的散射天光、深蓝调色、身体的轮廓光（见 LightingManager） */
  rayLen: number;
  glow: number;
  tone: number;
  rim: number;
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
  /** 镜头跟随点相对鲸鱼的滞后（米，由下沉动作给出） */
  lagX: number;
  lagY: number;
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
  /**
   * 水体参照系：x / y 为水体在世界中的累计偏移（海洋雪随之漂移），
   * flowX / flowY 为鲸鱼相对水体的速度（m/s），wake 为尾流扰动强度。
   */
  water: { x: number; y: number; flowX: number; flowY: number; wake: number };
  /** 开阔海域构图旋转角（已乘以权重） */
  comp: number;
  captions: Array<{ c: Caption; a: number }>;
  timeLabel: { text: string; a: number } | null;
}

// --------------------------------------------------------------- 鲸鱼谱系轨道（定义域 u ∈ [−0.13, 0.88]）

type DescentField = 'beat' | 'beatPh' | 'flex' | 'nod' | 'fluke' | 'finN' | 'finF' | 'arc' | 'fin';
const DESCENT_FIELDS: DescentField[] = ['beat', 'beatPh', 'flex', 'nod', 'fluke', 'finN', 'finF', 'arc', 'fin'];

const whaleKeys: Record<keyof Omit<WhaleState, 'visible' | 'seabed' | 'phase' | DescentField>, Keys> = {
  // 开场：从远处缓缓游来（约 3.3 m/s，蓝鲸的巡游速度），接近磷虾群时减速。
  // SWIM_START ~ SWIM_END 之间的位置、俯仰与拍尾幅度由 SwimMotion 给出，这里的关键帧是它的构图锚点与交还目标
  x: [
    [-0.13, -178.3], [-0.1, -166.3], [-0.07, -150.9], [-0.035, -120], [0, -89.8], [0.014, -73.7], [0.03, -56.6], [0.047, -39.4],
    [0.061, -25.7], [0.068, -19.5], [0.075, -12.3], [0.078, -9.3], [0.095, 2.7], [0.11, 11], [0.12, 15.4], [0.135, 22.3], [0.15, 29.1], [0.16, 32.6], [0.2, 37.7], [0.22, 41.1],
    // 0.262 ~ 0.512 由下沉动作表接管（这里只决定交接处的位置与速度）
    [0.245, 45.3], [DESCENT_START, 46.2], [0.27, 46.6], [0.512, WORLD.restX], [0.88, WORLD.restX],
  ],
  // 浮上海面时，背部露出水面约 0.7 米，喷气孔刚好高出水面
  y: [
    [-0.13, 25.7], [-0.07, 31.3], [-0.035, 35.0], [0, 38.0], [0.03, 41.85], [0.047, 44.6], [0.061, 48.0], [0.075, 49.75],
    [0.095, 49], [0.11, 48.3], [0.12, 46.3], [0.135, 35], [0.15, 19], [0.156, 11.5], [0.16, 4.6], [0.166, 1.6], [0.2, 1.45], [0.216, 1.5],
    [0.226, 5.5], [0.245, 11], [DESCENT_START, 12.5], [0.27, 13], [0.512, Y_REST], [0.88, Y_REST],
  ],
  z: [[-0.13, 265.7], [-0.1, 214.3], [-0.07, 157.7], [-0.035, 102.9], [0, 56.6], [0.014, 26.6], [0.026, 6], [0.035, 0], [0.88, 0]],
  pitch: [
    [-0.13, 0], [0, 0], [0.03, 0.02], [0.047, 0.06], [0.058, 0.16], [0.068, 0.19], [0.074, 0.1], [0.08, 0], [0.086, -0.07], [0.11, -0.1], [0.12, -0.2], [0.135, -0.42], [0.15, -0.38],
    [0.158, -0.15], [0.166, -0.06], [0.2, -0.05], [0.216, -0.04], [0.226, 0.05], [0.245, 0.04], [DESCENT_START, 0.035],
    [0.27, 0.032], [0.512, 0], [0.88, 0],
  ],
  swim: [
    [-0.13, 0.85], [0.06, 0.85], [0.075, 1], [0.088, 1], [0.11, 0.55], [0.125, 1], [0.15, 1], [0.166, 0.3], [0.2, 0.25], [0.22, 0.35],
    // 闭眼特写中（尾部不在画面里），主动游动交给由进度驱动的最后几次摆动（DescentMotion.beat）
    [0.245, 0.3], [0.264, 0.3], [0.282, 0], [0.88, 0],
  ],
  mouth: [[-0.13, 0], [0.074, 0], [0.083, 0.55], [0.088, 1], [0.098, 1], [0.106, 0.3], [0.112, 0], [0.88, 0]],
  throat: [[-0.13, 0], [0.076, 0], [0.086, 0.6], [0.096, 1], [0.104, 1], [0.113, 0.7], [0.125, 0.25], [0.14, 0], [0.88, 0]],
  eye: [[-0.13, 1], [0.248, 1], [0.262, 0.62], [0.27, 0.58], [0.279, 0.25], [0.288, 0], [0.88, 0]],
  life: [[-0.13, 1], [0.255, 1], [0.3, 0], [0.88, 0]],
  tissue: [[-0.13, 1], [0.555, 1], [0.58, 0.92], [0.605, 0.8], [0.63, 0.64], [0.655, 0.46], [0.68, 0.26], [0.7, 0.08], [0.715, 0], [0.88, 0]],
  collapse: [[-0.13, 0], [0.6, 0], [0.66, 0.3], [0.72, 0.75], [0.78, 1], [0.88, 1]],
  // 腹部接触海床后的约 5 秒：胸腹部先压进软泥，头部随后放低，尾部最后落下（见 WhaleBody.restSpineDY）
  rest: [[-0.13, 0], [0.497, 0], [0.5006, 0.3], [0.5041, 0.56], [0.5077, 0.76], [0.5118, 0.9], [0.5178, 1], [0.88, 1]],
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
  x: [[-0.2, 68.57], [-0.15, 65.14], [-0.13, 61.71], [-0.11, 56.57], [-0.09, 48], [-0.07, 41.14], [-0.04, 51.43], [-0.018, 68.57], [0.04, 37.71], [0.062, 27.43], [0.075, 15.43], [0.095, 12.86], [0.12, 15.43], [0.2, 20.57]],
  y: [[-0.2, 1772.57], [-0.17, 1769.14], [-0.15, 1758.86], [-0.14, 1722.86], [-0.13, 1650], [-0.11, 1000], [-0.09, 360], [-0.075, 160], [-0.06, 87.43], [-0.04, 56.57], [-0.018, 25.71], [0.04, 42.86], [0.062, 44.57], [0.075, 46.63], [0.095, 48], [0.12, 48], [0.2, 48]],
  z: [[-0.2, 17.14], [-0.15, 10.29], [-0.07, 6.86], [-0.04, 37.71], [-0.018, 94.29], [0.04, 85.71], [0.062, 54.86], [0.068, 24], [0.075, 1.03], [0.08, 0.69], [0.12, 0.86], [0.2, 0]],
  rx: [[-0.2, 37.71], [-0.17, 27.43], [-0.15, 17.14], [-0.12, 15.43], [-0.06, 14.57], [-0.03, 20.57], [0.04, 24], [0.062, 18.86], [0.072, 10.29], [0.075, 8.57], [0.1, 10.29], [0.12, 15.43], [0.2, 20.57]],
  ry: [[-0.2, 17.14], [-0.15, 8.57], [-0.06, 7.89], [-0.03, 10.29], [0.04, 12], [0.062, 10.29], [0.075, 5.83], [0.12, 10.29], [0.2, 13.71]],
  rz: [[-0.2, 24], [-0.15, 10.29], [0, 10.29], [0.062, 10.29], [0.075, 6], [0.12, 10.29], [0.2, 13.71]],
  heading: [[-0.2, -1.2], [-0.13, -1.45], [-0.07, -1.25], [-0.03, -1.0], [0.04, -2.6], [0.062, -2.95], [0.075, -2.95], [0.12, -3.6], [0.2, -3.6]],
  agg: [[-0.2, 0], [-0.18, 0.1], [-0.16, 0.5], [-0.14, 0.85], [-0.12, 1], [-0.06, 1], [-0.03, 0.6], [0.04, 0.4], [0.062, 0.45], [0.07, 0.85], [0.074, 1], [0.1, 1], [0.12, 0.6], [0.16, 0.3], [0.2, 0.3]],
  feed: [[-0.2, 0], [0.079, 0], [0.09, 0.45], [0.1, 0.85], [0.108, 1], [0.2, 1]],
  scatter: [[-0.2, 0], [0.09, 0], [0.105, 0.5], [0.12, 1], [0.2, 1]],
  deep: [[-0.2, 1], [-0.12, 0.9], [-0.06, 0.2], [0, 0], [0.2, 0]],
  stray: [[-0.2, 0], [0.05, 0], [0.055, 1], [0.07, 1], [0.077, 0], [0.2, 0]],
};

// --------------------------------------------------------------- 镜头（循环轨道）
// 列：p, fw, fk, fe, ox, oy, frameH, needW, sx, sy, elev, lat, wcy, cyAbs
// needW 是竖屏时必须容纳的宽度：下沉段按 ox 计算，吻端在参考点前约 10 米、尾叶尖在后约 17 米
type CamRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number];
const CAM_ROWS: CamRow[] = [
  // 1 超远景：鲸鱼很小，海洋辽阔，镜头缓慢推近
  [0.0, 1, 0, 0, 37.71, -17.14, 171.43, 109.71, 0.5, 0.5, 6.86, 0, 0, 0],
  [0.008, 1, 0, 0, 27.43, -13.71, 137.14, 89.14, 0.5, 0.5, 5.14, 0, 0, 0],
  // 2 侧面全景跟拍：与鲸鱼平行移动，完整展示头、身体与尾鳍（needW 保证竖屏也能放下整条鲸鱼）
  [0.016, 1, 0, 0, 13.71, -5.14, 78.86, 60, 0.5, 0.5, 2.57, 0, 0, 0],
  [0.024, 1, 0, 0, 4.29, -0.86, 46.29, 41.14, 0.5, 0.5, 1.37, 0, 0, 0],
  [0.031, 1, 0, 0, 0.86, 0.51, 39.43, 35.14, 0.5, 0.5, 0.51, 0, 0, 0],
  // 3 低角度仰拍：镜头沉到鲸鱼下方，庞大的身体从画面上方缓缓经过
  [0.0365, 1, 0, 0, -3.43, 5.14, 33.94, 31.71, 0.5, 0.5, -4.8, 0, 0, 0],
  [0.042, 1, 0, 0, -0.86, 8.91, 27.43, 30.17, 0.5, 0.5, -10.29, 0, 0, 0],
  [0.047, 1, 0, 0, 3.43, 7.71, 24, 26.57, 0.5, 0.5, -9.43, 0, 0, 0],
  // 4 眼睛与皮肤细节：缓慢升起并靠近眼睛
  [0.0525, 0.35, 0, 0.65, 1.37, 2.74, 14.4, 12.86, 0.5, 0.5, -2.74, 0, 0, 0],
  [0.0575, 0, 0, 1, 0, 0, 7.89, 5.31, 0.5, 0.5, 0, 0, 0, 0],
  [0.0605, 0, 0, 1, 0, 0, 6.86, 4.63, 0.5, 0.5, 0, 0, 0, 0],
  // 5 磷虾群揭示：缓慢拉远，前方的磷虾越聚越多，鲸鱼转向它们
  [0.0645, 0.75, 0, 0.25, 2.06, 0, 10.63, 12, 0.5, 0.5, 0.51, 0, 0, 0],
  [0.0685, 0.88, 0.12, 0, 1.03, 0, 18, 24, 0.5, 0.5, 1.2, 0, 0, 0],
  [0.072, 0.75, 0.25, 0, 0.69, 0.17, 25.71, 37.71, 0.5, 0.51, 1.71, 0, 0, 0],
  [0.075, 0.6, 0.4, 0, 2.57, 0.51, 30.86, 44.57, 0.5, 0.52, 1.71, 0, 0, 0],
  [0.09, 0.88, 0.12, 0, 5.49, 1.03, 24, 34.29, 0.5, 0.5, 1.03, 0, 0, 0],
  [0.108, 1, 0, 0, 3.77, 0.69, 25.71, 36, 0.5, 0.5, 0.86, 0, 0, 0],
  [0.125, 1, 0, 0, 1.71, -3.43, 34.29, 41.14, 0.5, 0.5, -1.71, 0, 0, 0],
  [0.145, 1, 0, 0, 3.43, -6, 41.14, 44.57, 0.5, 0.56, -6.86, 0, 0, 0],
  [0.158, 1, 0, 0, 1.71, -5.14, 37.71, 41.14, 0.5, 0.55, -3.43, 0, 0, 0],
  [0.19, 1, 0, 0, -0.86, -1.37, 29.14, 36, 0.5, 0.58, 0, 0, 1, 0.0],
  [0.205, 1, 0, 0, 0.86, -2.06, 25.71, 32.57, 0.5, 0.6, 0, 0, 1, -0.15],
  [0.218, 1, 0, 0, 2.06, -1.37, 24, 30.86, 0.5, 0.58, 0, 0, 1, 0.1],
  [0.232, 0.4, 0, 0.6, 1.03, 0.34, 13.71, 18.86, 0.5, 0.5, 0, 0, 0, 3],
  [0.248, 0, 0, 1, 0, 0, 4.46, 2.74, 0.5, 0.5, 0, 0, 0, 0],
  [0.27, 0, 0, 1, 0, 0, 3.86, 2.4, 0.5, 0.5, 0, 0, 0, 0],
  [0.288, 0, 0, 1, 0, 0, 3.43, 2.14, 0.5, 0.5, 0, 0, 0, 0],
  [0.296, 0, 0, 1, 0, 0, 3.43, 2.14, 0.5, 0.5, 0, 0, 0, 0],
  // ---- 下沉（各镜头之间是连续的拉、降、绕与推，没有切换）
  // 1 侧面中远景：从闭上的眼睛缓缓拉开，看见尾鳍最后几次渐弱的摆动与向前的滑行
  [0.303, 0.55, 0, 0.45, 1.37, 0.17, 12.86, 15.43, 0.5, 0.5, 0.34, 0, 0, 0],
  [0.31, 1, 0, 0, 2.74, 0.34, 32.57, 41.14, 0.5, 0.5, 0.86, 0, 0, 0],
  [0.317, 1, 0, 0, 1.03, 0.51, 39.43, 38.74, 0.5, 0.5, 1.03, 0, 0, 0],
  // 2 略低于鲸鱼的仰视：镜头沉到身体下方，庞大的身体从上方缓缓滑过，海面的光勾出背部轮廓
  [0.324, 1, 0, 0, -1.03, 5.14, 34.29, 34.63, 0.5, 0.5, -6.17, 0, 0, 0],
  [0.332, 1, 0, 0, -3.77, 8.91, 28.29, 31.71, 0.5, 0.5, -10.97, 0, 0, 0],
  // 3 斜侧面跟随：回到与鲸鱼相近的高度并偏向一侧，看头部先沉、躯干随之倾斜
  //   镜头略低于鲸鱼，微微仰视：上方透下的光束与天光衬出弓形的身体；低头的身体在画面中更高、更窄，
  //   下方留出它将要沉入的海水（竖屏所需宽度随之减小）
  [0.34, 1, 0, 0, 0.34, 3.77, 32.57, 37.37, 0.5, 0.47, -3.0, 5.14, 0, 0],
  [0.348, 1, 0, 0, 0.4, 1.71, 34.29, 36, 0.5, 0.45, -2.2, 8.57, 0, 0],
  [0.357, 1, 0, 0, 0.5, 1.5, 36.86, 35, 0.5, 0.45, -1.4, 7.71, 0, 0],
  // 4 缓慢拉远：鲸鱼在画面中逐渐变小，光束渐渐淡去，四周越来越深、越来越空
  [0.376, 1, 0, 0, 0, 1.37, 48, 37, 0.5, 0.46, 0.6, 4.29, 0, 0],
  [0.4, 1, 0, 0, -0.3, 1.37, 65.14, 45, 0.5, 0.47, 3.2, 0, 0, 0],
  // 5 远景持续跟随：深蓝中一个安静下沉的身影，最后自然接上海床
  [0.43, 1, 0, 0, -0.86, 1.37, 77.14, 51, 0.5, 0.47, 5.2, -1.71, 0, 0],
  [0.455, 1, 0, 0, 0, 1.71, 72, 50, 0.5, 0.46, 6.86, -0.86, 0, 0],
  [0.478, 1, 0, 0, 0, 2.4, 58.29, 46.29, 0.5, 0.45, 8.23, 0, 0, 0],
  // 着陆：缓慢推近为斜侧面中远景——镜头略高于海床，同时看清背部轮廓、侧面与腹部的接触；
  // 构图中心放在吻端与尾叶之间（参考点后方约 2 米），头尾都完整留在画面内
  [0.497, 1, 0, 0, -1.37, 2.23, 45.43, 41.14, 0.5, 0.47, 8.57, 0, 0, 0],
  [0.52, 1, 0, 0, -2.74, 1.71, 35.14, 36.86, 0.5, 0.5, 7.54, 1.03, 0, 0],
  [0.55, 1, 0, 0, -3.26, 1.54, 32.57, 36, 0.5, 0.51, 7.2, 2.06, 0, 0],
  [0.585, 1, 0, 0, -2.06, 1.37, 33.43, 35.14, 0.5, 0.52, 7.71, 3.43, 0, 0],
  [0.625, 1, 0, 0, 2.57, 0.86, 30.86, 30.86, 0.5, 0.52, 6.86, 1.71, 0, 0],
  [0.665, 1, 0, 0, 0, 1.03, 36, 34.29, 0.5, 0.52, 9.43, -1.71, 0, 0],
  [0.7, 1, 0, 0, 0, 0.86, 39.43, 36, 0.5, 0.52, 10.29, 0, 0, 0],
  [0.72, 1, 0, 0, -6.86, 1.03, 24, 24, 0.5, 0.52, 6.86, -1.71, 0, 0],
  [0.745, 1, 0, 0, -2.06, 1.37, 14.57, 15.43, 0.5, 0.52, 4.29, 0, 0, 0],
  [0.77, 1, 0, 0, 6.17, 1.37, 12.86, 13.71, 0.5, 0.52, 3.77, 0.86, 0, 0],
  [0.8, 1, 0, 0, 0, -0.86, 44.57, 37.71, 0.5, 0.55, 12, 0, 0, 0],
  [0.825, 0.55, 0.45, 0, 0, -3.43, 51.43, 44.57, 0.5, 0.5, 8.57, 0, 0, 0],
  [0.85, 0, 1, 0, 0, 1.71, 51.43, 44.57, 0.5, 0.45, 0, 0, 0, 0],
  [0.868, 0, 1, 0, 0, 0, 58.29, 48, 0.5, 0.45, -5.14, 0, 0, 0],
  [0.9, 0, 1, 0, 0, 0, 68.57, 51.43, 0.5, 0.45, -6.86, 0, 0, 0],
  [0.925, 0, 1, 0, 0, 0, 85.71, 61.71, 0.5, 0.48, -3.43, 0, 0, 0],
  // 磷虾群向上远去，镜头转向深蓝中远远游来的新鲸鱼，最终停在开场的超远景
  [0.945, 0.45, 0.55, 0, 10.29, -3.43, 154.29, 99.43, 0.5, 0.5, 3.43, 0, 0, 0],
  [0.97, 0.85, 0.15, 0, 27.43, -13.71, 171.43, 106.29, 0.5, 0.5, 6, 0, 0, 0],
];

/** 镜头轨道的自变量：进度 → 一圈之内的故事时间比例 [0,1) */
function camTime(p: number): number {
  return secondsAt(p - Math.floor(p)) / CYCLE_SECONDS;
}

function camTracks(): TrackSet<Exclude<keyof CameraFollow, 'lagX' | 'lagY'>> {
  const cols: Array<keyof CameraFollow> = ['fw', 'fk', 'fe', 'ox', 'oy', 'frameH', 'needW', 'sx', 'sy', 'elev', 'lat', 'wcy', 'cyAbs'];
  type TrackedCol = Exclude<keyof CameraFollow, 'lagX' | 'lagY'>;
  const ch = {} as Record<TrackedCol, Array<[number, number]>>;
  for (const c of cols) ch[c as TrackedCol] = [];
  ch.ax = [[0, 0]];
  ch.ay = [[0, 0]];
  // 关键帧按故事时间（归一化到一圈）插值：镜头的推拉与平移速度在各段之间连续，不会在段边界上突然变快变慢
  for (const row of CAM_ROWS) cols.forEach((c, i) => ch[c as TrackedCol].push([camTime(row[0]), row[i + 1]]));
  const set = makeTracks(ch, { cyclic: true }) as TrackSet<TrackedCol>;
  // 景别使用对数插值更自然：先换算成 log 再建轨道
  set.frameH = new Track(ch.frameH.map(([p, v]) => [p, Math.log(v)] as const), { cyclic: true });
  set.needW = new Track(ch.needW.map(([p, v]) => [p, Math.log(v)] as const), { cyclic: true });
  return set;
}

// --------------------------------------------------------------- 其他循环轨道
const envKeys = {
  vis: [[0, 123.43], [0.03, 128.57], [0.12, 120], [0.3, 111.43], [0.45, 85.71], [0.55, 82.29], [0.8, 82.29], [0.87, 102.86], [0.92, 128.57], [0.95, 137.14], [0.98, 123.43]] as Keys,
  focusLight: [[0, 0], [0.4, 0], [0.47, 0.55], [0.55, 0.75], [0.8, 0.75], [0.85, 0.35], [0.9, 0]] as Keys,
  bioGlow: [[0, 0], [0.33, 0], [0.4, 0.5], [0.46, 0.8], [0.55, 0.4], [0.7, 0.7], [0.8, 0.9], [0.87, 0.6], [0.92, 0.1], [0.95, 0]] as Keys,
  vignette: [[0, 0.32], [0.24, 0.4], [0.28, 0.55], [0.3, 0.42], [0.45, 0.5], [0.8, 0.5], [0.9, 0.38]] as Keys,
  comp: [[0, 0], [0.058, 0], [0.074, 1], [0.112, 1], [0.135, 0]] as Keys,
  // 下沉：光束一直追随到更深的水层才渐渐消失；开阔的深蓝海水、身体柔和的轮廓光
  // （深度被艺术化压缩：光束衰减按叙事节奏放慢，在约 1000 米、“阳光再也到达不了”的字幕之前消失）
  rayLen: [[0, 70], [0.29, 70], [0.315, 120], [0.345, 170], [0.362, 300], [0.375, 520], [0.388, 650], [0.397, 480], [0.405, 320], [0.43, 250], [0.47, 160], [0.52, 70]] as Keys,
  glow: [[0, 0], [0.29, 0], [0.32, 0.45], [0.35, 1], [0.46, 1], [0.495, 0.35], [0.53, 0]] as Keys,
  tone: [[0, 0], [0.29, 0], [0.315, 1], [0.35, 1], [0.375, 0.35], [0.41, 0]] as Keys,
  rim: [[0, 0], [0.292, 0], [0.315, 0.8], [0.34, 1], [0.47, 1], [0.497, 0.3], [0.52, 0]] as Keys,
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
  alt: [[0, 94.29], [0.15, 94.29], [0.158, 128.57], [0.168, 394.29], [0.178, 360], [0.19, 120], [0.2, 82.29]],
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
  readonly descent = StoryTimeline.makeDescent(this.whaleT);
  readonly swim = new SwimMotion(this.whaleT);
  private readonly dsc = makeDescentSample();
  private readonly ssc = makeSwimSample();
  /** 眼睛特写时零星磷虾的锚点（世界坐标，与构图旋转无关） */
  private readonly stray = { x: 0, y: 0 };
  private readonly wo = { x: 0, y: 0 };

  constructor() {
    this.placeStray();
  }

  /** 由交接处（DESCENT_START）的关键帧位置与速度初始化下沉动作 */
  private static makeDescent(t: TrackSet<keyof typeof whaleKeys>): DescentMotion {
    const p = DESCENT_START;
    const e = 1e-4;
    const secPerP = (secondsAt(p + e) - secondsAt(p - e)) / (2 * e);
    return new DescentMotion(
      {
        x: t.x.at(p),
        y: t.y.at(p),
        pitch: t.pitch.at(p),
        vx: t.x.slope(p) / secPerP,
        vy: t.y.slope(p) / secPerP,
        vp: t.pitch.slope(p) / secPerP,
      },
      Y_REST,
    );
  }

  readonly frame: StoryFrame = {
    p: 0,
    stage: stageAt(0),
    stageLocal: 0,
    whale1: makeWhaleState(),
    whale2: makeWhaleState(),
    krill: { visible: 0, x: 0, y: 0, z: 0, rx: 1, ry: 1, rz: 1, heading: 0, agg: 1, feed: 0, scatter: 0, deep: 0, stray: 0, sx: 0, sy: 0, sz: 0 },
    surface: { aerial: 0, alt: 300, rot: 0, surfacing: 0, breath1: 0, breath2: 0, t: 0 },
    env: { vis: 70, focusLight: 0, bioGlow: 0, vignette: 0.3, sediment: 0, rayLen: 70, glow: 0, tone: 0, rim: 0 },
    eco: { scav: 0, amph: 0, crabs: 0, enrich: 0, sulfo: 0, dwellers: 0 },
    cam: { lagX: 0, lagY: 0, fw: 0, fk: 0, fe: 0, ax: 0, ay: 0, ox: 0, oy: 0, frameH: 20, needW: 20, sx: 0.5, sy: 0.5, elev: 0, lat: 0, wcy: 0, cyAbs: 0 },
    water: { x: 0, y: 0, flowX: 0, flowY: 0, wake: 0 },
    comp: 0,
    captions: [],
    timeLabel: null,
  };

  /** 鲸鱼谱系在 u 处的状态 */
  whaleAt(u: number, out: WhaleState): WhaleState {
    const t = this.whaleT;
    for (const k in t) (out as unknown as Record<string, number>)[k] = t[k as keyof typeof t].at(u);
    out.visible = 1;
    out.seabed = WORLD.seabedY;
    if (DescentMotion.covers(u)) {
      const d = this.descent.sample(u, this.dsc);
      out.x = d.x;
      out.y = d.y;
      out.pitch = d.pitch;
      for (const k of DESCENT_FIELDS) out[k] = d[k];
      out.seabed += this.descent.seabedShift(u, this.wo).y;
    } else {
      for (const k of DESCENT_FIELDS) out[k] = 0;
    }
    out.phase = this.swim.phaseAt(u);
    if (SwimMotion.covers(u)) {
      const m = this.swim.sample(u, this.ssc);
      out.x = m.x;
      out.y = m.y;
      out.z = m.z;
      out.pitch = m.pitch;
      out.swim = m.swim;
      out.fin = m.fin;
      out.flex = m.flex;
      out.nod = m.nod;
    }
    return out;
  }

  krillAt(v: number, out: KrillState): KrillState {
    const t = this.krillT;
    for (const k in t) (out as unknown as Record<string, number>)[k] = t[k as keyof typeof t].at(v);
    out.sx = this.stray.x;
    out.sy = this.stray.y;
    out.sz = 0;
    return out;
  }

  /** 零星磷虾停在鲸鱼眼睛前方数米处：鲸鱼游过时，它们从特写镜头中缓缓漂过 */
  private placeStray(): void {
    const w = this.whaleAt(0.056, makeWhaleState());
    const eye = (S_REF - S_EYE) * WHALE_LEN;
    const below = -ART_EYE_OFF * WHALE_LEN;
    this.stray.x = w.x + eye * Math.cos(w.pitch) - below * Math.sin(w.pitch) + 1.7;
    this.stray.y = w.y + eye * Math.sin(w.pitch) + below * Math.cos(w.pitch) + 0.09;
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
    const pc = camTime(p);
    for (const key in ct) (cam as unknown as Record<string, number>)[key] = ct[key as keyof typeof ct].at(pc);
    cam.frameH = Math.exp(cam.frameH);
    cam.needW = Math.exp(cam.needW);

    // 下沉：镜头跟随点的滞后、水体参照系与尾流
    const wa = f.water;
    this.descent.waterOffset(p, this.wo);
    wa.x = this.wo.x;
    wa.y = this.wo.y;
    if (DescentMotion.covers(p)) {
      const d = this.descent.sample(p, this.dsc);
      cam.lagX = d.lagX;
      cam.lagY = d.lagY;
      wa.flowX = d.vx;
      wa.flowY = d.vy;
      wa.wake = smoothstep(0.3, 0.32, p) * (1 - smoothstep(0.494, 0.5, p));
    } else {
      cam.lagX = cam.lagY = 0;
      wa.flowX = wa.flowY = wa.wake = 0;
      // 开场与滤食：镜头跟随正在游动的那头鲸鱼，带一点质量感；身体推开海水
      const u = p < WHALE_SWITCH ? p : p - 1;
      if (SwimMotion.covers(u)) {
        const m = this.swim.sample(u, this.ssc);
        // 与鲸鱼一起随构图旋转
        const c = Math.cos(comp);
        const sn = Math.sin(comp);
        cam.lagX = m.lagX * c - m.lagY * sn;
        cam.lagY = m.lagX * sn + m.lagY * c;
        wa.flowX = m.vx * c - m.vy * sn;
        wa.flowY = m.vx * sn + m.vy * c;
        wa.wake = m.wake;
      }
    }

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
    e.rayLen = this.envT.rayLen.at(p);
    e.glow = this.envT.glow.at(p);
    e.tone = this.envT.tone.at(p);
    e.rim = this.envT.rim.at(p);
    e.sediment = p > CONTACT_P && p < 0.57 ? secondsAt(p) - secondsAt(CONTACT_P) : 0;

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
    let tx = c.ax * wa + ((whale.x + c.lagX) * c.fw + k.x * c.fk + eye.x * c.fe) * n;
    let ty = c.ay * wa + ((whale.y + c.lagY) * c.fw + k.y * c.fk + eye.y * c.fe) * n;
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
