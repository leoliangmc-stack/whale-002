import { hex, shade, type Shade } from '../../core/color';
import { clamp, damp, lerp, noise1, TAU } from '../../core/math';
import type { Projected } from '../../core/Camera';
import type { RenderCtx } from '../../core/types';
import { Creature, drawGlow, glowFade, glowSprite, SEABED, wanderSteer, type CreatureEnv } from './base';

/** 中层水域与近底层的漂游生物：鱼群、灯笼鱼、栉水母、冠水母、管水母、小飞象章鱼。 */

const P: Projected = { x: 0, y: 0, s: 0 };
const V = { x: 0, y: 0, z: 0 };

const C = {
  fishBack: hex('#3f5a70'),
  fishSilver: hex('#c3d0d9'),
  fishEye: hex('#0e1418'),
  lantern: hex('#2c2a33'),
  lanternBelly: hex('#4d4a55'),
  combBody: hex('#cfe6f2'),
  atolla: hex('#7c1a2a'),
  atollaDark: hex('#4a0f19'),
  atollaRim: hex('#a8303f'),
  siph: hex('#d9ecf5'),
  siphBell: hex('#b9dcef'),
  dumbo: hex('#ebb9a5'),
  dumboDark: hex('#c98c79'),
  dumboWeb: hex('#f3cdbf'),
  eye: hex('#1a1214'),
};

// ------------------------------------------------------------------ 鱼群

/** 银色小鱼群（简化的 boids：凝聚 + 对齐 + 噪声）。 */
export class FishSchool extends Creature {
  readonly info = 'fishSchool';
  readonly n: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly fvx: Float32Array;
  private readonly fvy: Float32Array;
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly oz: Float32Array;
  private dir = 1;

  constructor(
    seed: number,
    count: number,
    private readonly ax: number,
    private readonly ay: number,
    az: number,
    private readonly span: number,
    readonly fishLen = 0.22,
  ) {
    super(seed);
    this.custom = true;
    this.midwater = true;
    this.n = count;
    this.radius = 3;
    this.size = 4;
    const mk = () => new Float32Array(count);
    this.px = mk();
    this.py = mk();
    this.pz = mk();
    this.fvx = mk();
    this.fvy = mk();
    this.ox = mk();
    this.oy = mk();
    this.oz = mk();
    this.x = ax;
    this.y = ay;
    this.z = az;
    this.dir = this.rand() > 0.5 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      // 鱼群呈扁长的椭球
      const a = this.rand() * TAU;
      const r = Math.sqrt(this.rand());
      this.ox[i] = Math.cos(a) * r * 2.6;
      this.oy[i] = Math.sin(a) * r * 1.1;
      this.oz[i] = (this.rand() - 0.5) * 2.4;
      this.px[i] = ax + this.ox[i];
      this.py[i] = ay + this.oy[i];
      this.pz[i] = az + this.oz[i];
      this.fvx[i] = this.dir * 0.9;
    }
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'story' ? 1 : 0;
  }

  spawn(): void {}

  step(dt: number, env: CreatureEnv): void {
    const t = this.clock;
    // 鱼群中心沿 x 往返游动，带缓慢的上下起伏
    const speed = env.reduced ? 0.6 : 0.95;
    this.x += this.dir * speed * dt;
    if (this.x > this.ax + this.span) this.dir = -1;
    if (this.x < this.ax - this.span) this.dir = 1;
    this.y = this.ay + Math.sin(t * 0.13 + this.phase) * 1.6;
    const cvx = this.dir * speed;
    const swirl = t * 0.25;
    const cs = Math.cos(swirl);
    const sn = Math.sin(swirl);
    for (let i = 0; i < this.n; i++) {
      const ox = this.ox[i] * (0.85 + 0.15 * Math.sin(t * 0.4 + i));
      const oy = this.oy[i] * cs + this.oz[i] * 0.2 * sn;
      const tx = this.x + ox;
      const ty = this.y + oy;
      const wob = noise1(t * 0.7 + i * 3.7, 3) * 0.35;
      const dvx = cvx + (tx - this.px[i]) * 0.9 + wob;
      const dvy = (ty - this.py[i]) * 0.9 + noise1(t * 0.6 + i * 5.1, 9) * 0.2;
      this.fvx[i] = damp(this.fvx[i], dvx, 2.2, dt);
      this.fvy[i] = damp(this.fvy[i], dvy, 2.2, dt);
      this.px[i] += this.fvx[i] * dt;
      this.py[i] += this.fvy[i] * dt;
      this.pz[i] = this.z + this.oz[i];
    }
  }

  render(): void {}

  drawCustom(rc: RenderCtx, sh: Shade): void {
    const { ctx, cam, dpr } = rc;
    const L = this.fishLen;
    const back = shade(C.fishBack, sh);
    const silver = shade(C.fishSilver, sh, 1, 0.15);
    const eye = shade(C.fishEye, sh);
    const shimmer = this.clock;
    for (let i = 0; i < this.n; i++) {
      if (!cam.project(this.px[i], this.py[i], this.pz[i], P)) continue;
      if (P.x < -40 || P.x > rc.w + 40 || P.y < -40 || P.y > rc.h + 40) continue;
      const len = L * P.s;
      const vx = this.fvx[i];
      const vy = this.fvy[i];
      const sp = Math.hypot(vx, vy) || 1;
      if (len < 5) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = silver;
        ctx.lineWidth = Math.max(0.6, len * 0.3);
        ctx.beginPath();
        ctx.moveTo(P.x - (vx / sp) * len * 0.5, P.y - (vy / sp) * len * 0.5);
        ctx.lineTo(P.x + (vx / sp) * len * 0.5, P.y + (vy / sp) * len * 0.5);
        ctx.stroke();
        continue;
      }
      const face = vx >= 0 ? 1 : -1;
      const tilt = Math.atan2(vy, Math.abs(vx));
      cam.applyTransform(ctx, dpr, this.px[i], this.py[i], this.pz[i], face * tilt, face < 0);
      const tail = Math.sin(shimmer * 9 + i * 1.7) * 0.25;
      ctx.fillStyle = silver;
      ctx.beginPath();
      ctx.moveTo(L * 0.5, 0);
      ctx.quadraticCurveTo(L * 0.15, -L * 0.2, -L * 0.3, -L * 0.04);
      ctx.lineTo(-L * 0.5, -L * (0.14 + tail * 0.1));
      ctx.lineTo(-L * 0.44, 0);
      ctx.lineTo(-L * 0.5, L * (0.14 - tail * 0.1));
      ctx.lineTo(-L * 0.3, L * 0.04);
      ctx.quadraticCurveTo(L * 0.15, L * 0.17, L * 0.5, 0);
      ctx.fill();
      ctx.fillStyle = back;
      ctx.beginPath();
      ctx.moveTo(L * 0.46, -L * 0.02);
      ctx.quadraticCurveTo(L * 0.15, -L * 0.2, -L * 0.32, -L * 0.03);
      ctx.quadraticCurveTo(L * 0.1, -L * 0.06, L * 0.46, -L * 0.02);
      ctx.fill();
      if (len > 12) {
        ctx.fillStyle = eye;
        ctx.beginPath();
        ctx.arc(L * 0.36, -L * 0.03, L * 0.04, 0, TAU);
        ctx.fill();
      }
    }
  }

  hitPoint(): { x: number; y: number; z: number } {
    return this;
  }

  nearestDist(rc: RenderCtx, sx: number, sy: number): number {
    return nearest(rc, this.px, this.py, this.pz, this.n, sx, sy);
  }
}

/** 一组个体在屏幕上离点击点的最近距离（像素）。 */
function nearest(rc: RenderCtx, xs: Float32Array, ys: Float32Array, zs: Float32Array | number, n: number, sx: number, sy: number): number {
  let bd = 1e9;
  for (let i = 0; i < n; i++) {
    const z = typeof zs === 'number' ? zs : zs[i];
    if (!rc.cam.project(xs[i], ys[i], z, P)) continue;
    const d = Math.hypot(P.x - sx, P.y - sy);
    if (d < bd) bd = d;
  }
  return bd;
}

// ------------------------------------------------------------------ 灯笼鱼

/** 灯笼鱼小群：深色身体，腹侧一排青色发光器。 */
export class LanternfishGroup extends Creature {
  readonly info = 'lanternfish';
  private readonly n: number;
  private readonly fx: Float32Array;
  private readonly fy: Float32Array;
  private readonly fz: Float32Array;
  private readonly fvx: Float32Array;
  private readonly fvy: Float32Array;
  private readonly fyaw: Float32Array;
  private readonly fph: Float32Array;

  constructor(seed: number, count: number, readonly ax: number, readonly ay: number, readonly az: number) {
    super(seed);
    this.custom = true;
    this.midwater = true;
    this.radius = 1.5;
    this.size = 2;
    this.n = count;
    const mk = () => new Float32Array(count);
    this.fx = mk();
    this.fy = mk();
    this.fz = mk();
    this.fvx = mk();
    this.fvy = mk();
    this.fyaw = mk();
    this.fph = mk();
    this.x = ax;
    this.y = ay;
    this.z = az;
    for (let i = 0; i < count; i++) {
      this.fx[i] = ax + (this.rand() - 0.5) * 4;
      this.fy[i] = ay + (this.rand() - 0.5) * 2.5;
      this.fz[i] = az + (this.rand() - 0.5) * 3;
      this.fph[i] = this.rand() * TAU;
      this.fyaw[i] = this.rand() > 0.5 ? 0 : Math.PI;
    }
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'story' ? 1 : 0;
  }

  spawn(): void {}

  step(dt: number): void {
    const t = this.clock;
    this.x = this.ax + Math.sin(t * 0.05 + this.phase) * 6;
    for (let i = 0; i < this.n; i++) {
      const ph = this.fph[i];
      const tx = this.x + Math.sin(t * 0.17 + ph) * 2.2;
      const ty = this.ay + Math.sin(t * 0.11 + ph * 1.7) * 1.4;
      const dvx = (tx - this.fx[i]) * 0.35 + Math.sin(t * 0.5 + ph) * 0.08;
      const dvy = (ty - this.fy[i]) * 0.35;
      this.fvx[i] = damp(this.fvx[i], dvx, 1.2, dt);
      this.fvy[i] = damp(this.fvy[i], dvy, 1.2, dt);
      this.fx[i] += this.fvx[i] * dt;
      this.fy[i] += this.fvy[i] * dt;
      if (Math.abs(this.fvx[i]) > 0.03) this.fyaw[i] = damp(this.fyaw[i], this.fvx[i] >= 0 ? 0 : Math.PI, 2, dt);
    }
  }

  render(): void {}

  drawCustom(rc: RenderCtx, sh: Shade): void {
    const { ctx, cam, dpr } = rc;
    const L = 0.24;
    const body = shade(C.lantern, sh, 1, 0.2);
    const belly = shade(C.lanternBelly, sh, 1, 0.2);
    const spr = glowSprite(54, 200, 197);
    const gf = glowFade(sh);
    for (let i = 0; i < this.n; i++) {
      if (!cam.project(this.fx[i], this.fy[i], this.fz[i], P)) continue;
      if (P.x < -30 || P.x > rc.w + 30 || P.y < -30 || P.y > rc.h + 30) continue;
      const len = L * P.s;
      cam.applyTransform(ctx, dpr, this.fx[i], this.fy[i], this.fz[i], 0, false);
      const c = Math.cos(this.fyaw[i]);
      ctx.scale(Math.abs(c) < 0.12 ? 0.12 * Math.sign(c || 1) : c, 1);
      if (len > 4) {
        const tw = Math.sin(this.clock * 7 + this.fph[i]) * 0.04;
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(L * 0.5, 0.005);
        ctx.quadraticCurveTo(L * 0.3, -L * 0.2, -L * 0.25, -L * 0.07);
        ctx.lineTo(-L * 0.5, -L * 0.16 + tw);
        ctx.lineTo(-L * 0.45, tw * 0.5);
        ctx.lineTo(-L * 0.5, L * 0.15 + tw);
        ctx.lineTo(-L * 0.25, L * 0.07);
        ctx.quadraticCurveTo(L * 0.3, L * 0.18, L * 0.5, 0.005);
        ctx.fill();
        ctx.fillStyle = belly;
        ctx.beginPath();
        ctx.ellipse(L * 0.33, -L * 0.02, L * 0.075, L * 0.07, 0, 0, TAU);
        ctx.fill();
      }
      // 发光器
      const pulse = 0.65 + 0.35 * Math.sin(this.clock * 0.8 + this.fph[i]);
      const r = Math.max(L * 0.06, 2.2 / P.s);
      for (let k = 0; k < 6; k++) {
        const px = L * (0.28 - k * 0.11);
        drawGlow(ctx, spr, px, L * 0.1 - Math.abs(k - 2.5) * 0.003, r * 1.6, 0.8 * pulse * gf);
      }
    }
  }

  nearestDist(rc: RenderCtx, sx: number, sy: number): number {
    return nearest(rc, this.fx, this.fy, this.fz, this.n, sx, sy);
  }
}

// ------------------------------------------------------------------ 栉水母

/** 栉水母：透明的身体与八列闪烁彩虹光的栉板。 */
export class CombJelly extends Creature {
  readonly info: string = 'combJelly';
  protected ax: number;
  protected ay: number;
  protected az: number;
  protected glowing = false;

  constructor(seed: number, ax: number, ay: number, az: number, readonly bodyLen = 0.45) {
    super(seed);
    this.midwater = true;
    this.radius = 0.4;
    this.size = bodyLen;
    this.ax = ax;
    this.ay = ay;
    this.az = az;
    this.x = ax;
    this.y = ay;
    this.z = az;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'story' ? 1 : 0;
  }

  spawn(): void {}

  step(dt: number): void {
    const t = this.clock;
    wanderSteer(this, this.ax, this.ay, this.az, 3, 0.12, t, V);
    this.vx = damp(this.vx, V.x, 0.8, dt);
    this.vy = damp(this.vy, V.y, 0.8, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.tilt = Math.sin(t * 0.23 + this.phase) * 0.5 - 0.3;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const L = this.bodyLen;
    const W = L * 0.42;
    const t = this.clock;
    ctx.fillStyle = shade(C.combBody, sh, 0.16, 0.4);
    ctx.strokeStyle = shade(C.combBody, sh, 0.35, 0.4);
    ctx.lineWidth = Math.max(0.004, 0.8 / scale);
    // 身体（竖直的卵形，口端朝下）
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.5);
    ctx.bezierCurveTo(W * 1.1, -L * 0.45, W * 1.05, L * 0.35, W * 0.35, L * 0.5);
    ctx.lineTo(-W * 0.35, L * 0.5);
    ctx.bezierCurveTo(-W * 1.05, L * 0.35, -W * 1.1, -L * 0.45, 0, -L * 0.5);
    ctx.fill();
    ctx.stroke();
    if (scale * L < 5) return;
    // 栉板：沿子午线排列的短横纹，彩虹色光波由上往下流动
    const rows = [-0.8, -0.32, 0.32, 0.8];
    const segs = 11;
    ctx.lineWidth = Math.max(0.004, L * 0.022);
    ctx.lineCap = 'round';
    for (let r = 0; r < rows.length; r++) {
      const off = rows[r];
      for (let k = 0; k < segs; k++) {
        const u = k / (segs - 1);
        const yy = lerp(-L * 0.4, L * 0.38, u);
        const bulge = Math.sin(Math.PI * (u * 0.9 + 0.05));
        const xx = off * W * bulge;
        const hue = (200 + t * 90 + k * 26 + r * 40) % 360;
        const wave = 0.5 + 0.5 * Math.sin(t * 5 - k * 0.8 + r);
        ctx.strokeStyle = `hsla(${hue | 0},85%,72%,${(0.12 + 0.5 * wave) * (1 - sh.fog * 0.7)})`;
        ctx.beginPath();
        ctx.moveTo(xx - L * 0.035, yy);
        ctx.lineTo(xx + L * 0.035, yy - L * 0.006);
        ctx.stroke();
      }
    }
    // 内部的消化道
    ctx.strokeStyle = shade(C.combBody, sh, 0.3, 0.2);
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.3);
    ctx.lineTo(0, L * 0.42);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ 冠水母

/** 冠水母（Atolla）：深红色伞体，受扰时伞缘会出现旋转的蓝色光环（“防盗警报”）。 */
export class Atolla extends Creature {
  readonly info = 'atolla';
  private pulse = 0;
  private nextFlash: number;

  constructor(seed: number, readonly ax: number, readonly ay: number, readonly az: number, readonly nearBones = false) {
    super(seed);
    this.midwater = !nearBones;
    this.radius = 0.5;
    this.size = 0.55;
    this.x = ax;
    this.y = ay;
    this.z = az;
    this.nextFlash = 3 + this.rand() * 8;
  }

  driver(env: CreatureEnv): number {
    if (this.nearBones) return env.mode === 'explore' ? 1 : env.eco.dwellers;
    return env.mode === 'story' ? 1 : 0;
  }

  spawn(): void {
    this.x = this.ax + (this.rand() - 0.5) * 2;
    this.y = this.ay - 3;
  }

  step(dt: number): void {
    const t = this.clock;
    // 伞体收缩—舒张的节律推进
    const period = 2.8 + (this.seed % 5) * 0.25;
    this.pulse = (t / period + this.phase) % 1;
    const thrust = Math.pow(Math.max(0, Math.sin(this.pulse * TAU)), 3) * 0.12;
    this.vy = damp(this.vy, -thrust + 0.025 + (this.ay - this.y) * 0.03, 1.5, dt);
    this.vx = damp(this.vx, Math.sin(t * 0.07 + this.phase) * 0.06 + (this.ax - this.x) * 0.02, 0.5, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.y = Math.min(this.y, this.nearBones ? SEABED - 3 : this.y);
    this.tilt = Math.sin(t * 0.17 + this.phase) * 0.18;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const t = this.clock;
    const contr = Math.pow(Math.max(0, Math.sin(this.pulse * TAU)), 2);
    const W = 0.27 * (1 - contr * 0.12);
    const H = 0.11 * (1 + contr * 0.2);
    // 触手（先画在伞体后面）
    ctx.strokeStyle = shade(C.atollaRim, sh, 0.5, 0.8);
    ctx.lineWidth = Math.max(0.004, 0.7 / scale);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const x0 = lerp(-W * 0.9, W * 0.9, i / 8);
      const len = 0.18 + (i % 3) * 0.07;
      const sway = Math.sin(t * 0.9 + i) * 0.03;
      ctx.moveTo(x0, H * 0.25);
      ctx.quadraticCurveTo(x0 + sway, H * 0.25 + len * 0.5, x0 + sway * 2, H * 0.25 + len);
    }
    // 一条特别长的触手
    ctx.moveTo(W * 0.2, H * 0.3);
    ctx.bezierCurveTo(W * 0.6, 0.35, -W * 0.4 + Math.sin(t * 0.5) * 0.08, 0.6, W * 0.1, 0.95);
    ctx.stroke();
    // 伞体
    const g = ctx.createRadialGradient(0, -H * 0.3, 0, 0, 0, W * 1.1);
    g.addColorStop(0, shade(C.atollaDark, sh, 0.95, 0.9));
    g.addColorStop(0.6, shade(C.atolla, sh, 0.92, 0.9));
    g.addColorStop(1, shade(C.atollaRim, sh, 0.8, 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-W, H * 0.3);
    ctx.bezierCurveTo(-W * 1.02, -H * 0.6, -W * 0.45, -H * 1.1, 0, -H * 1.12);
    ctx.bezierCurveTo(W * 0.45, -H * 1.1, W * 1.02, -H * 0.6, W, H * 0.3);
    // 伞缘的小瓣
    const lobes = 10;
    for (let i = lobes; i >= 0; i--) {
      const x = lerp(-W, W, i / lobes);
      ctx.lineTo(x, H * 0.3 + (i % 2 ? H * 0.22 : 0));
    }
    ctx.closePath();
    ctx.fill();
    // 冠沟与中央隆起
    if (scale * W > 8) {
      ctx.strokeStyle = shade(C.atollaDark, sh, 0.6);
      ctx.lineWidth = Math.max(0.004, 0.9 / scale);
      ctx.beginPath();
      ctx.ellipse(0, -H * 0.15, W * 0.62, H * 0.35, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
    }
    // 生物发光：沿伞缘传递的蓝色光环，缓慢起伏（不闪烁）
    const since = t - this.nextFlash;
    if (since > 7) this.nextFlash = t + 6 + this.rand() * 9;
    const env = since > 0 ? Math.sin(clamp(since / 6.5) * Math.PI) : 0;
    const gf = glowFade(sh);
    const spr = glowSprite(70, 160, 255);
    const base = 0.22;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const lx = Math.cos(a) * W * 0.95;
      const ly = H * 0.25 + Math.sin(a) * H * 0.18;
      const wave = 0.5 + 0.5 * Math.sin(a * 2 - since * 3.5);
      drawGlow(ctx, spr, lx, ly, Math.max(0.035, 3 / scale), (base + env * wave * 0.9) * gf);
    }
  }
}

// ------------------------------------------------------------------ 管水母

/** 管水母：由许多个体组成的长链，缓缓漂动，链上点缀微弱的蓝白色光点。 */
export class Siphonophore extends Creature {
  readonly info: string = 'siphonophore';
  protected readonly n = 26;
  protected readonly cx: Float32Array;
  protected readonly cy: Float32Array;
  protected readonly segLen: number;
  protected ax: number;
  protected ay: number;
  protected az: number;

  constructor(seed: number, ax: number, ay: number, az: number, length = 4.5) {
    super(seed);
    this.custom = true;
    this.midwater = true;
    this.radius = 0.8;
    this.size = length;
    this.ax = ax;
    this.ay = ay;
    this.az = az;
    this.x = ax;
    this.y = ay;
    this.z = az;
    this.segLen = length / this.n;
    this.cx = new Float32Array(this.n);
    this.cy = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.cx[i] = ax - i * this.segLen * 0.6;
      this.cy[i] = ay + i * this.segLen * 0.8;
    }
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'story' ? 1 : 0;
  }

  spawn(): void {}

  step(dt: number): void {
    const t = this.clock;
    wanderSteer(this, this.ax, this.ay, this.az, 4, 0.18, t * 0.6, V);
    this.vx = damp(this.vx, V.x, 0.5, dt);
    this.vy = damp(this.vy, V.y * 0.6, 0.5, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.cx[0] = this.x;
    this.cy[0] = this.y;
    for (let i = 1; i < this.n; i++) {
      // 跟随前一节，带轻微下垂与波动
      const sway = Math.sin(t * 0.6 - i * 0.35 + this.phase) * 0.012;
      let dx = this.cx[i] - this.cx[i - 1] + sway;
      let dy = this.cy[i] - this.cy[i - 1] + 0.02;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      this.cx[i] = this.cx[i - 1] + dx * this.segLen;
      this.cy[i] = this.cy[i - 1] + dy * this.segLen;
    }
  }

  render(): void {}

  drawCustom(rc: RenderCtx, sh: Shade): void {
    const { ctx, cam, dpr } = rc;
    const scale = cam.applyTransform(ctx, dpr, this.x, this.y, this.z, 0, false);
    const ox = this.x;
    const oy = this.y;
    const t = this.clock;
    // 主干
    ctx.strokeStyle = shade(C.siph, sh, 0.45, 0.3);
    ctx.lineWidth = Math.max(0.018, 1 / scale);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 1; i < this.n; i++) ctx.lineTo(this.cx[i] - ox, this.cy[i] - oy);
    ctx.stroke();
    // 游泳钟（顶部的一簇透明小钟）
    ctx.fillStyle = shade(C.siphBell, sh, 0.28, 0.3);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse((this.cx[k] - ox) + (k % 2 ? 0.07 : -0.07), this.cy[k] - oy, 0.1, 0.08, 0, 0, TAU);
      ctx.fill();
    }
    if (scale * this.segLen > 3) {
      // 垂下的捕食触手
      ctx.strokeStyle = shade(C.siph, sh, 0.18, 0.3);
      ctx.lineWidth = Math.max(0.003, 0.5 / scale);
      ctx.beginPath();
      for (let i = 4; i < this.n; i += 2) {
        const x0 = this.cx[i] - ox;
        const y0 = this.cy[i] - oy;
        const sway = Math.sin(t * 0.7 + i) * 0.05;
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + 0.08 + sway, y0 + 0.2, x0 + 0.05 + sway * 2, y0 + 0.42);
      }
      ctx.stroke();
    }
    // 微弱的生物发光
    const spr = glowSprite(150, 215, 255);
    const gf = glowFade(sh);
    for (let i = 3; i < this.n; i += 2) {
      const w = 0.45 + 0.55 * Math.sin(t * 0.9 - i * 0.5 + this.phase);
      drawGlow(ctx, spr, this.cx[i] - ox, this.cy[i] - oy, Math.max(0.09, 4 / scale), 0.45 * w * gf);
    }
  }

  hitPoint(): { x: number; y: number; z: number } {
    return this;
  }

  nearestDist(rc: RenderCtx, sx: number, sy: number): number {
    return nearest(rc, this.cx, this.cy, this.z, this.n, sx, sy);
  }
}

// ------------------------------------------------------------------ 小飞象章鱼

/** 小飞象章鱼：扇动“耳朵”般的鳍，在海底附近缓慢悬游。 */
export class Dumbo extends Creature {
  readonly info = 'dumbo';
  private fin = 0;
  private glide = 0;

  constructor(seed: number, readonly ax: number, readonly ay: number, readonly az: number) {
    super(seed);
    this.radius = 0.4;
    this.size = 0.45;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'explore' ? 1 : env.eco.dwellers;
  }

  spawn(): void {
    this.x = this.ax + (this.rand() > 0.5 ? 24 : -24);
    this.y = this.ay - 2;
    this.z = this.az;
  }

  step(dt: number, env: CreatureEnv): void {
    const t = this.clock;
    this.fin += dt * (env.reduced ? 3 : 4.6);
    wanderSteer(this, this.ax, this.ay, this.az, 8.6, 0.22, t * 0.7, V);
    // 间歇性地收缩腕间膜，向上滑行
    this.glide = Math.max(0, Math.sin(t * 0.35 + this.phase));
    this.vx = damp(this.vx, V.x, 0.7, dt);
    this.vy = damp(this.vy, V.y - this.glide * 0.06, 0.7, dt);
    this.vz = damp(this.vz, V.z * 0.5, 0.7, dt);
    this.x += this.vx * dt;
    this.y = Math.min(SEABED - 0.6, this.y + this.vy * dt);
    this.z += this.vz * dt;
    if (Math.abs(this.vx) > 0.03) this.turnToward(this.vx, dt, 1.2);
    this.tilt = -0.15 + Math.sin(t * 0.5 + this.phase) * 0.08;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const S = 0.42;
    const flap = Math.sin(this.fin);
    const web = this.glide;
    const body = shade(C.dumbo, sh, 1, 0.35);
    const dark = shade(C.dumboDark, sh, 1, 0.3);
    // 耳鳍：头两侧的一对“大耳朵”，交替扇动
    const ear = (side: number) => {
      ctx.save();
      ctx.translate(side * S * 0.2, -S * 0.5);
      ctx.rotate(side * (0.75 + flap * 0.45));
      ctx.fillStyle = side < 0 ? dark : body;
      ctx.beginPath();
      ctx.ellipse(0, -S * 0.13, S * 0.085, S * 0.15, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    ear(-1);
    // 腕间膜形成的“裙摆”，边缘露出卷曲的腕尖
    const spread = 0.32 + 0.12 * web;
    ctx.fillStyle = shade(C.dumboWeb, sh, 0.92, 0.3);
    ctx.beginPath();
    ctx.moveTo(-S * 0.26, -S * 0.12);
    ctx.quadraticCurveTo(-S * (spread + 0.12), S * 0.1, -S * (spread + 0.04), S * 0.28);
    const tips = 5;
    for (let i = 0; i <= tips; i++) {
      const u = i / tips;
      const x = lerp(-S * (spread + 0.04), S * (spread + 0.04), u);
      const y = S * (0.28 + 0.06 * Math.sin(u * Math.PI) + 0.02 * Math.sin(this.fin * 0.5 + i));
      ctx.quadraticCurveTo(x - S * 0.05, y + S * 0.08, x, y);
    }
    ctx.quadraticCurveTo(S * (spread + 0.12), S * 0.1, S * 0.26, -S * 0.12);
    ctx.closePath();
    ctx.fill();
    // 卷曲的腕尖
    ctx.strokeStyle = dark;
    ctx.lineWidth = S * 0.025;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= tips; i += 1) {
      const u = i / tips;
      const x = lerp(-S * (spread + 0.04), S * (spread + 0.04), u);
      const y = S * (0.3 + 0.06 * Math.sin(u * Math.PI));
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + S * 0.04, y + S * 0.07, x + S * 0.08, y + S * 0.03);
    }
    ctx.stroke();
    // 头套膜
    const g = ctx.createLinearGradient(0, -S * 0.68, 0, S * 0.05);
    g.addColorStop(0, shade(C.dumboWeb, sh, 1, 0.35));
    g.addColorStop(1, body);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-S * 0.27, -S * 0.08);
    ctx.bezierCurveTo(-S * 0.34, -S * 0.5, -S * 0.2, -S * 0.68, 0, -S * 0.68);
    ctx.bezierCurveTo(S * 0.2, -S * 0.68, S * 0.34, -S * 0.5, S * 0.27, -S * 0.08);
    ctx.quadraticCurveTo(0, S * 0.02, -S * 0.27, -S * 0.08);
    ctx.fill();
    ear(1);
    // 眼睛
    if (scale * S > 10) {
      ctx.fillStyle = shade(C.eye, sh);
      ctx.beginPath();
      ctx.ellipse(S * 0.13, -S * 0.3, S * 0.06, S * 0.07, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(S * 0.115, -S * 0.325, S * 0.018, 0, TAU);
      ctx.fill();
    }
  }
}
