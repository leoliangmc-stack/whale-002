import type { Shade } from '../../core/color';
import { clamp, damp, lerp, rng, sampleProfile, TAU } from '../../core/math';
import type { RenderCtx } from '../../core/types';
import { WORLD } from '../../config/stages';
import type { EcoState } from '../../systems/StoryTimeline';
import { REST_GROUND, restSpineDY, S_REF, UPPER, WHALE_LEN } from '../WhaleBody';

/**
 * 深海生物的公共基类。
 *
 * - 出现与否由“驱动值”（来自叙事生态状态）与个体阈值决定，数量随进度平滑增减，可逆；
 * - 出现时从远处游来/走来，消失时离开并淡出；
 * - 所有动画使用个体自己的时钟（受生态时间缩放），暂停时完全静止；
 * - 侧视绘制：yaw 表示转身（0 朝右，π 朝左），通过水平缩放模拟三维转身，避免瞬间翻转。
 */

export type CreatureMode = 'story' | 'explore';

export interface CreatureEnv {
  mode: CreatureMode;
  p: number;
  eco: EcoState;
  camY: number;
  time: number;
  reduced: boolean;
}

export const SEABED = WORLD.seabedY;
export const REST_X = WORLD.restX;
const Y_REST = WORLD.seabedY - REST_GROUND;

export abstract class Creature {
  abstract readonly info: string;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** 0 朝右，π 朝左 */
  yaw = 0;
  /** 低头为正 */
  tilt = 0;
  alpha = 0;
  active = false;
  /** 当前是否被“需要”（驱动值高于阈值） */
  wanted = false;
  /** 出现阈值 */
  th = 0;
  /** 个体时钟（受生态时间缩放） */
  clock = 0;
  readonly rand: () => number;
  readonly phase: number;
  /** 命中半径（米） */
  radius = 0.3;
  /** 体长（米），用于细节分级 */
  size = 0.3;
  /** 中层水域生物：只在相机附近深度更新 */
  midwater = false;
  /** 绘制时可额外附加的整体透明度（如只在近处可见的发光生物） */
  extraAlpha = 1;
  /** 群体类对象（鱼群、端足类群）自行处理变换与绘制 */
  custom = false;
  /** 中层生物的名义深度（构建时的位置） */
  homeY = 0;
  /** 叙事下沉途中的水体锚点：鲸鱼经过 homeY 那一刻的水体位置（null 表示不随水体移动） */
  water: { ox: number; oy: number; wy: number } | null = null;
  /** 下沉途中是否与鲸鱼相遇；其余中层生物在下沉时隐去，让深海保持空旷 */
  encounter = false;
  /** 本帧的绘制偏移（米）：随水体参照系漂移 */
  shiftX = 0;
  shiftY = 0;

  constructor(readonly seed: number) {
    this.rand = rng(seed * 7919 + 17);
    this.phase = this.rand() * TAU;
  }

  /** 出现驱动值 0~1 */
  abstract driver(env: CreatureEnv): number;
  /** 激活时放到“到达”位置 */
  abstract spawn(env: CreatureEnv): void;
  /** 行为更新（dt 已按生态时间缩放，且已分步） */
  abstract step(dt: number, env: CreatureEnv): void;
  /** 在局部坐标中绘制（变换已设置好）；scale 为每米像素 */
  abstract render(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number, sh: Shade): void;

  /** custom 为 true 时由管理器调用：自行设置变换并绘制。 */
  drawCustom(_rc: RenderCtx, _sh: Shade): void {}

  /** 命中测试使用的点（默认为自身位置）；群体对象可返回离点击最近的个体。 */
  hitPoint(_rc: RenderCtx, _sx: number, _sy: number): { x: number; y: number; z: number } {
    return this;
  }

  updatePresence(dt: number, env: CreatureEnv): void {
    const d = this.driver(env);
    const want = clamp((d - this.th) / 0.05);
    this.wanted = want > 0.5;
    if (!this.active && want > 0) {
      this.active = true;
      this.alpha = 0;
      this.spawn(env);
    }
    if (!this.active) return;
    const rate = this.wanted ? 0.9 : 1.4;
    this.alpha = clamp(this.alpha + (want - this.alpha) * Math.min(1, dt * rate) + (this.wanted ? dt * 0.05 : -dt * 0.05));
    if (!this.wanted && this.alpha <= 0.002) {
      this.active = false;
      this.alpha = 0;
    }
  }

  /** 平滑转身：根据水平速度方向改变 yaw。 */
  turnToward(dir: number, dt: number, rate = 2.5): void {
    const target = dir >= 0 ? 0 : Math.PI;
    this.yaw = damp(this.yaw, target, rate, dt);
  }

  get facing(): number {
    return Math.cos(this.yaw) >= 0 ? 1 : -1;
  }

  /** 设置局部绘制变换，返回每米像素。 */
  beginLocal(rc: RenderCtx): number {
    const s = rc.cam.applyTransform(rc.ctx, rc.dpr, this.x, this.y, this.z, 0, false);
    const c = Math.cos(this.yaw);
    rc.ctx.rotate(this.tilt * c);
    const sx = Math.abs(c) < 0.1 ? 0.1 * Math.sign(c || 1) : c;
    rc.ctx.scale(sx, 1);
    return s;
  }
}

// ------------------------------------------------------------------ 鲸落现场的近似几何

/** 静卧鲸鱼尸体在 x 处的背部高度（未分解时）。 */
export function carcassTop(x: number, shrink = 0): number {
  const s = S_REF - (x - REST_X) / WHALE_LEN;
  if (s < 0 || s > 1) return SEABED;
  const up = sampleProfile(UPPER, s);
  const spine = Y_REST + restSpineDY(s);
  return spine - up * (1 - 0.42 * shrink);
}

export const CARCASS_X0 = REST_X - (1 - S_REF) * WHALE_LEN + 1.03;
export const CARCASS_X1 = REST_X + S_REF * WHALE_LEN - 0.51;

/** 坍塌后骨骼顶面的近似高度（用于在骨头上爬行的小动物）。 */
export function boneTop(x: number): number {
  const s = S_REF - (x - REST_X) / WHALE_LEN;
  if (s < 0 || s > 1) return SEABED;
  if (s < 0.3) {
    // 头骨：吻端低、颅顶高
    const t = s / 0.3;
    return lerp(SEABED - 2.31, Y_REST - 1.06, Math.pow(t, 0.8));
  }
  if (s < 0.9) return lerp(Y_REST - 0.21, SEABED - 0.55, Math.pow((s - 0.3) / 0.6, 1.6));
  return SEABED - 0.26;
}

// ------------------------------------------------------------------ 发光精灵缓存

const glowCache = new Map<string, HTMLCanvasElement>();

/** 指定颜色的柔和发光精灵（用于发光器、光圈）。 */
export function glowSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const key = `${r | 0},${g | 0},${b | 0}`;
  let c = glowCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${key},1)`);
  gr.addColorStop(0.18, `rgba(${key},0.75)`);
  gr.addColorStop(0.5, `rgba(${key},0.18)`);
  gr.addColorStop(1, `rgba(${key},0)`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  glowCache.set(key, c);
  return c;
}

/** 在局部坐标中画一个发光点（加色混合）。 */
export function drawGlow(ctx: CanvasRenderingContext2D, spr: HTMLCanvasElement, x: number, y: number, r: number, a: number): void {
  if (a <= 0.003) return;
  const prevA = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevA * Math.min(1, a);
  ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}

/** 生物发光受雾化减弱的系数。 */
export function glowFade(sh: Shade): number {
  return 1 - sh.fog * 0.75;
}

/** 绕锚点漫游的转向力（返回期望速度分量写入 out）。 */
export function wanderSteer(
  c: Creature,
  ax: number,
  ay: number,
  az: number,
  radius: number,
  speed: number,
  t: number,
  out: { x: number; y: number; z: number },
): void {
  const dx = ax - c.x;
  const dy = ay - c.y;
  const dz = az - c.z;
  const d = Math.hypot(dx, dy * 1.5, dz) || 1;
  const pull = clamp((d - radius * 0.4) / radius, 0, 2);
  const nx = Math.sin(t * 0.31 + c.phase) + 0.5 * Math.sin(t * 0.73 + c.phase * 2.1);
  const ny = Math.sin(t * 0.27 + c.phase * 1.3) * 0.35;
  const nz = Math.cos(t * 0.21 + c.phase * 0.7) * 0.6;
  out.x = (nx * (1 - Math.min(1, pull)) + (dx / d) * pull) * speed;
  out.y = (ny * (1 - Math.min(1, pull)) + (dy / d) * pull) * speed;
  out.z = (nz * (1 - Math.min(1, pull)) + (dz / d) * pull) * speed;
}
