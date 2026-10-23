import type { Camera } from '../core/Camera';
import { hex, mixRGB, rgba, sampleStops, type RGB, type Shade } from '../core/color';
import { clamp, fract, hash1, lerp, noise1, smoothstep } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';

/**
 * LightingManager：管理随深度变化的海水颜色、环境光、雾化、局部暖光、
 * 海面光束与整体调色。所有实体通过 shadeAt() 获得统一的着色参数。
 */

const WATER_STOPS: Array<[number, RGB]> = [
  [-1, hex('#62c0e4')],
  [0, hex('#55b5df')],
  [12, hex('#3c9fd2')],
  [40, hex('#2b86c2')],
  [80, hex('#2272ae')],
  [150, hex('#1a5c95')],
  [300, hex('#144b79')],
  [520, hex('#103D62')],
  [900, hex('#0c2f51')],
  [1300, hex('#0a2543')],
  [1800, hex('#071B35')],
  [2400, hex('#05142a')],
];

const LIGHT_STOPS: Array<[number, number]> = [
  [0, 1.06],
  [40, 1.0],
  [90, 0.9],
  [160, 0.74],
  [320, 0.55],
  [650, 0.42],
  [1100, 0.35],
  [1800, 0.33],
];

const TINT_STOPS: Array<[number, RGB]> = [
  [0, [1.02, 1.02, 1.0]],
  [60, [0.93, 0.98, 1.02]],
  [300, [0.72, 0.86, 1.0]],
  [1800, [0.64, 0.8, 1.0]],
];

function sampleScalar(stops: Array<[number, number]>, x: number): number {
  if (x <= stops[0][0]) return stops[0][1];
  const n = stops.length;
  if (x >= stops[n - 1][0]) return stops[n - 1][1];
  let i = 0;
  while (i < n - 2 && x > stops[i + 1][0]) i++;
  const t = (x - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
  return lerp(stops[i][1], stops[i + 1][1], t);
}

export interface LightingInput {
  /** 能见度（米） */
  vis: number;
  /** 深海局部暖光强度 */
  focusLight: number;
  focusX: number;
  focusY: number;
  /** 环境生物发光强度 */
  bioGlow: number;
  /** 光束强度倍率 */
  rays: number;
  /** 暗角强度 */
  vignette: number;
  /** 仰视程度（0~1）：镜头从下方仰拍时，画面上方透出海面的天光 */
  lookUp?: number;
}

export class LightingManager {
  depth = 60;
  vis = 70;
  focusLight = 0;
  focusX = 0;
  focusY = 0;
  bioGlow = 0;
  raysMul = 1;
  vignette = 0.35;
  lookUp = 0;
  readonly water: RGB = [30, 90, 150];
  private readonly tmpA: RGB = [0, 0, 0];
  private readonly tmpB: RGB = [0, 0, 0];
  private cam!: Camera;

  update(cam: Camera, input: LightingInput): void {
    this.cam = cam;
    this.depth = cam.cy;
    this.vis = input.vis;
    this.focusLight = input.focusLight;
    this.focusX = input.focusX;
    this.focusY = input.focusY;
    this.bioGlow = input.bioGlow;
    this.raysMul = input.rays;
    this.vignette = input.vignette;
    this.lookUp = input.lookUp ?? 0;
    this.waterAt(this.depth, this.water);
  }

  waterAt(y: number, out: RGB): RGB {
    return sampleStops(WATER_STOPS, y, out);
  }

  lightAt(y: number): number {
    return sampleScalar(LIGHT_STOPS, y);
  }

  /** 光线强度（0~1），用于光束、焦散等只在浅层出现的效果。 */
  sunAt(y: number): number {
    return clamp(Math.exp(-Math.max(0, y) / 70));
  }

  shadeAt(x: number, y: number, z: number, out: Shade): Shade {
    const cam = this.cam;
    out.light = this.lightAt(y);
    sampleStops(TINT_STOPS, y, out.tint);
    // 深海局部散射光：主体附近更亮，远处沉入黑暗
    if (this.focusLight > 0.001) {
      const dx = x - this.focusX;
      const dy = (y - this.focusY) * 1.4;
      const dz = Math.max(0, z) * 0.6;
      const r2 = (dx * dx + dy * dy + dz * dz) / (37.7 * 37.7);
      const k = this.focusLight * Math.exp(-r2);
      out.light += k * 0.55;
      out.warm = k * 0.55;
      out.light *= lerp(1, 0.55, this.focusLight * (1 - Math.exp(-r2 * 0.5)));
    } else {
      out.warm = 0;
    }
    const dEff = Math.max(0, z) + (cam ? cam.dist * 0.1 : 0);
    out.fog = clamp(1 - Math.exp(-dEff / Math.max(5, this.vis)), 0, 0.97);
    this.waterAt(y, out.fogC);
    return out;
  }

  /** 背景：远处海水的垂直渐变，以及浅层时朝向海面的明亮辉光。 */
  drawBackground(rc: RenderCtx): void {
    const { ctx, cam, w, h, dpr } = rc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const far = 400;
    const b = cam.boundsAt(far);
    const top = this.waterAt(b.t, this.tmpA);
    const bot = this.waterAt(b.b, this.tmpB);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(top));
    const mid: RGB = [0, 0, 0];
    this.waterAt((b.t + b.b) / 2, mid);
    g.addColorStop(0.5, rgba(mid));
    g.addColorStop(1, rgba(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 朝向海面的天光：越靠近海面越亮
    const sun = this.sunAt(cam.cy);
    if (sun > 0.02) {
      const sy = (0 - cam.cy) * cam.scaleAt(far) + cam.py;
      const gy = Math.min(h * 0.2, sy + h * 0.1);
      const rg = ctx.createRadialGradient(w * 0.42, gy - h * 0.35, 0, w * 0.42, gy - h * 0.35, Math.max(w, h) * 0.95);
      rg.addColorStop(0, `rgba(190,235,255,${0.32 * sun})`);
      rg.addColorStop(0.45, `rgba(140,210,245,${0.12 * sun})`);
      rg.addColorStop(1, 'rgba(120,200,240,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
      // 仰拍：画面上缘透出柔和的海面天光（斯涅尔窗），让上方经过的身体显出轮廓
      const up = this.lookUp * sun;
      if (up > 0.01) {
        const ug = ctx.createLinearGradient(0, 0, 0, h * 0.62);
        ug.addColorStop(0, `rgba(205,240,255,${0.3 * up})`);
        ug.addColorStop(0.4, `rgba(150,215,245,${0.12 * up})`);
        ug.addColorStop(1, 'rgba(120,200,240,0)');
        ctx.fillStyle = ug;
        ctx.fillRect(0, 0, w, h * 0.62);
        // 脚下是更深的海水
        const dg = ctx.createLinearGradient(0, h * 0.45, 0, h);
        dg.addColorStop(0, 'rgba(8,40,80,0)');
        dg.addColorStop(1, `rgba(8,40,80,${0.35 * this.lookUp})`);
        ctx.fillStyle = dg;
        ctx.fillRect(0, h * 0.45, w, h * 0.55);
      }
    }
  }

  /** 从海面射入的流动光束（加色混合）。 */
  drawRays(rc: RenderCtx): void {
    const { ctx, cam, w, h, dpr, time, quality } = rc;
    const sun = this.sunAt(cam.cy - 10) * this.raysMul;
    if (sun < 0.02) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = quality.rays;
    const zRay = 60;
    const s = cam.scaleAt(zRay);
    const surfaceY = cam.py + (0 - cam.cy) * s;
    const topY = Math.max(-h * 0.1, surfaceY);
    if (topY > h) return;
    const len = h * 1.25;
    const spacing = (w * 1.6) / n;
    const camShift = -(cam.cx * s * 0.6);
    ctx.globalCompositeOperation = 'lighter';
    const tex = textures().ray;
    for (let i = 0; i < n; i++) {
      const seed = hash1(i * 7 + 3);
      const sway = noise1(time * 0.07 + i * 3.1, 11) * spacing * 0.45;
      const base = ((i * spacing + camShift + sway) % (w * 1.6) + w * 1.6) % (w * 1.6) - w * 0.3;
      const width = spacing * (0.35 + seed * 0.7);
      const flick = 0.55 + 0.45 * (0.5 + 0.5 * noise1(time * 0.13 + seed * 50, 5));
      ctx.globalAlpha = Math.min(1, 0.16 * sun * flick);
      // 斜切变换：光束上窄下宽、略微倾斜
      const shift = w * 0.16;
      ctx.setTransform((dpr * width) / tex.width, 0, (dpr * shift) / tex.height, (dpr * len) / tex.height, dpr * (base - width / 2), dpr * topY);
      ctx.drawImage(tex, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 暗角、深海局部光的整体调色。 */
  drawGrade(rc: RenderCtx): void {
    const { ctx, w, h, dpr } = rc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const deep = smoothstep(150, 1200, this.depth);
    const v = this.vignette;
    if (v > 0.01) {
      const r = Math.hypot(w, h) * 0.62;
      const g = ctx.createRadialGradient(w / 2, h * 0.48, r * (0.42 - deep * 0.1), w / 2, h * 0.5, r);
      const dark = mixRGB([4, 16, 34], [2, 8, 18], deep, this.tmpA);
      g.addColorStop(0, rgba(dark, 0));
      g.addColorStop(1, rgba(dark, v * (0.75 + deep * 0.25)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** 生物发光的随机闪点（低频、柔和，不会造成闪烁不适）。 */
  drawBioSparks(rc: RenderCtx): void {
    const amt = this.bioGlow;
    if (amt < 0.02) return;
    const { ctx, cam, dpr, time } = rc;
    const n = Math.round(46 * amt * rc.quality.creatureDensity);
    const P = { x: 0, y: 0, s: 0 };
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const seed = i * 13 + 5;
      const z = lerp(-4, 60, hash1(seed));
      const b = cam.boundsAt(z, 2);
      const wx = b.l + fract(hash1(seed + 1) + time * 0.004 * (hash1(seed + 9) - 0.5)) * (b.r - b.l);
      const wy = b.t + fract(hash1(seed + 2) - time * 0.002) * (b.b - b.t);
      if (!cam.project(wx, wy, z, P)) continue;
      const phase = time * (0.25 + hash1(seed + 3) * 0.35) + hash1(seed + 4) * 10;
      const pulse = Math.pow(Math.max(0, Math.sin(phase)), 6);
      if (pulse < 0.02) continue;
      const r = Math.max(1.2, 0.06 * P.s) * (1 + pulse);
      const cyan = hash1(seed + 5) > 0.3;
      const g = ctx.createRadialGradient(P.x * dpr, P.y * dpr, 0, P.x * dpr, P.y * dpr, r * 4 * dpr);
      const col = cyan ? '54,200,197' : '141,220,208';
      g.addColorStop(0, `rgba(${col},${0.75 * pulse * amt})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = g;
      ctx.fillRect((P.x - r * 4) * dpr, (P.y - r * 4) * dpr, r * 8 * dpr, r * 8 * dpr);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
