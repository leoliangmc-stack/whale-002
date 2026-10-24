import { hex, makeShade, rgba, shadeRGB, type RGB, type Shade } from '../core/color';
import { hash1, mod, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import type { QualitySettings } from '../config/performance';
import { S_REF, WHALE_LEN } from '../entities/WhaleBody';

/**
 * ParticleManager：漂浮颗粒（海洋雪）、着陆时扬起的沉积物、海面喷气水雾与气泡。
 *  - 海洋雪使用固定数组 + 视差偏移，永不重新分配；
 *  - 海洋雪属于“水体参照系”：镜头相对水体的移动才产生视差（水体偏移由叙事给出），
 *    因此鲸鱼下沉时，颗粒以鲸鱼相对水体的缓慢速度从身边经过；
 *  - 大型身体经过时，附近的颗粒被轻轻推开、身后的颗粒被稍稍带走（绘制时的位移场，不累积）；
 *  - 沉积物与水雾是叙事进度的解析函数（位置 = f(局部时间)），可以完美倒放。
 */

/** 在水中移动的大型身体（用于颗粒的绕流偏移） */
export interface Wake {
  amt: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  /** 相对水体的速度（m/s） */
  vx: number;
  vy: number;
  /** 尾叶推水：尾叶中部的世界位置与它相对身体的速度（m/s，主要是上下拍动），以及强度 */
  flukeX: number;
  flukeY: number;
  flukeVx: number;
  flukeVy: number;
  flukeAmt: number;
}

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
  /** 水体在世界中的累计偏移（米）：只有镜头相对水体的移动才让颗粒产生视差 */
  waterX = 0;
  waterY = 0;
  readonly wake: Wake = { amt: 0, x: 0, y: 0, z: 0, pitch: 0, vx: 0, vy: 0, flukeX: 0, flukeY: 0, flukeVx: 0, flukeVy: 0, flukeAmt: 0 };
  private readonly fp = { x: 0, y: 0, s: 0 };
  private readonly wp = { x: 0, y: 0, s: 0 };

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
    const cx = cam.cx - this.waterX;
    const cy = cam.cy - this.waterY;
    if (Number.isNaN(this.lastCx)) {
      this.lastCx = cx;
      this.lastCy = cy;
    }
    let dx = (cx - this.lastCx) * ppm;
    let dy = (cy - this.lastCy) * ppm;
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
    this.lastCx = cx;
    this.lastCy = cy;
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
    // 绕流：把身体近似为沿脊线的椭圆（屏幕像素），速度换算为屏幕位移
    const wk = this.wake;
    const P = this.wp;
    let wOn = false;
    let wcx = 0;
    let wcy = 0;
    let ax = 1;
    let ay = 0;
    let ea = 1;
    let eb = 1;
    let mvx = 0;
    let mvy = 0;
    let push = 0;
    let trail = 0;
    if (!near && wk.amt > 0.01 && cam.project(wk.x, wk.y, wk.z, P)) {
      const sp = Math.hypot(wk.vx, wk.vy);
      if (sp > 0.02) {
        wOn = true;
        wcx = P.x;
        wcy = P.y;
        ax = Math.cos(wk.pitch);
        ay = Math.sin(wk.pitch);
        ea = 13 * P.s;
        eb = 3.9 * P.s;
        mvx = wk.vx / sp;
        mvy = wk.vy / sp;
        // 位移约等于身体在 0.4 秒内移过的距离，并且不超过身体半高的一部分
        push = wk.amt * Math.min(eb * 0.45, sp * 0.4 * P.s);
        trail = wk.amt * Math.min(eb * 0.5, sp * 0.5 * P.s);
      }
    }
    // 尾叶推水：尾叶附近的颗粒顺着尾叶的拍动被推开一点，并带一点旋涡（屏幕像素）
    let fOn = false;
    let fcx = 0;
    let fcy = 0;
    let fr = 1;
    let fdx = 0;
    let fdy = 0;
    if (!near && wk.flukeAmt > 0.01 && cam.project(wk.flukeX, wk.flukeY, wk.z, this.fp)) {
      fOn = true;
      fcx = this.fp.x;
      fcy = this.fp.y;
      fr = 3.4 * this.fp.s;
      // 约 0.45 秒的位移，不超过半径的 0.3 倍
      const k = wk.flukeAmt * 0.45 * this.fp.s;
      const lim = fr * 0.3;
      fdx = Math.max(-lim, Math.min(lim, wk.flukeVx * k));
      fdy = Math.max(-lim, Math.min(lim, wk.flukeVy * k));
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const k = this.d[i];
      const isNear = k > 1.3;
      if (near !== isNear) continue;
      let x = mod(this.u[i] * W + this.ox[i], W) - margin;
      let y = mod(this.v[i] * H + this.oy[i], H) - margin;
      // 与鲸鱼大致处于同一深度层的颗粒才受绕流影响
      if (wOn && k > 0.6) {
        const kz = (k - 1) / 0.32;
        const lw = Math.exp(-kz * kz);
        const dx = x - wcx;
        const dy = y - wcy;
        const u = (dx * ax + dy * ay) / ea;
        const v = (dy * ax - dx * ay) / eb;
        const r2 = u * u + v * v;
        if (r2 < 12 && lw > 0.05) {
          const r = Math.sqrt(r2);
          // 1) 靠近身体的颗粒沿轮廓法向被推开，随距离迅速减弱
          const f = r < 1 ? 1 : Math.exp(-(r - 1) * 1.5);
          let gx = (u / ea) * ax - (v / eb) * ay;
          let gy = (u / ea) * ay + (v / eb) * ax;
          const gl = Math.hypot(gx, gy) || 1;
          gx /= gl;
          gy /= gl;
          x += gx * push * f * lw;
          y += gy * push * f * lw;
          // 2) 尾流：身体后方（运动方向的反侧）的颗粒被轻轻带向运动方向
          const behind = -(dx * mvx + dy * mvy);
          if (behind > 0) {
            const lat = (dy * mvx - dx * mvy) / (ea * 0.85);
            const wl = Math.exp(-lat * lat) * Math.exp(-behind / (eb * 3.5)) * smoothstep(0, eb, behind);
            x += mvx * trail * wl * lw;
            y += mvy * trail * wl * lw;
          }
        }
      }
      if (fOn && k > 0.6) {
        const kz = (k - 1) / 0.32;
        const lw = Math.exp(-kz * kz);
        const dx = (x - fcx) / fr;
        const dy = (y - fcy) / fr;
        const r2 = dx * dx + dy * dy;
        if (r2 < 4 && lw > 0.05) {
          const g = Math.exp(-r2 * 1.6) * lw;
          // 旋涡：尾叶两侧的水向相反方向偏转
          const sw = 0.55 * Math.sign(dx * fdy - dy * fdx);
          x += (fdx - sw * fdy) * g;
          y += (fdy + sw * fdx) * g;
        }
      }
      if (y < clipTop) continue;
      // 漂进光束里的颗粒被照亮
      const lit = 1 + Math.min(1.2, 7 * rc.light.rayLightAt(x, y));
      const s = this.size[i] * (isNear ? k * 2.2 : 0.8 + k * 1.6) * Math.min(1.6, Math.max(0.6, cam.ppm / 30)) * (0.85 + 0.15 * lit);
      const a = (isNear ? 0.16 : 0.12 + 0.3 * Math.min(1, k)) * lum * speedFade * lit;
      ctx.globalAlpha = a;
      const sl = s + streak * k;
      ctx.drawImage(tex, x - s, y - sl, s * 2, sl * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * 鲸鱼落上海床时被挤起的细沉积物。t 为接触后的秒数，x 为静卧时鲸鱼参考点的世界 x。
   *
   * 不是一团向外喷射的烟雾，而是贴着海床、慢慢向两侧“流”出去的一层薄雾：
   *  - 从最先接触的胸腹部开始，沿着腹部依次被挤出；尾部最后落下时只有一小股；
   *  - 颗粒贴近海床、只升起不到一米，向外的速度很快被水阻耗尽，随后悬浮、缓缓沉降；
   *  - 身体后方（z>0）的颗粒在鲸鱼之前绘制（behind=true），前方的在之后绘制。
   * 位置是 t 的解析函数，可以完美倒放。
   */
  drawSediment(rc: RenderCtx, t: number, x: number, seabedY: number, behind: boolean): void {
    if (t <= 0 || t >= 13) return;
    const { ctx, cam, dpr } = rc;
    const n = Math.round(rc.quality.sediment * 1.6);
    const sh = this.sh;
    rc.light.shadeAt(x, seabedY, 0, sh);
    const col = shadeRGB(SAND, sh, this.tmpC, 0.35);
    const tex = this.sandDot(col);
    const P = this.wp;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 身体后方涌起的一团浑浊：几十吨的身体砸进软泥，整片细泥被掀起，几秒内涨大，再慢慢沉降、变淡
    if (behind) {
      const k = smoothstep(0, 1.6, t) * (1 - smoothstep(5, 12, t));
      if (k > 0.01 && cam.project(x + WHALE_LEN * (S_REF - 0.42), seabedY - 1.2 - 1.4 * smoothstep(0, 4, t), 3, P)) {
        const rx = (13 + 7 * smoothstep(0, 5, t)) * P.s;
        const ry = (2.6 + 2.2 * smoothstep(0, 4, t)) * P.s;
        ctx.save();
        ctx.translate(P.x, P.y);
        ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, rgba(col, 0.32 * k));
        g.addColorStop(0.6, rgba(col, 0.14 * k));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    for (let i = 0; i < n; i++) {
      const h = (k: number) => hash1(i * 11 + k);
      const tail = h(1) < 0.16;
      // 沿身体的位置（体长比例）与被挤出的时刻：前腹先触底，接触沿腹部向两端扩展；尾部最后
      const sv = tail ? 0.84 + h(2) * 0.16 : 0.13 + h(2) * 0.47;
      const t0 = tail ? 2.5 + h(3) * 0.9 : 0.1 + Math.abs(sv - 0.32) * 2.4 + h(3) * 0.35;
      const tau = t - t0;
      if (tau <= 0) continue;
      const side = h(4) < 0.5 ? -1 : 1;
      if (behind !== side > 0) continue;
      const half = tail ? 0.6 : 1.55 + 0.7 * Math.sin(Math.PI * Math.min(1, (sv - 0.1) / 0.55));
      // 向外的初速度很快被水阻耗尽（τ≈1.8 s）；身体两端的颗粒也向前 / 向后流出一些
      const v = (tail ? 0.9 : 1.2) + h(5) * 2.4;
      const ends = sv < 0.2 ? 0.7 : tail ? -0.6 : 0;
      const dirX = (h(6) - 0.5) * 0.9 + ends;
      const dirZ = side * (0.7 + 0.3 * h(7));
      const e = 1 - Math.exp(-tau / 1.8);
      const reach = v * 1.8 * e + 0.1 * tau;
      const x0 = x + WHALE_LEN * (S_REF - sv) + (h(8) - 0.5) * 0.7;
      const px = x0 + dirX * reach + Math.sin(tau * 0.31 + i) * 0.07 * tau;
      const pz = side * half + dirZ * reach;
      // 涌起的细泥：大多贴着海床翻滚，一部分升到四五米高，随后缓慢沉降
      const rise = (0.5 + 4.6 * Math.pow(h(9), 1.6)) * (1 - Math.exp(-tau / 1.4));
      const fall = 0.09 * Math.pow(Math.max(0, tau - 3), 1.3);
      const py = Math.min(seabedY - 0.06, seabedY - 0.08 - rise + fall);
      if (!cam.project(px, py, pz, P)) continue;
      const size = (0.8 + 1.0 * h(10) + 1.9 * (1 - Math.exp(-tau / 3.5))) * P.s;
      const a =
        (tail ? 0.2 : 0.27) * smoothstep(0, 0.5, tau) * (1 - smoothstep(5, 11.5 - 2 * h(3), tau)) * (0.45 + 0.55 * h(11)) *
        (1 - 0.45 * smoothstep(2, 5, rise + 0.08 - fall));
      if (a < 0.006 || size < 0.5) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(tex, P.x - size, P.y - size * 0.55, size * 2, size * 1.1);
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
    // 喷气时间（秒）：约 2.6 秒的持续喷射，之后水雾柱在空中停留、慢慢飘散
    const T = b * 9;
    const n = Math.round(rc.quality.spout * 1.7);
    const mists = textures().mist;
    const dot = textures().dotHard;
    const P = { x: 0, y: 0, s: 0 };
    const sun = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < n; i++) {
      const r1 = hash1(i * 9 + 11);
      const r2 = hash1(i * 9 + 12);
      const r3 = hash1(i * 9 + 13);
      // 持续约 2.6 秒的喷射：先喷出的冲得最高，整根水柱从海面一直连到顶端
      const tau0 = r1 * 2.6;
      const t = T - tau0;
      if (t <= 0) continue;
      // 蓝鲸的喷气：又高又细的水雾柱，可达 9 米，顶端才散开
      const v0 = 3.5 + (1 - r1 * 0.6) * r2 * 11;
      const td = 0.7;
      const e = 1 - Math.exp(-t / td);
      const rise = v0 * td * e;
      const spread = (r3 - 0.5) * (0.2 + rise * 0.1 + Math.max(0, rise - 5) * 0.12);
      const wind = 0.55 * Math.max(0, t - 0.4);
      const x = ox + spread + wind + Math.sin(t * 1.3 + i) * 0.08 * t;
      const y = oy - rise + 0.06 * t * t;
      const z = oz + (r1 - 0.5) * 0.8;
      if (!cam.project(x, y, z, P)) continue;
      const size = (0.12 + rise * 0.06 + t * 0.2) * P.s;
      const a = 0.42 * smoothstep(0, 0.1, t) * (1 - smoothstep(2.4 + r3 * 1.2, 5.2 + r1 * 1.4, t)) * sun;
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
      const t = T - r1 * 2.4;
      if (t <= 0 || t > 2.6) continue;
      const v0 = 8 + r2 * 5;
      const x = ox + (r1 - 0.5) * 1.6 * t + 0.4 * t;
      const y = oy - v0 * t + 4.9 * t * t;
      if (y > oy + 0.2) continue;
      if (!cam.project(x, y, oz, P)) continue;
      const s = Math.max(0.8, 0.03 * P.s);
      ctx.globalAlpha = 0.5 * (1 - t / 2.6);
      ctx.drawImage(dot, P.x - s, P.y - s, s * 2, s * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // 阳光下水雾里淡淡的彩虹
    const ra = 0.055 * smoothstep(0.9, 1.6, T) * (1 - smoothstep(5.0, 7.5, T));
    if (ra > 0.005 && cam.project(ox + 0.8 + T * 0.4, oy - 3.4, oz - 0.5, P)) {
      const R = 2.8 * P.s;
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
    // 高斯衰减：大量半透明颗粒叠加时不会出现一圈圈的边缘
    const rg = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      rg.addColorStop(t, `rgba(${key},${(0.9 * (Math.exp(-3.5 * t * t) - Math.exp(-3.5))) / (1 - Math.exp(-3.5))})`);
    }
    g.fillStyle = rg;
    g.fillRect(0, 0, 48, 48);
    this.sandKey = key;
    return this.sandTex;
  }
}
