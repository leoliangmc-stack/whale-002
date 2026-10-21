/**
 * 2.5D 透视相机。
 *
 * 世界坐标：x 向右（米），y 向下表示深度（米，海面为 0），z 指向画面内部（米）。
 * 叙事主体（鲸鱼、鲸骨）位于 z = 0 的参考平面上；背景层 z > 0，前景层 z < 0。
 * 相机位于 z = -dist 处、朝 +z 方向观察，通过“镜头平移（lens shift）”把目标点放在
 * 指定的屏幕位置，同时保留真实的视差、透视缩放和俯视角度。
 */

export interface ShotParams {
  /** 目标点（z=0 平面上）的世界坐标 */
  tx: number;
  ty: number;
  /** z=0 平面上可见的高度（米），即景别 */
  frameH: number;
  /** 目标点在屏幕上的位置（0~1） */
  sx: number;
  sy: number;
  /** 相机高于目标点的距离（米），产生俯视透视 */
  elev: number;
  /** 相机相对目标点的横向偏移（米） */
  lat: number;
}

export interface Projected {
  x: number;
  y: number;
  /** 该深度下每米对应的屏幕像素（CSS 像素） */
  s: number;
}

export const DEFAULT_FOV = (40 * Math.PI) / 180;

export class Camera {
  w = 1;
  h = 1;
  fov = DEFAULT_FOV;
  f = 1;
  cx = 0;
  cy = 0;
  cz = -10;
  dist = 10;
  px = 0;
  py = 0;
  readonly shot: ShotParams = { tx: 0, ty: 0, frameH: 20, sx: 0.5, sy: 0.5, elev: 0, lat: 0 };

  setViewport(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.update();
  }

  setShot(s: ShotParams): void {
    const t = this.shot;
    t.tx = s.tx;
    t.ty = s.ty;
    t.frameH = s.frameH;
    t.sx = s.sx;
    t.sy = s.sy;
    t.elev = s.elev;
    t.lat = s.lat;
    this.update();
  }

  get aspect(): number {
    return this.w / this.h;
  }

  /** 每米像素（z=0 平面） */
  get ppm(): number {
    return this.f / this.dist;
  }

  update(): void {
    const s = this.shot;
    const tanHalf = Math.tan(this.fov / 2);
    this.f = this.h / (2 * tanHalf);
    this.dist = Math.max(0.05, s.frameH / (2 * tanHalf));
    this.cz = -this.dist;
    this.cx = s.tx + s.lat;
    this.cy = s.ty - s.elev;
    const k = this.f / this.dist;
    this.px = s.sx * this.w - (s.tx - this.cx) * k;
    this.py = s.sy * this.h - (s.ty - this.cy) * k;
  }

  scaleAt(z: number): number {
    const d = z - this.cz;
    return d > 0.05 ? this.f / d : this.f / 0.05;
  }

  /** 投影一个世界点。返回 false 表示在相机后方。 */
  project(x: number, y: number, z: number, out: Projected): boolean {
    const d = z - this.cz;
    if (d <= 0.05) {
      out.x = out.y = -1e5;
      out.s = 0;
      return false;
    }
    const s = this.f / d;
    out.s = s;
    out.x = this.px + (x - this.cx) * s;
    out.y = this.py + (y - this.cy) * s;
    return true;
  }

  /** 把屏幕点反投影到深度 z 的平面上。 */
  unproject(sx: number, sy: number, z: number, out: { x: number; y: number }): { x: number; y: number } {
    const s = this.scaleAt(z);
    out.x = (sx - this.px) / s + this.cx;
    out.y = (sy - this.py) / s + this.cy;
    return out;
  }

  /** 某深度平面上的可见世界范围（含边距）。 */
  boundsAt(z: number, margin = 0): { l: number; r: number; t: number; b: number } {
    const s = this.scaleAt(z);
    return {
      l: (0 - this.px) / s + this.cx - margin,
      r: (this.w - this.px) / s + this.cx + margin,
      t: (0 - this.py) / s + this.cy - margin,
      b: (this.h - this.py) / s + this.cy + margin,
    };
  }

  /** 世界中 y 平面（如海床）在远处收敛的地平线屏幕高度。 */
  horizonY(): number {
    return this.py;
  }

  /** 在给定深度绘制时使用的变换：原点在 (x,y,z)，单位为米。 */
  applyTransform(ctx: CanvasRenderingContext2D, dpr: number, x: number, y: number, z: number, rot = 0, flipX = false): number {
    const d = z - this.cz;
    const s = this.f / Math.max(0.05, d);
    const sxp = this.px + (x - this.cx) * s;
    const syp = this.py + (y - this.cy) * s;
    const k = s * dpr;
    if (rot === 0) {
      ctx.setTransform(flipX ? -k : k, 0, 0, k, sxp * dpr, syp * dpr);
    } else {
      const c = Math.cos(rot) * k;
      const sn = Math.sin(rot) * k;
      if (flipX) ctx.setTransform(-c, -sn, -sn, c, sxp * dpr, syp * dpr);
      else ctx.setTransform(c, sn, -sn, c, sxp * dpr, syp * dpr);
    }
    return s;
  }
}
