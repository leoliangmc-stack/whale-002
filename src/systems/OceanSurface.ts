import { hex, rgba } from '../core/color';
import { clamp, hash1, lerp, sampleProfile, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import type { SurfaceState } from './StoryTimeline';
import { DORSAL, S_BLOW, S_REF, WHALE_LEN } from '../entities/WhaleBody';
import { DORSAL_ART, mipLevel, whaleArt } from '../entities/WhaleArt';

/**
 * 海面：
 *  - 水下仰望时的“海面天花板”（明亮、波动的反光带）；
 *  - 半水上半水下的分屏镜头（天空 + 水线 + 水下）；
 *  - 高空俯视镜头：广阔海面、浮出水面的鲸鱼（背面画）、扩散的水波、第一次呼气与盘旋的海鸟，
 *    以及进出这个镜头的转场（冲出水面的水线、镜头上的水滴、落回水面时涌过的浪花水雾）。
 */


const SKY_TOP = hex('#5aa6d8');
const SKY_HOR = hex('#cfeaf5');
const SEA_FAR = hex('#2f7fb0');

/** 俯视海面柔和部分的图层分辨率（相对设备像素） */
const SEA_RES = 0.5;

/** 俯视镜头中的海鸟数（最后两只从远处飞过，其余在鲸鱼上空盘旋） */
const BIRDS = 9;

interface Bird {
  x: number;
  y: number;
  a: number;
  size: number;
  sx: number;
  sy: number;
  ssize: number;
  flap: number;
}

export class OceanSurface {
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;
  private seaLayer: HTMLCanvasElement | null = null;
  private seaCtx: CanvasRenderingContext2D | null = null;
  private whaleLayer: HTMLCanvasElement | null = null;
  private whaleCtx: CanvasRenderingContext2D | null = null;
  private readonly patterns = new WeakMap<CanvasRenderingContext2D, Map<CanvasImageSource, CanvasPattern>>();
  private readonly birds: Bird[] = Array.from({ length: BIRDS }, () => ({ x: 0, y: 0, a: 0, size: 0, sx: 0, sy: 0, ssize: 0, flap: 0 }));

  /** 分屏水线的屏幕 y（若不在画面中返回 null） */
  waterline(rc: RenderCtx): number | null {
    const cam = rc.cam;
    if (Math.abs(cam.cy) > 4) return null;
    const y = cam.py + (0 - cam.cy) * cam.scaleAt(cam.cz + 6);
    if (y < -rc.h * 0.2 || y > rc.h * 1.2) return null;
    return y + Math.sin(rc.time * 0.9) * 1.5;
  }

  /** 水下仰望海面：越接近海面越明亮，带有缓慢流动的波光。 */
  drawCeiling(rc: RenderCtx): void {
    const { ctx, cam, dpr, w, time } = rc;
    if (cam.cy < 0.5 || cam.cy > 80) return;
    const py = cam.py;
    if (py <= 0) return;
    // 浅海光照时画面上缘已有一道明亮的海面（见 LightingManager.paintSurface），这里随之减弱
    const sun = clamp(1 - cam.cy / 80) * (1 - 0.7 * rc.light.sunlit);
    // 行 y 处视线击中海面的距离 dz：y = py − cy·f / dz
    const hitAt = (dz: number) => py - (cam.cy * cam.f) / Math.max(0.5, dz);
    const yFade = Math.min(py, hitAt(110));
    if (yFade <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, yFade);
    g.addColorStop(0, `rgba(200,240,255,${0.55 * sun})`);
    g.addColorStop(0.55, `rgba(150,215,240,${0.22 * sun})`);
    g.addColorStop(1, 'rgba(120,200,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, yFade);
    // 透视压缩的波光：近处稀疏宽大，远处细密
    ctx.globalCompositeOperation = 'lighter';
    const tex = textures().caustic;
    for (let k = 0; k < 7; k++) {
      const dz = 3 + k * k * 2.2;
      const y0 = hitAt(dz);
      const y1 = hitAt(dz * 1.6);
      if (y1 < 0 || y0 > py) continue;
      const hgt = Math.max(2, y1 - y0);
      const tile = Math.max(24, (cam.f / dz) * 3);
      const off = ((time * (14 + k * 3)) % tile) - tile;
      ctx.globalAlpha = 0.06 * sun * (1 - k / 8);
      for (let x = off; x < w; x += tile) ctx.drawImage(tex, x, y0, tile, hgt);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 分屏镜头：水线以上的天空与远海。 */
  drawSky(rc: RenderCtx): number | null {
    const wl = this.waterline(rc);
    if (wl === null) return null;
    const { ctx, dpr, w, time } = rc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const top = Math.min(wl, 0);
    const g = ctx.createLinearGradient(0, top - rc.h * 0.6, 0, wl);
    g.addColorStop(0, rgba(SKY_TOP));
    g.addColorStop(0.75, rgba(SKY_HOR));
    g.addColorStop(1, rgba(SKY_HOR));
    ctx.fillStyle = g;
    ctx.fillRect(0, -2, w, wl + 2);
    // 太阳光晕
    const sg = ctx.createRadialGradient(w * 0.18, wl - rc.h * 0.55, 0, w * 0.18, wl - rc.h * 0.55, rc.h * 0.6);
    sg.addColorStop(0, 'rgba(255,250,230,0.85)');
    sg.addColorStop(0.2, 'rgba(255,245,215,0.35)');
    sg.addColorStop(1, 'rgba(255,245,215,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, -2, w, wl + 2);
    // 淡淡的云
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i++) {
      const x = ((hash1(i * 3) * 1.4 - 0.2) * w + time * 3 * (0.5 + hash1(i))) % (w * 1.3) - w * 0.15;
      const y = wl - rc.h * (0.25 + hash1(i * 3 + 1) * 0.3);
      const s = rc.h * (0.06 + hash1(i * 3 + 2) * 0.06);
      ctx.beginPath();
      ctx.ellipse(x, y, s * 3, s * 0.5, 0, 0, TAU);
      ctx.ellipse(x + s, y - s * 0.3, s * 1.6, s * 0.55, 0, 0, TAU);
      ctx.fill();
    }
    // 远处海面（地平线附近的一条深蓝带）
    const hz = wl - Math.max(2, rc.h * 0.012);
    const sea = ctx.createLinearGradient(0, hz - 3, 0, wl);
    sea.addColorStop(0, rgba(SEA_FAR));
    sea.addColorStop(1, rgba(hex('#3d93c2')));
    ctx.fillStyle = sea;
    ctx.fillRect(0, hz, w, wl - hz + 1);
    return wl;
  }

  /** 分屏镜头：在水线以下叠加水体色调，并画出水线的弯月面与浪花。 */
  drawSplitOverlay(rc: RenderCtx, wl: number, whaleBack: { x0: number; x1: number } | null): void {
    const { ctx, dpr, w, h, time } = rc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wave = (x: number) => wl + Math.sin(x * 0.02 + time * 1.4) * 3 + Math.sin(x * 0.051 - time * 0.9) * 1.6;
    // 水下部分的水体色调
    ctx.fillStyle = 'rgba(40,130,190,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, wave(x));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    // 水线：明亮的弯月面
    ctx.strokeStyle = 'rgba(235,250,255,0.85)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let x = 0; x <= w + 10; x += 8) {
      const y = wave(x);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,70,110,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= w + 10; x += 8) {
      const y = wave(x) + 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 鲸背周围的白色浪花
    if (whaleBack) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 26; i++) {
        const t = hash1(i * 5 + 1);
        const x = lerp(whaleBack.x0, whaleBack.x1, t);
        const y = wave(x) - 1;
        const s = 2 + hash1(i * 5 + 2) * 6 + Math.sin(time * 2 + i) * 1.5;
        ctx.beginPath();
        ctx.ellipse(x, y, s * 1.8, s * 0.6, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------------ 高空俯视

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

  /** 平铺图案（按绘制的画布分别创建） */
  private pattern(ctx: CanvasRenderingContext2D, tex: CanvasImageSource): CanvasPattern {
    let m = this.patterns.get(ctx);
    if (!m) this.patterns.set(ctx, (m = new Map()));
    let pt = m.get(tex);
    if (!pt) m.set(tex, (pt = ctx.createPattern(tex, 'repeat')!));
    return pt;
  }

  /**
   * 高空俯视镜头。进入时（从水下升起）像镜头冲出水面：一道起伏的水线从画面上方扫到下方，
   * 水线之上是高空的海面，之后镜头上还挂着几滴水；离开时（落回水面高度）一团浪花与水雾涌过画面，
   * 雾散开时已是半水上半水下的镜头。
   */
  drawAerial(rc: RenderCtx, s: SurfaceState, swimPhase: number, swim: number, anchor: { x: number; y: number } | null = null): void {
    if (s.aerial <= 0.001) return;
    const full = s.aerial >= 0.999;
    const entering = s.t < 9;
    const ctx = full ? rc.ctx : this.ensureLayer(rc);
    const { w, h, dpr, time } = rc;
    const scale = h / (s.alt * 2 * Math.tan((40 * Math.PI) / 360)); // 像素 / 米
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 鲸鱼位于画面中心；在与侧视镜头过渡时，对齐到侧视鲸鱼的屏幕位置
    const k = anchor ? 1 - smoothstep(100, 260, s.alt) : 0;
    const cx = lerp(w * 0.5, anchor ? anchor.x : w * 0.5, k);
    const cy = lerp(h * 0.52, anchor ? anchor.y : h * 0.52, k);

    this.paintSea(ctx, rc, scale, cx, cy, s);
    ctx.save();
    ctx.translate(cx, cy);
    // 水波（浮出水面与呼吸时产生）
    this.drawRipples(ctx, s, scale);
    ctx.restore();
    this.paintWhale(ctx, rc, s, cx, cy, scale, swimPhase, swim);

    // 第一次呼气：俯视的白色水雾团
    if (s.breath1 > 0 && s.breath1 < 1) {
      const T = s.breath1 * 5;
      // 从正上方看，又高又细的喷气柱是一团圆形的水雾
      const blow = (S_REF - S_BLOW) * WHALE_LEN;
      const bx = cx + Math.cos(s.rot) * blow * scale;
      const by = cy + Math.sin(s.rot) * blow * scale;
      const mists = textures().mist;
      for (let i = 0; i < 26; i++) {
        const tt = T - hash1(i * 7) * 0.4;
        if (tt <= 0) continue;
        const ang = hash1(i * 7 + 1) * TAU;
        const sp = (0.8 + hash1(i * 7 + 2) * 1.8) * (1 - Math.exp(-tt / 0.6));
        const x = bx + Math.cos(ang) * sp * scale + tt * 1.5 * scale;
        const y = by + Math.sin(ang) * sp * scale - tt * 0.5 * scale;
        const r = (0.9 + tt * 1.4) * scale;
        ctx.globalAlpha = 0.55 * smoothstep(0, 0.2, tt) * (1 - smoothstep(1.5, 4.8, tt));
        ctx.drawImage(mists[i % 3], x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
    this.paintBirds(ctx, s, cx, cy, scale, time);

    // 轻微暗角
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    vg.addColorStop(0, 'rgba(3,20,40,0)');
    vg.addColorStop(1, 'rgba(3,20,40,0.38)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (!full) {
      if (entering) this.wipeIn(rc, s.aerial);
      else this.mistOut(rc, s.aerial, cx, cy);
    }
    if (entering) this.drawLensDrops(rc, s);
  }

  /**
   * 从高空看的海面：深蓝的大洋，颜色有缓慢的大尺度起伏；两层不同方向、不同尺度的波峰（涌浪与细浪）；
   * 太阳方向一片闪烁的碎光，零星的白浪。海面随时间缓慢流过（鲸鱼在向前游）。
   * 柔和的部分（底色、起伏、波峰、反光）画在半分辨率的图层上再放大，碎光与白浪按原分辨率画在上面。
   */
  private paintSea(out: CanvasRenderingContext2D, rc: RenderCtx, scale: number, cx: number, cy: number, s: SurfaceState): void {
    const { w, h, time } = rc;
    const dpr = rc.dpr * SEA_RES;
    const lw = Math.ceil(w * dpr);
    const lh = Math.ceil(h * dpr);
    if (!this.seaLayer) {
      this.seaLayer = document.createElement('canvas');
      this.seaCtx = this.seaLayer.getContext('2d');
    }
    if (this.seaLayer.width !== lw || this.seaLayer.height !== lh) {
      this.seaLayer.width = lw;
      this.seaLayer.height = lh;
    }
    const ctx = this.seaCtx!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(w * 0.55, h * 0.4, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.75);
    g.addColorStop(0, '#1a5f8e');
    g.addColorStop(0.55, '#124a75');
    g.addColorStop(1, '#0a3157');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 大尺度的颜色起伏（两片缓慢漂移的青色与深蓝）
    for (let i = 0; i < 2; i++) {
      const x = w * (0.15 + 0.7 * hash1(i * 5 + 1)) + Math.sin(time * 0.03 + i) * w * 0.05;
      const y = h * (0.15 + 0.7 * hash1(i * 5 + 2)) + Math.cos(time * 0.025 + i * 2) * h * 0.05;
      const r = Math.max(w, h) * (0.25 + 0.2 * hash1(i * 5 + 3));
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, i % 2 ? 'rgba(8,36,66,0.35)' : 'rgba(40,120,150,0.22)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    // 鲸鱼就在水面下：浅色的身体把周围的海水映成青绿
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, WHALE_LEN * 0.75 * scale);
    glow.addColorStop(0, `rgba(70,175,190,${0.3 - 0.08 * s.surfacing})`);
    glow.addColorStop(1, 'rgba(70,175,190,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // 波峰：两层平铺的波纹图案，按米缩放、沿各自的方向流动
    const rip = textures().ripple;
    ctx.globalCompositeOperation = 'lighter';
    const layers = [
      { size: 34, ang: -0.42, speed: 1.1, a: 0.075 },
      { size: 11, ang: 0.28, speed: 0.7, a: 0.06 },
    ];
    for (const L of layers) {
      const k = (L.size * scale) / rip.width;
      if (k * rip.height < 3) continue;
      const c = Math.cos(L.ang);
      const sn = Math.sin(L.ang);
      const off = (time * L.speed * scale) / k;
      ctx.fillStyle = this.pattern(ctx, rip);
      ctx.globalAlpha = L.a;
      ctx.setTransform(dpr * k * c, dpr * k * sn, -dpr * k * sn, dpr * k * c, dpr * w * 0.5, dpr * h * 0.5);
      const R = Math.hypot(w, h) / k;
      ctx.fillRect(-R + off, -R, 2 * R, 2 * R);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 太阳方向的碎光：一片缓慢闪烁的亮点（不会快速闪烁）
    const gx = w * 0.7;
    const gy = h * 0.28;
    const glare = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.45);
    glare.addColorStop(0, 'rgba(200,225,240,0.1)');
    glare.addColorStop(1, 'rgba(200,225,240,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = true;
    out.drawImage(this.seaLayer, 0, 0, lw, lh, 0, 0, w * rc.dpr, h * rc.dpr);
    out.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);
    this.paintSparkle(out, rc, scale, gx, gy);
  }

  /** 太阳方向的碎光与零星的白浪（原分辨率） */
  private paintSparkle(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number, gx: number, gy: number): void {
    const { w, h, time } = rc;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,250,232,1)';
    for (let i = 0; i < 160; i++) {
      const u = hash1(i * 3 + 1) * 2 - 1;
      const v = hash1(i * 3 + 2) * 2 - 1;
      const x = gx + u * w * 0.42;
      const y = gy + v * h * 0.32;
      const near = Math.max(0, 1 - Math.hypot(u, v * 1.3));
      const a = near * Math.pow(Math.max(0, Math.sin(time * (0.5 + hash1(i * 3 + 3) * 0.4) + hash1(i * 3 + 4) * 20)), 4);
      if (a < 0.04) continue;
      ctx.globalAlpha = a * 0.6;
      const len = 1.5 + 2.5 * hash1(i * 7 + 5);
      ctx.fillRect(x - len / 2, y - 0.6, len, 1.2);
    }
    // 零星的白浪：在海面上缓慢出现、消散
    const mist = textures().mist;
    for (let i = 0; i < 18; i++) {
      const ph = time * 0.12 + hash1(i * 11 + 1) * 10;
      const life = ph - Math.floor(ph);
      const cyc = Math.floor(ph);
      const x = ((hash1(i * 11 + 2 + cyc * 3) * 1.2 - 0.1) * w + time * 0.6 * scale) % (w * 1.2);
      const y = (hash1(i * 11 + 3 + cyc * 3) * 1.2 - 0.1) * h;
      const r = (1.2 + hash1(i * 11 + 4) * 1.8) * scale;
      ctx.globalAlpha = 0.28 * Math.sin(Math.PI * life);
      ctx.drawImage(mist[i % 3], x - r * 1.6, y - r * 0.6, r * 3.2, r * 1.2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * 俯视的蓝鲸：背面画（WhaleArt.dorsal）。水面下的部分被海水映成青绿、对比变弱；
   * 浮出水面时，背部中段露出水面，深色而湿亮，周围是白色的浪花。尾叶随拍尾前后缩短。
   * 先画在一张只覆盖鲸鱼的小图层上（染色只作用在鲸鱼上），再合成到海面上。
   */
  private paintWhale(ctx: CanvasRenderingContext2D, rc: RenderCtx, s: SurfaceState, cx: number, cy: number, scale: number, phase: number, swim: number): void {
    const art = whaleArt();
    const { dpr, time } = rc;
    const L = WHALE_LEN;
    // 水中的影子：比身体略大、柔和的深色
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s.rot);
    ctx.scale(scale, scale);
    for (const [k, a] of [[1.3, 0.1], [1.12, 0.14]] as const) {
      ctx.fillStyle = `rgba(4,26,46,${a})`;
      this.outline(ctx, k);
      ctx.fill();
    }
    ctx.restore();
    if (!art) return;
    const R = Math.ceil(0.62 * L * scale * dpr) + 4;
    if (!this.whaleLayer) {
      this.whaleLayer = document.createElement('canvas');
      this.whaleCtx = this.whaleLayer.getContext('2d');
    }
    const wl = this.whaleLayer;
    if (wl.width < 2 * R || wl.height < 2 * R || wl.width > 4 * R) {
      wl.width = 2 * R;
      wl.height = 2 * R;
    }
    const c = this.whaleCtx!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, 2 * R, 2 * R);
    const ppm = (DORSAL_ART.snoutX - DORSAL_ART.notchX) / L;
    const lv = mipLevel((scale * dpr) / ppm);
    const img = art.dorsal.levels[lv];
    const r = 1 / (1 << lv);
    const local = () => {
      c.setTransform(dpr, 0, 0, dpr, R, R);
      c.rotate(s.rot);
      c.scale(scale, scale);
      // 画像素 → 鲸鱼局部坐标（米，+x 指向吻端）
      c.translate(L * S_REF - DORSAL_ART.snoutX / ppm, -DORSAL_ART.axisY / ppm);
      c.scale(1 / ppm, 1 / ppm);
    };
    const paint = () => {
      const fx = DORSAL_ART.flukeX;
      c.drawImage(img, fx * r, 0, (DORSAL_ART.w - fx) * r, DORSAL_ART.h * r, fx, 0, DORSAL_ART.w - fx, DORSAL_ART.h);
      // 尾叶：上下拍动时从上方看前后缩短
      const fk = 1 - 0.2 * swim * (0.5 + 0.5 * Math.sin(phase));
      c.save();
      c.translate(fx, 0);
      c.scale(fk, 1);
      c.translate(-fx, 0);
      c.drawImage(img, 0, 0, (fx + 2) * r, DORSAL_ART.h * r, 0, 0, fx + 2, DORSAL_ART.h);
      c.restore();
    };
    local();
    paint();
    // 水面下：映成青绿、对比变弱
    const k = s.surfacing;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = `rgba(28,112,140,${0.48 - 0.2 * k})`;
    c.fillRect(0, 0, 2 * R, 2 * R);
    c.globalCompositeOperation = 'source-over';
    // 露出水面的背部：深色、湿亮
    if (k > 0.02) {
      c.save();
      c.setTransform(dpr, 0, 0, dpr, R, R);
      c.rotate(s.rot);
      c.scale(scale, scale);
      c.beginPath();
      this.outlinePath(c, 0.6, 0.08, 0.72);
      c.clip();
      local();
      c.globalAlpha = k;
      paint();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(20,28,36,${0.14 * k})`;
      c.fillRect(0, 0, 2 * R, 2 * R);
      c.restore();
      // 湿润的高光
      c.save();
      c.setTransform(dpr, 0, 0, dpr, R, R);
      c.rotate(s.rot);
      c.scale(scale, scale);
      c.strokeStyle = `rgba(225,242,255,${0.4 * k})`;
      c.lineWidth = 0.17;
      c.beginPath();
      c.moveTo(L * (S_REF - 0.14), -0.26);
      c.quadraticCurveTo(L * (S_REF - 0.4), -0.6, L * (S_REF - 0.66), -0.2);
      c.stroke();
      c.restore();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.96;
    ctx.drawImage(wl, 0, 0, 2 * R, 2 * R, cx * dpr - R, cy * dpr - R, 2 * R, 2 * R);
    ctx.restore();
    // 白色的水花：头前被推起的一道弧形浪，沿露出水面的背部两侧不规则地翻涌，身后拖出两道渐渐散开的尾流
    if (k > 0.02) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.rot);
      ctx.scale(scale, scale);
      const mist = textures().mist;
      const head = L * (S_REF - 0.06);
      for (let i = 0; i < 12; i++) {
        const a = (i / 11 - 0.5) * 2.2;
        const rr = 0.6 + hash1(i * 5 + 1) * 0.7;
        ctx.globalAlpha = k * (0.22 + 0.14 * Math.sin(time * 1.1 + i * 2.3));
        ctx.drawImage(mist[i % 3], head + Math.cos(a) * 1.6 - rr, Math.sin(a) * 2.2 - rr, rr * 2, rr * 2);
      }
      for (let i = 0; i < 30; i++) {
        const side = i % 2 ? 1 : -1;
        const t = 0.1 + hash1(i * 7 + 3) * 0.62;
        const x = L * (S_REF - t) + Math.sin(time * 0.9 + i) * 0.3;
        const y = side * sampleProfile(DORSAL, t) * (0.55 + 0.25 * hash1(i * 7 + 4));
        const rr = 0.35 + hash1(i * 7) * 0.9;
        ctx.globalAlpha = k * Math.max(0, 0.12 + 0.2 * Math.sin(time * 0.7 + i * 1.9));
        ctx.drawImage(mist[i % 3], x - rr * 1.6, y - rr, rr * 3.2, rr * 2);
      }
      for (let i = 0; i < 16; i++) {
        const side = i % 2 ? 1 : -1;
        const d = (i >> 1) / 7;
        const x = L * (S_REF - 0.8) - d * 14;
        const y = side * (1.6 + d * 5) + Math.sin(time * 0.6 + i) * 0.4;
        const rr = 0.9 + d * 1.6;
        ctx.globalAlpha = k * 0.16 * (1 - d);
        ctx.drawImage(mist[i % 3], x - rr * 1.8, y - rr, rr * 3.6, rr * 2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /** 俯视轮廓（局部坐标，米）：k 为半宽的倍数，s0~s1 为体长范围 */
  private outlinePath(ctx: CanvasRenderingContext2D, k: number, s0 = 0, s1 = 1): void {
    const L = WHALE_LEN;
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const t = lerp(s0, s1, i / n);
      const x = L * (S_REF - t);
      const y = -sampleProfile(DORSAL, t) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = n; i >= 0; i--) {
      const t = lerp(s0, s1, i / n);
      ctx.lineTo(L * (S_REF - t), sampleProfile(DORSAL, t) * k);
    }
    ctx.closePath();
  }

  private outline(ctx: CanvasRenderingContext2D, k: number): void {
    ctx.beginPath();
    this.outlinePath(ctx, k);
  }

  /**
   * 海鸟：几只在鲸鱼上空盘旋（鲸鱼呼吸、搅起的磷虾会引来海鸟），两只从远处飞过。
   * 它们比海面离镜头更近：越高的鸟在画面上越大、移动得越快；海面上有各自的影子（随太阳方向偏开）。
   * 从上方看，拍翅时翅膀的投影一伸一缩，间或张开翅膀滑翔。
   */
  private paintBirds(ctx: CanvasRenderingContext2D, s: SurfaceState, cx: number, cy: number, scale: number, time: number): void {
    const blow = (S_REF - S_BLOW) * WHALE_LEN;
    const ox = Math.cos(s.rot) * blow;
    const oy = Math.sin(s.rot) * blow;
    const birds = this.birds;
    for (let i = 0; i < BIRDS; i++) {
      const b = birds[i];
      const seed = i * 13 + 7;
      // 飞行高度（米）与透视放大
      const hgt = 14 + 70 * hash1(seed);
      const persp = s.alt / Math.max(8, s.alt - hgt);
      let x: number;
      let y: number;
      let dirx: number;
      let diry: number;
      if (i < BIRDS - 2) {
        // 盘旋：绕喷气孔附近，半径与角速度各不相同，偶尔有一点忽远忽近
        const rad = 14 + 26 * hash1(seed + 1) + 4 * Math.sin(time * 0.2 + i);
        const om = (0.16 + 0.18 * hash1(seed + 2)) * (i % 2 ? 1 : -1);
        const a = time * om + hash1(seed + 3) * TAU;
        x = ox + Math.cos(a) * rad;
        y = oy + Math.sin(a) * rad * 0.85;
        dirx = -Math.sin(a) * Math.sign(om);
        diry = Math.cos(a) * 0.85 * Math.sign(om);
      } else {
        // 远处飞过：沿一条直线缓慢穿过画面
        const span = 260;
        const u = (((time * 3.2 + hash1(seed + 4) * span) % span) + span) % span - span / 2;
        const ang = -0.6 + hash1(seed + 5) * 1.2;
        dirx = Math.cos(ang);
        diry = Math.sin(ang);
        x = u * dirx - 40 * diry * (i % 2 ? 1 : -1);
        y = u * diry + 40 * dirx * (i % 2 ? 1 : -1);
      }
      b.x = cx + x * scale * persp;
      b.y = cy + y * scale * persp;
      b.a = Math.atan2(diry, dirx);
      b.size = 2.1 * scale * persp;
      b.sx = cx + (x + hgt * 0.35) * scale;
      b.sy = cy + (y + hgt * 0.22) * scale;
      b.ssize = 2.1 * scale;
      // 拍翅与滑翔交替
      const cycle = time * 0.25 + hash1(seed + 6) * 3;
      const flapping = Math.sin(cycle * TAU) > -0.2;
      b.flap = flapping ? Math.sin(time * (7 + 3 * hash1(seed + 7)) + i) : 0.9;
    }
    // 影子在海面上，先画
    ctx.fillStyle = 'rgba(2,18,34,0.22)';
    for (const b of birds) if (b.ssize > 0.6) this.bird(ctx, b.sx, b.sy, b.a, b.ssize, b.flap, true);
    for (const b of birds) if (b.size > 0.6) this.bird(ctx, b.x, b.y, b.a, b.size, b.flap, false);
  }

  /** 一只从上方看的海鸟（翼展约 size，朝向 a）：白色的身体，灰色的翅膀，深色的翼尖 */
  private bird(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, size: number, flap: number, shadow: boolean): void {
    const span = size * (0.6 + 0.4 * Math.abs(flap));
    const sweep = size * 0.12 * flap;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const wing = () => {
      ctx.beginPath();
      ctx.moveTo(size * 0.08, 0);
      ctx.quadraticCurveTo(-size * 0.02 - sweep, -span * 0.3, -size * 0.14 - sweep, -span * 0.5);
      ctx.quadraticCurveTo(-size * 0.1 - sweep * 0.5, -span * 0.22, -size * 0.12, 0);
      ctx.quadraticCurveTo(-size * 0.1 - sweep * 0.5, span * 0.22, -size * 0.14 - sweep, span * 0.5);
      ctx.quadraticCurveTo(-size * 0.02 - sweep, span * 0.3, size * 0.08, 0);
      ctx.closePath();
    };
    if (shadow) {
      wing();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-size * 0.02, 0, size * 0.22, size * 0.05, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(176,186,196,0.95)';
      wing();
      ctx.fill();
      // 深色的翼尖
      ctx.fillStyle = 'rgba(40,46,54,0.9)';
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(-size * 0.13 - sweep, sd * span * 0.46, size * 0.035, span * 0.06, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(246,248,250,1)';
      ctx.beginPath();
      ctx.ellipse(-size * 0.02, 0, size * 0.22, size * 0.055, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 进入俯视：像镜头从水下冲出水面。一道起伏的水线从画面上方扫到下方，
   * 水线之上已是高空的海面；水线明亮，带起一串水花，冲出水面的一瞬画面微微一亮。
   */
  private wipeIn(rc: RenderCtx, a: number): void {
    const { ctx, w, h, dpr, time } = rc;
    const e = smoothstep(0, 1, a);
    const y0 = lerp(-0.14 * h, 1.14 * h, e);
    const wave = (x: number) => y0 + Math.sin(x * 0.011 + time * 2.1) * h * 0.016 + Math.sin(x * 0.029 - time * 1.4) * h * 0.007;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(w, -2);
    for (let x = w; x >= -10; x -= 12) ctx.lineTo(x, wave(x));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer!, 0, 0);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 水线下方被照亮的一条
    const glow = ctx.createLinearGradient(0, y0, 0, y0 + h * 0.16);
    glow.addColorStop(0, 'rgba(200,240,255,0.35)');
    glow.addColorStop(1, 'rgba(200,240,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y0, w, h * 0.16);
    // 明亮的水线
    ctx.lineCap = 'round';
    for (const [lw, al] of [[7, 0.18], [3, 0.5], [1.4, 0.95]] as const) {
      ctx.strokeStyle = `rgba(235,250,255,${al})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let x = -10; x <= w + 12; x += 12) {
        const y = wave(x);
        if (x < 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 水线上方被带起的水花
    ctx.fillStyle = 'rgba(240,250,255,0.85)';
    for (let i = 0; i < 40; i++) {
      const x = hash1(i * 5 + 1) * w;
      const up = (0.01 + 0.08 * hash1(i * 5 + 2)) * h * (0.5 + 0.5 * Math.sin(time * 3 + i));
      const r = 0.8 + 2.2 * hash1(i * 5 + 3);
      ctx.globalAlpha = 0.7 * Math.sin(Math.PI * e);
      ctx.beginPath();
      ctx.arc(x, wave(x) - up, r, 0, TAU);
      ctx.fill();
    }
    // 冲出水面的一瞬：画面微微一亮
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(225,242,255,${0.2 * Math.sin(Math.PI * e)})`;
    ctx.fillRect(0, 0, w, h);
  }

  /** 冲出水面之后，镜头上还挂着几滴水：慢慢往下滑，渐渐消失（只出现在已经出水的部分） */
  private drawLensDrops(rc: RenderCtx, s: SurfaceState): void {
    const { ctx, w, h, dpr } = rc;
    const e = smoothstep(0, 1, s.aerial);
    const lineY = lerp(-0.14 * h, 1.14 * h, e);
    const T = s.t - 1.4;
    if (T < -1.6 || T > 4.5) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = Math.min(w, h);
    for (let i = 0; i < 14; i++) {
      const r = m * (0.012 + 0.032 * hash1(i * 9 + 3) ** 2);
      const x = hash1(i * 9 + 1) * w;
      const y0 = hash1(i * 9 + 2) * h * 0.92;
      const y = y0 + Math.max(0, T) * Math.max(0, T) * (0.006 + 0.02 * hash1(i * 9 + 4)) * h;
      if (y0 > lineY - r) continue;
      const a = 1 - smoothstep(1.6 + hash1(i * 9 + 5) * 2, 3 + hash1(i * 9 + 5) * 1.5, T);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.06)');
      g.addColorStop(0.7, 'rgba(210,235,250,0.12)');
      g.addColorStop(0.92, 'rgba(255,255,255,0.32)');
      g.addColorStop(1, 'rgba(0,30,55,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 1.08, 0, 0, TAU);
      ctx.fill();
      // 下缘一道暗边、左上一个小高光
      ctx.strokeStyle = 'rgba(0,25,45,0.25)';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.94, 0.25 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(x - r * 0.38, y - r * 0.42, r * 0.13, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 离开俯视：镜头落回水面高度。高空的画面一边推近一边淡去，一团白色的浪花与水雾涌过画面，
   * 雾散开时已是半水上半水下的镜头。
   */
  private mistOut(rc: RenderCtx, a: number, cx: number, cy: number): void {
    const { ctx, w, h, dpr, time } = rc;
    const z = 1 + 0.22 * (1 - a);
    ctx.save();
    ctx.setTransform(z, 0, 0, z, cx * dpr * (1 - z), cy * dpr * (1 - z));
    ctx.globalAlpha = smoothstep(0, 1, a);
    ctx.drawImage(this.layer!, 0, 0);
    ctx.restore();
    const m = Math.pow(Math.sin(Math.PI * clamp(1 - a)), 1.3);
    if (m < 0.01) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgba(232,243,250,${0.34 * m})`;
    ctx.fillRect(0, 0, w, h);
    const mist = textures().mist;
    const big = Math.max(w, h);
    for (let i = 0; i < 22; i++) {
      const ang = hash1(i * 3 + 1) * TAU;
      const d = (0.1 + 0.5 * hash1(i * 3 + 2)) * big * (0.6 + 0.6 * (1 - a));
      const x = w / 2 + Math.cos(ang) * d + Math.sin(time * 0.4 + i) * 10;
      const y = h / 2 + Math.sin(ang) * d * 0.7;
      const r = big * (0.18 + 0.22 * hash1(i * 3 + 3));
      ctx.globalAlpha = 0.7 * m;
      ctx.drawImage(mist[i % 3], x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawRipples(ctx: CanvasRenderingContext2D, s: SurfaceState, scale: number): void {
    // 发射时间（秒，相对于 s.t）：浮出水面时一组，呼吸时一组
    const emits = [2.5, 4, 5.5, 7.5, 9, 10.8, 12.6, 14.4];
    ctx.lineWidth = Math.max(1, 0.3 * scale);
    for (let i = 0; i < emits.length; i++) {
      const age = s.t - emits[i];
      if (age <= 0 || age > 12) continue;
      const r = (6 + age * 2.7) * scale;
      const a = 0.3 * smoothstep(0, 1.2, age) * (1 - age / 12) * s.surfacing;
      ctx.strokeStyle = `rgba(220,245,255,${a})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.9, r, s.rot, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(10,50,80,${a * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.9 + 3, r + 3, s.rot, 0, TAU);
      ctx.stroke();
    }
  }
}
