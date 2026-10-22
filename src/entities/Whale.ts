import { hex, makeShade, mixRGB, rgba, shadeRGB, type RGB, type Shade } from '../core/color';
import { clamp, hash1, lerp, noise1, rng, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import { WORLD } from '../config/stages';
import { S_BLOW, S_EYE, S_FIN, S_GAPE, WhaleBody, type WhaleShape } from './WhaleBody';
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
  /** 近侧 / 远侧胸鳍随水流的被动摆动（弧度，正值向后上方抬起） */
  finN: number;
  finF: number;
  /** 鲸鱼下方海床的世界 y（下沉途中海床属于水体参照系，会有偏移；用于鳍的海床约束与接触阴影） */
  seabed: number;
}

/**
 * 胸鳍姿态（鲸鱼局部坐标）：a 为根部方向，bend 为远端相对根部的弯折（正值使远端更平），
 * len / wid 为侧视中的长度与宽度比例（平放在海床上的鳍因透视而略短、略窄）。
 */
export interface FinPose {
  a: number;
  bend: number;
  len: number;
  wid: number;
}

/** 静卧：近侧胸鳍向外展开，根部较陡、远端顺着海床放平 */
const REST_FIN: FinPose = { a: Math.PI - 0.38, bend: 0.24, len: 0.93, wid: 0.7 };
/** 静卧：远侧胸鳍沿身体向后落在另一侧的海床上，大部分被躯干遮住 */
const REST_FIN_FAR: FinPose = { a: Math.PI - 0.1, bend: 0.06, len: 0.84, wid: 0.58 };
const FIN_LEN = 4.3;
/** 鳍尖可以低于身体着地线的距离（米）：近侧的鳍落在镜头一侧的海床上，侧视中略低；远侧的落在身体后方，侧视中略高 */
const FIN_GROUND_NEAR = 0.5;
const FIN_GROUND_FAR = -0.22;

export function makeWhaleState(): WhaleState {
  return {
    visible: 1,
    x: 0,
    y: 0,
    z: 0,
    pitch: 0,
    swim: 1,
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
    finN: 0,
    finF: 0,
    seabed: WORLD.seabedY,
  };
}

const C = {
  dorsal: hex('#29313b'),
  flank: hex('#414b56'),
  lowFlank: hex('#69727b'),
  belly: hex('#bfc6cb'),
  bellyLight: hex('#e1e5e7'),
  pleat: hex('#353d46'),
  interior: hex('#1b1f27'),
  interiorDeep: hex('#0f1117'),
  baleen: hex('#b6a88b'),
  baleenDark: hex('#6f6656'),
  tongue: hex('#857680'),
  fin: hex('#d2d8dc'),
  finEdge: hex('#7d8790'),
  finMottle: hex('#4f5963'),
  eyeBall: hex('#120e0d'),
  iris: hex('#3d2b20'),
  lid: hex('#323b45'),
  socket: hex('#1f252c'),
  tubercle: hex('#3b444f'),
  barnacle: hex('#c8c2b2'),
  pale: hex('#9aa2a8'),
  paleBelly: hex('#c3c7c9'),
  rim: hex('#cfe9f7'),
};

/** 被挤起的软泥边缘（被局部散射光照亮的细颗粒沉积物） */
const BERM = hex('#9a9484');

interface Mottle {
  s: number;
  v: number;
  r: number;
  dark: boolean;
  rot: number;
}

interface Hole {
  s: number;
  v: number;
  r: number;
  th: number;
  seed: number;
}

/** 鲸鱼游动动画控制：把叙事状态转换为具体的身体几何与绘制。 */
export class Whale {
  readonly body = new WhaleBody();
  readonly skeleton: WhaleSkeleton;
  readonly state: WhaleState = makeWhaleState();
  phase = 0;
  private readonly shape: WhaleShape = { swim: 0, phase: 0, beat: 0, beatPh: 0, mouth: 0, throat: 0, rest: 0, flex: 0, nod: 0, fluke: 0, shrink: 0 };
  private readonly sh: Shade = makeShade();
  private readonly mottles: Mottle[] = [];
  private readonly holes: Hole[] = [];
  private readonly col: Record<keyof typeof C, string> = {} as Record<keyof typeof C, string>;
  private readonly tmp: RGB = [0, 0, 0];
  private readonly tmp2: RGB = [0, 0, 0];
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;
  private readonly p = { x: 0, y: 0 };
  private readonly q = { x: 0, y: 0 };
  private readonly f = { x: 0, y: 0, a: 0 };
  private readonly P3 = { x: 0, y: 0, s: 0 };
  private readonly P4 = { x: 0, y: 0, s: 0 };
  private readonly sh2: Shade = makeShade();
  /** 尾叶两侧叶片在侧视中的展开（尾叶坐标的 y 系数）：近侧 / 远侧 */
  private kNear = 0.52;
  private kFar = -0.4;
  private readonly finCx = new Float32Array(37);
  private readonly finCy = new Float32Array(37);
  private readonly finTh = new Float32Array(37);
  /** 局部绘制变换在屏幕上的包围盒（像素，用于分解图层裁剪） */
  private bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  readonly finPose: FinPose = { a: Math.PI - 0.62, bend: 0, len: 1, wid: 1 };
  readonly finFarPose: FinPose = { a: Math.PI - 0.48, bend: 0, len: 0.92, wid: 0.85 };
  /** 与海床的接触（每帧由 prepareContact 计算，局部坐标） */
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
    for (let i = 0; i < 40; i++) {
      const belly = i < 30;
      this.mottles.push({
        s: 0.1 + r() * 0.62,
        v: belly ? -0.45 - r() * 0.5 : -0.3 + r() * 0.55,
        r: 0.05 + r() * r() * 0.2,
        dark: belly ? r() > 0.2 : r() > 0.85,
        rot: r() * Math.PI,
      });
    }
    for (let i = 0; i < 64; i++) {
      this.holes.push({
        s: 0.05 + r() * 0.9,
        v: -0.85 + r() * 1.7,
        r: 0.35 + r() * 0.85,
        th: 0.18 + r() * 0.8,
        seed: i,
      });
    }
    this.skeleton = new WhaleSkeleton(seed);
  }

  /**
   * 推进主动游动的相位。effort 为叙事推进速度（用于让尾鳍拍动与位移匹配）。
   * 失去生命之后的一切动作（最后几次摆动、被动摆动）都由叙事进度决定，不再使用这个时钟。
   */
  update(dt: number, effort: number): void {
    const st = this.state;
    // 大型动物的节奏：尾叶约 4~6 秒拍一次，用户快速滚动时也只略微加快
    const freq = 0.17 + 0.08 * clamp(effort);
    this.phase += dt * TAU * freq * (0.35 + 0.65 * st.swim);
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
    sh.phase = this.phase;
    sh.beat = st.beat;
    sh.beatPh = st.beatPh;
    sh.mouth = st.mouth;
    sh.throat = st.throat;
    sh.rest = st.rest;
    sh.flex = st.flex;
    sh.nod = st.nod;
    sh.fluke = st.fluke;
    sh.shrink = 1 - smoothstep(0.0, 1, st.tissue);
    this.body.compute(sh);
    this.finFor(st.finN, false, this.finPose);
    this.finFor(st.finF, true, this.finFarPose);
    this.flukeFor();
  }

  /**
   * 尾叶：游动与下沉时两片叶片上下展开；静卧时尾叶松弛地斜靠在海床上——
   * 远侧叶片贴着海床，近侧叶片略微翘起，整体比游动时平得多，也不再对称。
   */
  private flukeFor(): void {
    const st = this.state;
    const b = this.body;
    const k = smoothstep(0.3, 0.95, st.rest);
    this.kNear = lerp(0.52, 0.27, k);
    this.kFar = lerp(-0.4, -0.13, k);
    // 海床约束：两片叶片的尖端都不低于海床（侧视中远侧叶片在身体后方，应略高于着地线）
    const n = b.n;
    const c = Math.cos(b.flukeAngle);
    const s = Math.sin(b.flukeAngle);
    for (const far of [false, true]) {
      const ky = far ? this.kFar : this.kNear;
      const tx = b.px[n - 1] + 1.75 * c - 2.35 * ky * s;
      const ty = b.py[n - 1] + 1.75 * s + 2.35 * ky * c;
      const limit = this.groundLocal(tx) + (far ? -0.08 : 0.42);
      if (Math.abs(c) < 0.2) continue;
      // ty 关于 ky 是线性的：解出恰好落在海床上的展开量，再以软约束（softplus）平滑地限制，
      // 叶片接近海床时就开始被托平，而不是碰到后突然折起
      const B = 2.35 * c;
      const kLim = ky + (limit - ty) / B;
      const w = 0.04;
      const x = (B < 0 ? kLim - ky : ky - kLim) / w;
      const push = w * (x > 20 ? x : Math.log1p(Math.exp(x)));
      const k2 = B < 0 ? ky + push : ky - push;
      if (far) this.kFar = k2;
      else this.kNear = k2;
    }
  }

  /**
   * 胸鳍姿态：游动时向后下方，滤食时外展；失去生命后保持自然展开，只随水流被动摆动
   * （passive 由下沉动作层给出）。静卧时两侧不对称：近侧向外展开、斜放在沉积物上，
   * 远侧沿身体向后落在另一侧的海床上。任何时候鳍尖都不会穿过海床——接近海床时，
   * 先触到海床的鳍被缓缓推向后方。
   */
  private finFor(passive: number, far: boolean, out: FinPose): void {
    const st = this.state;
    const swimFin = Math.PI - 0.62 + 0.12 * Math.sin(this.phase * 0.5 + 0.8) * st.swim;
    const feedFin = Math.PI - 1.15;
    const limpFin = Math.PI - 0.8 + passive;
    let a = lerp(limpFin, swimFin, st.life);
    a = lerp(a, feedFin, smoothstep(0.1, 0.8, st.mouth) * st.life);
    if (far) a += 0.14;
    const rp = far ? REST_FIN_FAR : REST_FIN;
    const k = smoothstep(0.15, 0.8, st.rest);
    // 最后一点惯性：鳍落定时极轻地再压下一点，随即回到静止
    const settle = (far ? 0.02 : 0.035) * Math.sin(Math.PI * smoothstep(0.55, 1, st.rest));
    out.a = lerp(a, rp.a, k) - settle;
    out.bend = rp.bend * k;
    out.len = lerp(far ? 0.92 : 1, rp.len, k);
    out.wid = lerp(far ? 0.85 : 1, rp.wid, k);

    // 海床约束（局部坐标，按鳍的平均方向估算鳍尖）
    const root = this.body.point(S_FIN, far ? -0.32 : -0.5, this.p);
    const L = FIN_LEN * out.len;
    const aEff = out.a + out.bend * 0.5;
    const limit = this.groundLocal(root.x + L * Math.cos(aEff)) + (far ? FIN_GROUND_FAR : FIN_GROUND_NEAR);
    const need = (limit - root.y) / L;
    // 软约束（softplus）：鳍尖接近海床时就开始被缓缓推开，而不是碰到后突然转向；始终不低于海床
    const aMin = Math.PI - Math.asin(clamp(need, -1, 1));
    const w = 0.07;
    const x = (aMin - aEff) / w;
    out.a += w * (x > 20 ? x : Math.log1p(Math.exp(x)));
  }

  /** 海床在鲸鱼局部坐标中、局部 x 处的 y */
  private groundLocal(lx: number): number {
    const st = this.state;
    return (st.seabed - st.y - lx * Math.sin(st.pitch)) / Math.cos(st.pitch);
  }

  /** 口腔中心（磷虾被吞入的位置），世界坐标。 */
  mouthPoint(out: { x: number; y: number }): { x: number; y: number } {
    const b = this.body;
    const i = Math.min(b.gapeCount - 1, Math.round(b.gapeCount * 0.55));
    const lx = (b.mux[i] + b.mlx[i]) / 2 + 0.6 * b.jawAngle;
    const ly = (b.muy[i] + b.mly[i]) / 2;
    return this.toWorld(lx, ly, out);
  }

  /** 吻端（头部最前方） */
  snoutPoint(out: { x: number; y: number }): { x: number; y: number } {
    return this.toWorld(this.body.ux[0], this.body.uy[0] + 0.1, out);
  }

  blowholePoint(out: { x: number; y: number }): { x: number; y: number } {
    this.body.point(S_BLOW, 0.96, this.p);
    return this.toWorld(this.p.x, this.p.y, out);
  }

  eyePoint(out: { x: number; y: number }): { x: number; y: number } {
    this.body.surfaceFrame(S_EYE, 0.02, this.f);
    return this.toWorld(this.f.x, this.f.y, out);
  }

  private computeColors(rc: RenderCtx): void {
    const st = this.state;
    const sh = this.sh;
    rc.light.shadeAt(st.x, st.y, st.z, sh);
    const pale = (1 - st.tissue) * 0.75;
    for (const k of Object.keys(C) as Array<keyof typeof C>) {
      let base = C[k];
      if (pale > 0 && (k === 'dorsal' || k === 'flank' || k === 'lowFlank' || k === 'lid' || k === 'tubercle')) {
        base = mixRGB(base, C.pale, pale, this.tmp2);
      } else if (pale > 0 && (k === 'belly' || k === 'bellyLight' || k === 'fin')) {
        base = mixRGB(base, C.paleBelly, pale, this.tmp2);
      }
      shadeRGB(base, sh, this.tmp);
      this.col[k] = rgba(this.tmp);
    }
  }

  private ensureLayer(rc: RenderCtx): CanvasRenderingContext2D {
    const cw = rc.ctx.canvas.width;
    const ch = rc.ctx.canvas.height;
    if (!this.layer) {
      this.layer = document.createElement('canvas');
      this.layerCtx = this.layer.getContext('2d');
    }
    if (this.layer.width !== cw || this.layer.height !== ch) {
      this.layer.width = cw;
      this.layer.height = ch;
    }
    return this.layerCtx!;
  }

  /** 设置鲸鱼局部坐标的绘制变换，返回屏幕缩放。 */
  private applyLocal(ctx: CanvasRenderingContext2D, rc: RenderCtx): number {
    const st = this.state;
    return rc.cam.applyTransform(ctx, rc.dpr, st.x, st.y, st.z, st.pitch);
  }

  private computeBBox(rc: RenderCtx): void {
    const st = this.state;
    const P = { x: 0, y: 0, s: 0 };
    rc.cam.project(st.x, st.y, st.z, P);
    const r = 13 * P.s;
    this.bbox.x0 = Math.max(0, Math.floor((P.x - r) * rc.dpr));
    this.bbox.y0 = Math.max(0, Math.floor((P.y - r) * rc.dpr));
    this.bbox.x1 = Math.min(rc.ctx.canvas.width, Math.ceil((P.x + r) * rc.dpr));
    this.bbox.y1 = Math.min(rc.ctx.canvas.height, Math.ceil((P.y + r) * rc.dpr));
  }

  /** 屏幕上是否可见（粗略包围盒）。 */
  onScreen(rc: RenderCtx): boolean {
    const st = this.state;
    if (st.visible <= 0.001) return false;
    const P = { x: 0, y: 0, s: 0 };
    if (!rc.cam.project(st.x, st.y, st.z, P)) return false;
    const r = 12 * P.s;
    return P.x + r > 0 && P.x - r < rc.w && P.y + r > 0 && P.y - r < rc.h;
  }

  // ------------------------------------------------------------------ 绘制

  /** 口腔内部（深色腔体、鲸须板、舌头）。应在磷虾之前绘制。 */
  drawInterior(rc: RenderCtx): void {
    const st = this.state;
    if (st.mouth < 0.01 || st.visible <= 0.001 || st.tissue < 0.99) return;
    const ctx = rc.ctx;
    const b = this.body;
    this.computeColors(rc);
    this.applyLocal(ctx, rc);
    ctx.globalAlpha = st.visible;
    const g = b.gapeCount;
    ctx.beginPath();
    ctx.moveTo(b.mux[0], b.muy[0]);
    for (let i = 1; i < g; i++) ctx.lineTo(b.mux[i], b.muy[i]);
    ctx.lineTo(b.hingeX, b.hingeY);
    for (let i = g - 1; i >= 0; i--) ctx.lineTo(b.mlx[i], b.mly[i]);
    ctx.closePath();
    const grad = ctx.createLinearGradient(b.mux[0], b.muy[0], b.hingeX, b.hingeY);
    grad.addColorStop(0, this.col.interior);
    grad.addColorStop(1, this.col.interiorDeep);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 舌头：沿下颌的柔软隆起
    ctx.fillStyle = this.col.tongue;
    ctx.globalAlpha = st.visible * 0.55;
    ctx.beginPath();
    const i0 = Math.floor(g * 0.25);
    ctx.moveTo(b.mlx[i0], b.mly[i0]);
    for (let i = i0; i < g; i++) {
      const t = (i - i0) / (g - i0);
      const lift = Math.sin(Math.PI * t) * 0.35 * st.mouth;
      ctx.lineTo(b.mlx[i] + 0.0, b.mly[i] - lift);
    }
    ctx.lineTo(b.hingeX, b.hingeY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = st.visible;
    // 鲸须板：从上颌垂下的梳状结构
    const len0 = 0.5 * clamp(st.mouth * 1.6);
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? this.col.baleenDark : this.col.baleen;
      ctx.lineWidth = pass === 0 ? 0.05 : 0.022;
      ctx.beginPath();
      for (let i = 1; i < g - 1; i++) {
        const t = i / (g - 1);
        const steps = 3;
        for (let k = 0; k < steps; k++) {
          const u = (i + k / steps) / (g - 1);
          if (u > 0.97) break;
          const ix = Math.min(g - 2, Math.floor(u * (g - 1)));
          const fr = u * (g - 1) - ix;
          const x = lerp(b.mux[ix], b.mux[ix + 1], fr);
          const y = lerp(b.muy[ix], b.muy[ix + 1], fr);
          const L = len0 * (0.35 + Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.9);
          ctx.moveTo(x, y);
          ctx.lineTo(x - L * 0.18, y + L);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 身体、鳍、眼睛等主体。分解阶段在离屏图层中挖出柔和的空洞，露出骨骼。 */
  draw(rc: RenderCtx): void {
    const st = this.state;
    if (st.visible <= 0.001) return;
    this.computeColors(rc);
    this.updateContact(rc);
    const decaying = st.tissue < 0.999;
    if (decaying) {
      // 骨骼在身体之后；压进沉积物的部分同样被压痕边缘挡住
      const clip = this.contact.sunk;
      if (clip) {
        rc.ctx.save();
        this.applyLocal(rc.ctx, rc);
        this.crestClip(rc.ctx);
      }
      this.skeleton.draw(rc, this.body, st, this.finPose);
      if (clip) rc.ctx.restore();
      if (st.tissue <= 0.002) {
        this.drawBerm(rc);
        return;
      }
      this.computeBBox(rc);
      const bb = this.bbox;
      if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) return;
      const lctx = this.ensureLayer(rc);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      this.drawBodyTo(lctx, rc);
      this.cutHoles(lctx, rc);
      const ctx = rc.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = st.visible * smoothstep(0, 0.3, st.tissue);
      ctx.drawImage(this.layer!, bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0, bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      ctx.globalAlpha = 1;
      this.drawBerm(rc);
    } else {
      // 远处的鲸鱼：以低分辨率绘制再放大，得到柔和的“景深”轮廓
      const soft = clamp((st.z - 35) / 90);
      if (soft > 0.02) {
        this.drawSoft(rc, 1 / (1 + soft * 5));
        return;
      }
      rc.ctx.globalAlpha = st.visible;
      this.drawBodyTo(rc.ctx, rc);
      rc.ctx.globalAlpha = 1;
      this.drawBerm(rc);
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
    if (minGap > 3) return;
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
      c.cy[i] = ly + 6;
      c.d[i] = 0;
      if (d <= 0) continue;
      const w = Math.sqrt(Math.max(0, 2 * r * d - d * d));
      // 被挤到两侧的软泥：低矮、不规则，不会像沙堆一样隆起
      const berm = (0.04 + 0.3 * d) * (0.8 + 0.35 * noise1(b.s[i] * 19, 5)) * smoothstep(0, 0.06, d);
      const wx = st.x + lx * cp - ly * sp;
      if (!cam.project(wx, st.seabed - berm, st.z - (0.9 * w + 0.12), P)) continue;
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
    ctx.beginPath();
    ctx.moveTo(c.cx[0] + 9, -40);
    ctx.lineTo(c.cx[0] + 9, c.cy[0]);
    for (let i = 0; i < n; i++) ctx.lineTo(c.cx[i], c.cy[i]);
    ctx.lineTo(c.cx[n - 1] - 9, c.cy[n - 1]);
    ctx.lineTo(c.cx[n - 1] - 9, -40);
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
    if (st.visible <= 0.001) return;
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
      if (g > 2.6) continue;
      const lx = b.px[i] - b.nx[i] * b.lo0[i];
      const ly = b.py[i] - b.ny[i] * b.lo0[i];
      const wx = st.x + lx * cp - ly * sp;
      const r = 0.85 * b.lo0[i];
      const lift = Math.max(0, g);
      // 接触阴影：越贴近海床越深、越集中
      this.groundBlob(rc, wx, st.seabed, st.z - 0.3 * r, 0.9 + 0.4 * lift, 0.5 * r + 0.55 * lift + 0.15, 0.34 * Math.exp(-lift / 0.4) * k0);
      // 宽而淡的环境遮蔽
      if (i % 6 === 0) this.groundBlob(rc, wx, st.seabed, st.z - 0.15 * r, 2.4, 1.25 * r + 0.9 * lift, 0.13 * Math.exp(-lift / 1.4) * k0);
    }
    // 胸鳍与尾叶：落在海床上的部分各有一小片软阴影
    const kf = k0 * smoothstep(0.12, 0.5, st.tissue);
    if (kf > 0.01) {
      this.finShadow(rc, this.finPose, -0.5, 0, kf);
      this.finShadow(rc, this.finFarPose, -0.32, 0.25, kf * 0.6);
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
    const k = a * smoothstep(-0.35, 0.05, Y - st.seabed);
    if (k < 0.004 || Y - cam.cy < 0.2) return;
    const zw = st.z - cam.cz;
    let z = cam.cz + ((st.seabed - cam.cy) * zw) / Math.max(st.seabed - cam.cy + 0.01, Y - cam.cy);
    z = clamp(z, st.z - 6, st.z + 2.5);
    const gx = cam.cx + ((X - cam.cx) * (z - cam.cz)) / zw;
    this.groundBlob(rc, gx, st.seabed, z, rx, rz, k);
  }

  /** 胸鳍中线上 t 处（0 根部 ~ 1 鳍尖）的局部坐标 */
  private finCenter(pose: FinPose, v: number, dx: number, t: number, out: { x: number; y: number }): { x: number; y: number } {
    this.body.point(S_FIN, v, out);
    const L = FIN_LEN * pose.len;
    // 弯折沿鳍长平滑分布：对方向角积分（数值积分，10 步）
    let x = 0;
    let y = 0;
    const steps = 10;
    for (let j = 0; j < steps; j++) {
      const u = ((j + 0.5) / steps) * t;
      const th = pose.a + pose.bend * smoothstep(0.25, 0.75, u);
      x += Math.cos(th) * (L * t) / steps;
      y += Math.sin(th) * (L * t) / steps;
    }
    out.x += x + dx;
    out.y += y;
    return out;
  }

  private finShadow(rc: RenderCtx, pose: FinPose, v: number, dx: number, a: number): void {
    const q = this.q;
    for (let j = 0; j < 4; j++) {
      const t = 0.4 + j * 0.2;
      this.finCenter(pose, v, dx, t, q);
      this.groundShadowAt(rc, q.x, q.y, 0.55 * pose.len, 0.3 + 0.25 * pose.wid * (1 - t), 0.2 * a);
    }
  }

  private flukeShadow(rc: RenderCtx, a: number): void {
    const b = this.body;
    const n = b.n;
    const c = Math.cos(b.flukeAngle);
    const s = Math.sin(b.flukeAngle);
    for (const [fx, fy] of [
      [0.6, 0.1],
      [1.25, 2.0 * this.kFar],
      [1.25, 2.0 * this.kNear],
    ] as const) {
      this.groundShadowAt(rc, b.px[n - 1] + fx * c - fy * s, b.py[n - 1] + fx * s + fy * c, 0.75, 0.5, 0.2 * a);
    }
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
      ctx.lineWidth = pass === 0 ? 0.2 : pass === 1 ? 0.09 : 0.035;
      const oy = pass === 0 ? 0.12 : 0;
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
          ctx.globalAlpha = am * fade * smoothstep(0.0, 0.12, sum / (j - i + 1));
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
        if (c.d[i] < 0.03) continue;
        for (let j = 0; j < 2; j++) {
          const h = hash1(i * 11 + j * 3 + 7);
          if (h > 0.55) continue;
          const t = hash1(i * 5 + j);
          const x = lerp(c.cx[i], c.cx[i + 1], t);
          const y = lerp(c.cy[i], c.cy[i + 1], t) + (hash1(i * 7 + j) - 0.3) * 0.12;
          const r = 0.02 + 0.035 * hash1(i * 13 + j);
          ctx.globalAlpha = 0.35 * fade * smoothstep(0.03, 0.12, c.d[i]);
          ctx.beginPath();
          ctx.ellipse(x, y, r * 1.5, r, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawSoft(rc: RenderCtx, k: number): void {
    const st = this.state;
    this.computeBBox(rc);
    const bb = this.bbox;
    if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) return;
    const lctx = this.ensureLayer(rc);
    const sw = Math.ceil((bb.x1 - bb.x0) * k) + 2;
    const shh = Math.ceil((bb.y1 - bb.y0) * k) + 2;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, sw + 2, shh + 2);
    // 在缩小的坐标系中绘制：平移到包围盒原点并缩放
    const fake = { ...rc, ctx: lctx, dpr: rc.dpr * k } as RenderCtx;
    const cam = rc.cam;
    const px = cam.px;
    const py = cam.py;
    cam.px -= bb.x0 / rc.dpr;
    cam.py -= bb.y0 / rc.dpr;
    this.drawBodyTo(lctx, fake);
    cam.px = px;
    cam.py = py;
    const ctx = rc.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = st.visible;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer!, 0, 0, sw, shh, bb.x0, bb.y0, sw / k, shh / k);
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
      for (let j = 0; j < 3; j++) {
        const a = hash1(h.seed * 7 + j) * TAU;
        const d = r * 0.45 * hash1(h.seed * 13 + j);
        const rr = r * (0.7 + 0.5 * hash1(h.seed * 3 + j));
        ctx.globalAlpha = 1;
        ctx.drawImage(dot, this.p.x + Math.cos(a) * d - rr, this.p.y + Math.sin(a) * d - rr, rr * 2, rr * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private bodyPath(ctx: CanvasRenderingContext2D): void {
    const b = this.body;
    const n = b.n;
    const g = b.gapeCount;
    ctx.beginPath();
    ctx.moveTo(b.ux[0], b.uy[0]);
    through(ctx, b.ux, b.uy, 0, n - 1);
    ctx.lineTo(b.bx[n - 1], b.by[n - 1]);
    through(ctx, b.bx, b.by, n - 1, 0);
    ctx.lineTo(b.mlx[0], b.mly[0]);
    through(ctx, b.mlx, b.mly, 0, g - 1);
    ctx.lineTo(b.hingeX, b.hingeY);
    ctx.lineTo(b.mux[g - 1], b.muy[g - 1]);
    through(ctx, b.mux, b.muy, g - 1, 0);
    ctx.closePath();
  }

  private drawBodyTo(ctx: CanvasRenderingContext2D, rc: RenderCtx): void {
    const st = this.state;
    const b = this.body;
    const col = this.col;
    const n = b.n;
    const g = b.gapeCount;
    const scale = this.applyLocal(ctx, rc);
    const sun = rc.light.sunAt(st.y);
    const caust = st.y > 2.4 ? Math.exp(-(st.y - 2.4) / 9) : 0;

    // 压进沉积物的部分被近侧压痕边缘挡住（远侧鳍、尾叶与身体都在边缘之后）
    const sunk = this.contact.sunk;
    if (sunk) {
      ctx.save();
      this.crestClip(ctx);
    }
    // 远侧胸鳍（在身体之后）
    this.drawFin(ctx, true);
    // 尾鳍
    this.drawFluke(ctx);

    // ---- 身体
    this.bodyPath(ctx);
    // 静卧时身体略向镜头一侧侧倾：背部的深色延伸得更低，浅色的腹部更多地转到下方
    const roll = smoothstep(0.25, 0.95, st.rest);
    const grad = ctx.createLinearGradient(0, -1.7, 0, 1.95);
    grad.addColorStop(0, col.dorsal);
    grad.addColorStop(0.45 + 0.08 * roll, col.flank);
    grad.addColorStop(0.66 + 0.08 * roll, col.lowFlank);
    grad.addColorStop(0.8 + 0.07 * roll, col.belly);
    grad.addColorStop(1, col.bellyLight);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // 喉腹褶区域（从下颌到肚脐），张嘴时被撑开变浅
    const iEnd = b.indexAt(0.58);
    const hx = b.hingeX;
    const hy = b.hingeY;
    b.point(0.6, -0.42, this.p);
    const qx = this.p.x;
    const qy = this.p.y;
    const topX = (i: number) => (i < g ? b.mlx[i] : lerp(hx, qx, (b.s[i] - S_GAPE) / (0.6 - S_GAPE)));
    const topY = (i: number) => (i < g ? b.mly[i] : lerp(hy, qy, (b.s[i] - S_GAPE) / (0.6 - S_GAPE)));
    ctx.beginPath();
    ctx.moveTo(topX(0), topY(0));
    for (let i = 1; i <= iEnd; i++) ctx.lineTo(topX(i), topY(i));
    for (let i = iEnd; i >= 0; i--) ctx.lineTo(b.bx[i], b.by[i]);
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, 0, 0, 2.2 + st.throat * 2);
    tg.addColorStop(0, col.lowFlank);
    tg.addColorStop(0.45, col.belly);
    tg.addColorStop(1, col.bellyLight);
    ctx.fillStyle = tg;
    ctx.globalAlpha = 0.55 + 0.45 * st.throat;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 斑驳的花纹
    for (const m of this.mottles) {
      b.point(m.s, m.v, this.p);
      ctx.fillStyle = m.dark ? col.flank : col.belly;
      ctx.globalAlpha = m.dark ? 0.5 : 0.14;
      ctx.beginPath();
      ctx.ellipse(this.p.x, this.p.y, m.r * 1.6, m.r, m.rot * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 喉腹褶线条
    const pleats = 11;
    ctx.lineWidth = Math.min(0.028 + st.throat * 0.03, 2.2 / scale);
    ctx.strokeStyle = st.throat > 0.3 ? col.lowFlank : col.pleat;
    ctx.globalAlpha = 0.42 + 0.2 * st.throat;
    ctx.beginPath();
    const i0 = b.indexAt(0.025);
    for (let j = 1; j <= pleats; j++) {
      const f = Math.pow(j / (pleats + 1), 0.82);
      for (let i = i0; i <= iEnd; i++) {
        const t = (b.s[i] - 0.025) / (0.58 - 0.025);
        const taper = Math.sin(Math.PI * clamp(t)) * 0.25 + 0.75;
        const ff = 1 - (1 - f) * taper;
        const x = lerp(topX(i), b.bx[i], ff);
        const y = lerp(topY(i), b.by[i], ff);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 焦散光网（靠近海面时在皮肤上流动）
    if (rc.quality.caustics && caust > 0.08 && st.tissue > 0.99) {
      const tex = textures().caustic;
      ctx.globalCompositeOperation = 'lighter';
      const tile = 3.2;
      for (let layer = 0; layer < 2; layer++) {
        const ox = ((rc.time * (layer ? 0.21 : -0.17)) % tile) - tile;
        const oy = ((rc.time * (layer ? 0.09 : 0.13)) % tile) - tile;
        ctx.globalAlpha = 0.045 * caust * (layer ? 0.8 : 1) * clamp(90 / scale);
        for (let x = -9 + ox; x < 7.5; x += tile) {
          for (let y = -2.6 + oy; y < 4; y += tile) ctx.drawImage(tex, x, y, tile, tile);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // 体积感：腹侧暗部与背部边缘光（静卧时改由下方按实际接触计算的遮蔽代替这条均匀的暗边）
    ctx.strokeStyle = `rgba(5,12,22,${0.32 * (1 - 0.8 * st.rest)})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(b.bx[0], b.by[0]);
    through(ctx, b.bx, b.by, 0, n - 1);
    ctx.stroke();
    if (sun > 0.05 || st.y < 5) {
      ctx.strokeStyle = rgba(C.rim, 0.22 * Math.max(sun, 0.25));
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(b.ux[0], b.uy[0]);
      through(ctx, b.ux, b.uy, 0, n - 1);
      ctx.stroke();
    }
    // 皮肤纹理
    ctx.globalAlpha = 0.28;
    ctx.drawImage(textures().skin, -8.3, -1.8, 14.4, 4.4);
    ctx.globalAlpha = 1;
    this.drawBodyContactShade(ctx);
    this.drawDeepLight(ctx, rc);
    // 近景：细小的毛孔、斑点与浅浅的褶痕（只铺在镜头附近，开销很小）
    if (scale > 70 && st.tissue > 0.99) this.drawSkinDetail(ctx, rc, scale);
    // 逆光：镜头位于鲸鱼下方时，身体背着明亮的海面变暗，边缘被海面的光勾勒出来
    const below = clamp((rc.cam.cy - st.y - 1.5) / 5);
    const rim = below * clamp(rc.light.sunAt(st.y - 15) * 1.4);
    if (rim > 0.02) {
      ctx.fillStyle = `rgba(6,22,42,${0.4 * rim})`;
      ctx.fillRect(-9.5, -3, 17, 9);
      // 只沿背部上缘：由宽到窄的几层描边在裁剪区内叠出柔和的内侧光边
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.moveTo(b.ux[0], b.uy[0]);
      through(ctx, b.ux, b.uy, 0, n - 1);
      for (const [lw, a] of [
        [0.7, 0.05],
        [0.36, 0.08],
        [0.14, 0.16],
        [0.05, 0.3],
      ] as const) {
        ctx.strokeStyle = `rgba(200,240,255,${a * rim})`;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // 嘴线（闭嘴时为一条带上扬的暗线）
    ctx.strokeStyle = col.socket;
    ctx.lineWidth = Math.min(0.045, 3 / scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.mux[0], b.muy[0]);
    through(ctx, b.mux, b.muy, 0, g - 1);
    ctx.stroke();
    if (st.mouth > 0.02) {
      ctx.beginPath();
      ctx.moveTo(b.mlx[0], b.mly[0]);
      through(ctx, b.mlx, b.mly, 0, g - 1);
      ctx.stroke();
    }

    this.drawTubercles(ctx);
    this.drawBlowhole(ctx);
    this.drawEye(ctx, scale);
    if (sunk) ctx.restore();
    // 近侧胸鳍（在压痕边缘之前，向外展开落在镜头一侧的海床上）
    this.drawFin(ctx, false);
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
      if (g > 0.7) continue;
      const a = 0.16 * (1 - clamp(g / 0.7)) * k;
      if (a < 0.005) continue;
      // 可见的下缘：压痕边缘与腹侧轮廓中较高的一个
      const y = Math.min(c.cy[i], b.by[i]);
      const x = c.d[i] > 0 ? c.cx[i] : b.bx[i];
      const r = 0.55 + 0.25 * clamp(-g / 0.25);
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
    const g = ctx.createLinearGradient(0, -1.9, 0, 1.9);
    g.addColorStop(0, `rgba(180,205,225,${0.11 * deep})`);
    g.addColorStop(0.35, 'rgba(180,205,225,0)');
    g.addColorStop(0.7, 'rgba(3,8,16,0)');
    g.addColorStop(1, `rgba(3,8,16,${0.2 * deep})`);
    ctx.fillStyle = g;
    ctx.fillRect(-9.5, -3, 17, 7);
    ctx.beginPath();
    ctx.moveTo(b.ux[0], b.uy[0]);
    through(ctx, b.ux, b.uy, 0, n - 1);
    ctx.strokeStyle = `rgba(185,220,240,${0.13 * deep})`;
    ctx.lineWidth = 0.16;
    ctx.stroke();
    ctx.strokeStyle = `rgba(200,230,245,${0.12 * deep})`;
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }

  /** 近景皮肤细节：以眼睛附近为中心平铺细节纹理，越近越清晰。 */
  private drawSkinDetail(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number): void {
    const tex = textures().skinDetail;
    const a = clamp((scale - 70) / 220);
    const tile = 0.9;
    this.body.surfaceFrame(S_EYE, 0, this.f);
    // 只覆盖镜头可能看到的范围（以眼睛为中心）
    const span = Math.min(9, (rc.h / scale) * 1.6 + 1);
    const x0 = Math.floor((this.f.x - span) / tile) * tile;
    const y0 = Math.floor((this.f.y - span * 0.6) / tile) * tile;
    ctx.globalAlpha = 0.5 * a;
    for (let x = x0; x < this.f.x + span; x += tile) {
      for (let y = y0; y < this.f.y + span * 0.6; y += tile) ctx.drawImage(tex, x, y, tile, tile);
    }
    // 柔和的顶光：皮肤上方略亮，向下渐暗
    const g = ctx.createRadialGradient(this.f.x - 0.4, this.f.y - 1.2, 0, this.f.x - 0.4, this.f.y - 1.2, 2.6);
    g.addColorStop(0, `rgba(200,225,240,${0.1 * a})`);
    g.addColorStop(1, 'rgba(200,225,240,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(this.f.x - 3, this.f.y - 4, 6, 6);
  }

  private drawFluke(ctx: CanvasRenderingContext2D): void {
    const b = this.body;
    const n = b.n;
    const col = this.col;
    ctx.save();
    // 尾叶里没有骨骼：随软组织一起逐渐消失
    ctx.globalAlpha *= smoothstep(0.12, 0.55, this.state.tissue);
    ctx.translate(b.px[n - 1], b.py[n - 1]);
    // 尾鳍坐标：+x 指向身体后方
    ctx.rotate(b.flukeAngle);
    for (let side = 0; side < 2; side++) {
      const far = side === 0;
      const k = far ? this.kFar : this.kNear;
      ctx.beginPath();
      ctx.moveTo(-0.25, 0.1 * Math.sign(k));
      // 前缘：向后上/后下方后掠到尖端
      ctx.bezierCurveTo(0.3, 0.9 * k, 1.0, 2.0 * k, 1.75, 2.35 * k);
      // 后缘：带锯齿的波浪
      const tipX = 1.75;
      const tipY = 2.35 * k;
      const notchX = 0.95;
      const steps = 7;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = lerp(tipX, notchX, t) - Math.sin(Math.PI * t) * 0.32;
        const y = lerp(tipY, 0.02 * Math.sign(k), t);
        const bump = i % 2 === 0 ? 0.05 : -0.02;
        ctx.lineTo(x + bump, y);
      }
      ctx.lineTo(-0.15, 0);
      ctx.closePath();
      ctx.fillStyle = far ? col.dorsal : col.flank;
      ctx.fill();
      if (!far) {
        ctx.strokeStyle = col.lowFlank;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.04;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /**
   * 胸鳍轮廓（鳍坐标：x 从根部到尖端，负 y 为带结节的前缘）。pose 给出侧视中的长度、宽度比例，
   * 以及远端相对根部的弯折：弯折沿鳍长平滑分布，像一片有骨骼支撑、只在中段略微顺势弯下的鳍。
   */
  private finPath(ctx: CanvasRenderingContext2D, pose: FinPose): void {
    const L = FIN_LEN;
    const n = 36;
    const sl = pose.len;
    const sw = pose.wid;
    const bend = pose.bend;
    // 弯折后的中线（按 t 积分方向角）
    const cxs = this.finCx;
    const cys = this.finCy;
    const ths = this.finTh;
    cxs[0] = 0;
    cys[0] = 0;
    ths[0] = 0;
    for (let i = 1; i <= n; i++) {
      const tm = (i - 0.5) / n;
      const th = bend * smoothstep(0.25, 0.75, tm);
      cxs[i] = cxs[i - 1] + (Math.cos(th) * L * sl) / n;
      cys[i] = cys[i - 1] + (Math.sin(th) * L * sl) / n;
      ths[i] = bend * smoothstep(0.25, 0.75, i / n);
    }
    // 鳍坐标中的点 (x, y) → 弯折后的位置
    const warp = (x: number, y: number, out: { x: number; y: number }) => {
      const t = clamp(x / L, 0, 1);
      const fi = t * n;
      const i = Math.min(n - 1, Math.floor(fi));
      const fr = fi - i;
      const th = lerp(ths[i], ths[i + 1], fr);
      const over = (x - t * L) * sl;
      const px = lerp(cxs[i], cxs[i + 1], fr) + Math.cos(th) * over;
      const py = lerp(cys[i], cys[i + 1], fr) + Math.sin(th) * over;
      const yy = y * sw;
      out.x = px - Math.sin(th) * yy;
      out.y = py + Math.cos(th) * yy;
      return out;
    };
    const q = this.q;
    const r = this.p;
    ctx.beginPath();
    warp(-0.05, -0.2, q);
    ctx.moveTo(q.x, q.y);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = (0.2 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.5))) * (1 - 0.82 * t);
      const knob = t > 0.08 && t < 0.92 ? Math.abs(Math.sin(t * Math.PI * 10)) * 0.045 * (1 - t * 0.5) : 0;
      warp(t * L, -w - knob, q);
      ctx.lineTo(q.x, q.y);
    }
    warp(L + 0.1, 0.02, r);
    warp(L - 0.12, 0.07, q);
    ctx.quadraticCurveTo(r.x, r.y, q.x, q.y);
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const w = 0.04 + 0.34 * Math.pow(1 - t, 1.1) + 0.06 * Math.sin(Math.PI * t);
      warp(t * L, w, q);
      ctx.lineTo(q.x, q.y);
    }
    warp(-0.2, 0.2, r);
    warp(-0.05, -0.2, q);
    ctx.quadraticCurveTo(r.x, r.y, q.x, q.y);
    ctx.closePath();
  }

  private drawFin(ctx: CanvasRenderingContext2D, far: boolean): void {
    const b = this.body;
    const col = this.col;
    const pose = far ? this.finFarPose : this.finPose;
    b.point(S_FIN, far ? -0.32 : -0.5, this.p);
    ctx.save();
    ctx.translate(this.p.x + (far ? 0.25 : 0), this.p.y);
    ctx.rotate(pose.a);
    this.finPath(ctx, pose);
    if (far) {
      ctx.fillStyle = col.flank;
      ctx.fill();
    } else {
      const Lx = FIN_LEN * pose.len;
      const g = ctx.createLinearGradient(0, 0, Lx, 0);
      g.addColorStop(0, col.flank);
      g.addColorStop(0.16, col.lowFlank);
      g.addColorStop(0.32, col.belly);
      g.addColorStop(1, col.fin);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // 前缘的阴影与细小斑点
      ctx.strokeStyle = col.finMottle;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 0.09 * pose.wid;
      ctx.beginPath();
      const q = this.q;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        this.finLocalPoint(pose, 0.2 + t * 4.0, lerp(-0.32, -0.02, t * t), q);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.fillStyle = col.finMottle;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      this.finLocalPoint(pose, 1.7, 0.12, q);
      ctx.ellipse(q.x, q.y, 0.16 * pose.len, 0.06 * pose.wid, 0.1 + pose.bend * 0.3, 0, TAU);
      this.finLocalPoint(pose, 2.5, -0.02, q);
      ctx.moveTo(q.x + 0.09, q.y);
      ctx.ellipse(q.x, q.y, 0.09 * pose.len, 0.04 * pose.wid, pose.bend * 0.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 静卧：鳍贴着沉积物的后缘一侧略暗（与海床之间的细小遮蔽）
      if (pose.bend > 0.02) {
        const k = pose.bend / REST_FIN.bend;
        ctx.strokeStyle = 'rgba(4,10,18,1)';
        ctx.globalAlpha = 0.22 * k;
        ctx.lineWidth = 0.22 * pose.wid;
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) {
          const t = 0.35 + (i / 8) * 0.6;
          this.finLocalPoint(pose, t * FIN_LEN, 0.04 + 0.34 * Math.pow(1 - t, 1.1) + 0.06 * Math.sin(Math.PI * t), q);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.strokeStyle = col.finEdge;
      ctx.lineWidth = 0.025;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 鳍坐标中 (x, y) 经弯折与缩放后的位置（需在 finPath 之后调用，复用其中线） */
  private finLocalPoint(pose: FinPose, x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
    const n = 36;
    const t = clamp(x / FIN_LEN, 0, 1);
    const fi = t * n;
    const i = Math.min(n - 1, Math.floor(fi));
    const fr = fi - i;
    const th = lerp(this.finTh[i], this.finTh[i + 1], fr);
    const px = lerp(this.finCx[i], this.finCx[i + 1], fr);
    const py = lerp(this.finCy[i], this.finCy[i + 1], fr);
    const yy = y * pose.wid;
    out.x = px - Math.sin(th) * yy;
    out.y = py + Math.cos(th) * yy;
    return out;
  }

  private drawTubercles(ctx: CanvasRenderingContext2D): void {
    const b = this.body;
    const col = this.col;
    ctx.fillStyle = col.tubercle;
    // 吻部背侧的两列结节
    for (let i = 0; i < 9; i++) {
      const s = 0.022 + i * 0.019;
      b.point(s, 0.93, this.p);
      ctx.beginPath();
      ctx.arc(this.p.x, this.p.y, 0.055, 0, TAU);
      ctx.fill();
      if (i % 2 === 0 && i > 0) {
        b.point(s + 0.008, 0.62, this.p);
        ctx.beginPath();
        ctx.arc(this.p.x, this.p.y, 0.045, 0, TAU);
        ctx.fill();
      }
    }
    // 下颌边缘的结节与藤壶（随下颌一起转动）
    const g = b.gapeCount;
    const c = Math.cos(b.jawAngle);
    const sn = Math.sin(b.jawAngle);
    for (let i = 1; i < Math.min(g, 8); i += 1) {
      const x = b.mlx[i] + (-sn) * 0 + sn * 0.0;
      const y = b.mly[i];
      const ox = -sn * 0.16;
      const oy = c * 0.16;
      ctx.fillStyle = col.tubercle;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, 0.045, 0, TAU);
      ctx.fill();
      if (i === 2 || i === 4) {
        ctx.fillStyle = col.barnacle;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(x + ox * 2.2, y + oy * 2.2, 0.06, 0, TAU);
        ctx.arc(x + ox * 2.6 + 0.08, y + oy * 2.6, 0.045, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawBlowhole(ctx: CanvasRenderingContext2D): void {
    const b = this.body;
    b.point(S_BLOW + 0.012, 1, this.p);
    const x = this.p.x;
    const y = this.p.y;
    ctx.fillStyle = this.col.flank;
    ctx.beginPath();
    ctx.ellipse(x + 0.2, y - 0.02, 0.32, 0.07, 0, Math.PI, TAU);
    ctx.fill();
    ctx.strokeStyle = this.col.socket;
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(x - 0.12, y + 0.03);
    ctx.quadraticCurveTo(x + 0.02, y - 0.03, x + 0.16, y + 0.02);
    ctx.stroke();
  }

  private drawEye(ctx: CanvasRenderingContext2D, scale: number): void {
    const st = this.state;
    const b = this.body;
    const col = this.col;
    b.surfaceFrame(S_EYE, 0.0, this.f);
    const ex = this.f.x;
    const ey = this.f.y;
    const r = 0.085;
    const detail = scale * r; // 眼睛半径的屏幕像素
    // 眼窝
    ctx.fillStyle = col.socket;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 2.5, r * 1.75, -0.08, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (detail > 6) {
      // 眼周皱褶：上下各两三道不完整的弧线
      ctx.strokeStyle = col.socket;
      ctx.lineCap = 'round';
      ctx.globalAlpha = clamp((detail - 6) / 20) * 0.45;
      const arcs: Array<[number, number, number, number, number]> = [
        [1.55, 1.15, 1.12, 1.88, 0.07],
        [1.95, 1.4, 1.2, 1.75, 0.05],
        [2.35, 1.6, 1.28, 1.6, 0.035],
        [1.6, 1.05, 0.2, 0.75, 0.06],
        [2.05, 1.3, 0.3, 0.62, 0.04],
      ];
      for (const [kx, ky, a0, a1, lw] of arcs) {
        ctx.lineWidth = r * lw;
        ctx.beginPath();
        ctx.ellipse(ex - r * 0.12, ey + r * 0.04, r * kx, r * ky, -0.06, Math.PI * a0, Math.PI * a1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // 眼球
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 1.2, r * 0.88, -0.08, 0, TAU);
    ctx.clip();
    ctx.fillStyle = col.eyeBall;
    ctx.fill();
    if (detail > 4) {
      const ig = ctx.createRadialGradient(ex + r * 0.1, ey, r * 0.1, ex, ey, r * 0.95);
      ig.addColorStop(0, col.eyeBall);
      ig.addColorStop(0.55, col.iris);
      ig.addColorStop(1, col.eyeBall);
      ctx.fillStyle = ig;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.95, r * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = col.eyeBall;
      ctx.beginPath();
      ctx.ellipse(ex + r * 0.05, ey, r * 0.45, r * 0.3, 0, 0, TAU);
      ctx.fill();
    }
    // 湿润的高光
    ctx.fillStyle = 'rgba(235,245,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(ex - r * 0.42, ey - r * 0.36, r * 0.2, r * 0.13, -0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,225,245,0.35)';
    ctx.beginPath();
    ctx.ellipse(ex + r * 0.45, ey + r * 0.3, r * 0.12, r * 0.07, -0.5, 0, TAU);
    ctx.fill();
    // 眼睑：上睑下垂、下睑微抬，在略低于中线处相合，形成平静的弧线
    const e = clamp(st.eye);
    const upY = lerp(ey + r * 0.22, ey - r * 1.0, e);
    const loY = lerp(ey + r * 0.26, ey + r * 0.95, e);
    ctx.fillStyle = col.lid;
    ctx.beginPath();
    ctx.moveTo(ex - r * 1.4, ey - r * 1.2);
    ctx.lineTo(ex + r * 1.4, ey - r * 1.2);
    ctx.lineTo(ex + r * 1.4, upY - r * 0.1);
    ctx.quadraticCurveTo(ex, upY + r * 0.35 * (1 - e * 0.6), ex - r * 1.4, upY - r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ex - r * 1.4, ey + r * 1.2);
    ctx.lineTo(ex + r * 1.4, ey + r * 1.2);
    ctx.lineTo(ex + r * 1.4, loY + r * 0.1);
    ctx.quadraticCurveTo(ex, loY + r * 0.3 * e, ex - r * 1.4, loY + r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 眼睑边缘与褶线
    ctx.strokeStyle = col.socket;
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - r * 1.2, upY - r * 0.05);
    ctx.quadraticCurveTo(ex, upY + r * 0.35 * (1 - e * 0.6), ex + r * 1.2, upY - r * 0.05);
    ctx.stroke();
    if (detail > 5) {
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(ex - r * 1.1, upY - r * 0.42);
      ctx.quadraticCurveTo(ex, upY - r * 0.1 - r * 0.25 * e, ex + r * 1.15, upY - r * 0.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
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
