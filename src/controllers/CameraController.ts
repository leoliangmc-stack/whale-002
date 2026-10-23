import { Camera, type ShotParams } from '../core/Camera';
import { clamp, damp, lerp, noise1 } from '../core/math';
import { EXPLORE_BOUNDS } from '../config/scene';
import { WORLD } from '../config/stages';

/**
 * CameraController：叙事模式下镜头完全由时间线决定（再叠加极轻微的“手持”漂移）；
 * 自由探索模式下由用户拖动 / 缩放控制，带惯性、边界约束与跟随生物。
 */

export interface ExploreTarget {
  x: number;
  y: number;
  z: number;
}

export class CameraController {
  readonly cam = new Camera();
  private readonly shot: ShotParams = { tx: 0, ty: 0, frameH: 20, sx: 0.5, sy: 0.5, elev: 0, lat: 0 };

  // ---- 探索模式状态（目标值与当前值）
  ex = { x: WORLD.restX, y: WORLD.seabedY - 17.1, frameH: 51.4 };
  private exGoal = { x: WORLD.restX, y: WORLD.seabedY - 17.1, frameH: 51.4 };
  private vel = { x: 0, y: 0 };
  follow: ExploreTarget | null = null;
  /** 正在飞向某处（返回全景等） */
  private flying = false;

  setViewport(w: number, h: number): void {
    this.cam.setViewport(w, h);
  }

  /** 叙事镜头：直接采用时间线的结果，叠加轻微的呼吸感漂移。 */
  applyStory(s: ShotParams, time: number, handheld: number): void {
    const sh = this.shot;
    sh.tx = s.tx;
    sh.ty = s.ty;
    sh.frameH = s.frameH;
    sh.sx = s.sx;
    sh.sy = s.sy;
    sh.elev = s.elev;
    sh.lat = s.lat;
    if (handheld > 0) {
      const a = s.frameH * 0.006 * handheld;
      sh.tx += noise1(time * 0.11, 3) * a;
      sh.ty += noise1(time * 0.09, 7) * a * 0.8;
    }
    this.cam.setShot(sh);
  }

  // ------------------------------------------------------------ 探索模式

  enterExplore(from: ShotParams, overview: { x: number; y: number; frameH: number }): void {
    this.ex = { x: from.tx, y: from.ty, frameH: from.frameH };
    this.exGoal = { ...overview };
    this.vel = { x: 0, y: 0 };
    this.follow = null;
    this.flying = true;
  }

  flyTo(x: number, y: number, frameH: number): void {
    this.exGoal = { x, y, frameH };
    this.vel = { x: 0, y: 0 };
    this.follow = null;
    this.flying = true;
  }

  /** 屏幕像素拖动 → 世界平移（拖动方向与画面移动一致）。 */
  pan(dx: number, dy: number): void {
    const ppm = this.cam.ppm;
    this.exGoal.x -= dx / ppm;
    this.exGoal.y -= dy / ppm;
    this.follow = null;
    this.flying = false;
    this.clampGoal();
  }

  panEnd(vx: number, vy: number): void {
    const ppm = this.cam.ppm;
    this.vel.x = -vx / ppm;
    this.vel.y = -vy / ppm;
  }

  /** 以屏幕点为中心缩放（factor > 1 放大）。 */
  zoom(factor: number, sx: number, sy: number): void {
    const cam = this.cam;
    const g = this.exGoal;
    const before = g.frameH;
    const after = clamp(before / factor, EXPLORE_BOUNDS.frameMin, EXPLORE_BOUNDS.frameMax);
    // 让光标下的世界点保持不动（在 z=0 平面上）
    const k = 1 - after / before;
    const ppm = cam.h / before;
    const wx = (sx - cam.w / 2) / ppm;
    const wy = (sy - cam.h / 2) / ppm;
    g.x += wx * k;
    g.y += wy * k;
    g.frameH = after;
    this.flying = false;
    this.clampGoal();
  }

  private clampGoal(): void {
    const b = EXPLORE_BOUNDS;
    const g = this.exGoal;
    g.x = clamp(g.x, b.xMin, b.xMax);
    // 镜头下沿不低于海床太多
    const halfH = g.frameH / 2;
    g.y = clamp(g.y, b.yMin, Math.max(b.yMin, b.yMax - halfH * 0.35));
  }

  updateExplore(dt: number): void {
    const g = this.exGoal;
    if (this.follow) {
      g.x = lerp(g.x, this.follow.x, 1 - Math.exp(-dt * 2.2));
      g.y = lerp(g.y, this.follow.y, 1 - Math.exp(-dt * 2.2));
      this.clampGoal();
    } else if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.01) {
      g.x += this.vel.x * dt;
      g.y += this.vel.y * dt;
      this.vel.x *= Math.exp(-dt / 0.3);
      this.vel.y *= Math.exp(-dt / 0.3);
      this.clampGoal();
    }
    const rate = this.flying ? 2.4 : 9;
    this.ex.x = damp(this.ex.x, g.x, rate, dt);
    this.ex.y = damp(this.ex.y, g.y, rate, dt);
    this.ex.frameH = Math.exp(damp(Math.log(this.ex.frameH), Math.log(g.frameH), rate, dt));
    if (this.flying && Math.abs(this.ex.frameH - g.frameH) < 0.02 * g.frameH && Math.abs(this.ex.x - g.x) < 0.05) this.flying = false;
    const sh = this.shot;
    sh.tx = this.ex.x;
    sh.ty = this.ex.y;
    sh.frameH = this.ex.frameH;
    sh.sx = 0.5;
    sh.sy = 0.5;
    // 放大时相机更贴近，俯视角相应减小
    sh.elev = clamp(this.ex.frameH * 0.22, 0.05, 10.3);
    sh.lat = 0;
    this.cam.setShot(sh);
  }

  get exploreFrameH(): number {
    return this.ex.frameH;
  }

  get currentShot(): ShotParams {
    return this.shot;
  }
}
