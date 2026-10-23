import { hex, rgba } from '../core/color';
import { clamp, hash1, lerp, sampleProfile, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import type { SurfaceState } from './StoryTimeline';
import { S_BLOW, S_REF, WHALE_LEN } from '../entities/WhaleBody';

/**
 * 海面：
 *  - 水下仰望时的“海面天花板”（明亮、波动的反光带）；
 *  - 半水上半水下的分屏镜头（天空 + 水线 + 水下）；
 *  - 高空俯视镜头：广阔海面、浮出水面的鲸鱼、扩散的水波与第一次呼气。
 */

/** 俯视的蓝鲸：身体半宽（米），量自 whale-kit 的腹面画（俯视与仰视的轮廓相同） */
const DORSAL: ReadonlyArray<readonly [number, number]> = [
  [0, 0.3], [0.02, 1.16], [0.04, 1.46], [0.065, 1.71], [0.09, 1.86], [0.11, 1.94], [0.13, 2.06], [0.15, 2.16],
  [0.2, 2.24], [0.24, 2.38], [0.3, 2.45], [0.38, 2.51], [0.42, 2.53], [0.46, 2.48], [0.51, 2.44], [0.55, 2.42],
  [0.6, 2.3], [0.66, 2.03], [0.71, 1.94], [0.75, 1.64], [0.8, 1.35], [0.84, 1.21], [0.88, 0.87], [0.93, 0.69],
  [0.97, 0.58], [1, 0.5],
];

const SKY_TOP = hex('#5aa6d8');
const SKY_HOR = hex('#cfeaf5');
const SEA_FAR = hex('#2f7fb0');

export class OceanSurface {
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;

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
    const sun = clamp(1 - cam.cy / 80);
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

  /** 绘制俯视镜头，并按 s.aerial 与当前画面交叉溶解。 */
  drawAerial(rc: RenderCtx, s: SurfaceState, swimPhase: number, swim: number, anchor: { x: number; y: number } | null = null): void {
    if (s.aerial <= 0.001) return;
    const full = s.aerial >= 0.999;
    const ctx = full ? rc.ctx : this.ensureLayer(rc);
    const { w, h, dpr, time } = rc;
    const scale = h / (s.alt * 2 * Math.tan((40 * Math.PI) / 360)); // 像素 / 米
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 海面底色
    const g = ctx.createRadialGradient(w * 0.45, h * 0.45, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.7);
    g.addColorStop(0, '#2a80b4');
    g.addColorStop(1, '#16547f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 浪纹（两层不同方向）
    const tex = textures().wave;
    const tile = 22 * scale;
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 2; layer++) {
      const k = layer ? 0.6 : 1;
      const ts = tile * k;
      const ox = ((time * (layer ? -0.9 : 0.6) * scale) % ts) - ts;
      const oy = ((time * (layer ? 0.4 : 0.8) * scale) % ts) - ts;
      ctx.globalAlpha = layer ? 0.045 : 0.06;
      if (ts > 6) for (let x = ox; x < w; x += ts) for (let y = oy; y < h; y += ts) ctx.drawImage(tex, x, y, ts, ts);
    }
    // 阳光碎金（缓慢变化，不闪烁）
    ctx.fillStyle = 'rgba(255,250,225,0.9)';
    for (let i = 0; i < 70; i++) {
      const x = hash1(i * 3 + 1) * w;
      const y = hash1(i * 3 + 2) * h;
      const a = Math.pow(Math.max(0, Math.sin(time * 0.6 + hash1(i * 3 + 3) * 20)), 3);
      if (a < 0.05) continue;
      ctx.globalAlpha = a * 0.35;
      ctx.fillRect(x, y, 2.2, 1.2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 鲸鱼位于画面中心；在与侧视镜头交叉溶解时，对齐到侧视鲸鱼的屏幕位置
    const k = anchor ? 1 - smoothstep(100, 260, s.alt) : 0;
    const cx = lerp(w * 0.5, anchor ? anchor.x : w * 0.5, k);
    const cy = lerp(h * 0.52, anchor ? anchor.y : h * 0.52, k);
    ctx.save();
    ctx.translate(cx, cy);
    // 水波（浮出水面与呼吸时产生）
    this.drawRipples(ctx, s, scale);
    ctx.rotate(s.rot);
    ctx.scale(scale, scale);
    this.drawDorsalWhale(ctx, s, swimPhase, swim, time);
    ctx.restore();

    // 第一次呼气：俯视的白色水雾团
    if (s.breath1 > 0 && s.breath1 < 1) {
      const T = s.breath1 * 5;
      // 从正上方看，又高又细的喷气柱是一团圆形的水雾
      const blow = (S_REF - S_BLOW) * WHALE_LEN;
      const bx = cx + Math.cos(s.rot) * blow * scale;
      const by = cy + Math.sin(s.rot) * blow * scale;
      const mists = textures().mist;
      for (let i = 0; i < 26; i++) {
        const t = T - hash1(i * 7) * 0.4;
        if (t <= 0) continue;
        const ang = hash1(i * 7 + 1) * TAU;
        const sp = (0.8 + hash1(i * 7 + 2) * 1.8) * (1 - Math.exp(-t / 0.6));
        const x = bx + Math.cos(ang) * sp * scale + t * 1.5 * scale;
        const y = by + Math.sin(ang) * sp * scale - t * 0.5 * scale;
        const r = (0.9 + t * 1.4) * scale;
        ctx.globalAlpha = 0.55 * smoothstep(0, 0.2, t) * (1 - smoothstep(1.5, 4.8, t));
        ctx.drawImage(mists[i % 3], x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
    // 轻微暗角
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    vg.addColorStop(0, 'rgba(5,30,55,0)');
    vg.addColorStop(1, 'rgba(5,30,55,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (!full) {
      const main = rc.ctx;
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = s.aerial;
      main.drawImage(this.layer!, 0, 0);
      main.globalAlpha = 1;
    }
  }

  private drawRipples(ctx: CanvasRenderingContext2D, s: SurfaceState, scale: number): void {
    // 发射时间（秒，相对于 s.t）：浮出水面时一组，呼吸时一组
    const emits = [2.5, 4, 5.5, 7.5, 9, 10.8, 12.6, 14.4];
    ctx.lineWidth = Math.max(1, 0.3 * scale);
    for (let i = 0; i < emits.length; i++) {
      const age = s.t - emits[i];
      if (age <= 0 || age > 12) continue;
      const r = (3.4 + age * 2.7) * scale;
      const a = 0.32 * (1 - age / 12) * s.surfacing;
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

  /** 俯视的蓝鲸：水下部分偏青绿、模糊；露出水面的背部深色且湿亮。胸鳍短小，尾叶宽阔。 */
  private drawDorsalWhale(ctx: CanvasRenderingContext2D, s: SurfaceState, phase: number, swim: number, time: number): void {
    const L = WHALE_LEN;
    const ref = S_REF;
    const flukeK = 1 - 0.18 * swim * (0.5 + 0.5 * Math.sin(phase));
    const outline = (k: number, s0 = 0, s1 = 1) => {
      ctx.beginPath();
      const n = 30;
      for (let i = 0; i <= n; i++) {
        const t = lerp(s0, s1, i / n);
        const x = L * (ref - t);
        const y = -sampleProfile(DORSAL, t) * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = n; i >= 0; i--) {
        const t = lerp(s0, s1, i / n);
        ctx.lineTo(L * (ref - t), sampleProfile(DORSAL, t) * k);
      }
      ctx.closePath();
    };
    const sub = 1 - s.surfacing * 0.35;
    // 胸鳍：短而窄，与背部同色
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(L * (ref - 0.31), side * 2.3);
      ctx.rotate(side * (Math.PI - 0.95) + Math.sin(time * 0.5 + side) * 0.04);
      ctx.fillStyle = `rgba(52,98,118,${0.8 * sub})`;
      ctx.beginPath();
      ctx.moveTo(0, -0.32);
      ctx.quadraticCurveTo(1.5, -0.38, 2.9, -0.04);
      ctx.quadraticCurveTo(1.5, 0.26, 0, 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // 尾叶：宽阔的三角形，后缘平直，中间一道缺刻
    ctx.save();
    ctx.translate(L * (ref - 1), 0);
    ctx.scale(flukeK, 1);
    ctx.fillStyle = `rgba(28,62,84,${0.85 * sub})`;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.bezierCurveTo(-0.7, -1, -2.2, -2.6, -2.6, -3.1);
    ctx.quadraticCurveTo(-1.7, -1.6, -1.9, -0.15);
    ctx.lineTo(-1.6, 0);
    ctx.lineTo(-1.9, 0.15);
    ctx.quadraticCurveTo(-1.7, 1.6, -2.6, 3.1);
    ctx.bezierCurveTo(-2.2, 2.6, -0.7, 1, 0.5, 0);
    ctx.fill();
    ctx.restore();
    // 身体（水下，柔和的边缘）
    ctx.fillStyle = `rgba(30,70,95,${0.35 * sub})`;
    outline(1.18);
    ctx.fill();
    ctx.fillStyle = `rgba(26,58,80,${0.9 * sub + 0.1})`;
    outline(1);
    ctx.fill();
    // 露出水面的背部
    if (s.surfacing > 0.02) {
      const k = s.surfacing;
      ctx.globalAlpha = k;
      const bg = ctx.createLinearGradient(0, -1, 0, 1);
      bg.addColorStop(0, '#1f262d');
      bg.addColorStop(0.5, '#3a444e');
      bg.addColorStop(1, '#1f262d');
      ctx.fillStyle = bg;
      outline(0.62, 0.1, 0.7);
      ctx.fill();
      // 湿润的高光
      ctx.strokeStyle = 'rgba(220,240,255,0.35)';
      ctx.lineWidth = 0.17;
      ctx.beginPath();
      ctx.moveTo(L * (ref - 0.14), -0.26);
      ctx.quadraticCurveTo(L * (ref - 0.4), -0.6, L * (ref - 0.66), -0.2);
      ctx.stroke();
      // 喷气孔（前方有一道防溅脊）
      ctx.fillStyle = '#0d1014';
      ctx.beginPath();
      ctx.ellipse(L * (ref - S_BLOW), -0.22, 0.28, 0.1, 0.1, 0, TAU);
      ctx.ellipse(L * (ref - S_BLOW), 0.22, 0.28, 0.1, -0.1, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,225,240,0.25)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(L * (ref - S_BLOW) + 0.5, 0, 0.6, -1.1, 1.1);
      ctx.stroke();
      // 背鳍：很小，在身体后部约四分之三处
      ctx.fillStyle = '#1b2127';
      ctx.beginPath();
      ctx.ellipse(L * (ref - 0.79), 0, 0.4, 0.12, 0, 0, TAU);
      ctx.fill();
      // 背部周围的白色浪花：沿边缘散布的柔和泡沫
      const mist = textures().mist;
      for (let i = 0; i < 22; i++) {
        const t = 0.1 + (i / 21) * 0.6;
        const side = i % 2 ? 1 : -1;
        const x = L * (ref - t) + Math.sin(time * 1.3 + i) * 0.17;
        const y = side * sampleProfile(DORSAL, t) * 0.7;
        const r = 0.75 + hash1(i * 7) * 0.7;
        ctx.globalAlpha = k * (0.35 + 0.2 * Math.sin(time * 0.8 + i * 1.7));
        ctx.drawImage(mist[i % 3], x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }
}
