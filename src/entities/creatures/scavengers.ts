import { hex, shade, type Shade } from '../../core/color';
import { clamp, damp, hash1, lerp, noise1, smoothstep, TAU } from '../../core/math';
import type { Projected } from '../../core/Camera';
import type { RenderCtx } from '../../core/types';
import { CARCASS_X0, CARCASS_X1, carcassTop, Creature, REST_X, SEABED, wanderSteer, type CreatureEnv } from './base';

/** 移动清道夫：盲鳗、睡鲨、长尾鳕、端足类、深海蟹。 */

const P: Projected = { x: 0, y: 0, s: 0 };
const V = { x: 0, y: 0, z: 0 };

const C = {
  hag: hex('#b49b9d'),
  hagBack: hex('#8e777e'),
  hagBelly: hex('#d2bdba'),
  hagSpot: hex('#e7dad6'),
  shark: hex('#3d3a37'),
  sharkBelly: hex('#6b6762'),
  sharkFin: hex('#2c2a28'),
  gren: hex('#8d877c'),
  grenBack: hex('#5f5a52'),
  grenBelly: hex('#b9b3a6'),
  grenFin: hex('#4b4740'),
  eye: hex('#141416'),
  eyeRing: hex('#c9d4d8'),
  amph: hex('#e6d2c8'),
  amphDark: hex('#b59a8e'),
  crab: hex('#b9573b'),
  crabDark: hex('#83402c'),
  crabBelly: hex('#dc9b74'),
};

// ------------------------------------------------------------------ 盲鳗

type HagState = 'approach' | 'feed' | 'wander' | 'leave';

/** 盲鳗：粉灰色、像鳗鱼一样蜿蜒游动，把头钻向鲸鱼尸体取食，偶尔把身体卷成结。 */
export class Hagfish extends Creature {
  readonly info = 'hagfish';
  private state: HagState = 'approach';
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private timer = 0;
  private heading = 0;
  private wave = 0;
  private curl = 0;
  readonly len: number;
  private readonly xs = new Float32Array(14);
  private readonly ys = new Float32Array(14);

  constructor(seed: number, th: number) {
    super(seed);
    this.th = th;
    this.len = 0.5 + this.rand() * 0.25;
    this.radius = 0.35;
    this.size = this.len;
  }

  driver(env: CreatureEnv): number {
    return env.eco.scav;
  }

  spawn(): void {
    const side = this.rand() > 0.5 ? 1 : -1;
    this.x = REST_X + side * (13 + this.rand() * 6);
    this.y = SEABED - 0.5 - this.rand() * 2.5;
    this.z = -0.6 - this.rand() * 1.2;
    this.heading = side > 0 ? Math.PI : 0;
    this.yaw = side > 0 ? Math.PI : 0;
    this.pickFeedTarget();
  }

  private pickFeedTarget(): void {
    const x = lerp(CARCASS_X0 + 1.2, CARCASS_X1 - 1.2, this.rand());
    const top = carcassTop(x, 0.3);
    this.tx = x;
    this.ty = lerp(top + 0.25, SEABED - 0.25, this.rand());
    this.tz = -0.55 - this.rand() * 0.5;
    this.state = 'approach';
  }

  step(dt: number, env: CreatureEnv): void {
    this.wave += dt * (this.state === 'feed' ? 7 : 5.2);
    if (!this.wanted && this.state !== 'leave') {
      this.state = 'leave';
      this.tx = this.x + (this.x > REST_X ? 25 : -25);
      this.ty = this.y - 1;
    }
    let speed = 0.38;
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    switch (this.state) {
      case 'approach':
        speed = d > 4 ? 1.1 : 0.35;
        if (d < 0.2) {
          this.state = 'feed';
          this.timer = 4 + this.rand() * 7;
        }
        break;
      case 'feed':
        speed = 0.02;
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'wander';
          this.timer = 3 + this.rand() * 5;
          this.tx = this.x + (this.rand() - 0.5) * 6;
          this.ty = Math.min(SEABED - 0.3, this.y - this.rand() * 1.5);
        }
        break;
      case 'wander':
        this.timer -= dt;
        speed = 0.3;
        if (this.timer <= 0 || d < 0.3) this.pickFeedTarget();
        break;
      case 'leave':
        speed = 0.6;
        break;
    }
    if (env.reduced) speed *= 0.7;
    // 平滑转向
    if (this.state !== 'feed') {
      const want = Math.atan2(dy, dx);
      let da = want - this.heading;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      this.heading += clamp(da, -1.6 * dt, 1.6 * dt);
    }
    const sp = this.state === 'feed' ? Math.sin(this.wave * 0.6) * 0.03 : speed;
    this.vx = damp(this.vx, Math.cos(this.heading) * sp, 3, dt);
    this.vy = damp(this.vy, Math.sin(this.heading) * sp * 0.7, 3, dt);
    this.x += this.vx * dt;
    this.y = Math.min(SEABED - 0.05, this.y + this.vy * dt);
    this.z = damp(this.z, this.tz, 0.5, dt);
    this.turnToward(Math.cos(this.heading), dt, 2.2);
    this.tilt = clamp(Math.atan2(Math.sin(this.heading), Math.abs(Math.cos(this.heading))), -1.0, 1.0);
    // 进食时身体卷曲（打结的倾向）
    this.curl = damp(this.curl, this.state === 'feed' ? 1 : 0, 0.8, dt);
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const L = this.len;
    const n = 14;
    const xs = this.xs;
    const ys = this.ys;
    let x = L * 0.5;
    let y = 0;
    let ang = 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      xs[i] = x;
      ys[i] = y;
      const env = 0.25 + 0.75 * u;
      const bend = Math.sin(this.wave - u * 7.5) * 0.55 * env + this.curl * (0.35 + 1.4 * u * u) * Math.sin(this.phase + this.clock * 0.2);
      ang = bend * 0.6;
      x -= Math.cos(ang) * (L / (n - 1));
      y -= Math.sin(ang) * (L / (n - 1));
    }
    const width = (u: number) => (0.034 - 0.012 * u) * (u < 0.06 ? 0.75 + u * 4 : 1);
    if (scale * L < 6) {
      ctx.strokeStyle = shade(C.hag, sh);
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.stroke();
      return;
    }
    // 身体轮廓
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const j = Math.min(n - 1, i + 1);
      const k = Math.max(0, i - 1);
      const tx = xs[j] - xs[k];
      const ty = ys[j] - ys[k];
      const tl = Math.hypot(tx, ty) || 1;
      const w = width(u);
      const px = xs[i] + (ty / tl) * w;
      const py = ys[i] - (tx / tl) * w;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = n - 1; i >= 0; i--) {
      const u = i / (n - 1);
      const j = Math.min(n - 1, i + 1);
      const k = Math.max(0, i - 1);
      const tx = xs[j] - xs[k];
      const ty = ys[j] - ys[k];
      const tl = Math.hypot(tx, ty) || 1;
      const w = width(u) * (u > 0.7 ? 1 + (u - 0.7) * 1.6 : 1);
      ctx.lineTo(xs[i] - (ty / tl) * w, ys[i] + (tx / tl) * w);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -0.04, 0, 0.04);
    g.addColorStop(0, shade(C.hagBack, sh));
    g.addColorStop(0.55, shade(C.hag, sh));
    g.addColorStop(1, shade(C.hagBelly, sh));
    ctx.fillStyle = g;
    ctx.fill();
    if (scale * L > 30) {
      // 黏液孔：沿体侧的一排小点
      ctx.fillStyle = shade(C.hagSpot, sh, 0.55);
      for (let i = 2; i < n - 2; i++) {
        ctx.beginPath();
        ctx.arc(xs[i], ys[i] + 0.01, 0.0045, 0, TAU);
        ctx.fill();
      }
      // 触须与退化的眼点
      ctx.strokeStyle = shade(C.hagBelly, sh, 0.8);
      ctx.lineWidth = 0.005;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = -0.5 + k * 0.45;
        ctx.moveTo(xs[0], ys[0] + 0.01);
        ctx.lineTo(xs[0] + Math.cos(a) * 0.03, ys[0] + 0.01 + Math.sin(a) * 0.03);
      }
      ctx.stroke();
      ctx.fillStyle = shade(C.hagSpot, sh, 0.7);
      ctx.beginPath();
      ctx.arc(xs[1] + 0.005, ys[1] - 0.012, 0.006, 0, TAU);
      ctx.fill();
    }
  }
}

// ------------------------------------------------------------------ 太平洋睡鲨

/** 太平洋睡鲨：体型很大、动作极慢的鲨鱼，在远处缓缓巡游。 */
export class SleeperShark extends Creature {
  readonly info = 'sleeperShark';
  private dir = 1;
  private tail = 0;

  constructor(seed: number) {
    super(seed);
    this.th = 0.62;
    this.radius = 1.6;
    this.size = 4;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'explore' ? 0 : env.eco.scav;
  }

  spawn(): void {
    this.dir = this.rand() > 0.5 ? 1 : -1;
    this.x = REST_X - this.dir * 34;
    this.y = SEABED - 3.4;
    this.z = 10 + this.rand() * 3;
    this.yaw = this.dir > 0 ? 0 : Math.PI;
  }

  step(dt: number, env: CreatureEnv): void {
    const sp = env.reduced ? 0.3 : 0.42;
    this.tail += dt * 1.9;
    if (this.wanted) {
      if (this.x > REST_X + 30) this.dir = -1;
      if (this.x < REST_X - 30) this.dir = 1;
    }
    this.vx = damp(this.vx, this.dir * sp, 0.4, dt);
    this.x += this.vx * dt;
    this.y = SEABED - 3.2 + Math.sin(this.clock * 0.09 + this.phase) * 0.8;
    this.turnToward(this.vx, dt, 0.6);
    this.tilt = Math.cos(this.clock * 0.09 + this.phase) * 0.04;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const L = 4;
    const tl = Math.sin(this.tail) * 0.14;
    const body = shade(C.shark, sh);
    const fin = shade(C.sharkFin, sh);
    // 尾鳍（歪尾）
    ctx.fillStyle = fin;
    ctx.save();
    ctx.translate(-L * 0.38, 0);
    ctx.rotate(tl);
    ctx.beginPath();
    ctx.moveTo(0, -0.12);
    ctx.quadraticCurveTo(-0.45, -0.28, -0.78, -0.42);
    ctx.quadraticCurveTo(-0.62, -0.1, -0.5, 0.05);
    ctx.quadraticCurveTo(-0.38, 0.2, -0.3, 0.28);
    ctx.quadraticCurveTo(-0.15, 0.1, 0, 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 身体
    const g = ctx.createLinearGradient(0, -0.4, 0, 0.4);
    g.addColorStop(0, body);
    g.addColorStop(0.65, body);
    g.addColorStop(1, shade(C.sharkBelly, sh));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0.02);
    ctx.bezierCurveTo(L * 0.5, -0.24, L * 0.36, -0.4, L * 0.15, -0.42);
    ctx.bezierCurveTo(-L * 0.05, -0.43, -L * 0.25, -0.26, -L * 0.4 + tl * 0.2, -0.1);
    ctx.lineTo(-L * 0.4 + tl * 0.2, 0.1);
    ctx.bezierCurveTo(-L * 0.2, 0.26, L * 0.1, 0.38, L * 0.3, 0.32);
    ctx.bezierCurveTo(L * 0.44, 0.26, L * 0.5, 0.18, L * 0.5, 0.02);
    ctx.fill();
    // 背鳍、胸鳍、腹鳍
    ctx.fillStyle = fin;
    ctx.beginPath();
    ctx.moveTo(L * 0.02, -0.41);
    ctx.quadraticCurveTo(-L * 0.04, -0.62, -L * 0.1, -0.6);
    ctx.lineTo(-L * 0.12, -0.37);
    ctx.closePath();
    ctx.moveTo(-L * 0.24, -0.27);
    ctx.quadraticCurveTo(-L * 0.28, -0.43, -L * 0.32, -0.42);
    ctx.lineTo(-L * 0.33, -0.18);
    ctx.closePath();
    ctx.moveTo(L * 0.26, 0.24);
    ctx.quadraticCurveTo(L * 0.16, 0.52, L * 0.08, 0.55);
    ctx.lineTo(L * 0.14, 0.28);
    ctx.closePath();
    ctx.moveTo(-L * 0.16, 0.24);
    ctx.quadraticCurveTo(-L * 0.22, 0.38, -L * 0.26, 0.38);
    ctx.lineTo(-L * 0.25, 0.2);
    ctx.closePath();
    ctx.fill();
    if (scale * L > 40) {
      // 眼睛与鳃裂
      ctx.fillStyle = shade(C.eye, sh);
      ctx.beginPath();
      ctx.ellipse(L * 0.4, -0.1, 0.035, 0.03, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,200,220,0.35)';
      ctx.beginPath();
      ctx.arc(L * 0.405, -0.11, 0.01, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = shade(C.sharkFin, sh, 0.8);
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const gx = L * (0.3 - k * 0.025);
        ctx.moveTo(gx, -0.1);
        ctx.lineTo(gx - 0.02, 0.08);
      }
      ctx.stroke();
    }
  }
}

// ------------------------------------------------------------------ 长尾鳕

/** 长尾鳕（鼠尾鱼）：大头、长长的尖尾，常常头朝下悬停在海底上方。 */
export class Grenadier extends Creature {
  readonly info = 'grenadier';
  private tail = 0;
  private glide = 0;
  private ax: number;
  private az: number;

  constructor(seed: number, th: number, ax: number, az: number) {
    super(seed);
    this.th = th;
    this.radius = 0.5;
    this.size = 0.9;
    this.ax = ax;
    this.az = az;
  }

  driver(env: CreatureEnv): number {
    return Math.max(env.eco.scav, env.eco.dwellers * 0.5);
  }

  spawn(): void {
    const side = this.rand() > 0.5 ? 1 : -1;
    this.x = this.ax + side * 16;
    this.y = SEABED - 2;
    this.z = this.az;
  }

  step(dt: number, env: CreatureEnv): void {
    const t = this.clock;
    this.tail += dt * (2.4 + this.glide * 2);
    // 每隔一段时间缓慢滑行到新位置
    this.glide = Math.max(0, Math.sin(t * 0.12 + this.phase));
    const ax = this.wanted ? this.ax + Math.sin(t * 0.05 + this.phase) * 4 : this.ax + (this.x > this.ax ? 30 : -30);
    wanderSteer(this, ax, SEABED - 1.1, this.az, 3, 0.1 + this.glide * 0.25, t, V);
    const sp = env.reduced ? 0.7 : 1;
    this.vx = damp(this.vx, V.x * sp, 0.6, dt);
    this.vy = damp(this.vy, V.y * 0.3 * sp, 0.6, dt);
    this.vz = damp(this.vz, V.z * 0.3, 0.6, dt);
    this.x += this.vx * dt;
    this.y = clamp(this.y + this.vy * dt, SEABED - 3, SEABED - 0.45);
    this.z += this.vz * dt;
    if (Math.abs(this.vx) > 0.04) this.turnToward(this.vx, dt, 0.9);
    // 头朝下悬停，滑行时放平
    this.tilt = lerp(0.55, 0.12, this.glide) + Math.sin(t * 0.3 + this.phase) * 0.05;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const L = 0.9;
    const n = 10;
    const tw = Math.sin(this.tail);
    const body = shade(C.gren, sh, 1, 0.1);
    if (scale * L < 6) {
      ctx.strokeStyle = body;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(L * 0.4, 0);
      ctx.lineTo(-L * 0.55, tw * 0.03);
      ctx.stroke();
      return;
    }
    // 尾部的连续鳍条（背鳍 + 臀鳍）
    ctx.fillStyle = shade(C.grenFin, sh, 0.7);
    ctx.beginPath();
    ctx.moveTo(L * 0.05, -0.07);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = lerp(L * 0.05, -L * 0.6, u);
      const w = lerp(0.09, 0.008, u);
      const wav = Math.sin(this.tail - u * 5) * 0.02 * u;
      ctx.lineTo(x, -w + wav);
    }
    for (let i = n; i >= 0; i--) {
      const u = i / n;
      const x = lerp(L * 0.12, -L * 0.6, u);
      const w = lerp(0.1, 0.008, u);
      const wav = Math.sin(this.tail - u * 5) * 0.02 * u;
      ctx.lineTo(x, w + wav);
    }
    ctx.closePath();
    ctx.fill();
    // 身体：大头 + 渐细的尾
    const g = ctx.createLinearGradient(0, -0.1, 0, 0.1);
    g.addColorStop(0, shade(C.grenBack, sh));
    g.addColorStop(0.5, body);
    g.addColorStop(1, shade(C.grenBelly, sh, 1, 0.1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L * 0.4, 0.0);
    ctx.bezierCurveTo(L * 0.4, -0.08, L * 0.3, -0.1, L * 0.15, -0.095);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = lerp(L * 0.1, -L * 0.6, u);
      ctx.lineTo(x, -lerp(0.08, 0.004, Math.pow(u, 0.8)) + Math.sin(this.tail - u * 5) * 0.02 * u);
    }
    for (let i = n; i >= 0; i--) {
      const u = i / n;
      const x = lerp(L * 0.1, -L * 0.6, u);
      ctx.lineTo(x, lerp(0.075, 0.004, Math.pow(u, 0.8)) + Math.sin(this.tail - u * 5) * 0.02 * u);
    }
    ctx.bezierCurveTo(L * 0.25, 0.09, L * 0.36, 0.07, L * 0.4, 0.0);
    ctx.fill();
    // 第一背鳍
    ctx.fillStyle = shade(C.grenFin, sh);
    ctx.beginPath();
    ctx.moveTo(L * 0.14, -0.09);
    ctx.lineTo(L * 0.1, -0.2 - tw * 0.005);
    ctx.lineTo(L * 0.03, -0.085);
    ctx.closePath();
    ctx.fill();
    // 胸鳍
    ctx.beginPath();
    ctx.moveTo(L * 0.2, 0.01);
    ctx.quadraticCurveTo(L * 0.1, 0.06 + tw * 0.01, L * 0.04, 0.03);
    ctx.lineTo(L * 0.18, -0.005);
    ctx.fill();
    if (scale * L > 25) {
      // 大眼睛与颏须
      ctx.fillStyle = shade(C.eyeRing, sh, 0.85);
      ctx.beginPath();
      ctx.ellipse(L * 0.29, -0.032, 0.032, 0.028, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(C.eye, sh);
      ctx.beginPath();
      ctx.ellipse(L * 0.295, -0.032, 0.021, 0.019, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = shade(C.grenBelly, sh, 0.8);
      ctx.lineWidth = 0.006;
      ctx.beginPath();
      ctx.moveTo(L * 0.33, 0.05);
      ctx.lineTo(L * 0.31, 0.1);
      ctx.moveTo(L * 0.4, 0.015);
      ctx.quadraticCurveTo(L * 0.36, 0.04, L * 0.31, 0.04);
      ctx.stroke();
    }
  }
}

// ------------------------------------------------------------------ 端足类群

/** 端足类：成百上千只小小的“跳虾”，在鲸鱼尸体表面不停地游动、啃食。 */
export class AmphipodSwarm extends Creature {
  readonly info = 'amphipod';
  private readonly n: number;
  private readonly hx: Float32Array;
  private readonly hy: Float32Array;
  private readonly hz: Float32Array;
  private readonly th2: Float32Array;
  private readonly ph: Float32Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private drive = 0;

  constructor(seed: number, count: number) {
    super(seed);
    this.custom = true;
    this.n = count;
    this.radius = 6;
    this.size = 0.04;
    const mk = () => new Float32Array(count);
    this.hx = mk();
    this.hy = mk();
    this.hz = mk();
    this.th2 = mk();
    this.ph = mk();
    this.px = mk();
    this.py = mk();
    this.pz = mk();
    for (let i = 0; i < count; i++) {
      const x = lerp(CARCASS_X0 + 0.4, CARCASS_X1 - 0.6, this.rand());
      const top = carcassTop(x, 0.35);
      this.hx[i] = x;
      this.hy[i] = lerp(top + 0.15, SEABED - 0.1, Math.pow(this.rand(), 0.7));
      this.hz[i] = -0.45 + this.rand() * 0.6;
      this.th2[i] = this.rand();
      this.ph[i] = this.rand() * 100;
    }
    this.x = REST_X - 1;
    this.y = SEABED - 1;
    this.z = 0;
  }

  driver(env: CreatureEnv): number {
    this.drive = env.eco.amph;
    return env.eco.amph;
  }

  spawn(): void {}

  step(_dt: number, env: CreatureEnv): void {
    const t = this.clock * (env.reduced ? 0.5 : 1);
    for (let i = 0; i < this.n; i++) {
      const ph = this.ph[i];
      // 快速而不规则的小幅游动 + 偶尔的冲刺
      const dash = Math.pow(Math.max(0, Math.sin(t * 0.7 + ph)), 8);
      this.px[i] = this.hx[i] + noise1(t * 1.6 + ph, 1) * 0.16 + noise1(t * 0.3 + ph, 2) * 0.5 * dash;
      this.py[i] = this.hy[i] + noise1(t * 1.9 + ph, 3) * 0.1 - dash * 0.15;
      this.pz[i] = this.hz[i];
    }
  }

  render(): void {}

  drawCustom(rc: RenderCtx, sh: Shade): void {
    const { ctx, cam, dpr } = rc;
    const vis = this.drive;
    const col = shade(C.amph, sh, 1, 0.25);
    const dark = shade(C.amphDark, sh, 1, 0.1);
    const L = 0.04;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let detail = false;
    if (cam.project(this.x, this.y, 0, P)) detail = P.s * L > 4;
    if (!detail) ctx.fillStyle = col;
    for (let i = 0; i < this.n; i++) {
      const k = smoothstep(this.th2[i], this.th2[i] + 0.08, vis);
      if (k <= 0.01) continue;
      if (!cam.project(this.px[i], this.py[i], this.pz[i], P)) continue;
      if (P.x < -10 || P.x > rc.w + 10 || P.y < -10 || P.y > rc.h + 10) continue;
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * k * 0.85;
      if (!detail) {
        const r = Math.max(0.9, P.s * L * 0.5);
        ctx.fillRect((P.x - r / 2) * dpr, (P.y - r / 2) * dpr, r * dpr, r * dpr);
      } else {
        const face = hash1(i) > 0.5 ? 1 : -1;
        cam.applyTransform(ctx, dpr, this.px[i], this.py[i], this.pz[i], Math.sin(this.ph[i] + this.clock) * 0.3, face < 0);
        // 弯曲的“C”形身体
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(L * 0.5, 0);
        ctx.quadraticCurveTo(L * 0.1, -L * 0.42, -L * 0.45, -L * 0.05);
        ctx.quadraticCurveTo(-L * 0.4, L * 0.12, -L * 0.3, L * 0.08);
        ctx.quadraticCurveTo(L * 0.05, -L * 0.14, L * 0.42, L * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = dark;
        ctx.lineWidth = L * 0.04;
        ctx.beginPath();
        for (let k2 = 0; k2 < 4; k2++) {
          const lx = L * (0.3 - k2 * 0.15);
          ctx.moveTo(lx, L * 0.05);
          ctx.lineTo(lx - L * 0.05, L * 0.22);
        }
        ctx.moveTo(L * 0.48, 0);
        ctx.lineTo(L * 0.65, -L * 0.15);
        ctx.stroke();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.globalAlpha = a;
    }
  }

  hitPoint(rc: RenderCtx, sx: number, sy: number): { x: number; y: number; z: number } {
    let best = -1;
    let bd = 1e9;
    for (let i = 0; i < this.n; i++) {
      if (this.th2[i] > this.drive) continue;
      if (!rc.cam.project(this.px[i], this.py[i], this.pz[i], P)) continue;
      const d = (P.x - sx) ** 2 + (P.y - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return this;
    // 跟随目标：一个持续更新的代理点
    this.followIdx = best;
    return this.follow;
  }

  private followIdx = 0;
  private readonly follow = {
    owner: this as AmphipodSwarm,
    get x() {
      return this.owner.px[this.owner.followIdx];
    },
    get y() {
      return this.owner.py[this.owner.followIdx];
    },
    get z() {
      return this.owner.pz[this.owner.followIdx];
    },
  };

  /** 屏幕上离 (sx, sy) 最近个体的距离（像素），用于命中测试。 */
  nearestDist(rc: RenderCtx, sx: number, sy: number): number {
    let bd = 1e9;
    for (let i = 0; i < this.n; i++) {
      if (this.th2[i] > this.drive) continue;
      if (!rc.cam.project(this.px[i], this.py[i], this.pz[i], P)) continue;
      const d = Math.hypot(P.x - sx, P.y - sy);
      if (d < bd) bd = d;
    }
    return bd;
  }
}

// ------------------------------------------------------------------ 深海蟹

/** 深海蟹：在海床上横着走，走走停停。 */
export class Crab extends Creature {
  readonly info = 'crab';
  private walk = 0;
  private pause = 0;
  private dir = 1;
  private ax: number;
  private az: number;

  constructor(seed: number, th: number, ax: number, az: number) {
    super(seed);
    this.th = th;
    this.radius = 0.3;
    this.size = 0.4;
    this.ax = ax;
    this.az = az;
  }

  driver(env: CreatureEnv): number {
    return env.eco.crabs;
  }

  spawn(): void {
    const side = this.rand() > 0.5 ? 1 : -1;
    this.x = this.ax + side * 9;
    this.z = this.az;
    this.y = SEABED;
    this.dir = -side;
  }

  step(dt: number, env: CreatureEnv): void {
    if (this.pause > 0) {
      this.pause -= dt;
      this.vx = damp(this.vx, 0, 6, dt);
    } else {
      const target = this.wanted ? this.ax : this.ax + (this.x > this.ax ? 30 : -30);
      const far = Math.abs(target - this.x);
      if (this.wanted && far > 3) this.dir = Math.sign(target - this.x);
      else if (this.wanted && this.rand() < dt * 0.15) this.dir = -this.dir;
      const sp = (far > 4 ? 0.35 : 0.13) * (env.reduced ? 0.7 : 1);
      this.vx = damp(this.vx, this.dir * sp, 4, dt);
      if (this.wanted && this.rand() < dt * 0.22) this.pause = 1.5 + this.rand() * 4;
    }
    this.x += this.vx * dt;
    this.walk += Math.abs(this.vx) * dt * 28;
    this.y = SEABED;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const W = 0.2;
    const H = 0.17;
    const lift = 0.15;
    const body = shade(C.crab, sh, 1, 0.1);
    const dark = shade(C.crabDark, sh);
    if (scale * W < 3) {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, -lift, W, H * 0.5, 0, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.lineCap = 'round';
    const legs = (far: boolean) => {
      ctx.strokeStyle = far ? dark : body;
      ctx.lineWidth = far ? 0.022 : 0.03;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const side = i < 2 ? -1 : 1;
        const k = i % 2;
        const ph = this.walk + i * 1.6 + (far ? Math.PI : 0);
        const step = Math.sin(ph) * 0.05;
        const up = Math.max(0, Math.cos(ph)) * 0.04;
        const hipX = side * (0.06 + k * 0.06);
        const kneeX = side * (0.22 + k * 0.09) + step * 0.5;
        const footX = side * (0.3 + k * 0.1) + step;
        ctx.moveTo(hipX, -lift);
        ctx.lineTo(kneeX, -lift - 0.1 - up);
        ctx.lineTo(footX, -up);
      }
      ctx.stroke();
    };
    legs(true);
    // 甲壳
    const g = ctx.createLinearGradient(0, -lift - H, 0, -lift + H * 0.4);
    g.addColorStop(0, body);
    g.addColorStop(1, shade(C.crabBelly, sh, 1, 0.05));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-W, -lift + 0.02);
    ctx.bezierCurveTo(-W, -lift - H * 0.9, W, -lift - H * 0.9, W, -lift + 0.02);
    ctx.quadraticCurveTo(0, -lift + H * 0.35, -W, -lift + 0.02);
    ctx.fill();
    if (scale * W > 12) {
      // 甲壳上的小疣突
      ctx.fillStyle = dark;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc(-W * 0.6 + k * W * 0.3, -lift - H * 0.45 - Math.sin((k / 4) * Math.PI) * H * 0.12, 0.009, 0, TAU);
        ctx.fill();
      }
      // 眼柄与螯
      ctx.strokeStyle = body;
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      ctx.moveTo(W * 0.15, -lift - H * 0.55);
      ctx.lineTo(W * 0.2, -lift - H * 0.75);
      ctx.moveTo(-W * 0.15, -lift - H * 0.55);
      ctx.lineTo(-W * 0.2, -lift - H * 0.75);
      ctx.stroke();
      ctx.fillStyle = shade(C.eye, sh);
      ctx.beginPath();
      ctx.arc(W * 0.2, -lift - H * 0.78, 0.012, 0, TAU);
      ctx.arc(-W * 0.2, -lift - H * 0.78, 0.012, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = body;
    const claw = Math.sin(this.clock * 1.3 + this.phase) * 0.02;
    ctx.beginPath();
    ctx.ellipse(W * 0.75, -lift - 0.02 + claw, 0.07, 0.04, -0.4, 0, TAU);
    ctx.ellipse(-W * 0.75, -lift - 0.02 - claw, 0.07, 0.04, 0.4, 0, TAU);
    ctx.fill();
    legs(false);
  }
}
