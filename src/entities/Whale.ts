import { hex, makeShade, rgba, shadeRGB, type RGB, type Shade } from '../core/color';
import { clamp, hash1, lerp, noise1, rng, sampleProfile, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import { WORLD } from '../config/stages';
import { woundSize, WOUNDS } from '../config/feast';
import { FIN_PAINT_DIR, FIN_ROOT_S, finRootPhi } from './FinGeometry';
import { ART_EYE_OFF, ART_H, ART_W, AXIS_ANGLE, AXIS_PX, axisPx, EYE_ART, FIN_PIVOT, FIN_RECT, mipLevel, sAtPx, whaleArt, type Mipped, type WhaleArtSet } from './WhaleArt';
import { DORSAL, LOWER, LUNGE_LO, mouthY, rolledHeight, S_BLOW, S_EYE, S_FIN, strokeWarp, UPPER, WHALE_LEN, WhaleBody, type WhaleShape } from './WhaleBody';
import { WhaleSkeleton } from './WhaleSkeleton';

/** 由叙事时间线求得的鲸鱼状态。 */
export interface WhaleState {
  visible: number;
  x: number;
  y: number;
  z: number;
  /** 俯仰角（弧度，正值为低头） */
  pitch: number;
  swim: number;
  /** 主动游动的拍尾相位（弧度，由故事时间决定） */
  phase: number;
  mouth: number;
  throat: number;
  /** 眼睛睁开程度 1→0 */
  eye: number;
  /** 生命力：1 为主动游动，0 为完全放松 */
  life: number;
  /** 软组织 1→0 */
  tissue: number;
  /** 骨骼坍塌 */
  collapse: number;
  rest: number;
  /** 骨骼表面的生态：细菌席、食骨蠕虫、沉积覆盖 */
  mats: number;
  osedax: number;
  burial: number;
  // ---- 下沉动作层（由叙事进度确定，见 systems/DescentMotion.ts；其余时间为 0）
  /** 停止游动前最后几次尾叶摆动的幅度与相位 */
  beat: number;
  beatPh: number;
  /** 尾柄被动弯曲（米，正值上抬） */
  flex: number;
  /** 头部被动俯仰（米，正值向下） */
  nod: number;
  /** 尾叶被动偏转（弧度） */
  fluke: number;
  /**
   * 下沉途中两侧胸鳍的三维方向（单位向量，见 entities/FinGeometry.ts：a 沿体轴指向尾部，h 指向局部上方，z 指向镜头）。
   * fn 是游动时的近侧胸鳍，ff 是远侧；全为 0 时（下沉之外）胸鳍按画中的姿态绘制（见 fin）。
   */
  fnA: number;
  fnH: number;
  fnZ: number;
  ffA: number;
  ffH: number;
  ffZ: number;
  /** 身体的弓形程度 0~1（见 WhaleBody.archAngle）：下沉时头尾从胸腹部垂下的弧线 */
  arc: number;
  /** 绕体轴的翻身角（弧度，见 WhaleBody.rolledHeight）：下沉时肚子朝上（π），着陆前翻回来 */
  roll: number;
  /** 画中胸鳍绕根部的转动（弧度，正值向下张开、离开身体，负值向后贴近腹部）：游动时配合转向、上浮与滑行 */
  fin: number;
  /** 鲸鱼下方海床的世界 y（下沉途中海床属于水体参照系，会有偏移；用于尾叶的海床约束与接触阴影） */
  seabed: number;
  /** 鲸鱼谱系进度（食腐动物留下的伤口按它出现，见 config/feast.ts）；负值表示没有伤口 */
  feast: number;
}

/**
 * 胸鳍姿态（鲸鱼局部坐标）：a 为根部指向鳍尖的方向，bend 为远端相对根部的弯折，
 * len / wid 为侧视中的长度与宽度比例。蓝鲸的胸鳍短而窄，画中贴着身体斜向后下方，
 * 骨骼里的胸鳍骨按同一个姿态摆放。
 */
export interface FinPose {
  a: number;
  bend: number;
  len: number;
  wid: number;
}

/** 画中胸鳍：根部在体轴下方约 0.94 米，长约 3.2 米（体长的 13%），斜向后下方约 30° */
export const FIN_LEN = 3.22;
export const FIN_ROOT_V = -0.39;
const PAINTED_FIN: FinPose = { a: Math.PI - 0.523, bend: 0, len: 1, wid: 1 };

/** 画中尾叶下叶的尖端（画框像素）：静卧时它不会插进海床 */
const FLUKE_TIP = { x: 40, y: 472 };
/** 尾叶的另外两个代表点（用于海床上的阴影） */
const FLUKE_MID = { x: 150, y: 400 };
const FLUKE_UP = { x: 170, y: 255 };

/** 胸鳍图层随身体摆放时参照的脊线位置（鳍的中部） */
const FIN_S = sAtPx(FIN_RECT[0] + FIN_RECT[2] / 2);

/** 每个分解空洞由几块柔和的圆斑拼成（形状不规则，边缘参差） */
const HOLE_DOTS = 5;

/** 沿体轴切成的条带数：每条约 0.3 米，弯曲时看不出折线 */
const SLICES = 84;
/** 画中离体轴最远的内容（尾叶的叶尖、背鳍）到体轴的距离（画像素），用于估计弯曲时条带之间的缝 */
const BEND_REACH = 280;
/** 翻身途中每条带沿横截面分成的块数 */
const ROLL_BANDS = 6;

export function makeWhaleState(): WhaleState {
  return {
    visible: 1,
    x: 0,
    y: 0,
    z: 0,
    pitch: 0,
    swim: 1,
    phase: 0,
    mouth: 0,
    throat: 0,
    eye: 1,
    life: 1,
    tissue: 1,
    collapse: 0,
    rest: 0,
    mats: 0,
    osedax: 0,
    burial: 0,
    beat: 0,
    beatPh: 0,
    flex: 0,
    nod: 0,
    fluke: 0,
    fnA: 0,
    fnH: 0,
    fnZ: 0,
    ffA: 0,
    ffH: 0,
    ffZ: 0,
    arc: 0,
    roll: 0,
    fin: 0,
    seabed: WORLD.seabedY,
    feast: -1,
  };
}

let flesh: { rim: HTMLCanvasElement; core: HTMLCanvasElement } | null = null;

/** 伤口的两张精灵：外圈的鲸脂与淤青、里面暗红的肌肉（颜色之后随身体一起按深度着色） */
function fleshSprites(): { rim: HTMLCanvasElement; core: HTMLCanvasElement } {
  if (flesh) return flesh;
  const make = (stops: Array<[number, string]>) => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 96);
    return c;
  };
  flesh = {
    rim: make([
      [0, '#d6c6aa'],
      [0.74, '#cbb89b'],
      [0.84, 'rgba(84,70,68,0.4)'],
      [1, 'rgba(70,60,60,0)'],
    ]),
    core: make([
      [0, '#260b0e'],
      [0.38, '#3f1518'],
      [0.66, '#672827'],
      [0.84, '#8a4740'],
      [0.93, 'rgba(150,92,80,0.55)'],
      [1, 'rgba(150,92,80,0)'],
    ]),
  };
  return flesh;
}

/** 分解时软组织褪去的颜色 */
const PALE = hex('#a7aeb2');
/** 身体画与骨骼画的平均颜色（用于光照的色偏近似，见 applyLight） */
const SKIN_AVG: RGB = [154, 171, 175];
const BONE_AVG: RGB = [194, 187, 173];

// ------------------------------------------------------------------ 张嘴（滤食）
// 须鲸冲刺滤食时，上下颌之间的张角接近 90°（Pyenson et al. 2012；Goldbogen 2010）。
// 张嘴的那张画只张开了约 30°：先从游动的画过渡到它，再把下颌连同喉囊绕颌关节继续向下转 60°。
// 喉囊像扇子一样展开、向外鼓起；上下颌之间的缝隙保持透明，看到的是后面的海水。

/** 颌关节：画中上下颌缝隙的顶点（s 与离体轴的距离，米，正值向上） */
const JAW_S = 0.178;
const JAW_OFF = 0.25;
/** 下颌上缘的方向（从颌关节指向下颌尖；头部坐标，+x 指向吻端，+y 向下） */
const JAW_A = Math.atan2(1.44 + JAW_OFF, (JAW_S - 0.01) * WHALE_LEN);
/** 吻部下缘的方向 */
const ROSTRUM_A = Math.atan2(-(0.78 - JAW_OFF), (JAW_S - 0.01) * WHALE_LEN);
/** 喉囊后缘的方向：颌关节到胸鳍前方的腹部（s = 0.42），之后的身体不动 */
const POUCH_A = Math.atan2(2.39 + JAW_OFF, (JAW_S - 0.42) * WHALE_LEN);
/** 下颌骨所在的一窄条：整体刚性转动 */
const JAW_BONE = 0.14;
/** 扇形从下颌上缘之上一点开始（下颌上缘并不是直线，略有拱起；这里是透明的缝隙） */
const JAW_MARGIN = 0.12;
/** 画中张角之外再转的角度（张到约 90° 时） */
const JAW_EXTRA = Math.PI / 3;
/** 张嘴的画中上下颌的张角（约 30°） */
const PAINT_GAP = JAW_A - ROSTRUM_A;
/** 最大张角 */
const MOUTH_MAX = PAINT_GAP + JAW_EXTRA;
/**
 * 游动的画中闭合的嘴线方向（从颌关节指向吻端的唇线，约 3°）：张嘴的画中吻部微微抬起（约 −7.5°），
 * 合上时把它放到这里，下颌也合到这里，两张画重合
 */
const CLOSED_A = Math.atan2(JAW_OFF + mouthY(0.01), (JAW_S - 0.01) * WHALE_LEN);
/** 吻部扇形的上缘（指向头顶的喷气孔附近）：这里以上的头部不动 */
const SKULL_A = -1.25;
/** 吻部扇形的分块数 */
const FAN_U = 20;
/** 喉囊展开时向外鼓起的幅度（半径的比例） */
const POUCH_SWELL = 0.5;
/** 扇形分块数 */
const FAN = 40;

/** 被挤起的软泥边缘（被局部散射光照亮的细颗粒沉积物） */
const BERM = hex('#9a9484');

interface Hole {
  s: number;
  v: number;
  r: number;
  th: number;
  seed: number;
}

/**
 * 一条画面条带在鲸鱼局部坐标中的摆放：中心、朝向（指向吻端），以及体轴上下两半各自的竖向缩放
 * （分解时软组织向骨骼收缩；滤食时游动的画向张嘴的轮廓拉伸，张嘴的画从游动的轮廓展开）。
 */
interface Slice {
  x0: number;
  x1: number;
  s: number;
  px: number;
  py: number;
  a: number;
  /** 游动的画：上半 / 下半的竖向缩放 */
  ku: number;
  kl: number;
  /** 张嘴的画：上半 / 下半的竖向缩放 */
  kuL: number;
  klL: number;
  /** 尾叶条带的透明度（尾叶里没有骨骼，随软组织一起消失） */
  alpha: number;
  /** 张嘴时，游动的画在吻端尖处提前淡出（那里被拉伸得最厉害） */
  tipFade: number;
}

/** 鲸鱼游动动画控制：把叙事状态转换为具体的身体几何与绘制。 */
export class Whale {
  readonly body = new WhaleBody();
  readonly skeleton: WhaleSkeleton;
  readonly state: WhaleState = makeWhaleState();
  /** 主动游动的拍尾相位（弧度）：叙事中为 state.phase 加上停下时的悬停轻摆（见 NarrativeScene） */
  phase = 0;
  private readonly shape: WhaleShape = { swim: 0, phase: 0, beat: 0, beatPh: 0, mouth: 0, throat: 0, rest: 0, flex: 0, nod: 0, fluke: 0, arc: 0, roll: 0, shrink: 0 };
  private readonly sh: Shade = makeShade();
  private readonly holes: Hole[] = [];
  /** 伤口轮廓（复用，避免每帧分配） */
  private readonly gashPts = new Float32Array(56);
  private readonly tmp: RGB = [0, 0, 0];
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;
  private aux: HTMLCanvasElement | null = null;
  private auxCtx: CanvasRenderingContext2D | null = null;
  private eyeLayer: HTMLCanvasElement | null = null;
  private eyeCtx: CanvasRenderingContext2D | null = null;
  private readonly p = { x: 0, y: 0 };
  private readonly q = { x: 0, y: 0 };
  private readonly f = { x: 0, y: 0, a: 0 };
  private readonly P3 = { x: 0, y: 0, s: 0 };
  private readonly P4 = { x: 0, y: 0, s: 0 };
  private readonly sh2: Shade = makeShade();
  private readonly slices: Slice[] = [];
  /** 翻身时一条带的分块边界（横截面上的角度，复用以免每帧分配） */
  private readonly rollAngles: number[] = [];
  /** 尾叶相对尾柄的偏转（弧度，含静卧时的海床约束） */
  private flukeTurn = 0;
  /** 游动 → 张嘴两张画的过渡（0~1） */
  private gape = 0;
  /** 张嘴的画中下颌相对画中位置的转角（弧度，正值向下张开，负值往上合）与吻部下放的角度 */
  private jawTurn = 0;
  private rostrumTurn = 0;
  /** 局部绘制变换在屏幕上的包围盒（像素，用于离屏图层裁剪） */
  private bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** 只在这个屏幕范围内绘制图层（骨骼只从空洞里露出来时） */
  private limit: { x0: number; y0: number; x1: number; y1: number } | null = null;
  readonly finPose: FinPose = { ...PAINTED_FIN };
  readonly finFarPose: FinPose = { ...PAINTED_FIN };
  /** 与海床的接触（每帧由 updateContact 计算，局部坐标） */
  private readonly contact = {
    /** 每个脊线采样处，腹侧（按未分解的身体）离海床的距离，负值为压入沉积物的深度 */
    gap: new Float32Array(64),
    /** 近侧压痕边缘（沉积物隆起的脊）在侧视中的位置：低于它的身体被沉积物挡住 */
    cx: new Float32Array(64),
    cy: new Float32Array(64),
    /** 近侧压痕深度（米） */
    d: new Float32Array(64),
    /** 身体是否接近海床（需要绘制接触关系） */
    near: false,
    /** 是否有部分压入沉积物 */
    sunk: false,
  };

  constructor(seed = 1) {
    const r = rng(seed * 97 + 13);
    for (let i = 0; i < 64; i++) {
      this.holes.push({
        s: 0.05 + r() * 0.9,
        v: -0.85 + r() * 1.7,
        r: 0.6 + r() * 1.45,
        th: 0.18 + r() * 0.8,
        seed: i,
      });
    }
    // 条带：在画中等宽，覆盖整幅画（吻端之前的一点空白到尾叶末端）
    const w = ART_W / SLICES;
    for (let j = 0; j < SLICES; j++) {
      const x0 = j * w;
      const x1 = x0 + w;
      this.slices.push({ x0, x1, s: sAtPx((x0 + x1) / 2), px: 0, py: 0, a: 0, ku: 1, kl: 1, kuL: 1, klL: 1, alpha: 1, tipFade: 1 });
    }
    // 从吻端排到尾叶，便于在缺刻之后沿着尾叶逐段累积位置
    this.slices.sort((a, b) => a.s - b.s);
    this.skeleton = new WhaleSkeleton(seed);
  }

  /**
   * 身体 (s, v) 处还剩多少软组织（0~1）：被分解的空洞挖掉的地方为 0（与 cutHoles 同一组空洞），
   * 软组织整体褪去时一起减少。食腐动物只在还有肉的地方进食。
   */
  fleshAt(s: number, v: number): number {
    const st = this.state;
    if (st.tissue >= 0.999) return 1;
    const b = this.body;
    const q = b.point(s, v, { x: 0, y: 0 });
    let left = smoothstep(0, 0.3, st.tissue);
    for (const h of this.holes) {
      const k = smoothstep(h.th, h.th - 0.5, st.tissue);
      if (k <= 0.001) continue;
      const r = h.r * Math.pow(k, 1.25) * (1 + (1 - st.tissue) * 0.35);
      b.point(h.s, h.v, this.p);
      for (let j = 0; j < HOLE_DOTS; j++) {
        const a = hash1(h.seed * 7 + j) * TAU;
        const d = r * 0.62 * hash1(h.seed * 13 + j);
        const rr = r * (0.5 + 0.45 * hash1(h.seed * 3 + j));
        const dist = Math.hypot(q.x - this.p.x - Math.cos(a) * d, q.y - this.p.y - Math.sin(a) * d);
        left = Math.min(left, smoothstep(rr * 0.55, rr * 1.05, dist));
      }
    }
    return left;
  }

  /** 局部坐标 → 世界坐标 */
  toWorld(lx: number, ly: number, out: { x: number; y: number }): { x: number; y: number } {
    const st = this.state;
    const c = Math.cos(st.pitch);
    const s = Math.sin(st.pitch);
    out.x = st.x + lx * c - ly * s;
    out.y = st.y + lx * s + ly * c;
    return out;
  }

  /** 准备几何：每帧调用一次。 */
  prepare(): void {
    const st = this.state;
    const sh = this.shape;
    sh.swim = st.swim;
    sh.phase = strokeWarp(this.phase);
    sh.beat = st.beat;
    sh.beatPh = st.beatPh;
    sh.mouth = st.mouth;
    sh.throat = st.throat;
    sh.rest = st.rest;
    sh.flex = st.flex;
    sh.nod = st.nod;
    sh.fluke = st.fluke;
    sh.arc = st.arc;
    sh.roll = st.roll;
    sh.shrink = 1 - smoothstep(0.0, 1, st.tissue);
    this.body.compute(sh);
    this.flukeFor();
    this.placeSlices();
    if (st.tissue < 0.999) this.skeleton.prepare(this.body, st, st.rest > 0.5 ? (lx) => this.groundLocal(lx) : null);
  }

  /**
   * 尾叶相对尾柄的偏转：游动时随拍尾超前摆动，下沉时被水流托起（WhaleBody.flukeAngle）；
   * 接近海床时，画中斜向后下方的尾叶下叶被海床托住——偏转以软约束（softplus）平滑地受限，
   * 叶尖可以略微陷进软泥，但不会插进海床。
   */
  private flukeFor(): void {
    const b = this.body;
    const n = b.n;
    let turn = b.flukeAngle - b.tailAngle;
    // 尾叶下叶尖端相对缺刻的位置（局部坐标，未偏转时）
    const mpp = WHALE_LEN / AXIS_PX;
    const notch = axisPx(1, this.p);
    const vx = (FLUKE_TIP.x - notch.x) * mpp;
    // 肚子朝上时画面沿体轴上下翻转，画中斜向后下方的下叶变成斜向后上方
    const vy = (FLUKE_TIP.y - notch.y) * mpp * (this.state.roll >= Math.PI - 1e-3 ? -1 : 1);
    b.frame(1, 0, this.f);
    const nx = b.px[n - 1];
    const ny = b.py[n - 1];
    const tip = (t: number) => {
      const a = this.f.a + t - AXIS_ANGLE;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return { x: nx + vx * c - vy * s, y: ny + vx * s + vy * c };
    };
    const k = smoothstep(0.2, 0.9, this.state.rest);
    const t0 = tip(turn);
    const limit = this.groundLocal(t0.x) + 0.28;
    // 叶尖高度对偏转的导数（数值），沿着让叶尖抬起的方向推开
    const e = 0.01;
    const dy = (tip(turn + e).y - t0.y) / e;
    if (Math.abs(dy) > 0.05) {
      const w = 0.06;
      const x = (t0.y - limit) / Math.abs(dy) / w;
      const push = w * (x > 20 ? x : Math.log1p(Math.exp(x)));
      turn -= Math.sign(dy) * push;
    }
    // 静卧：尾叶在关节处松弛地多放平一点
    this.flukeTurn = turn - 0.12 * k;
  }

  /** 每条画面条带的摆放：缺刻之前沿着脊线，之后沿着偏转的尾叶逐段累积。 */
  private placeSlices(): void {
    const b = this.body;
    const st = this.state;
    const L = WHALE_LEN;
    const f = this.f;
    const shrink = this.shape.shrink;
    const fu = 1 - 0.42 * shrink;
    const fl = 1 - 0.3 * shrink;
    // 张嘴：张角 θ = mouth × 最大张角。张嘴的画按张角变形（见 drawLunge）：比画中小时下颌往上合、吻部往下放，
    // 合拢时与游动的画重合，所以两张画只在嘴几乎闭上的一瞬间交接，看不出换画；比画中大时下颌继续下转。
    // 闭嘴后喉囊仍鼓着，随着海水被挤出才慢慢收回
    const theta = clamp(st.mouth) * MOUTH_MAX;
    const m = smoothstep(0.004, 0.06, st.mouth);
    const pouch = Math.max(smoothstep(0.02, 0.4, st.mouth), 0.85 * clamp(st.throat));
    this.gape = m;
    const shut = 1 - clamp(theta / PAINT_GAP);
    this.rostrumTurn = (CLOSED_A - ROSTRUM_A) * shut;
    this.jawTurn = ROSTRUM_A + this.rostrumTurn + theta - JAW_A;
    const turn = this.flukeTurn;
    const ramp = (s: number) => smoothstep(0.965, 1.04, s);
    const flukeA = smoothstep(0.12, 0.55, st.tissue);
    let lastS = 0;
    let lastX = 0;
    let lastY = 0;
    let lastA = 0;
    for (const sl of this.slices) {
      const s = sl.s;
      if (s <= 1) {
        b.frame(Math.max(0, s), 0, f);
        sl.a = f.a + turn * ramp(s);
        sl.px = f.x;
        sl.py = f.y;
        if (s < 0) {
          sl.px += -s * L * Math.cos(f.a);
          sl.py += -s * L * Math.sin(f.a);
        }
        if (s <= 1) {
          lastS = s;
          lastX = sl.px;
          lastY = sl.py;
          lastA = sl.a;
        }
      } else {
        if (lastS < 1) {
          // 从缺刻处接着排：先到缺刻
          b.frame(1, 0, f);
          lastX = f.x;
          lastY = f.y;
          lastA = f.a + turn * ramp(1);
          lastS = 1;
        }
        const a = f.a + turn * ramp(s);
        const am = (a + lastA) / 2;
        const d = (s - lastS) * L;
        sl.px = lastX - d * Math.cos(am);
        sl.py = lastY - d * Math.sin(am);
        sl.a = a;
        lastS = s;
        lastX = sl.px;
        lastY = sl.py;
        lastA = a;
      }
      // 竖向：上下两半分别缩放，体轴保持不动
      const sc = clamp(s, 0, 1);
      const lo = sampleProfile(LOWER, sc);
      let loL = lo;
      let el = lo;
      let es = lo;
      if (sc < 0.44 && pouch > 0) {
        loL = sampleProfile(LUNGE_LO, sc);
        el = lo + (loL - lo) * pouch;
        // 游动的画（嘴已合上）：下颌尖是硬的骨头，不随喉囊鼓起，只有后面的喉囊鼓着
        es = lo + (loL - lo) * pouch * smoothstep(0.03, 0.2, sc);
      }
      // 上半各按自己的轮廓（张嘴的画抬起的吻部由 drawLunge 绕颌关节放下来）；下半随喉囊鼓起。
      // 吻端尖处游动的画非常薄，拉伸倍数设上限（那里本来就几乎是透明的），避免把边缘的半透明像素拉成细线
      sl.ku = fu;
      sl.kl = Math.min(5, (fl * es) / lo);
      sl.kuL = fu;
      sl.klL = (fl * el) / loL;
      sl.alpha = s > 1 ? flukeA : 1;
      sl.tipFade = 1 - smoothstep(0, 0.6, m) * (1 - smoothstep(0.01, 0.045, s));
    }
  }

  /** 海床在鲸鱼局部坐标中、局部 x 处的 y */
  private groundLocal(lx: number): number {
    const st = this.state;
    return (st.seabed - st.y - lx * Math.sin(st.pitch)) / Math.cos(st.pitch);
  }

  /** 口腔中心（磷虾被吞入的位置），世界坐标：张开的上下颌之间。 */
  mouthPoint(out: { x: number; y: number }): { x: number; y: number } {
    const a = (ROSTRUM_A + this.rostrumTurn + JAW_A + this.jawTurn) / 2;
    const r = 2.6;
    const f = this.body.frame(JAW_S, JAW_OFF, this.f);
    return this.toWorld(f.x + r * Math.cos(f.a + a), f.y + r * Math.sin(f.a + a), out);
  }

  /** 吻端（头部最前方） */
  snoutPoint(out: { x: number; y: number }): { x: number; y: number } {
    return this.toWorld(this.body.ux[0], this.body.uy[0] + 0.15, out);
  }

  blowholePoint(out: { x: number; y: number }): { x: number; y: number } {
    this.body.point(S_BLOW, 0.96, this.p);
    return this.toWorld(this.p.x, this.p.y, out);
  }

  eyePoint(out: { x: number; y: number }): { x: number; y: number } {
    this.body.frame(S_EYE, ART_EYE_OFF * WHALE_LEN, this.f);
    return this.toWorld(this.f.x, this.f.y, out);
  }

  /** 尾叶中部（世界坐标）：尾叶拍动时推动海水的位置 */
  flukePoint(out: { x: number; y: number }): { x: number; y: number } {
    const last = this.slices[this.slices.length - 1];
    this.artToLocal(last, FLUKE_MID.x, FLUKE_MID.y, this.q);
    return this.toWorld(this.q.x, this.q.y, out);
  }

  /** 画面是否上下翻转（肚子朝上） */
  private get flipped(): boolean {
    return this.shape.roll >= Math.PI - 1e-3;
  }

  /** 胸鳍根部（局部坐标）：肚子朝上时在体轴上方 */
  finRoot(out: { x: number; y: number }): { x: number; y: number } {
    return this.body.point(S_FIN, this.flipped ? -FIN_ROOT_V : FIN_ROOT_V, out);
  }

  /**
   * 胸鳍的方向（局部坐标中根部指向鳍尖的角度，+y 向下）：画中的方向减去转动（画框与局部坐标的 y 都向下，
   * 张开是画面上的逆时针）；肚子朝上时画面沿体轴上下翻转，方向随之镜像
   */
  finDir(): number {
    const a = this.finPose.a - this.finTurn();
    return this.flipped ? -a : a;
  }

  private computeShade(rc: RenderCtx): void {
    const st = this.state;
    rc.light.shadeAt(st.x, st.y, st.z, this.sh);
  }

  private ensureLayers(rc: RenderCtx): void {
    const cw = rc.ctx.canvas.width;
    const ch = rc.ctx.canvas.height;
    if (!this.layer) {
      this.layer = document.createElement('canvas');
      this.layerCtx = this.layer.getContext('2d');
      this.aux = document.createElement('canvas');
      this.auxCtx = this.aux.getContext('2d');
    }
    for (const c of [this.layer, this.aux!]) {
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
    }
  }

  /** 设置鲸鱼局部坐标的绘制变换，返回屏幕缩放。 */
  private applyLocal(ctx: CanvasRenderingContext2D, rc: RenderCtx): number {
    const st = this.state;
    return rc.cam.applyTransform(ctx, rc.dpr, st.x, st.y, st.z, st.pitch);
  }

  private computeBBox(rc: RenderCtx): void {
    const st = this.state;
    const P = this.P3;
    rc.cam.project(st.x, st.y, st.z, P);
    const r = 0.78 * WHALE_LEN * P.s;
    this.bbox.x0 = Math.max(0, Math.floor((P.x - r) * rc.dpr));
    this.bbox.y0 = Math.max(0, Math.floor((P.y - r) * rc.dpr));
    this.bbox.x1 = Math.min(rc.ctx.canvas.width, Math.ceil((P.x + r) * rc.dpr));
    this.bbox.y1 = Math.min(rc.ctx.canvas.height, Math.ceil((P.y + r) * rc.dpr));
    const l = this.limit;
    if (l) {
      this.bbox.x0 = Math.max(this.bbox.x0, l.x0);
      this.bbox.y0 = Math.max(this.bbox.y0, l.y0);
      this.bbox.x1 = Math.min(this.bbox.x1, l.x1);
      this.bbox.y1 = Math.min(this.bbox.y1, l.y1);
    }
  }

  /** 已经打开的分解空洞在屏幕上的包围盒（设备像素，含柔和边缘的余量）；没有空洞时为空盒 */
  private holeBox(rc: RenderCtx): { x0: number; y0: number; x1: number; y1: number } {
    const st = this.state;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const P = this.P4;
    for (const h of this.holes) {
      const k = smoothstep(h.th, h.th - 0.5, st.tissue);
      if (k <= 0.001) continue;
      const r = h.r * Math.pow(k, 1.25) * (1 + (1 - st.tissue) * 0.35) * 1.4 + 0.3;
      this.body.point(h.s, h.v, this.p);
      this.toWorld(this.p.x, this.p.y, this.q);
      if (!rc.cam.project(this.q.x, this.q.y, st.z, P)) continue;
      const rr = r * P.s;
      box.x0 = Math.min(box.x0, (P.x - rr) * rc.dpr);
      box.y0 = Math.min(box.y0, (P.y - rr) * rc.dpr);
      box.x1 = Math.max(box.x1, (P.x + rr) * rc.dpr);
      box.y1 = Math.max(box.y1, (P.y + rr) * rc.dpr);
    }
    box.x0 = Math.floor(box.x0);
    box.y0 = Math.floor(box.y0);
    box.x1 = Math.ceil(box.x1);
    box.y1 = Math.ceil(box.y1);
    return box;
  }

  /** 屏幕上是否可见（粗略包围盒）。 */
  onScreen(rc: RenderCtx): boolean {
    const st = this.state;
    if (st.visible <= 0.001) return false;
    const P = this.P3;
    if (!rc.cam.project(st.x, st.y, st.z, P)) return false;
    const r = 0.75 * WHALE_LEN * P.s;
    return P.x + r > 0 && P.x - r < rc.w && P.y + r > 0 && P.y - r < rc.h;
  }

  // ------------------------------------------------------------------ 绘制

  /** 身体（绘画）。分解阶段在离屏图层中挖出柔和的空洞，露出骨骼。 */
  draw(rc: RenderCtx): void {
    const st = this.state;
    if (st.visible <= 0.001) return;
    const art = whaleArt();
    if (!art) return;
    this.computeShade(rc);
    this.updateContact(rc);
    const decaying = st.tissue < 0.999;
    if (decaying) {
      // 骨骼在身体之后；压进沉积物的部分同样被压痕边缘挡住
      const vis = this.skeleton.visibility(st);
      // 软组织还很完整时，骨骼只会从已经打开的空洞里露出来：骨骼图层只画空洞所在的范围（近景时省掉一整层全屏绘制）
      const limit = st.tissue > 0.62 ? this.holeBox(rc) : null;
      if (vis > 0.001 && (!limit || limit.x1 > limit.x0)) {
        const sk = this.skeleton;
        this.limit = limit;
        this.renderLayer(rc, 1, vis, 0, BONE_AVG, (ctx) => sk.drawSlices(ctx, art.skeleton), (ctx, _fake, _scale, w, h) => sk.stain(ctx, st, w, h));
        this.limit = null;
        const ctx = rc.ctx;
        ctx.save();
        const scale = this.applyLocal(ctx, rc);
        if (this.contact.sunk) this.crestClip(ctx);
        ctx.globalAlpha = vis;
        sk.drawLife(ctx, rc, st, scale);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      if (st.tissue <= 0.002) {
        this.drawBerm(rc);
        return;
      }
    }
    // 远处的鲸鱼：以低分辨率绘制再放大，得到柔和的“景深”轮廓
    const soft = decaying ? 0 : clamp((st.z - 35) / 90);
    this.renderLayer(
      rc,
      soft > 0.02 ? 1 / (1 + soft * 5) : 1,
      st.visible * (decaying ? smoothstep(0, 0.3, st.tissue) : 1),
      // 分解时软组织褪成灰白
      (1 - st.tissue) * 0.6,
      SKIN_AVG,
      (ctx, aux, fake, scale, w, h, k) => this.paintBody(ctx, aux, fake, scale, w, h, k),
      (ctx, fake, scale) => {
        ctx.globalCompositeOperation = 'source-atop';
        this.drawSurfaceLight(ctx, fake, scale);
        ctx.globalCompositeOperation = 'source-over';
        if (st.tissue < 0.999) this.cutHoles(ctx, fake);
      },
    );
    this.drawBerm(rc);
  }

  /** 身体：游动 / 张嘴两张画（交叉过渡）与眼睛特写。 */
  private paintBody(lctx: CanvasRenderingContext2D, actx: CanvasRenderingContext2D, fake: RenderCtx, scale: number, sw: number, shh: number, k: number): void {
    const art = whaleArt()!;
    // 游动 → 张嘴：两张画在图层中按预乘透明度精确地交叉淡化，张嘴的画里上下颌之间的缝隙保持透明
    const m = this.gape;
    if (m < 0.999) {
      // 胸鳍单独转动时：先画去掉胸鳍的身体，再把胸鳍绕根部转过去叠上
      const fin = this.finTurn();
      if (this.fins3D()) {
        // 下沉：两侧胸鳍按三维方向单独绘制。鳍根转到身体背面一侧的先画（被身体挡住，只露出伸出轮廓的部分）
        this.drawFins3D(lctx, art, false);
        this.drawSlices(lctx, art.swimBody, false);
        this.drawFins3D(lctx, art, true);
      } else if (fin !== 0) {
        this.drawSlices(lctx, art.swimBody, false);
        this.drawFin(lctx, art, fin);
      } else this.drawSlices(lctx, art.swim, false);
    }
    if (m > 0.001) {
      if (m >= 0.999) this.drawLunge(lctx, art.lunge);
      else {
        actx.save();
        this.applyLocal(actx, fake);
        this.drawLunge(actx, art.lunge);
        actx.restore();
        lctx.save();
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = 'destination-out';
        lctx.globalAlpha = m;
        lctx.fillRect(0, 0, sw, shh);
        lctx.globalCompositeOperation = 'lighter';
        lctx.drawImage(this.aux!, 0, 0, sw, shh, 0, 0, sw, shh);
        lctx.restore();
        actx.setTransform(1, 0, 0, 1, 0, 0);
        actx.clearRect(0, 0, sw + 2, shh + 2);
      }
    }
    const st = this.state;
    if (st.feast > 0.55 && st.tissue > 0.002) this.drawWounds(lctx);
    this.drawEye(lctx, scale, k);
  }

  /**
   * 食腐动物咬开的伤口，以及分解时空洞的边缘：先画一圈白色的鲸脂与周围的淤青，再画里面暗红的肌肉。
   * 画在身体画上（source-atop），之后与身体一起按深度着色；空洞本身在 finish 中挖掉，留下生肉的边缘。
   */
  private drawWounds(ctx: CanvasRenderingContext2D): void {
    const st = this.state;
    const u = st.feast;
    const b = this.body;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 1;
    for (let i = 0; i < WOUNDS.length; i++) {
      const w = WOUNDS[i];
      const k = woundSize(w, u);
      if (k <= 0) continue;
      const f = b.frame(w.s, 0, this.f);
      b.point(w.s, w.v, this.p);
      this.drawGash(ctx, this.p.x, this.p.y, f.a, w.r * k, 0.62, i + 1, w.kind === 'shark');
    }
    // 分解的空洞：挖掉之前先铺上生肉与鲸脂，挖掉之后留下一圈撕开的边缘
    if (st.tissue < 0.999) {
      const spr = fleshSprites();
      for (let pass = 0; pass < 2; pass++) {
        for (const h of this.holes) {
          const k = smoothstep(h.th, h.th - 0.5, st.tissue);
          if (k <= 0.001) continue;
          const r = h.r * Math.pow(k, 1.25) * (1 + (1 - st.tissue) * 0.35);
          b.point(h.s, h.v, this.p);
          for (let j = 0; j < HOLE_DOTS; j++) {
            const a = hash1(h.seed * 7 + j) * TAU;
            const d = r * 0.62 * hash1(h.seed * 13 + j);
            const rr = r * (0.5 + 0.45 * hash1(h.seed * 3 + j)) * (pass === 0 ? 1.32 : 1.13);
            ctx.drawImage(pass === 0 ? spr.rim : spr.core, this.p.x + Math.cos(a) * d - rr, this.p.y + Math.sin(a) * d - rr, rr * 2, rr * 2);
          }
        }
      }
    }
    ctx.restore();
  }

  /**
   * 一处撕开的伤口（局部坐标）：不规则、边缘参差的轮廓沿体轴拉长；外面一圈淤青与白色的鲸脂层，
   * 里面是暗红的肌肉，越深越暗，带几道肌肉纤维与裂缝。睡鲨的一口在一侧留下一排齿痕的扇贝形边缘。
   */
  private drawGash(ctx: CanvasRenderingContext2D, cx: number, cy: number, a: number, R: number, flat: number, seed: number, bite: boolean): void {
    const N = 28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts = this.gashPts;
    for (let j = 0; j < N; j++) {
      const t = (j / N) * TAU;
      let r = 1 + 0.13 * (noise1(Math.cos(t) * 1.3 + seed * 5.3, seed) + noise1(Math.sin(t) * 1.3 + seed, seed + 1) - 1) + 0.07 * (hash1(seed * 97 + j) - 0.5);
      // 齿痕：上缘（指向上方的一侧）一排小的扇贝形缺口
      if (bite && Math.sin(t) > 0.15) r += 0.13 * Math.abs(Math.sin(t * 7 + seed)) * Math.sin(t);
      const lx = Math.cos(t) * r * R;
      const ly = -Math.sin(t) * r * R * flat;
      pts[2 * j] = lx;
      pts[2 * j + 1] = ly;
    }
    const path = (k: number) => {
      ctx.beginPath();
      for (let j = 0; j < N; j++) {
        const lx = pts[2 * j] * k;
        const ly = pts[2 * j + 1] * k;
        const x = cx + lx * ca - ly * sa;
        const y = cy + lx * sa + ly * ca;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    // 淤青与鲸脂
    ctx.fillStyle = 'rgba(62,52,58,0.22)';
    path(1.45);
    ctx.fill();
    path(1.27);
    ctx.fill();
    ctx.fillStyle = '#cfbd9f';
    path(1.12);
    ctx.fill();
    // 肌肉：中心最深
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05);
    g.addColorStop(0, '#220a0d');
    g.addColorStop(0.45, '#45171a');
    g.addColorStop(0.8, '#6f2c2a');
    g.addColorStop(1, '#93504a');
    ctx.fillStyle = g;
    path(1);
    ctx.fill();
    // 肌肉纤维与裂缝
    ctx.lineCap = 'round';
    for (let j = 0; j < 5; j++) {
      const h1 = hash1(seed * 13 + j);
      const h2 = hash1(seed * 29 + j);
      const t0 = (h1 - 0.5) * 1.3 * R;
      const q0 = (h2 - 0.5) * 0.8 * R * flat;
      const len = (0.3 + 0.3 * hash1(seed * 41 + j)) * R;
      const x0 = cx + t0 * ca - q0 * sa;
      const y0 = cy + t0 * sa + q0 * ca;
      const d = a + (hash1(seed * 53 + j) - 0.5) * 0.9;
      ctx.strokeStyle = j % 2 ? 'rgba(160,92,84,0.55)' : 'rgba(20,6,8,0.6)';
      ctx.lineWidth = R * (j % 2 ? 0.05 : 0.07);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(d) * len, y0 + Math.sin(d) * len);
      ctx.stroke();
    }
  }


  /**
   * 在离屏图层中画出一张画（身体或骨骼），再整体合成到画面上：
   * paint 画出画面本身（已设为鲸鱼局部变换，并按压痕边缘裁剪）→ 深度光照与水体雾化 →
   * finish 叠加只落在画面上的光影、分解的空洞等。k < 1 时以较低分辨率绘制（远处的柔和轮廓）。
   */
  private renderLayer(
    rc: RenderCtx,
    k: number,
    alpha: number,
    pale: number,
    avg: RGB,
    paint: (ctx: CanvasRenderingContext2D, aux: CanvasRenderingContext2D, fake: RenderCtx, scale: number, w: number, h: number, k: number) => void,
    finish: (ctx: CanvasRenderingContext2D, fake: RenderCtx, scale: number, w: number, h: number) => void,
  ): void {
    this.computeBBox(rc);
    const bb = this.bbox;
    if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) return;
    this.ensureLayers(rc);
    const lctx = this.layerCtx!;
    const actx = this.auxCtx!;
    const sw = Math.ceil((bb.x1 - bb.x0) * k) + 2;
    const shh = Math.ceil((bb.y1 - bb.y0) * k) + 2;
    // 辅助图层只在游动 / 张嘴交叉过渡时使用，用完立即清空，所以这里只清主图层
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
    lctx.clearRect(0, 0, sw + 2, shh + 2);
    // 在图层坐标系中绘制：把包围盒移到原点并缩放
    const fake = { ...rc, ctx: lctx, dpr: rc.dpr * k } as RenderCtx;
    const cam = rc.cam;
    const px = cam.px;
    const py = cam.py;
    cam.px -= bb.x0 / rc.dpr;
    cam.py -= bb.y0 / rc.dpr;
    try {
      lctx.save();
      const scale = this.applyLocal(lctx, fake);
      // 压进沉积物的部分被压痕边缘挡住（只裁剪画面本身；之后的光照都只作用在已有的像素上）
      if (this.contact.sunk) this.crestClip(lctx);
      paint(lctx, actx, fake, scale, sw, shh, k);
      lctx.restore();
      lctx.save();
      this.applyLight(lctx, sw, shh, pale, avg);
      this.applyLocal(lctx, fake);
      finish(lctx, fake, scale, sw, shh);
      lctx.restore();
    } finally {
      cam.px = px;
      cam.py = py;
    }
    const ctx = rc.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer!, 0, 0, sw, shh, bb.x0, bb.y0, sw / k, shh / k);
    ctx.globalAlpha = 1;
  }

  /**
   * 张嘴的画，按当前的张角变形：颌关节下方的扇形（下颌与喉囊）与上方的扇形（吻部）分别按扇形分块绘制。
   *  - 张得比画中更大时：下颌骨一窄条整体下转，越往后转得越少，到喉囊后缘不转；同时喉囊沿半径方向向外鼓起；
   *  - 比画中小（正在合上 / 刚刚张开）时：下颌往上合，画中微微抬起的吻部往下放，嘴合拢时与游动的画重合。
   * 其余部分仍按条带绘制，并裁掉这两块扇形。
   */
  private drawLunge(ctx: CanvasRenderingContext2D, art: Mipped): void {
    const jt = this.jawTurn;
    const rt = this.rostrumTurn;
    if (Math.abs(jt) < 1e-3 && rt < 1e-3) {
      this.drawSlices(ctx, art, true);
      return;
    }
    const B = ctx.getTransform();
    const f = this.body.frame(JAW_S, JAW_OFF, { x: 0, y: 0, a: 0 });
    const R = 0.45 * WHALE_LEN;
    const RU = 0.3 * WHALE_LEN;
    const upper = rt > 1e-3;
    const dir = (a: number) => ({ x: Math.cos(f.a + a), y: Math.sin(f.a + a) });
    // 1. 条带，裁掉扇形（evenodd：大矩形 + 扇形）
    ctx.save();
    ctx.beginPath();
    ctx.rect(-WHALE_LEN, -WHALE_LEN, 2 * WHALE_LEN, 2 * WHALE_LEN);
    ctx.moveTo(f.x, f.y);
    for (let i = 0; i <= 16; i++) {
      const d = dir(lerp(JAW_A - JAW_MARGIN, POUCH_A, i / 16));
      ctx.lineTo(f.x + d.x * R, f.y + d.y * R);
    }
    ctx.closePath();
    if (upper) {
      ctx.moveTo(f.x, f.y);
      for (let i = 0; i <= 16; i++) {
        const d = dir(lerp(SKULL_A, ROSTRUM_A + JAW_MARGIN * 0.5, i / 16));
        ctx.lineTo(f.x + d.x * RU, f.y + d.y * RU);
      }
      ctx.closePath();
    }
    ctx.clip('evenodd');
    this.drawSlices(ctx, art, true);
    ctx.restore();

    // 2. 扇形分块：画像素 → 以颌关节为原点的头部坐标（米）→ 扇形变形 → 局部坐标
    const mpp = WHALE_LEN / AXIS_PX;
    const lv = mipLevel(Math.hypot(B.a, B.b) * mpp);
    const img = art.levels[lv];
    const r = 1 / (1 << lv);
    const A0 = axisPx(JAW_S, this.q);
    const head = new DOMMatrix()
      .translateSelf(0, JAW_OFF)
      .scaleSelf(mpp, mpp)
      .rotateSelf((-AXIS_ANGLE * 180) / Math.PI)
      .translateSelf(-A0.x, -A0.y);
    const local = new DOMMatrix().translateSelf(f.x, f.y).rotateSelf((f.a * 180) / Math.PI);
    const base = B.multiply(local);
    // 只取头部（胸鳍之前）的画面
    const x0 = Math.floor(axisPx(0.45, { x: 0, y: 0 }).x);
    const wedge = [new DOMPoint(), new DOMPoint(), new DOMPoint(), new DOMPoint()];
    const sector = (sa: number, sb: number, turn: (a: number) => number, swell: (a: number) => number, reach: number) => {
      const sc = (sa + sb) / 2;
      const ba = sa + turn(sa);
      const bb = sb + turn(sb);
      const bc = sc + turn(sc);
      const k = (bb - ba) / (sb - sa);
      const g = swell(sc);
      // 鼓起的幅度随角度变化：在分块内用一个剪切项线性近似，相邻分块在边界处严丝合缝
      const dg = (swell(sb) - swell(sa)) / (sb - sa);
      ctx.save();
      ctx.setTransform(base);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const e = 0.006;
      ctx.lineTo(Math.cos(ba - e) * reach, Math.sin(ba - e) * reach);
      ctx.lineTo(Math.cos((ba + bb) / 2) * reach * 1.12, Math.sin((ba + bb) / 2) * reach * 1.12);
      ctx.lineTo(Math.cos(bb + e) * reach, Math.sin(bb + e) * reach);
      ctx.closePath();
      ctx.clip();
      // 分块中心方向上：径向 x 缩放 g 并随切向 y（≈ 半径 × 角度差）线性变化，切向按 g·k 展开
      const fan = new DOMMatrix()
        .rotateSelf((bc * 180) / Math.PI)
        .multiplySelf(new DOMMatrix([g, 0, dg, g * k, 0, 0]))
        .rotateSelf((-sc * 180) / Math.PI);
      const toPaint = fan.multiply(head);
      ctx.setTransform(base.multiply(toPaint));
      // 只取扇形分块在画中对应的那一小块（扇形的三角形按逆变换回画框像素的包围盒），
      // 而不是每一块都把整个头部画一遍——张嘴时这能少掉绝大部分的填充
      const inv = toPaint.inverse();
      wedge[0].x = 0;
      wedge[0].y = 0;
      wedge[1].x = Math.cos(ba - e) * reach;
      wedge[1].y = Math.sin(ba - e) * reach;
      wedge[2].x = Math.cos((ba + bb) / 2) * reach * 1.12;
      wedge[2].y = Math.sin((ba + bb) / 2) * reach * 1.12;
      wedge[3].x = Math.cos(bb + e) * reach;
      wedge[3].y = Math.sin(bb + e) * reach;
      let ax = Infinity;
      let ay = Infinity;
      let bx = -Infinity;
      let by = -Infinity;
      for (const q of wedge) {
        const m = inv.transformPoint(q);
        ax = Math.min(ax, m.x);
        ay = Math.min(ay, m.y);
        bx = Math.max(bx, m.x);
        by = Math.max(by, m.y);
      }
      const sx0 = Math.max(x0, Math.floor(ax) - 2);
      const sy0 = Math.max(0, Math.floor(ay) - 2);
      const sx1 = Math.min(ART_W, Math.ceil(bx) + 2);
      const sy1 = Math.min(ART_H, Math.ceil(by) + 2);
      if (sx1 > sx0 && sy1 > sy0) ctx.drawImage(img, sx0 * r, sy0 * r, (sx1 - sx0) * r, (sy1 - sy0) * r, sx0, sy0, sx1 - sx0, sy1 - sy0);
      ctx.restore();
    };
    // 下颌与喉囊
    const span = POUCH_A - (JAW_A + JAW_BONE);
    const open = Math.max(0, jt) / JAW_EXTRA;
    const turn = (a: number) => jt * (a <= JAW_A + JAW_BONE ? 1 : 1 - smoothstep(JAW_A + JAW_BONE, POUCH_A, a));
    const swell = (a: number) => 1 + POUCH_SWELL * open * Math.pow(Math.sin(Math.PI * clamp((a - JAW_A - JAW_BONE) / span)), 1.2);
    const a0 = JAW_A - JAW_MARGIN;
    for (let i = 0; i < FAN; i++) sector(lerp(a0, POUCH_A, i / FAN), lerp(a0, POUCH_A, (i + 1) / FAN), turn, swell, R * 1.2);
    // 吻部：靠近嘴唇的部分整体下放，往头顶（喷气孔）方向渐渐不动
    if (upper) {
      const a1 = ROSTRUM_A + JAW_MARGIN * 0.5;
      const turnU = (a: number) => rt * smoothstep(SKULL_A, ROSTRUM_A - 0.35, a);
      const none = () => 1;
      for (let i = 0; i < FAN_U; i++) sector(lerp(SKULL_A, a1, i / FAN_U), lerp(SKULL_A, a1, (i + 1) / FAN_U), turnU, none, RU * 1.2);
    }
    ctx.setTransform(B);
  }

  /** 按条带把一张画贴到弯曲的身体上（使用 ctx 当前的局部变换）。lunge 为张嘴的画。 */
  private drawSlices(ctx: CanvasRenderingContext2D, art: Mipped, lunge: boolean): void {
    const B = ctx.getTransform();
    const mpp = WHALE_LEN / AXIS_PX;
    // 每个画像素对应的设备像素 → 缩小级别
    const lv = mipLevel(Math.hypot(B.a, B.b) * mpp);
    const img = art.levels[lv];
    const r = 1 / (1 << lv);
    const ct = Math.cos(AXIS_ANGLE);
    const stt = Math.sin(AXIS_ANGLE);
    const A = this.q;
    const base = ctx.globalAlpha;
    const sls = this.slices;
    // 翻身：转动途中按横截面分块重新排布每一条带；完全翻过来（肚子朝上）时，整幅画沿体轴上下翻转
    const rho = this.shape.roll;
    const rolling = rho > 1e-3 && rho < Math.PI - 1e-3;
    const flip = rho >= Math.PI - 1e-3;
    const sgn = flip ? -1 : 1;
    // 翻身途中轮廓由各条带的分块拼成，边缘会有台阶：身体（吻端到尾叶缺刻）按转动后平滑的轮廓裁剪，
    // 缺刻之后沿尾柄方向留出一大块，尾叶的条带不裁
    let clipped = false;
    if (rolling) {
      const b = this.body;
      const n = b.n;
      const tx = b.px[n - 1] - b.px[n - 3];
      const ty = b.py[n - 1] - b.py[n - 3];
      const tl = Math.hypot(tx, ty) || 1;
      const ex = (tx / tl) * 4;
      const ey = (ty / tl) * 4;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(b.ux[0], b.uy[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(b.ux[i], b.uy[i]);
      ctx.lineTo(b.ux[n - 1] + b.nx[n - 1] * 6 + ex, b.uy[n - 1] + b.ny[n - 1] * 6 + ey);
      ctx.lineTo(b.bx[n - 1] - b.nx[n - 1] * 6 + ex, b.by[n - 1] - b.ny[n - 1] * 6 + ey);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(b.bx[i], b.by[i]);
      ctx.closePath();
      ctx.clip();
      clipped = true;
    }
    for (let j = 0; j < sls.length; j++) {
      const sl = sls[j];
      const al = sl.alpha * (lunge ? 1 : sl.tipFade);
      if (al <= 0.002) continue;
      ctx.globalAlpha = base * al;
      // 相邻条带重叠 1 像素，避免接缝处的发丝缝；身体弯曲时，外凸一侧的条带之间会张开楔形的缝，
      // 所以每条带再向尾部（下一条带，之后绘制并盖住重叠处）多延伸一些，延伸量随相邻条带的夹角增加。
      // 翻身途中每条带要分成好几块，这时把相邻两条合成一条绘制（弯曲很平缓，看不出差别；
      // 头部的轮廓变化太快，不合并）
      const pair = rolling && sl.s > 0.12 && j + 1 < sls.length && sls[j + 1].s <= 1;
      const next = sls[Math.min(sls.length - 1, j + (pair ? 2 : 1))];
      const da = next.a - sl.a;
      const ext = Math.min(pair ? 24 : 16, Math.ceil(Math.abs(da) * BEND_REACH));
      const x0 = Math.max(0, (pair ? sls[j + 1].x0 : sl.x0) - 1);
      const x1 = Math.min(ART_W, sl.x1 + 1);
      if (pair) j++;
      axisPx(sl.s, A);
      const ku = lunge ? sl.kuL : sl.ku;
      const kl = lunge ? sl.klL : sl.kl;
      if (clipped && sl.s > 1) {
        ctx.restore();
        clipped = false;
      }
      if (rolling && sl.s > 1) {
        // 尾叶是一块水平的薄板：侧面看去是画中的样子，翻到一半时正对镜头，看到的是整个展开的尾叶（两片叶左右对称）。
        // 用画中的尾叶与它上下翻过来的样子交叉叠加近似，正对镜头时两者都在、并按翼展拉开
        const cr = Math.cos(rho);
        const spread = 1 + 0.6 * Math.sin(rho);
        const w1 = smoothstep(-0.75, -0.15, cr);
        const w2 = smoothstep(-0.75, -0.15, -cr);
        for (const [w, ky] of [[w1, spread], [w2, -spread]] as const) {
          if (w <= 0.002) continue;
          ctx.globalAlpha = base * al * w;
          this.sliceTransform(ctx, B, sl, A, ky, mpp, ct, stt);
          ctx.drawImage(img, Math.max(0, x0 - ext) * r, 0, (x1 - Math.max(0, x0 - ext)) * r, ART_H * r, Math.max(0, x0 - ext), 0, x1 - Math.max(0, x0 - ext), ART_H);
        }
      } else if (rolling) {
        this.drawRolledSlice(ctx, B, sl, A, img, r, Math.max(0, x0 - ext), x1, ku, kl, mpp, ct, stt, rho);
      } else if (ext <= 0 && Math.abs(ku - 1) < 1e-3 && Math.abs(kl - 1) < 1e-3) {
        this.sliceTransform(ctx, B, sl, A, sgn, mpp, ct, stt);
        ctx.drawImage(img, x0 * r, 0, (x1 - x0) * r, ART_H * r, x0, 0, x1 - x0, ART_H);
      } else {
        // 体轴上下两半分别绘制（张嘴、分解时各自缩放），在体轴处重叠 1 像素；
        // 只有外凸的一半向尾部延伸（向尾部越来越向下弯时，外凸的是画面上方的一半：平常是背侧，翻过来时是腹侧）
        const ya = Math.ceil(A.y) + 1;
        const yb = Math.floor(A.y) - 1;
        const xu = (flip ? da > 0 : da < 0) ? Math.max(0, x0 - ext) : x0;
        const xl = (flip ? da < 0 : da > 0) ? Math.max(0, x0 - ext) : x0;
        this.sliceTransform(ctx, B, sl, A, ku * sgn, mpp, ct, stt);
        ctx.drawImage(img, xu * r, 0, (x1 - xu) * r, ya * r, xu, 0, x1 - xu, ya);
        if (Math.abs(kl - ku) >= 1e-3) this.sliceTransform(ctx, B, sl, A, kl * sgn, mpp, ct, stt);
        ctx.drawImage(img, xl * r, yb * r, (x1 - xl) * r, (ART_H - yb) * r, xl, yb, x1 - xl, ART_H - yb);
      }
    }
    if (clipped) ctx.restore();
    ctx.globalAlpha = base;
    ctx.setTransform(B);
  }

  /**
   * 翻身途中的一条带：沿横截面从下缘的轮廓点经朝向镜头的一面到上缘，分成若干块，
   * 每块是画中体轴上方或下方的一段（sin φ 决定画中的高度），按转动后的高度线性排布。
   * 越过腹中线（或背脊）之后看到的是远侧的一面，用同一段画上下翻过来代替（左右对称）。
   */
  private drawRolledSlice(
    ctx: CanvasRenderingContext2D,
    B: DOMMatrix,
    sl: Slice,
    A: { x: number; y: number },
    img: CanvasImageSource,
    r: number,
    x0: number,
    x1: number,
    ku: number,
    kl: number,
    mpp: number,
    ct: number,
    stt: number,
    rho: number,
  ): void {
    const s = clamp(sl.s, 0, 1);
    const upM = sampleProfile(UPPER, s);
    const loM = sampleProfile(LOWER, s);
    const U = upM * ku;
    const L = loM * kl;
    const W = sampleProfile(DORSAL, s);
    const p0 = -Math.PI / 2 - rho;
    const p1 = Math.PI / 2 - rho;
    const ph = this.rollAngles;
    ph.length = 0;
    for (let i = 0; i <= ROLL_BANDS; i++) ph.push(lerp(p0, p1, i / ROLL_BANDS));
    // 画中高度的转折点（腹中线、背脊、体侧中线）也作为分块边界，块内的映射才是单调的
    for (let q = -2; q <= 1; q++) {
      const a = (q * Math.PI) / 2;
      if (a > p0 + 1e-3 && a < p1 - 1e-3) ph.push(a);
    }
    ph.sort((a, b) => a - b);
    // 画中离体轴的距离（画像素，向下为正）。截面上的点先折回近侧（远侧与近侧左右对称），
    // 画中的相对高度在正侧面时是 sin φ；转到一半时改为按角度均匀取画，否则正对镜头的腹中线附近
    // 只剩画的外缘（半透明的轮廓）被拉成一大片。截面内部不用画的最外缘，两端仍是身体的轮廓时则延伸到外缘之外，保留柔和的边
    const even = smoothstep(0.1, 0.6, Math.sin(rho));
    const artW = (phi: number, edge: boolean): number => {
      const u = phi > Math.PI / 2 ? Math.PI - phi : phi < -Math.PI / 2 ? -Math.PI - phi : phi;
      const v = lerp(Math.sin(u), u / (Math.PI / 2), even);
      const lim = edge && Math.abs(v) > 0.9 ? 1.08 : 0.95;
      const c = clamp(v, -lim, lim);
      return c >= 0 ? (-c * upM) / mpp : (-c * loM) / mpp;
    };
    for (let i = 0; i + 1 < ph.length; i++) {
      const pa = ph[i];
      const pb = ph[i + 1];
      const wa = artW(pa, i === 0);
      let wb = artW(pb, i + 2 === ph.length);
      // 只剩一两行画的分块（转折点紧挨着画的外缘）：取一小段画拉开，宁可有一点拖影也不留缝
      if (Math.abs(wb - wa) < 3) wb = wa + (wb >= wa ? 3 : -3);
      // 局部坐标中沿法线向下的距离；最外侧的两块再向外多铺一点，由平滑的轮廓裁掉
      let da = -rolledHeight(pa, rho, U, L, W);
      let db = -rolledHeight(pb, rho, U, L, W);
      if (i === 0) da += 0.15 * Math.max(U, L, W) + 0.1;
      if (i + 2 === ph.length) db -= 0.15 * Math.max(U, L, W) + 0.1;
      const ky = (db - da) / ((wb - wa) * mpp);
      this.sliceTransform(ctx, B, sl, A, ky, mpp, ct, stt, da - ky * mpp * wa);
      const ya = Math.floor(A.y + Math.min(wa, wb)) - 1;
      const yb = Math.ceil(A.y + Math.max(wa, wb)) + 1;
      ctx.drawImage(img, x0 * r, ya * r, (x1 - x0) * r, (yb - ya) * r, x0, ya, x1 - x0, yb - ya);
    }
  }

  /** 下沉途中：胸鳍按三维方向单独绘制（见 FinGeometry） */
  private fins3D(): boolean {
    const st = this.state;
    return st.fnA * st.fnA + st.fnH * st.fnH > 0.04 && this.gape < 0.001 && st.tissue >= 0.999;
  }

  /**
   * 两侧胸鳍中鳍根朝向镜头（front）或背向镜头的那些：鳍根随翻身转到横截面上的新位置，
   * 胸鳍图层的鳍根放在那里，按三维方向在侧视中的投影摆放——朝向镜头或背离镜头时投影变短；
   * 鳍尖在体轴上方时图层沿鳍的长轴翻过来（与肚子朝上时翻转的画一致），转到与体轴平行时变窄。
   */
  private drawFins3D(ctx: CanvasRenderingContext2D, art: WhaleArtSet, front: boolean): void {
    const st = this.state;
    const rho = this.shape.roll;
    const U = sampleProfile(UPPER, FIN_ROOT_S);
    const L = sampleProfile(LOWER, FIN_ROOT_S);
    const W = sampleProfile(DORSAL, FIN_ROOT_S);
    for (const side of [1, -1]) {
      const phi = finRootPhi(side);
      const sp = Math.sin(phi);
      const depth = W * Math.cos(phi) * Math.cos(rho) - (sp >= 0 ? U : L) * sp * Math.sin(rho);
      if (depth >= 0 !== front) continue;
      const fa = side > 0 ? st.fnA : st.ffA;
      const fh = side > 0 ? st.fnH : st.ffH;
      this.drawFin3D(ctx, art, rolledHeight(phi, rho, U, L, W), fa, fh);
    }
  }

  private drawFin3D(ctx: CanvasRenderingContext2D, art: WhaleArtSet, h: number, fa: number, fh: number): void {
    const B = ctx.getTransform();
    const mpp = WHALE_LEN / AXIS_PX;
    const lv = mipLevel(Math.hypot(B.a, B.b) * mpp);
    const img = art.fin.levels[lv];
    const r = 1 / (1 << lv);
    const f = this.body.frame(FIN_ROOT_S, h, this.f);
    const ca = Math.cos(f.a);
    const sa = Math.sin(f.a);
    // 侧视中的方向：沿体轴指向尾部 (−cos a, −sin a)，局部上方 (sin a, −cos a)
    const dx = -fa * ca + fh * sa;
    const dy = -fa * sa - fh * ca;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;
    const k = Math.max(0.3, Math.abs(Math.tanh(fh / 0.12))) * (fh <= 0 ? 1 : -1);
    const px = FIN_PAINT_DIR.x;
    const py = FIN_PAINT_DIR.y;
    const qx = -py;
    const qy = px;
    // 画像素 → 局部坐标：沿鳍的长轴按投影长度缩放，垂直方向按宽度（含翻转）缩放
    const a = mpp * (len * ux * px + k * vx * qx);
    const c = mpp * (len * ux * py + k * vx * qy);
    const b = mpp * (len * uy * px + k * vy * qx);
    const d = mpp * (len * uy * py + k * vy * qy);
    const e = f.x - (a * FIN_PIVOT.x + c * FIN_PIVOT.y);
    const g = f.y - (b * FIN_PIVOT.x + d * FIN_PIVOT.y);
    ctx.setTransform(B.a * a + B.c * b, B.b * a + B.d * b, B.a * c + B.c * d, B.b * c + B.d * d, B.a * e + B.c * g + B.e, B.b * e + B.d * g + B.f);
    const [rx, ry, rw, rh] = FIN_RECT;
    ctx.drawImage(img, 0, 0, Math.ceil(rw * r), Math.ceil(rh * r), rx, ry, rw, rh);
    ctx.setTransform(B);
  }

  /** 胸鳍的转动（弧度）。滤食时（张嘴的画、鼓起的喉囊）、翻身、分解与静卧时身体会变形，这些时候胸鳍保持原位。 */
  private finTurn(): number {
    const st = this.state;
    if (Math.abs(st.fin) < 1e-4 || this.gape > 0.001 || st.throat > 0.001 || st.tissue < 0.999 || st.rest > 0) return 0;
    if (st.roll > 1e-3 && st.roll < Math.PI - 1e-3) return 0;
    return st.fin;
  }

  /** 胸鳍图层：按鳍中部所在条带的位置摆放，再绕鳍根转动（使用 ctx 当前的局部变换） */
  private drawFin(ctx: CanvasRenderingContext2D, art: WhaleArtSet, turn: number): void {
    const B = ctx.getTransform();
    const mpp = WHALE_LEN / AXIS_PX;
    const lv = mipLevel(Math.hypot(B.a, B.b) * mpp);
    const img = art.fin.levels[lv];
    const r = 1 / (1 << lv);
    const f = this.body.frame(FIN_S, 0, this.f);
    const A = axisPx(FIN_S, this.q);
    // 肚子朝上时整幅画上下翻转，胸鳍图层随之翻转
    const sgn = this.shape.roll >= Math.PI - 1e-3 ? -1 : 1;
    this.sliceTransform(ctx, B, { px: f.x, py: f.y, a: f.a }, A, sgn, mpp, Math.cos(AXIS_ANGLE), Math.sin(AXIS_ANGLE));
    // 画框与局部坐标的 y 轴都向下：画面上逆时针（张开）是负的旋转角
    ctx.translate(FIN_PIVOT.x, FIN_PIVOT.y);
    ctx.rotate(-turn);
    ctx.translate(-FIN_PIVOT.x, -FIN_PIVOT.y);
    const [rx, ry, rw, rh] = FIN_RECT;
    ctx.drawImage(img, 0, 0, Math.ceil(rw * r), Math.ceil(rh * r), rx, ry, rw, rh);
    ctx.setTransform(B);
  }

  /** 画像素 → 局部坐标：平移到体轴点、转正体轴、按米缩放（竖向乘以 ky），再放到身体的局部坐标系 */
  private sliceTransform(
    ctx: CanvasRenderingContext2D,
    B: DOMMatrix,
    sl: Pick<Slice, 'px' | 'py' | 'a'>,
    A: { x: number; y: number },
    ky: number,
    mpp: number,
    ct: number,
    stt: number,
    off = 0,
  ): void {
    const cf = Math.cos(sl.a);
    const sf = Math.sin(sl.a);
    const a = mpp * (cf * ct + ky * sf * stt);
    const c = mpp * (cf * stt - ky * sf * ct);
    const b = mpp * (sf * ct - ky * cf * stt);
    const d = mpp * (sf * stt + ky * cf * ct);
    // off：体轴处再沿法线向下平移（米），翻身时每块画的位置
    const e = sl.px - (a * A.x + c * A.y) - off * sf;
    const f = sl.py - (b * A.x + d * A.y) + off * cf;
    ctx.setTransform(B.a * a + B.c * b, B.b * a + B.d * b, B.a * c + B.c * d, B.b * c + B.d * d, B.a * e + B.c * f + B.e, B.b * e + B.d * f + B.f);
  }

  /**
   * 眼睛特写：靠近时（或眼睑开始合上时）叠在身体画的眼睛上，边缘已羽化。
   * 眼睑从睁眼的画扫到闭眼的画：上方的一部分换成闭眼的画，分界线随睁开程度下移。
   */
  private drawEye(ctx: CanvasRenderingContext2D, scale: number, k: number): void {
    const st = this.state;
    const art = whaleArt()!;
    const e = clamp(st.eye);
    const near = smoothstep(22, 60, scale);
    const a = Math.max(near, e < 0.999 ? 1 : 0) * smoothstep(0.75, 0.95, st.tissue);
    if (a <= 0.01) return;
    const size = EYE_ART.sizeOfLen * WHALE_LEN;
    const px = size / EYE_ART.w;
    // 翻身：眼睛随横截面转到新的高度，转到轮廓边上时被压扁、淡去；翻过来之后是远侧的眼睛（上下翻转）
    const rho = st.roll;
    let off = ART_EYE_OFF * WHALE_LEN;
    let sy = 1;
    let fade = 1;
    if (rho > 1e-3) {
      const U = sampleProfile(UPPER, S_EYE);
      const L = sampleProfile(LOWER, S_EYE);
      const v = clamp(off >= 0 ? off / U : off / L, -1, 1);
      const near = Math.cos(rho) >= 0;
      const phi = near ? Math.asin(v) : Math.PI - Math.asin(v);
      off = rolledHeight(phi, rho, U, L, sampleProfile(DORSAL, S_EYE));
      sy = Math.cos(rho);
      fade = smoothstep(0.2, 0.45, Math.abs(sy));
    }
    if (a * fade <= 0.01) return;
    this.body.frame(S_EYE, off, this.f);
    ctx.save();
    ctx.translate(this.f.x, this.f.y);
    ctx.rotate(this.f.a - AXIS_ANGLE);
    ctx.scale(px, px * sy);
    ctx.translate(-EYE_ART.px, -EYE_ART.py);
    ctx.globalAlpha = a * fade;
    ctx.drawImage(art.eyeOpen, 0, 0);
    if (e < 0.999) {
      // 屏幕上眼睛有多大，就用多大的图层（最多原画尺寸）
      const res = clamp(scale * size * k * 1.5, 128, EYE_ART.w);
      ctx.drawImage(this.lidLayer(e, res), 0, 0, res, (res * EYE_ART.h) / EYE_ART.w, 0, 0, EYE_ART.w, EYE_ART.h);
    }
    ctx.restore();
  }

  /** 闭眼的画，只保留眼睑分界线以上、眼裂附近的部分 */
  private lidLayer(e: number, res: number): HTMLCanvasElement {
    const art = whaleArt()!;
    if (!this.eyeLayer) {
      this.eyeLayer = document.createElement('canvas');
      this.eyeLayer.width = EYE_ART.w;
      this.eyeLayer.height = EYE_ART.h;
      this.eyeCtx = this.eyeLayer.getContext('2d');
    }
    const c = this.eyeCtx!;
    const S = res / EYE_ART.w;
    const W = res;
    const H = (res * EYE_ART.h) / EYE_ART.w;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, EYE_ART.w, EYE_ART.h);
    c.drawImage(art.eyeClosed, 0, 0, W, H);
    c.globalCompositeOperation = 'destination-in';
    const side = EYE_ART.w * S;
    const pupilX = EYE_ART.px * S;
    const pupilY = EYE_ART.py * S;
    const openY = pupilY - 0.75 * EYE_ART.almondH * side;
    const shutY = pupilY + 0.75 * EYE_ART.almondH * side;
    const edge = lerp(openY, shutY, 1 - e);
    const soft = 0.012 * side;
    const g = c.createLinearGradient(0, edge - soft, 0, edge + soft);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // 只在眼裂附近的椭圆内替换
    c.translate(pupilX, pupilY);
    c.scale(0.75 * EYE_ART.almondW * side * 1.1, 1.25 * EYE_ART.almondH * side * 1.1);
    const r = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    r.addColorStop(0.727, 'rgba(0,0,0,1)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = r;
    c.fillRect(-20, -20, 40, 40);
    return this.eyeLayer;
  }

  /**
   * 深度光照与水体雾化，与程序绘制的物体使用同一个着色模型（core/color.ts 的 shadeRGB）：
   * 颜色先逐通道乘以光照（深处更暗、更蓝，鲸落附近带一点暖色散射光），再混向该处海水的颜色；
   * 分解时还先褪向灰白。整个变换近似为一次 source-atop 填充 c′ = (1 − a)·c + a·X：
   * 逐通道的色偏只按画面的平均颜色 avg 计算（画面本身接近灰色，误差在 2% 以内），
   * 这样只需一次全图层的合成，手机上也很轻。
   */
  private applyLight(ctx: CanvasRenderingContext2D, w: number, h: number, pale: number, avg: RGB): void {
    const sh = this.sh;
    const wm = sh.warm * 0.55;
    const M = [
      Math.min(1, sh.light * sh.tint[0] + wm * (242 / 255)),
      Math.min(1, sh.light * sh.tint[1] + wm * (199 / 255)),
      Math.min(1, sh.light * sh.tint[2] + wm * (124 / 255)),
    ];
    const m = (M[0] + M[1] + M[2]) / 3;
    const f = sh.fog;
    const keep = (1 - f) * m * (1 - pale);
    const a = 1 - keep;
    if (a < 0.004) return;
    const X: RGB = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const pi = PALE[i] / 255;
      const avgI = (1 - pale) * (avg[i] / 255) + pale * pi;
      const d = (1 - f) * (m * pale * pi + (M[i] - m) * avgI) + (f * sh.fogC[i]) / 255;
      X[i] = clamp(d / a) * 255;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba(X, a);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * 叠在画面上的光影（只落在身体上）：靠近海面时流动的焦散光网、接触海床处的遮蔽、
   * 深海里来自上方的散射光与冷色轮廓光、近景的皮肤细节，以及从下方仰视时被海面勾出的背部轮廓。
   */
  private drawSurfaceLight(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number): void {
    const st = this.state;
    const b = this.body;
    const n = b.n;
    const L = WHALE_LEN;
    const caust = st.y > 2.4 ? Math.exp(-(st.y - 2.4) / 9) : 0;
    // 焦散光网（靠近海面时在皮肤上流动）
    if (rc.quality.caustics && caust > 0.08 && st.tissue > 0.99) {
      const tex = textures().caustic;
      const tile = 3.2;
      for (let layer = 0; layer < 2; layer++) {
        const ox = ((rc.time * (layer ? 0.21 : -0.17)) % tile) - tile;
        const oy = ((rc.time * (layer ? 0.09 : 0.13)) % tile) - tile;
        ctx.globalAlpha = 0.07 * caust * (layer ? 0.8 : 1) * clamp(90 / scale);
        for (let x = -0.6 * L + ox; x < 0.45 * L; x += tile) {
          for (let y = -2.6 + oy; y < 3; y += tile) ctx.drawImage(tex, x, y, tile, tile);
        }
      }
      ctx.globalAlpha = 1;
    }
    this.drawBodyContactShade(ctx);
    this.drawDeepLight(ctx, rc);
    this.drawVolumeLight(ctx, rc);
    // 近景：细小的毛孔、斑点与浅浅的褶痕（只铺在镜头附近，开销很小）
    if (scale > 70 && st.tissue > 0.99) this.drawSkinDetail(ctx, rc, scale);
    // 逆光：镜头位于鲸鱼下方时，身体背着明亮的海面变暗，边缘被海面的光勾勒出来
    const below = clamp((rc.cam.cy - st.y - 2.5) / 8);
    const rim = below * clamp(rc.light.sunAt(st.y - 15) * 1.4);
    if (rim > 0.02) {
      ctx.fillStyle = `rgba(6,22,42,${0.4 * rim})`;
      ctx.fillRect(-0.7 * L, -5, 1.3 * L, 14);
      ctx.beginPath();
      ctx.moveTo(b.ux[0], b.uy[0]);
      through(ctx, b.ux, b.uy, 0, n - 1);
      for (const [lw, a] of [
        [1.2, 0.06],
        [0.6, 0.1],
        [0.24, 0.2],
        [0.08, 0.35],
      ] as const) {
        ctx.strokeStyle = `rgba(200,240,255,${a * rim})`;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ 与海床的接触

  /**
   * 计算身体与海床的接触：每个脊线采样处腹侧离海床的距离（按未分解的完整身体），
   * 以及近侧压痕边缘在侧视中的位置。
   *
   * 鲸鱼是侧视绘制的，但它有真实的宽度：压进软泥的部分在身体近侧留下一道隆起的边缘，
   * 这道边缘在镜头前方（z<0）的海床上，按透视投影后正好挡住腹部最下缘。
   * 只有真正压入沉积物的区域才有这道边缘，其余部分保持原样。
   */
  private updateContact(rc: RenderCtx): void {
    const st = this.state;
    const b = this.body;
    const c = this.contact;
    const n = b.n;
    c.near = false;
    c.sunk = false;
    if (st.visible <= 0.001) return;
    const cp = Math.cos(st.pitch);
    const sp = Math.sin(st.pitch);
    let minGap = Infinity;
    for (let i = 0; i < n; i++) {
      const lx = b.px[i] - b.nx[i] * b.lo0[i];
      const ly = b.py[i] - b.ny[i] * b.lo0[i];
      c.gap[i] = st.seabed - (st.y + lx * sp + ly * cp);
      if (c.gap[i] < minGap) minGap = c.gap[i];
    }
    if (minGap > 5) return;
    c.near = true;
    const cam = rc.cam;
    const P = this.P3;
    for (let i = 0; i < n; i++) {
      const lx = b.px[i] - b.nx[i] * b.lo0[i];
      const ly = b.py[i] - b.ny[i] * b.lo0[i];
      // 横截面近似为圆；身体向镜头一侧侧倾时，近侧压得更深一点
      const r = 0.85 * b.lo0[i];
      const d = -c.gap[i] + Math.sin(b.rl[i]) * r * 0.3;
      c.cx[i] = lx;
      c.cy[i] = ly + 10;
      c.d[i] = 0;
      if (d <= 0) continue;
      const w = Math.sqrt(Math.max(0, 2 * r * d - d * d));
      // 被挤到两侧的软泥：低矮、不规则，不会像沙堆一样隆起
      const berm = (0.06 + 0.3 * d) * (0.8 + 0.35 * noise1(b.s[i] * 19, 5)) * smoothstep(0, 0.1, d);
      const wx = st.x + lx * cp - ly * sp;
      if (!cam.project(wx, st.seabed - berm, st.z - (0.9 * w + 0.2), P)) continue;
      cam.unproject(P.x, P.y, st.z, this.p);
      const dx = this.p.x - st.x;
      const dy = this.p.y - st.y;
      c.cx[i] = dx * cp + dy * sp;
      c.cy[i] = -dx * sp + dy * cp;
      c.d[i] = d;
      c.sunk = true;
    }
  }

  /** 以压痕边缘裁剪（局部坐标）：边缘以下的身体被沉积物挡住 */
  private crestClip(ctx: CanvasRenderingContext2D): void {
    const c = this.contact;
    const n = this.body.n;
    const L = WHALE_LEN;
    ctx.beginPath();
    ctx.moveTo(c.cx[0] + 0.65 * L, -3 * L);
    ctx.lineTo(c.cx[0] + 0.65 * L, c.cy[0]);
    for (let i = 0; i < n; i++) ctx.lineTo(c.cx[i], c.cy[i]);
    // 尾叶在缺刻之后：沿最后一段的高度继续延伸
    ctx.lineTo(c.cx[n - 1] - 0.65 * L, c.cy[n - 1]);
    ctx.lineTo(c.cx[n - 1] - 0.65 * L, -3 * L);
    ctx.closePath();
    ctx.clip();
  }

  /**
   * 海床上的接触阴影（在鲸鱼之前绘制）。按每一段身体实际离海床的高度分区域计算：
   * 压入沉积物的腹部最深，悬空的尾柄与下颌下方较淡、较宽，胸鳍与尾叶在落地处各有一小片软阴影。
   * 另有一层很宽、很淡的环境遮蔽：巨大的身体挡住了来自上方的散射光。
   */
  drawContact(rc: RenderCtx): void {
    const st = this.state;
    if (st.visible <= 0.001 || !whaleArt()) return;
    this.updateContact(rc);
    const c = this.contact;
    if (!c.near) return;
    const b = this.body;
    const ctx = rc.ctx;
    const cp = Math.cos(st.pitch);
    const sp = Math.sin(st.pitch);
    // 分解后骨骼仍然贴着海床，阴影变淡但不会消失
    const k0 = st.visible * (0.5 + 0.5 * smoothstep(0.1, 0.8, st.tissue));
    ctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);
    // 隔一个采样绘制一片（相邻的软阴影大量重叠，减半数量不影响观感）
    for (let i = 0; i < b.n; i += 2) {
      const g = c.gap[i];
      if (g > 4.4) continue;
      const lx = b.px[i] - b.nx[i] * b.lo0[i];
      const ly = b.py[i] - b.ny[i] * b.lo0[i];
      const wx = st.x + lx * cp - ly * sp;
      const r = 0.85 * b.lo0[i];
      const lift = Math.max(0, g);
      // 接触阴影：越贴近海床越深、越集中
      this.groundBlob(rc, wx, st.seabed, st.z - 0.3 * r, 1.5 + 0.4 * lift, 0.5 * r + 0.55 * lift + 0.25, 0.34 * Math.exp(-lift / 0.7) * k0);
      // 宽而淡的环境遮蔽
      if (i % 6 === 0) this.groundBlob(rc, wx, st.seabed, st.z - 0.15 * r, 4, 1.25 * r + 0.9 * lift, 0.13 * Math.exp(-lift / 2.4) * k0);
    }
    // 胸鳍与尾叶：落在海床上的部分各有一小片软阴影
    const kf = k0 * smoothstep(0.12, 0.5, st.tissue);
    if (kf > 0.01) {
      this.finShadow(rc, kf);
      this.flukeShadow(rc, kf);
    }
    ctx.globalAlpha = 1;
  }

  /** 海床上 (x, y, z) 处、横向半径 rx、纵深半径 rz（米）的一片软阴影 */
  private groundBlob(rc: RenderCtx, x: number, y: number, z: number, rx: number, rz: number, a: number): void {
    if (a < 0.004) return;
    const cam = rc.cam;
    const A = this.P3;
    const B = this.P4;
    if (z - rz - cam.cz < 0.5) return;
    if (!cam.project(x, y, z - rz, A) || !cam.project(x, y, z + rz, B)) return;
    const sx = rx * (A.s + B.s) * 0.5;
    const cy = (A.y + B.y) * 0.5;
    const ry = Math.max(0.6, Math.abs(A.y - B.y) * 0.5);
    const cx = (A.x + B.x) * 0.5;
    if (cx + sx < 0 || cx - sx > rc.w || cy + ry < 0 || cy - ry > rc.h) return;
    rc.ctx.globalAlpha = Math.min(1, a);
    rc.ctx.drawImage(textures().shadow, cx - sx, cy - ry, sx * 2, ry * 2);
  }

  /**
   * 把侧视中画在鲸鱼平面上、低于着地线的一点“放回”海床：求出海床上透视投影到同一屏幕位置的点，
   * 在那里画阴影。这样鳍与尾叶在画面上落在哪里，阴影就在哪里，与镜头的高度无关。
   */
  private groundShadowAt(rc: RenderCtx, lx: number, ly: number, rx: number, rz: number, a: number): void {
    const st = this.state;
    const cam = rc.cam;
    this.toWorld(lx, ly, this.p);
    const X = this.p.x;
    const Y = this.p.y;
    // 离海床越高，阴影越淡（高于海床的部分不在海床上）
    const k = a * smoothstep(-0.6, 0.08, Y - st.seabed);
    if (k < 0.004 || Y - cam.cy < 0.2) return;
    const zw = st.z - cam.cz;
    let z = cam.cz + ((st.seabed - cam.cy) * zw) / Math.max(st.seabed - cam.cy + 0.01, Y - cam.cy);
    z = clamp(z, st.z - 10, st.z + 4);
    const gx = cam.cx + ((X - cam.cx) * (z - cam.cz)) / zw;
    this.groundBlob(rc, gx, st.seabed, z, rx, rz, k);
  }

  private finShadow(rc: RenderCtx, a: number): void {
    const root = this.finRoot(this.q);
    const dir = this.finDir();
    for (let j = 0; j < 4; j++) {
      const t = 0.4 + j * 0.2;
      const x = root.x + Math.cos(dir) * FIN_LEN * t;
      const y = root.y + Math.sin(dir) * FIN_LEN * t;
      this.groundShadowAt(rc, x, y, 0.55, 0.35 + 0.3 * (1 - t), 0.2 * a);
    }
  }

  private flukeShadow(rc: RenderCtx, a: number): void {
    const last = this.slices[this.slices.length - 1];
    for (const pt of [FLUKE_MID, FLUKE_TIP, FLUKE_UP]) {
      this.artToLocal(last, pt.x, pt.y, this.q);
      this.groundShadowAt(rc, this.q.x, this.q.y, 1.2, 0.8, 0.2 * a);
    }
  }

  /** 画框像素 → 局部坐标（按某一条带的摆放；尾叶各点都用最后一条带，因为尾叶是刚性的） */
  private artToLocal(sl: Slice, x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
    const mpp = WHALE_LEN / AXIS_PX;
    const A = axisPx(sl.s, this.p);
    const dx = x - A.x;
    const dy = y - A.y;
    const ct = Math.cos(-AXIS_ANGLE);
    const st = Math.sin(-AXIS_ANGLE);
    const u = (dx * ct - dy * st) * mpp;
    const v0 = (dx * st + dy * ct) * mpp;
    // 肚子朝上时画面沿体轴上下翻转
    const v = v0 * (v0 < 0 ? sl.ku : sl.kl) * (this.flipped ? -1 : 1);
    const c = Math.cos(sl.a);
    const s = Math.sin(sl.a);
    out.x = sl.px + u * c - v * s;
    out.y = sl.py + u * s + v * c;
    return out;
  }

  /** 压痕边缘：被挤到身体两侧、略微隆起的软泥，顶部接住一点顶光，前坡稍暗；还有零星被带起的泥块 */
  private drawBerm(rc: RenderCtx): void {
    const c = this.contact;
    if (!c.sunk) return;
    const st = this.state;
    const b = this.body;
    const ctx = rc.ctx;
    const scale = this.applyLocal(ctx, rc);
    rc.light.shadeAt(st.x, st.seabed, st.z - 1, this.sh2);
    const lip = rgba(shadeRGB(BERM, this.sh2, this.tmp), 1);
    const shadeC = 'rgba(4,9,15,1)';
    const fade = st.visible * (1 - 0.55 * st.burial);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 3; pass++) {
      // 0：前坡的暗部（略低于边缘）；1：边缘的柔和亮边；2：最亮的一线
      ctx.strokeStyle = pass === 0 ? shadeC : lip;
      ctx.lineWidth = pass === 0 ? 0.32 : pass === 1 ? 0.14 : 0.05;
      const oy = pass === 0 ? 0.18 : 0;
      const am = pass === 0 ? 0.16 : pass === 1 ? 0.16 : 0.22;
      let i = 0;
      while (i < b.n) {
        if (c.d[i] <= 0) {
          i++;
          continue;
        }
        // 一段连续的压痕作为一条路径绘制（避免分段描边在接缝处叠出暗点），浓淡按这一段的平均深度
        let j = i;
        let sum = c.d[i];
        while (j + 1 < b.n && c.d[j + 1] > 0) sum += c.d[++j];
        if (j > i) {
          ctx.globalAlpha = am * fade * smoothstep(0.0, 0.2, sum / (j - i + 1));
          ctx.beginPath();
          ctx.moveTo(c.cx[i], c.cy[i] + oy);
          for (let k = i + 1; k <= j; k++) ctx.lineTo(c.cx[k], c.cy[k] + oy);
          ctx.stroke();
        }
        i = j + 1;
      }
    }
    // 零星的小泥块（只在近景可见）
    if (scale > 25) {
      ctx.fillStyle = lip;
      for (let i = 1; i < b.n - 1; i++) {
        if (c.d[i] < 0.05) continue;
        for (let j = 0; j < 2; j++) {
          const h = hash1(i * 11 + j * 3 + 7);
          if (h > 0.55) continue;
          const t = hash1(i * 5 + j);
          const x = lerp(c.cx[i], c.cx[i + 1], t);
          const y = lerp(c.cy[i], c.cy[i + 1], t) + (hash1(i * 7 + j) - 0.3) * 0.2;
          const r = 0.03 + 0.05 * hash1(i * 13 + j);
          ctx.globalAlpha = 0.35 * fade * smoothstep(0.05, 0.2, c.d[i]);
          ctx.beginPath();
          ctx.ellipse(x, y, r * 1.5, r, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private cutHoles(ctx: CanvasRenderingContext2D, rc: RenderCtx): void {
    const st = this.state;
    const b = this.body;
    this.applyLocal(ctx, rc);
    ctx.globalCompositeOperation = 'destination-out';
    const dot = textures().hole;
    for (const h of this.holes) {
      const k = smoothstep(h.th, h.th - 0.5, st.tissue);
      if (k <= 0.001) continue;
      const r = h.r * Math.pow(k, 1.25) * (1 + (1 - st.tissue) * 0.35);
      b.point(h.s, h.v, this.p);
      for (let j = 0; j < HOLE_DOTS; j++) {
        const a = hash1(h.seed * 7 + j) * TAU;
        const d = r * 0.62 * hash1(h.seed * 13 + j);
        const rr = r * (0.5 + 0.45 * hash1(h.seed * 3 + j));
        ctx.globalAlpha = 1;
        ctx.drawImage(dot, this.p.x + Math.cos(a) * d - rr, this.p.y + Math.sin(a) * d - rr, rr * 2, rr * 2);
      }
    }
    // 尾叶里没有骨骼：分解后期整片消失
    if (st.tissue < 0.4) {
      const last = this.slices[this.slices.length - 1];
      ctx.globalAlpha = 1 - smoothstep(0.12, 0.4, st.tissue);
      for (const pt of [FLUKE_MID, FLUKE_TIP, FLUKE_UP]) {
        this.artToLocal(last, pt.x, pt.y, this.q);
        ctx.drawImage(dot, this.q.x - 2, this.q.y - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * 身体下缘的接触遮蔽：只在真正贴近或压入海床的地方，沿可见的下缘逐渐加深，
   * 悬空的尾柄与下颌下方几乎没有，不会形成一圈均匀的黑边。
   */
  private drawBodyContactShade(ctx: CanvasRenderingContext2D): void {
    const c = this.contact;
    if (!c.near) return;
    const b = this.body;
    const tex = textures().shadow;
    const k = this.state.visible;
    for (let i = 1; i < b.n - 1; i++) {
      const g = c.gap[i];
      if (g > 1.2) continue;
      const a = 0.18 * (1 - clamp(g / 1.2)) * k;
      if (a < 0.005) continue;
      // 可见的下缘：压痕边缘与腹侧轮廓中较高的一个
      const y = Math.min(c.cy[i], b.by[i]);
      const x = c.d[i] > 0 ? c.cx[i] : b.bx[i];
      const r = 0.95 + 0.4 * clamp(-g / 0.4);
      ctx.globalAlpha = a;
      ctx.drawImage(tex, x - r, y - r * 0.7, r * 2, r * 1.4);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 深海中的光：来自上方的柔和散射光让背部略亮、身体下半部渐暗，
   * 再加一条很克制的冷色轮廓光，帮助在幽暗中读出身体的体积。
   */
  private drawDeepLight(ctx: CanvasRenderingContext2D, rc: RenderCtx): void {
    const st = this.state;
    const deep = smoothstep(700, 1500, st.y) * clamp(rc.light.focusLight / 0.6);
    if (deep < 0.02) return;
    const b = this.body;
    const n = b.n;
    const L = WHALE_LEN;
    const g = ctx.createLinearGradient(0, -2.4, 0, 2.6);
    g.addColorStop(0, `rgba(180,205,225,${0.13 * deep})`);
    g.addColorStop(0.35, 'rgba(180,205,225,0)');
    g.addColorStop(0.7, 'rgba(3,8,16,0)');
    g.addColorStop(1, `rgba(3,8,16,${0.24 * deep})`);
    ctx.fillStyle = g;
    ctx.fillRect(-0.7 * L, -5, 1.3 * L, 10);
    ctx.beginPath();
    ctx.moveTo(b.ux[0], b.uy[0]);
    through(ctx, b.ux, b.uy, 0, n - 1);
    ctx.strokeStyle = `rgba(185,220,240,${0.16 * deep})`;
    ctx.lineWidth = 0.3;
    ctx.stroke();
    ctx.strokeStyle = `rgba(200,230,245,${0.14 * deep})`;
    ctx.lineWidth = 0.1;
    ctx.stroke();
  }

  /**
   * 下沉时的体积明暗与轮廓光：上方透下的天光沿背部铺开一层柔和的亮，腹部渐渐沉入暗处，
   * 背部边缘再勾一道很细的冷色轮廓光。都沿着身体的轮廓线绘制，所以随身体的弧度一起弯曲；
   * 只落在身体上（source-atop），越深越弱但不会完全消失。
   */
  private drawVolumeLight(ctx: CanvasRenderingContext2D, rc: RenderCtx): void {
    const st = this.state;
    const k = rc.light.rim * (0.6 + 0.4 * rc.light.sunAt(st.y)) * smoothstep(0.98, 1, st.tissue);
    if (k < 0.02) return;
    const b = this.body;
    const n = b.n;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 背部：宽而淡的受光面（浅海的阳光下更亮，像参考画面里被照亮的背）
    const sun = 1 + 1.2 * rc.light.sunlit * rc.light.sunR;
    ctx.beginPath();
    ctx.moveTo(b.ux[0], b.uy[0]);
    through(ctx, b.ux, b.uy, 0, n - 1);
    for (const [lw, a] of [
      [2.6, 0.07],
      [1.4, 0.08],
    ] as const) {
      ctx.strokeStyle = `rgba(185,225,250,${a * k * sun})`;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    // 轮廓光
    for (const [lw, a] of [
      [0.5, 0.09],
      [0.2, 0.15],
      [0.07, 0.26],
    ] as const) {
      ctx.strokeStyle = `rgba(205,238,255,${a * k})`;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    // 腹部：渐渐沉入暗处，边缘留一线被下方深蓝映亮的冷光
    ctx.beginPath();
    ctx.moveTo(b.bx[0], b.by[0]);
    through(ctx, b.bx, b.by, 0, n - 1);
    for (const [lw, a] of [
      [3.2, 0.12],
      [1.6, 0.1],
    ] as const) {
      ctx.strokeStyle = `rgba(3,12,28,${a * k})`;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(120,180,225,${0.07 * k})`;
    ctx.lineWidth = 0.14;
    ctx.stroke();
  }

  /** 近景皮肤细节：以眼睛附近为中心平铺细节纹理，越近越清晰。 */
  private drawSkinDetail(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number): void {
    const tex = textures().skinDetail;
    const a = clamp((scale - 70) / 220);
    const tile = 0.9;
    this.body.surfaceFrame(S_EYE, 0, this.f);
    // 只覆盖镜头可能看到的范围（以眼睛为中心）
    const span = Math.min(14, (rc.h / scale) * 1.6 + 1);
    const x0 = Math.floor((this.f.x - span) / tile) * tile;
    const y0 = Math.floor((this.f.y - span * 0.6) / tile) * tile;
    ctx.globalAlpha = 0.28 * a;
    for (let x = x0; x < this.f.x + span; x += tile) {
      for (let y = y0; y < this.f.y + span * 0.6; y += tile) ctx.drawImage(tex, x, y, tile, tile);
    }
    ctx.globalAlpha = 1;
  }
}

/** 以二次曲线平滑经过 xs/ys[i0..i1]（当前点已位于 i0）。 */
function through(ctx: CanvasRenderingContext2D, xs: Float32Array, ys: Float32Array, i0: number, i1: number): void {
  if (i0 === i1) return;
  const step = i1 > i0 ? 1 : -1;
  let i = i0 + step;
  while (i !== i1) {
    const j = i + step;
    ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
    i = j;
  }
  ctx.lineTo(xs[i1], ys[i1]);
}
