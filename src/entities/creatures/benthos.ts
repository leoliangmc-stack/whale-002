import { hex, shade, type Shade } from '../../core/color';
import { clamp, damp, lerp, TAU } from '../../core/math';
import type { RenderCtx } from '../../core/types';
import { boneTop, Creature, REST_X, SEABED, type CreatureEnv } from './base';

/** 底栖生物：多毛类、蛤与贻贝、螺、铠甲虾、海猪、蛇尾。 */

const C = {
  tube: hex('#6d675b'),
  tubeLight: hex('#8c8576'),
  worm: hex('#c8655c'),
  wormLight: hex('#eb9d8e'),
  palp: hex('#f2b39c'),
  clam: hex('#e5e0d2'),
  clamShade: hex('#a9a497'),
  mussel: hex('#5b4a3c'),
  musselLight: hex('#8c7663'),
  siphon: hex('#e3a0a0'),
  snailShell: hex('#d8cbb3'),
  snailBand: hex('#9b8467'),
  snailFoot: hex('#d9b9a8'),
  squat: hex('#e8c7a4'),
  squatRed: hex('#d38a6a'),
  squatDark: hex('#a6694f'),
  pig: hex('#e7a7b0'),
  pigDark: hex('#c47d8a'),
  pigLight: hex('#f6cfd3'),
  brittle: hex('#c9a68c'),
  brittleDark: hex('#9c7c66'),
  eye: hex('#1b1416'),
};

// ------------------------------------------------------------------ 多毛类

/** 多毛类：住在沉积物管道里的小虫，伸出身体和触须，又缩回去。 */
export class Polychaete extends Creature {
  readonly info = 'polychaete';
  private ext = 0;
  private readonly period: number;

  constructor(seed: number, th: number, x: number, z: number) {
    super(seed);
    this.th = th;
    this.x = x;
    this.z = z;
    this.y = SEABED;
    this.radius = 0.12;
    this.size = 0.15;
    this.period = 7 + this.rand() * 9;
  }

  driver(env: CreatureEnv): number {
    return env.eco.enrich;
  }

  spawn(): void {
    this.ext = 0;
  }

  step(dt: number, env: CreatureEnv): void {
    const t = this.clock / this.period + this.phase;
    const cyc = t - Math.floor(t);
    // 慢慢伸出 → 停留摆动 → 迅速缩回 → 停在管中
    let target: number;
    if (cyc < 0.25) target = cyc / 0.25;
    else if (cyc < 0.7) target = 1;
    else if (cyc < 0.76) target = 1 - (cyc - 0.7) / 0.06;
    else target = 0;
    this.ext = damp(this.ext, this.wanted ? target : 0, env.reduced ? 2 : 4, dt);
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    // 管口
    ctx.fillStyle = shade(C.tube, sh);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.035, 0.012, 0, Math.PI, TAU);
    ctx.fill();
    ctx.fillStyle = shade(C.tubeLight, sh);
    ctx.fillRect(-0.012, -0.03, 0.024, 0.03);
    const h = 0.16 * this.ext;
    if (h < 0.005) return;
    const sway = Math.sin(this.clock * 1.4 + this.phase) * 0.03 * this.ext;
    if (scale * 0.16 < 5) {
      ctx.strokeStyle = shade(C.worm, sh);
      ctx.lineWidth = 0.015;
      ctx.beginPath();
      ctx.moveTo(0, -0.03);
      ctx.lineTo(sway, -0.03 - h);
      ctx.stroke();
      return;
    }
    ctx.strokeStyle = shade(C.worm, sh, 1, 0.1);
    ctx.lineWidth = 0.014;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -0.03);
    ctx.quadraticCurveTo(sway * 0.3, -0.03 - h * 0.6, sway, -0.03 - h);
    ctx.stroke();
    // 体节
    ctx.strokeStyle = shade(C.wormLight, sh, 0.8);
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    for (let k = 1; k < 6; k++) {
      const u = k / 6;
      const x = sway * u * u;
      const y = -0.03 - h * u;
      ctx.moveTo(x - 0.008, y);
      ctx.lineTo(x + 0.008, y);
    }
    ctx.stroke();
    // 触须冠
    ctx.strokeStyle = shade(C.palp, sh, 0.9, 0.1);
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    const hx = sway;
    const hy = -0.03 - h;
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.4 + Math.sin(this.clock * 2 + k) * 0.15;
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(hx + Math.cos(a) * 0.02, hy + Math.sin(a) * 0.02, hx + Math.cos(a + 0.3) * 0.04, hy + Math.sin(a + 0.3) * 0.04);
    }
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ 蛤与贻贝

/** 化能合成阶段的蛤类与贻贝：半埋在沉积物中，偶尔伸出水管。 */
export class ClamCluster extends Creature {
  readonly info = 'clam';
  private readonly shells: Array<{ dx: number; dz: number; r: number; a: number; mussel: boolean; th: number }> = [];
  private sulfo = 0;

  constructor(seed: number, th: number, x: number, z: number) {
    super(seed);
    this.th = th;
    this.x = x;
    this.z = z;
    this.y = SEABED;
    this.radius = 0.25;
    this.size = 0.35;
    const n = 4 + Math.floor(this.rand() * 4);
    let px = -0.2;
    for (let i = 0; i < n; i++) {
      const mussel = this.rand() > 0.5;
      const r = mussel ? 0.022 + this.rand() * 0.012 : 0.04 + this.rand() * 0.02;
      px += r * (mussel ? 1.6 : 2.2) + this.rand() * 0.03;
      this.shells.push({
        dx: px,
        dz: (this.rand() - 0.5) * 0.3,
        r,
        a: mussel ? (this.rand() - 0.5) * 0.8 : (this.rand() > 0.5 ? 1 : -1) * (0.5 + this.rand() * 0.5),
        mussel,
        th: this.rand(),
      });
    }
    this.shells.sort((a, b) => b.dz - a.dz);
  }

  driver(env: CreatureEnv): number {
    this.sulfo = env.mode === 'explore' ? 1 : env.eco.sulfo;
    return this.sulfo;
  }

  spawn(): void {}

  step(): void {}

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const grow = clamp((this.sulfo - this.th) / 0.3);
    const edge = shade(C.clamShade, sh, 0.9);
    for (const s of this.shells) {
      const k = clamp((grow - s.th * 0.6) / 0.4);
      if (k <= 0.01) continue;
      const r = s.r * (0.55 + 0.45 * k);
      if (scale * r < 1.5) {
        ctx.fillStyle = shade(s.mussel ? C.mussel : C.clam, sh);
        ctx.fillRect(s.dx - r, -r, r * 2, r);
        continue;
      }
      ctx.save();
      // 半埋在泥中：只画出露在泥面以上的部分
      ctx.beginPath();
      ctx.rect(s.dx - r * 3, -r * 3, r * 6, r * 3 + s.dz * 0.04);
      ctx.clip();
      ctx.translate(s.dx, s.dz * 0.04);
      ctx.rotate(s.a);
      if (s.mussel) {
        const g = ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, shade(C.musselLight, sh, 1, 0.1));
        g.addColorStop(1, shade(C.mussel, sh));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-r * 1.5, 0);
        ctx.quadraticCurveTo(-r * 0.6, -r * 0.95, r * 1.5, -r * 0.35);
        ctx.quadraticCurveTo(r * 0.4, r * 0.75, -r * 1.5, 0);
        ctx.fill();
      } else {
        const g = ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, shade(C.clam, sh, 1, 0.1));
        g.addColorStop(1, shade(C.clamShade, sh));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.5, r * 0.72, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.lineWidth = Math.max(r * 0.05, 0.7 / scale);
        ctx.stroke();
        if (scale * r > 5) {
          // 生长纹
          ctx.lineWidth = r * 0.04;
          ctx.beginPath();
          for (let q = 1; q <= 3; q++) ctx.ellipse(-r * 0.5, r * 0.15, r * 0.35 * q, r * 0.2 * q, 0, Math.PI * 1.05, Math.PI * 1.85);
          ctx.stroke();
        }
      }
      ctx.restore();
      // 偶尔伸出的水管（蛤）
      if (!s.mussel && scale * r > 4) {
        const sip = Math.max(0, Math.sin(this.clock * 0.5 + s.dx * 40)) * k;
        if (sip > 0.05) {
          const tipX = s.dx + Math.cos(s.a - Math.PI / 2) * r * (0.6 + sip * 0.9);
          const tipY = -r * (0.6 + sip * 0.9);
          ctx.strokeStyle = shade(C.siphon, sh, 0.85);
          ctx.lineWidth = r * 0.3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.dx, -r * 0.3);
          ctx.lineTo(tipX * 0.5 + s.dx * 0.5, tipY);
          ctx.stroke();
        }
      }
    }
  }
}

// ------------------------------------------------------------------ 螺

/** 小型螺类：在鲸骨与沉积物上慢慢爬行，啃食细菌。 */
export class Snail extends Creature {
  readonly info = 'snail';
  private dir = 1;
  private readonly x0: number;
  private readonly x1: number;
  private readonly onBone: boolean;

  constructor(seed: number, th: number, x0: number, x1: number, z: number, onBone: boolean) {
    super(seed);
    this.th = th;
    this.x0 = x0;
    this.x1 = x1;
    this.z = z;
    this.onBone = onBone;
    this.x = lerp(x0, x1, this.rand());
    this.radius = 0.1;
    this.size = 0.08;
    this.dir = this.rand() > 0.5 ? 1 : -1;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'explore' ? 1 : env.eco.sulfo;
  }

  spawn(): void {}

  step(dt: number, env: CreatureEnv): void {
    const sp = (env.reduced ? 0.02 : 0.035) * (0.7 + 0.3 * Math.sin(this.clock * 0.8 + this.phase));
    this.x += this.dir * sp * dt;
    if (this.x > this.x1) this.dir = -1;
    if (this.x < this.x0) this.dir = 1;
    this.y = this.onBone ? boneTop(this.x) : SEABED;
    this.yaw = damp(this.yaw, this.dir > 0 ? 0 : Math.PI, 1.5, dt);
    // 沿表面坡度倾斜
    const slope = this.onBone ? (boneTop(this.x + 0.05) - boneTop(this.x - 0.05)) / 0.1 : 0;
    this.tilt = Math.atan(slope) * (this.dir > 0 ? 1 : -1);
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const S = 0.075;
    if (scale * S < 3) {
      ctx.fillStyle = shade(C.snailShell, sh);
      ctx.beginPath();
      ctx.arc(0, -S * 0.4, S * 0.4, 0, TAU);
      ctx.fill();
      return;
    }
    const crawl = Math.sin(this.clock * 3 + this.phase) * 0.06;
    // 腹足
    ctx.fillStyle = shade(C.snailFoot, sh, 0.95);
    ctx.beginPath();
    ctx.moveTo(-S * 0.55, 0);
    ctx.quadraticCurveTo(0, -S * 0.2, S * (0.65 + crawl), -S * 0.05);
    ctx.quadraticCurveTo(S * 0.7, S * 0.02, -S * 0.55, 0);
    ctx.fill();
    // 触角
    ctx.strokeStyle = shade(C.snailFoot, sh);
    ctx.lineWidth = S * 0.05;
    ctx.beginPath();
    ctx.moveTo(S * 0.55, -S * 0.1);
    ctx.lineTo(S * 0.75, -S * 0.32);
    ctx.moveTo(S * 0.5, -S * 0.1);
    ctx.lineTo(S * 0.62, -S * 0.35);
    ctx.stroke();
    // 螺壳
    const g = ctx.createLinearGradient(0, -S * 0.9, 0, 0);
    g.addColorStop(0, shade(C.snailShell, sh, 1, 0.15));
    g.addColorStop(1, shade(C.snailBand, sh));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-S * 0.05, -S * 0.42, S * 0.42, S * 0.38, -0.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade(C.snailBand, sh, 0.8);
    ctx.lineWidth = S * 0.05;
    ctx.beginPath();
    let r = S * 0.3;
    let a = 0;
    ctx.moveTo(-S * 0.05 + r, -S * 0.42);
    for (let i = 0; i < 24; i++) {
      a += 0.4;
      r *= 0.94;
      ctx.lineTo(-S * 0.05 + Math.cos(a) * r, -S * 0.42 + Math.sin(a) * r * 0.9);
    }
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ 铠甲虾

/** 铠甲虾（Munidopsis）：伸着两条细长的螯，蹲守在鲸骨旁。 */
export class SquatLobster extends Creature {
  readonly info = 'squatLobster';
  private wave = 0;
  private hop = 0;
  private hopFrom = 0;
  private hopTo = 0;
  private readonly onBone: boolean;

  constructor(seed: number, th: number, x: number, z: number, onBone: boolean) {
    super(seed);
    this.th = th;
    this.x = x;
    this.z = z;
    this.onBone = onBone;
    this.radius = 0.15;
    this.size = 0.16;
    this.yaw = this.rand() > 0.5 ? 0 : Math.PI;
    this.y = this.surfaceY(x);
  }

  private surfaceY(x: number): number {
    return this.onBone ? boneTop(x) : SEABED;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'explore' ? 1 : env.eco.sulfo;
  }

  spawn(): void {}

  step(dt: number, env: CreatureEnv): void {
    // 偶尔挥动螯
    const w = Math.sin(this.clock * 0.45 + this.phase);
    this.wave = damp(this.wave, w > 0.7 ? 1 : 0, 3, dt);
    // 偶尔跳到附近的新位置
    if (this.hop <= 0 && this.rand() < dt * 0.03 && !env.reduced) {
      this.hop = 1;
      this.hopFrom = this.x;
      this.hopTo = clamp(this.x + (this.rand() - 0.5) * 0.8, REST_X - 13.7, REST_X + 10.3);
    }
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt * 1.2);
      const u = 1 - this.hop;
      this.x = lerp(this.hopFrom, this.hopTo, u);
      this.y = this.surfaceY(this.x) - Math.sin(u * Math.PI) * 0.12;
      this.yaw = this.hopTo > this.hopFrom ? 0 : Math.PI;
    } else {
      this.y = this.surfaceY(this.x);
    }
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const S = 0.1;
    const body = shade(C.squat, sh, 1, 0.15);
    const red = shade(C.squatRed, sh, 1, 0.1);
    if (scale * S < 3) {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, -S * 0.3, S * 0.5, S * 0.25, 0, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.lineCap = 'round';
    // 步足
    ctx.strokeStyle = red;
    ctx.lineWidth = S * 0.06;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const hx = S * (0.15 - k * 0.2);
      ctx.moveTo(hx, -S * 0.3);
      ctx.lineTo(hx + S * 0.12, -S * 0.5);
      ctx.lineTo(hx + S * 0.2, 0);
    }
    ctx.stroke();
    // 身体：头胸甲 + 折在下面的腹部
    const g = ctx.createLinearGradient(0, -S * 0.7, 0, -S * 0.1);
    g.addColorStop(0, body);
    g.addColorStop(1, red);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -S * 0.42, S * 0.42, S * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-S * 0.38, -S * 0.3, S * 0.18, S * 0.14, 0.5, 0, TAU);
    ctx.fill();
    // 长长的螯
    const lift = this.wave * 0.5 + Math.sin(this.clock * 2.5 + this.phase) * 0.05 * this.wave;
    ctx.strokeStyle = body;
    ctx.lineWidth = S * 0.07;
    ctx.beginPath();
    for (let side = 0; side < 2; side++) {
      const a = -0.15 - lift * (side ? 0.8 : 1) + side * 0.12;
      const ex = S * 0.35 + Math.cos(a) * S * 0.6;
      const ey = -S * 0.45 + Math.sin(a) * S * 0.6;
      ctx.moveTo(S * 0.3, -S * 0.45);
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a) * S * 0.55, ey + Math.sin(a) * S * 0.55);
    }
    ctx.stroke();
    ctx.fillStyle = red;
    for (let side = 0; side < 2; side++) {
      const a = -0.15 - lift * (side ? 0.8 : 1) + side * 0.12;
      const tx = S * 0.35 + Math.cos(a) * S * 1.15;
      const ty = -S * 0.45 + Math.sin(a) * S * 1.15;
      ctx.beginPath();
      ctx.ellipse(tx, ty, S * 0.13, S * 0.05, a, 0, TAU);
      ctx.fill();
    }
    // 触角与眼睛
    ctx.strokeStyle = red;
    ctx.lineWidth = S * 0.025;
    ctx.beginPath();
    ctx.moveTo(S * 0.38, -S * 0.52);
    ctx.quadraticCurveTo(S * 0.8, -S * 0.9, S * 1.1, -S * 0.75);
    ctx.stroke();
    ctx.fillStyle = shade(C.eye, sh, 0.8);
    ctx.beginPath();
    ctx.arc(S * 0.36, -S * 0.5, S * 0.04, 0, TAU);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ 海猪

/** 海猪（Scotoplanes，一种海参）：圆滚滚的粉色身体，用管足在泥上慢慢走，吃沉积物里的有机碎屑。 */
export class SeaPig extends Creature {
  readonly info = 'seaPig';
  private walk = 0;
  private dir = 1;
  private feed = 0;
  private readonly ax: number;

  constructor(seed: number, th: number, ax: number, z: number) {
    super(seed);
    this.th = th;
    this.ax = ax;
    this.z = z;
    this.y = SEABED;
    this.radius = 0.22;
    this.size = 0.26;
    this.dir = this.rand() > 0.5 ? 1 : -1;
  }

  driver(env: CreatureEnv): number {
    return env.eco.dwellers;
  }

  spawn(): void {
    this.x = this.ax - this.dir * 8.6;
  }

  step(dt: number, env: CreatureEnv): void {
    const target = this.wanted ? this.ax : this.ax + (this.x > this.ax ? 34.3 : -34.3);
    if (Math.abs(target - this.x) > 3) this.dir = Math.sign(target - this.x);
    else if (this.rand() < dt * 0.04) this.dir = -this.dir;
    this.feed = damp(this.feed, Math.sin(this.clock * 0.3 + this.phase) > 0.6 ? 1 : 0, 1.5, dt);
    const sp = (Math.abs(target - this.x) > 3 ? 0.18 : 0.045) * (1 - this.feed * 0.8) * (env.reduced ? 0.7 : 1);
    this.vx = damp(this.vx, this.dir * sp, 2, dt);
    this.x += this.vx * dt;
    this.walk += Math.abs(this.vx) * dt * 40;
    this.turnToward(this.dir, dt, 1);
    this.y = SEABED;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const S = 0.26;
    const body = shade(C.pig, sh, 0.95, 0.15);
    const dark = shade(C.pigDark, sh, 0.95);
    const bob = Math.sin(this.walk * 0.5) * 0.006;
    if (scale * S < 4) {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, -S * 0.25, S * 0.5, S * 0.2, 0, 0, TAU);
      ctx.fill();
      return;
    }
    // 管足
    ctx.fillStyle = dark;
    for (let k = 0; k < 5; k++) {
      const fx = S * (0.32 - k * 0.16);
      const lift = Math.max(0, Math.sin(this.walk + k * 1.3)) * 0.015;
      ctx.beginPath();
      ctx.ellipse(fx, -S * 0.07 - lift, S * 0.045, S * 0.09, 0, 0, TAU);
      ctx.fill();
    }
    // 半透明的身体
    const g = ctx.createLinearGradient(0, -S * 0.5, 0, -S * 0.05);
    g.addColorStop(0, shade(C.pigLight, sh, 0.9, 0.15));
    g.addColorStop(1, body);
    ctx.fillStyle = g;
    ctx.beginPath();
    const head = -this.feed * 0.08;
    ctx.moveTo(-S * 0.48, -S * 0.12 + bob);
    ctx.bezierCurveTo(-S * 0.55, -S * 0.42, -S * 0.1, -S * 0.52, S * 0.2, -S * 0.46 + bob);
    ctx.bezierCurveTo(S * 0.48, -S * 0.42, S * 0.58, -S * (0.2 + head), S * 0.5, -S * (0.08 + head * 0.5));
    ctx.quadraticCurveTo(0, -S * 0.02, -S * 0.48, -S * 0.12 + bob);
    ctx.fill();
    // 背上的“触角”状疣足
    ctx.strokeStyle = body;
    ctx.lineWidth = S * 0.055;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const bx = S * (0.18 + k * 0.08);
      const sw = Math.sin(this.clock * 0.9 + k + this.phase) * 0.03;
      ctx.moveTo(bx, -S * 0.44);
      ctx.quadraticCurveTo(bx + S * 0.05, -S * 0.62, bx + S * (0.14 + sw), -S * (0.7 - k * 0.04));
    }
    ctx.stroke();
    // 前端的触手（进食时伸到泥里）
    ctx.strokeStyle = dark;
    ctx.lineWidth = S * 0.03;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      ctx.moveTo(S * 0.48, -S * 0.1);
      ctx.lineTo(S * (0.56 + k * 0.03), -S * 0.02 + this.feed * S * 0.04);
    }
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ 蛇尾

/** 蛇尾：圆盘与五条细长的腕，在泥面上缓缓摆动。 */
export class BrittleStar extends Creature {
  readonly info = 'brittleStar';
  private readonly angles: number[] = [];

  constructor(seed: number, th: number, x: number, z: number) {
    super(seed);
    this.th = th;
    this.x = x;
    this.z = z;
    this.y = SEABED;
    this.radius = 0.18;
    this.size = 0.3;
    const a0 = this.rand() * TAU;
    for (let i = 0; i < 5; i++) this.angles.push(a0 + (i / 5) * TAU);
  }

  driver(env: CreatureEnv): number {
    return env.eco.dwellers;
  }

  spawn(): void {}

  step(dt: number): void {
    // 缓慢地挪动
    this.x += Math.sin(this.clock * 0.05 + this.phase) * 0.004 * dt;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const R = 0.035;
    const armLen = 0.15;
    const col = shade(C.brittle, sh, 1, 0.1);
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = this.angles[i];
      // 三维朝向投影到侧视：x 分量 cos(a)，z 分量只影响抬起的高度
      const dx = Math.cos(a);
      const lift = (Math.sin(this.clock * 0.6 + i * 1.7 + this.phase) * 0.5 + 0.5) * 0.04 * (i % 2 ? 1 : 0.4);
      const n = 6;
      ctx.lineWidth = Math.max(0.004, R * 0.35);
      ctx.beginPath();
      ctx.moveTo(dx * R, -R * 0.4);
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const curl = Math.sin(this.clock * 0.8 + i + u * 3) * 0.05 * u;
        ctx.lineTo(dx * (R + armLen * u) + curl * Math.sin(a), -R * 0.3 - lift * Math.sin(u * Math.PI) + Math.abs(curl) * 0.3);
      }
      ctx.stroke();
    }
    ctx.fillStyle = shade(C.brittleDark, sh);
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.45, R, R * 0.45, 0, 0, TAU);
    ctx.fill();
    if (scale * R > 6) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, -R * 0.62, R * 0.5, R * 0.2, 0, 0, TAU);
      ctx.fill();
    }
  }
}
