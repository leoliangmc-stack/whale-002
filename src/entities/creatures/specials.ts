import { hex, shade, type Shade } from '../../core/color';
import { clamp, damp, smoothstep, TAU } from '../../core/math';
import type { Projected } from '../../core/Camera';
import type { RenderCtx } from '../../core/types';
import { HIDDEN } from '../../config/scene';
import { Creature, drawGlow, glowFade, glowSprite, type CreatureEnv } from './base';
import { CombJelly } from './midwater';

/** 隐藏发现：岩石后的鮟鱇鱼、暗处的发光栉水母。只在自由探索模式出现。 */

const P: Projected = { x: 0, y: 0, s: 0 };

const C = {
  angler: hex('#2b2426'),
  anglerLight: hex('#4a3e40'),
  tooth: hex('#e9e4da'),
  eye: hex('#0d0b0c'),
  rod: hex('#5a4d4e'),
};

/** 深海鮟鱇：头上的“钓竿”末端有会发光的诱饵。 */
export class Anglerfish extends Creature {
  readonly info = 'anglerfish';
  private readonly hx = HIDDEN.anglerfish.x;
  private readonly hy = HIDDEN.anglerfish.y;
  private readonly hz = HIDDEN.anglerfish.z;

  constructor(seed: number) {
    super(seed);
    this.radius = 0.4;
    this.size = 0.45;
    this.x = this.hx;
    this.y = this.hy;
    this.z = this.hz;
    this.yaw = Math.PI;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'explore' ? 1 : 0;
  }

  spawn(): void {
    this.x = this.hx;
    this.y = this.hy;
  }

  step(dt: number): void {
    const t = this.clock;
    this.x = damp(this.x, this.hx + Math.sin(t * 0.13 + this.phase) * 0.35, 1, dt);
    this.y = this.hy + Math.sin(t * 0.4) * 0.08;
    this.tilt = Math.sin(t * 0.3) * 0.06;
  }

  render(ctx: CanvasRenderingContext2D, _rc: RenderCtx, scale: number, sh: Shade): void {
    const S = 0.42;
    const t = this.clock;
    const fin = Math.sin(t * 3) * 0.08;
    // 尾鳍
    ctx.fillStyle = shade(C.anglerLight, sh, 1, 0.2);
    ctx.beginPath();
    ctx.moveTo(-S * 0.42, 0);
    ctx.lineTo(-S * 0.7, -S * (0.2 + fin));
    ctx.lineTo(-S * 0.66, S * (0.18 - fin));
    ctx.closePath();
    ctx.fill();
    // 圆圆的身体
    const g = ctx.createRadialGradient(S * 0.05, -S * 0.15, S * 0.05, 0, 0, S * 0.5);
    g.addColorStop(0, shade(C.anglerLight, sh, 1, 0.25));
    g.addColorStop(1, shade(C.angler, sh, 1, 0.15));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, S * 0.46, S * 0.38, 0, 0, TAU);
    ctx.fill();
    // 大嘴与小牙
    ctx.strokeStyle = shade(C.angler, sh);
    ctx.lineWidth = S * 0.03;
    ctx.beginPath();
    ctx.moveTo(S * 0.44, S * 0.02);
    ctx.quadraticCurveTo(S * 0.25, S * 0.2, S * 0.05, S * 0.12);
    ctx.stroke();
    if (scale * S > 14) {
      ctx.fillStyle = shade(C.tooth, sh, 0.85, 0.2);
      for (let k = 0; k < 6; k++) {
        const u = k / 5;
        const x = S * (0.42 - u * 0.33);
        const y = S * (0.04 + Math.sin(u * Math.PI) * 0.12);
        ctx.beginPath();
        ctx.moveTo(x - S * 0.012, y);
        ctx.lineTo(x, y - S * (0.05 + (k % 2) * 0.02));
        ctx.lineTo(x + S * 0.012, y);
        ctx.fill();
      }
      // 小眼睛
      ctx.fillStyle = shade(C.eye, sh);
      ctx.beginPath();
      ctx.arc(S * 0.22, -S * 0.12, S * 0.045, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,230,255,0.4)';
      ctx.beginPath();
      ctx.arc(S * 0.21, -S * 0.135, S * 0.013, 0, TAU);
      ctx.fill();
      // 胸鳍
      ctx.fillStyle = shade(C.anglerLight, sh, 0.9, 0.1);
      ctx.beginPath();
      ctx.ellipse(-S * 0.05, S * 0.08, S * 0.1, S * 0.05, 0.6 + fin, 0, TAU);
      ctx.fill();
    }
    // 钓竿与发光诱饵
    const sway = Math.sin(t * 0.9) * 0.08;
    const ex = S * 0.62 + sway * S;
    const ey = -S * 0.62 + Math.cos(t * 0.7) * S * 0.04;
    ctx.strokeStyle = shade(C.rod, sh, 0.9, 0.2);
    ctx.lineWidth = Math.max(0.006, S * 0.025);
    ctx.beginPath();
    ctx.moveTo(S * 0.18, -S * 0.34);
    ctx.quadraticCurveTo(S * 0.35, -S * 0.85, ex, ey);
    ctx.stroke();
    const pulse = 0.7 + 0.3 * Math.sin(t * 1.1);
    const gf = glowFade(sh);
    drawGlow(ctx, glowSprite(120, 240, 230), ex, ey, S * 0.5, 0.55 * pulse * gf);
    drawGlow(ctx, glowSprite(230, 255, 250), ex, ey, S * 0.09, 0.95 * gf);
  }
}

/**
 * 暗处的发光栉水母：只有当镜头靠近、并把它放在画面中央附近时才会显现。
 */
export class GlowJelly extends CombJelly {
  readonly info = 'glowJelly';

  constructor(seed: number) {
    super(seed, HIDDEN.glowJelly.x, HIDDEN.glowJelly.y, HIDDEN.glowJelly.z, 0.4);
    this.midwater = false;
    this.glowing = true;
    this.radius = 0.5;
  }

  driver(env: CreatureEnv): number {
    return env.mode === 'explore' ? 1 : 0;
  }

  /** 根据屏幕位置与缩放计算可见度：越靠近画面中心、镜头越近，越清晰。 */
  updateVisibility(rc: RenderCtx): void {
    if (!rc.cam.project(this.x, this.y, this.z, P)) {
      this.extraAlpha = 0;
      return;
    }
    const dx = (P.x - rc.w / 2) / (rc.w / 2);
    const dy = (P.y - rc.h / 2) / (rc.h / 2);
    const centered = 1 - smoothstep(0.35, 0.9, Math.hypot(dx, dy));
    const near = smoothstep(18, 70, P.s);
    this.extraAlpha = clamp(centered * near);
  }

  render(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number, sh: Shade): void {
    const gf = glowFade(sh);
    const t = this.clock;
    const breathe = 0.75 + 0.25 * Math.sin(t * 0.6);
    // 光晕
    drawGlow(ctx, glowSprite(54, 200, 197), 0, 0, this.bodyLen * 2.4, 0.5 * breathe * gf);
    super.render(ctx, rc, scale, sh);
    // 沿栉板流动的蓝绿色冷光
    const spr = glowSprite(141, 220, 208);
    for (let k = 0; k < 8; k++) {
      const u = (k / 8 + t * 0.15) % 1;
      const y = (u - 0.5) * this.bodyLen * 0.8;
      const x = Math.sin(u * Math.PI) * this.bodyLen * 0.38 * (k % 2 ? 1 : -1);
      drawGlow(ctx, spr, x, y, Math.max(0.03, 3 / scale), 0.7 * gf * breathe);
    }
  }
}
