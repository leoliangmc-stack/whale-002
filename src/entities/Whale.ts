import { hex, makeShade, mixRGB, rgba, shadeRGB, type RGB, type Shade } from '../core/color';
import { clamp, hash1, lerp, rng, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import { mouthY, S_BLOW, S_EYE, S_FIN, S_GAPE, WhaleBody, type WhaleShape } from './WhaleBody';
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
}

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
  private readonly f = { x: 0, y: 0, a: 0 };
  /** 局部绘制变换在屏幕上的包围盒（像素，用于分解图层裁剪） */
  private bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  finAngle = Math.PI - 0.62;
  finFarAngle = Math.PI - 0.62;

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
    this.finAngle = this.finFor(st.finN);
    this.finFarAngle = this.finFor(st.finF);
  }

  /**
   * 胸鳍角度：游动时向后下方，滤食时外展；失去生命后保持自然展开，
   * 只随水流被动摆动（passive 由下沉动作层给出）；静卧时贴向海床。
   */
  private finFor(passive: number): number {
    const st = this.state;
    const swimFin = Math.PI - 0.62 + 0.12 * Math.sin(this.phase * 0.5 + 0.8) * st.swim;
    const feedFin = Math.PI - 1.15;
    const limpFin = Math.PI - 0.8 + passive;
    const restFin = Math.PI - 0.28;
    let a = lerp(limpFin, swimFin, st.life);
    a = lerp(a, feedFin, smoothstep(0.1, 0.8, st.mouth) * st.life);
    return lerp(a, restFin, st.rest);
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
    this.body.frame(S_EYE, 0.02, this.f);
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
    const decaying = st.tissue < 0.999;
    if (decaying) {
      // 骨骼在身体之后
      this.skeleton.draw(rc, this.body, st, this.finAngle);
      if (st.tissue <= 0.002) return;
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
    }
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

    // 远侧胸鳍（在身体之后）
    this.drawFin(ctx, true);
    // 尾鳍
    this.drawFluke(ctx);

    // ---- 身体
    this.bodyPath(ctx);
    const grad = ctx.createLinearGradient(0, -1.7, 0, 1.95);
    grad.addColorStop(0, col.dorsal);
    grad.addColorStop(0.45, col.flank);
    grad.addColorStop(0.66, col.lowFlank);
    grad.addColorStop(0.8, col.belly);
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

    // 体积感：腹侧暗部与背部边缘光
    ctx.strokeStyle = 'rgba(5,12,22,0.32)';
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
    // 近侧胸鳍
    this.drawFin(ctx, false);
  }

  /** 近景皮肤细节：以眼睛附近为中心平铺细节纹理，越近越清晰。 */
  private drawSkinDetail(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number): void {
    const tex = textures().skinDetail;
    const a = clamp((scale - 70) / 220);
    const tile = 0.9;
    this.body.frame(S_EYE, 0, this.f);
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
      const k = far ? -0.4 : 0.52;
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

  private finPath(ctx: CanvasRenderingContext2D): void {
    // 胸鳍平面：x 从根部到尖端，负 y 为带结节的前缘
    const L = 4.3;
    const n = 36;
    ctx.beginPath();
    ctx.moveTo(-0.05, -0.2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = (0.2 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.5))) * (1 - 0.82 * t);
      const knob = t > 0.08 && t < 0.92 ? Math.abs(Math.sin(t * Math.PI * 10)) * 0.045 * (1 - t * 0.5) : 0;
      ctx.lineTo(t * L, -w - knob);
    }
    ctx.quadraticCurveTo(L + 0.1, 0.02, L - 0.12, 0.07);
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const w = 0.04 + 0.34 * Math.pow(1 - t, 1.1) + 0.06 * Math.sin(Math.PI * t);
      ctx.lineTo(t * L, w);
    }
    ctx.quadraticCurveTo(-0.2, 0.2, -0.05, -0.2);
    ctx.closePath();
  }

  private drawFin(ctx: CanvasRenderingContext2D, far: boolean): void {
    const b = this.body;
    const col = this.col;
    b.point(S_FIN, far ? -0.32 : -0.5, this.p);
    ctx.save();
    ctx.translate(this.p.x + (far ? 0.25 : 0), this.p.y);
    ctx.rotate(far ? this.finFarAngle + 0.14 : this.finAngle);
    if (far) ctx.scale(0.92, 0.85);
    this.finPath(ctx);
    if (far) {
      ctx.fillStyle = col.flank;
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, 4.3, 0);
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
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.moveTo(0.2, -0.32);
      ctx.quadraticCurveTo(2.2, -0.3, 4.2, -0.02);
      ctx.stroke();
      ctx.fillStyle = col.finMottle;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.ellipse(1.7, 0.12, 0.16, 0.06, 0.1, 0, TAU);
      ctx.ellipse(2.5, -0.02, 0.09, 0.04, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.strokeStyle = col.finEdge;
      ctx.lineWidth = 0.025;
      ctx.stroke();
    }
    ctx.restore();
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
    b.frame(S_EYE, 0.0, this.f);
    const ex = this.f.x;
    const ey = this.f.y + mouthY(S_GAPE) * 0.0;
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
