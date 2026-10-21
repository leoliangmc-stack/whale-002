import { hex, makeShade, shadeRGB, type RGB, type Shade } from '../core/color';
import { hash1, mod, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import type { QualitySettings } from '../config/performance';

/**
 * ParticleManager：漂浮颗粒（海洋雪）、着陆时扬起的沉积物、海面喷气水雾与气泡。
 *  - 海洋雪使用固定数组 + 视差偏移，永不重新分配；
 *  - 沉积物与水雾是叙事进度的解析函数（位置 = f(局部时间)），可以完美倒放。
 */

const SNOW_MAX = 300;
const SAND = hex('#8c8576');

export class ParticleManager {
  private readonly u = new Float32Array(SNOW_MAX);
  private readonly v = new Float32Array(SNOW_MAX);
  private readonly d = new Float32Array(SNOW_MAX);
  private readonly ox = new Float32Array(SNOW_MAX);
  private readonly oy = new Float32Array(SNOW_MAX);
  private readonly size = new Float32Array(SNOW_MAX);
  private readonly ph = new Float32Array(SNOW_MAX);
  private lastCx = NaN;
  private lastCy = NaN;
  private screenVy = 0;
  private readonly sh: Shade = makeShade();
  quality!: QualitySettings;

  constructor() {
    for (let i = 0; i < SNOW_MAX; i++) {
      this.u[i] = hash1(i * 7 + 1);
      this.v[i] = hash1(i * 7 + 2);
      const r = hash1(i * 7 + 3);
      // 远、中、近三层：近处颗粒少而大
      this.d[i] = r < 0.55 ? 0.25 + r * 0.6 : r < 0.9 ? 0.6 + (r - 0.55) * 1.6 : 1.4 + (r - 0.9) * 8;
      this.size[i] = 0.6 + hash1(i * 7 + 4) * 1.2;
      this.ph[i] = hash1(i * 7 + 5) * 100;
    }
  }

  /** 镜头移动 → 颗粒视差位移（像素）。 */
  update(rc: RenderCtx, dt: number): void {
    const cam = rc.cam;
    const ppm = cam.ppm;
    if (Number.isNaN(this.lastCx)) {
      this.lastCx = cam.cx;
      this.lastCy = cam.cy;
    }
    let dx = (cam.cx - this.lastCx) * ppm;
    let dy = (cam.cy - this.lastCy) * ppm;
    // 跳转（重新开始 / 切换章节）时不要产生巨大的拖影
    if (Math.abs(dx) > rc.w || Math.abs(dy) > rc.h * 1.5) {
      dx = 0;
      dy = 0;
    }
    this.screenVy = dt > 0 ? dy / dt : 0;
    const drift = rc.reducedMotion ? 0.4 : 1;
    for (let i = 0; i < SNOW_MAX; i++) {
      const k = this.d[i];
      this.ox[i] -= dx * k;
      this.oy[i] -= dy * k;
      this.oy[i] += dt * 3.5 * k * drift;
      this.ox[i] += dt * 1.2 * k * drift * Math.sin(rc.time * 0.2 + this.ph[i]);
    }
    this.lastCx = cam.cx;
    this.lastCy = cam.cy;
  }

  /** 绘制海洋雪。near=true 时只画近景大颗粒（在主体之后再画，形成前景层）。 */
  drawSnow(rc: RenderCtx, near: boolean, clipTop = -1e9, amount = 1): void {
    const { ctx, cam, dpr, w, h } = rc;
    const depth = cam.cy;
    const dens = (0.3 + 0.7 * smoothstep(20, 600, depth)) * amount;
    const n = Math.min(SNOW_MAX, Math.round(rc.quality.snow * dens));
    if (n <= 0) return;
    const sh = this.sh;
    rc.light.shadeAt(cam.cx, depth, 0, sh);
    const lum = Math.min(1, sh.light * 0.9 + sh.warm * 0.8 + 0.12);
    const tex = textures().dot;
    const margin = 40;
    const W = w + margin * 2;
    const H = h + margin * 2;
    const streak = Math.min(60, Math.abs(this.screenVy) / 60);
    // 快速上升 / 下降时降低亮度，避免高速闪动
    const speedFade = 1 / (1 + Math.abs(this.screenVy) / 900);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const k = this.d[i];
      const isNear = k > 1.3;
      if (near !== isNear) continue;
      const x = mod(this.u[i] * W + this.ox[i], W) - margin;
      const y = mod(this.v[i] * H + this.oy[i], H) - margin;
      if (y < clipTop) continue;
      const s = this.size[i] * (isNear ? k * 2.2 : 0.8 + k * 1.6) * Math.min(1.6, Math.max(0.6, cam.ppm / 30));
      const a = (isNear ? 0.16 : 0.12 + 0.3 * Math.min(1, k)) * lum * speedFade;
      ctx.globalAlpha = a;
      const sl = s + streak * k;
      ctx.drawImage(tex, x - s, y - sl, s * 2, sl * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 鲸鱼接触海床时扬起的柔和沉积物云。progress 0~1 对应约 11 秒。 */
  drawSediment(rc: RenderCtx, progress: number, cx: number, seabedY: number): void {
    if (progress <= 0 || progress >= 1) return;
    const { ctx, cam, dpr } = rc;
    const T = progress * 11;
    const n = rc.quality.sediment;
    const sh = this.sh;
    rc.light.shadeAt(cx, seabedY, 0, sh);
    const tex = this.sandDot(shadeRGB(SAND, sh, this.tmpC, 0.35));
    const P = { x: 0, y: 0, s: 0 };
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < n; i++) {
      const r1 = hash1(i * 5 + 1);
      const r2 = hash1(i * 5 + 2);
      const r3 = hash1(i * 5 + 3);
      const r4 = hash1(i * 5 + 4);
      const x0 = cx - 7 + r1 * 13;
      const z0 = (r2 - 0.5) * 4;
      const side = x0 < cx - 1 ? -1 : 1;
      const vx = side * (0.6 + r3 * 2.4);
      const vy = 0.25 + r4 * 1.1;
      const vz = (r2 - 0.5) * 2.5;
      const tau = 1.6;
      const e = 1 - Math.exp(-T / tau);
      const x = x0 + vx * tau * e + Math.sin(T * 0.3 + i) * 0.2 * T * 0.2;
      const y = Math.min(seabedY - 0.05, seabedY - 0.1 - vy * tau * e + 0.012 * T * T);
      const z = z0 + vz * tau * e;
      if (!cam.project(x, y, z, P)) continue;
      const size = (0.35 + r3 * 0.5 + T * 0.18) * P.s;
      const a = 0.32 * smoothstep(0, 0.4, T) * (1 - smoothstep(4, 11, T)) * (0.5 + r4 * 0.5);
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(tex, P.x - size, P.y - size * 0.7, size * 2, size * 1.4);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 喷气：温暖潮湿的呼气在空气中凝结成水雾柱，随后扩散、飘散、消失。
   * b 为喷气进度 0~1（约 6 秒），origin 为喷气孔世界坐标。
   */
  drawSpout(rc: RenderCtx, b: number, ox: number, oy: number, oz: number): void {
    if (b <= 0 || b >= 1) return;
    const { ctx, cam, dpr } = rc;
    const T = b * 6;
    const n = rc.quality.spout;
    const mists = textures().mist;
    const dot = textures().dotHard;
    const P = { x: 0, y: 0, s: 0 };
    const sun = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < n; i++) {
      const r1 = hash1(i * 9 + 11);
      const r2 = hash1(i * 9 + 12);
      const r3 = hash1(i * 9 + 13);
      const tau0 = r1 * 0.6;
      const t = T - tau0;
      if (t <= 0) continue;
      // 座头鲸的喷气：浓密的“灌木状”水雾柱，约 3~4 米高
      const v0 = 6.5 + r2 * 4.5;
      const td = 0.48;
      const e = 1 - Math.exp(-t / td);
      const rise = v0 * td * e;
      const spread = (r3 - 0.5) * (0.25 + rise * 0.32);
      const wind = 0.55 * Math.max(0, t - 0.4);
      const x = ox + spread + wind + Math.sin(t * 1.3 + i) * 0.08 * t;
      const y = oy - rise + 0.06 * t * t;
      const z = oz + (r1 - 0.5) * 0.8;
      if (!cam.project(x, y, z, P)) continue;
      const size = (0.12 + rise * 0.1 + t * 0.22) * P.s;
      const a = 0.42 * smoothstep(0, 0.1, t) * (1 - smoothstep(1.0 + r3 * 0.8, 3.6 + r1 * 1.4, t)) * sun;
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      const tex = mists[i % 3];
      ctx.drawImage(tex, P.x - size, P.y - size, size * 2, size * 2);
    }
    // 细小水滴：先被喷起，再落回海面
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n * 0.4; i++) {
      const r1 = hash1(i * 13 + 3);
      const r2 = hash1(i * 13 + 4);
      const t = T - r1 * 0.4;
      if (t <= 0 || t > 1.8) continue;
      const v0 = 5 + r2 * 4;
      const x = ox + (r1 - 0.5) * 1.6 * t + 0.4 * t;
      const y = oy - v0 * t + 4.9 * t * t;
      if (y > oy + 0.2) continue;
      if (!cam.project(x, y, oz, P)) continue;
      const s = Math.max(0.8, 0.03 * P.s);
      ctx.globalAlpha = 0.5 * (1 - t / 1.8);
      ctx.drawImage(dot, P.x - s, P.y - s, s * 2, s * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // 阳光下水雾里淡淡的彩虹
    const ra = 0.055 * smoothstep(0.9, 1.6, T) * (1 - smoothstep(3.0, 4.6, T));
    if (ra > 0.005 && cam.project(ox + 0.6 + T * 0.4, oy - 1.6, oz - 0.5, P)) {
      const R = 1.7 * P.s;
      const cols = ['255,80,80', '255,170,60', '255,240,90', '90,220,120', '90,160,255', '160,110,255'];
      ctx.lineWidth = Math.max(1, R * 0.045);
      for (let k = 0; k < cols.length; k++) {
        ctx.strokeStyle = `rgba(${cols[k]},${ra})`;
        ctx.beginPath();
        ctx.arc(P.x, P.y + R * 0.9, R - k * ctx.lineWidth, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 从某点升起的一串气泡（氛围时钟驱动）。 */
  drawBubbles(rc: RenderCtx, ox: number, oy: number, oz: number, amount: number, surfaceY = 0): void {
    if (amount <= 0.01) return;
    const { ctx, cam, dpr, time } = rc;
    const n = Math.round(rc.quality.bubbles * 0.4 * amount);
    const P = { x: 0, y: 0, s: 0 };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const life = 3 + hash1(i * 3) * 3;
      const age = mod(time + hash1(i * 3 + 1) * life, life);
      const rise = 0.6 + hash1(i * 3 + 2) * 0.9;
      const x = ox + (hash1(i * 5) - 0.5) * 1.2 + Math.sin(age * 4 + i) * 0.12;
      const y = oy - age * rise * (1 + age * 0.15);
      if (y < surfaceY) continue;
      if (!cam.project(x, y, oz + (hash1(i * 7) - 0.5), P)) continue;
      const r = Math.max(1, (0.02 + hash1(i * 11) * 0.05) * (1 + age * 0.1) * P.s);
      ctx.globalAlpha = 0.55 * (1 - age / life) * amount;
      ctx.strokeStyle = 'rgba(220,245,255,0.9)';
      ctx.beginPath();
      ctx.arc(P.x, P.y, r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(P.x - r * 0.4, P.y - r * 0.5, r * 0.35, r * 0.35);
    }
    ctx.globalAlpha = 1;
  }

  private sandTex: HTMLCanvasElement | null = null;
  private sandKey = '';
  private readonly tmpC: RGB = [0, 0, 0];

  /** 沉积物颗粒的着色精灵（颜色变化时才重绘）。 */
  private sandDot(c: RGB): HTMLCanvasElement {
    const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
    if (this.sandTex && this.sandKey === key) return this.sandTex;
    if (!this.sandTex) {
      this.sandTex = document.createElement('canvas');
      this.sandTex.width = this.sandTex.height = 48;
    }
    const g = this.sandTex.getContext('2d')!;
    g.clearRect(0, 0, 48, 48);
    const rg = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    rg.addColorStop(0, `rgba(${key},0.9)`);
    rg.addColorStop(0.5, `rgba(${key},0.4)`);
    rg.addColorStop(1, `rgba(${key},0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, 48, 48);
    this.sandKey = key;
    return this.sandTex;
  }
}
