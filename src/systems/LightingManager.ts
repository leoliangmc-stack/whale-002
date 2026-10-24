import type { Camera } from '../core/Camera';
import { hex, mixRGB, rgba, sampleStops, type RGB, type Shade } from '../core/color';
import { clamp, fract, hash1, lerp, noise1, smoothstep } from '../core/math';
import { FAN_SPREAD, textures, type Tex } from '../core/textures';
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
  /** 光束随深度衰减的长度（米，默认 70）：下沉时光束可以一直追随到更深的水层 */
  rayLen?: number;
  /** 自上而下的散射天光（0~1）：开阔的深蓝海水，上方略亮、下方渐深，深海中也不是一片死黑 */
  glow?: number;
  /** 深蓝调色（0~1）：下沉时整体压低亮度、偏向清澈的深蓝，避免浅层的青色过曝 */
  tone?: number;
  /** 身体的柔和轮廓光与体积明暗（0~1） */
  rim?: number;
  /** 参考画面的浅海光照（0~1）：灰蓝、通透的海水，画面上缘明亮起伏的海面，密集的光柱，受光明亮的身体 */
  sunlit?: number;
}

/** 一束光在屏幕上的位置：顶部中心、每像素的水平偏移（扇形散开）、宽度与强度 */
interface RayBeam {
  x: number;
  top: number;
  slope: number;
  w0: number;
  w1: number;
  len: number;
  a: number;
}

/**
 * 光束分为远、中、近三层：远处宽而淡、移动慢，近处窄而稀疏、视差大；
 * 每一层都从画面上方的同一个“太阳”方向扇形散开，层层叠叠形成体积感。
 */
/**
 * 深蓝调色（tone = 1 时）：海水、雾色与物体受光的逐通道系数。像电影调色一样压低浅层的青色高光，
 * 红、绿压得多一些，画面偏向清澈的深蓝而不过曝。直接作用在颜色上，不需要额外的全屏合成。
 */
const TONE: RGB = [178 / 255, 204 / 255, 234 / 255];
/** 自上而下的散射天光：画面上缘、中部与下缘混入的颜色 */
const GLOW_TOP: RGB = [70, 150, 215];
const GLOW_MID: RGB = [40, 110, 180];
const GLOW_BOT: RGB = [2, 10, 24];

/**
 * 参考画面的浅海光照：画面上缘、中部与下缘的海水颜色（不含光柱），从参考画面中光柱之间的海水量出。
 * 浅处是通透的灰蓝，越深越暗、越偏向深蓝，最后与深海的颜色接上。
 */
const SUN_SHALLOW: RGB[] = [[136, 160, 182], [104, 132, 156], [72, 98, 124]];
const SUN_DEEP: RGB[] = [[34, 66, 98], [20, 46, 76], [8, 22, 44]];
/** 浅海阳光下物体受光的颜色（略偏冷的中性白） */
const SUN_TINT: RGB = [0.95, 0.99, 1.02];
/** 浅海阳光在水中的散射（物体上蒙的一层薄雾）：浅处明亮的灰蓝，深处的深蓝 */
const SUN_HAZE: RGB = [178, 198, 214];
const SUN_HAZE_DEEP: RGB = [30, 58, 88];

/** 背景与光束离屏图层的分辨率（相对 CSS 像素） */
const RAY_RES = 0.25;

/** 记录下来、供颗粒判断是否在光里的光束数 */
const MAX_BEAMS = 40;

/**
 * 每一层的基准光束数。光束画在 1/4 分辨率的图层上，开销很小，所以不随画质分级变化：
 * 画质自动升降时光束的位置与数量保持不变，画面不会忽明忽暗。
 */
const RAY_COUNT = 8;

const RAY_LAYERS = [
  { z: 150, count: 0.7, alpha: 0.07, width: 1.25, sway: 0.05, streak: 0, close: false },
  { z: 60, count: 1, alpha: 0.11, width: 0.85, sway: 0.07, streak: 0.5, close: false },
  { z: 18, count: 0.4, alpha: 0.07, width: 1.6, sway: 0.1, streak: 0.35, close: true },
];

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
  rayLen = 70;
  glow = 0;
  tone = 0;
  rim = 0;
  sunlit = 0;
  /** 浅海光照的强弱（0~1）：随深度衰减，但比普通的光束更持久——鲸鱼弯成弓形下沉的那几个镜头仍然明亮 */
  sunR = 0;
  /** 远处海水在画面中可见高度的一半（米，用于把参考画面的上下渐变放到对应深度） */
  private span = 100;
  /** 本帧画出的光束（供颗粒判断自己是否在光里） */
  private readonly beams: RayBeam[] = [];
  private beamCount = 0;
  /** 背景与光束的离屏图层（1/4 分辨率，见 drawBackground） */
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;
  /** 海面波光的平铺图案（建在低分辨率图层上） */
  private ripple: CanvasPattern | null = null;
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
    this.rayLen = input.rayLen ?? 70;
    this.sunlit = input.sunlit ?? 0;
    this.glow = input.glow ?? 0;
    // 浅海光照本身就是通透、不过曝的颜色，不再需要深蓝调色
    this.tone = (input.tone ?? 0) * (1 - this.sunlit);
    this.rim = input.rim ?? 0;
    this.sunR = Math.pow(clamp(this.rayAt(this.depth - 10) * 1.8), 0.6);
    const b = cam.boundsAt(400);
    this.span = Math.max(1, (b.b - b.t) / 2);
    this.waterAt(this.depth, this.water);
  }

  waterAt(y: number, out: RGB): RGB {
    sampleStops(WATER_STOPS, y, out);
    if (this.tone > 0) for (let i = 0; i < 3; i++) out[i] *= lerp(1, TONE[i], this.tone);
    const sl = this.sunlit;
    if (sl > 0.001) {
      // 参考画面：按相对镜头的高度取上 / 中 / 下的颜色，按浅海光照的强弱在浅处与深处的颜色之间过渡
      const u = clamp((y - this.depth) / this.span, -1, 1) + 1;
      const i = Math.min(1, Math.floor(u));
      const t = u - i;
      const r = this.sunR;
      for (let c = 0; c < 3; c++) {
        const a = lerp(SUN_DEEP[i][c], SUN_SHALLOW[i][c], r);
        const b = lerp(SUN_DEEP[i + 1][c], SUN_SHALLOW[i + 1][c], r);
        out[c] = lerp(out[c], lerp(a, b, t), sl);
      }
    }
    return out;
  }

  lightAt(y: number): number {
    return sampleScalar(LIGHT_STOPS, y);
  }

  /** 光线强度（0~1），用于光束、焦散等只在浅层出现的效果。 */
  sunAt(y: number): number {
    return clamp(Math.exp(-Math.max(0, y) / 70));
  }

  /** 光束强度（0~1）：与 sunAt 相同，但衰减长度可以由叙事调节 */
  rayAt(y: number): number {
    return clamp(Math.exp(-Math.max(0, y) / this.rayLen));
  }

  /** 屏幕点 (x, y) 处光束的亮度（0~1 左右）：海洋雪漂进光里时会被照亮 */
  rayLightAt(x: number, y: number): number {
    let sum = 0;
    for (let i = 0; i < this.beamCount; i++) {
      const b = this.beams[i];
      const t = (y - b.top) / b.len;
      if (t < 0 || t > 1) continue;
      const half = (b.w0 + (b.w1 - b.w0) * t) * 0.5;
      const u = (x - (b.x + b.slope * (y - b.top))) / half;
      if (u < -1.6 || u > 1.6) continue;
      const fade = Math.pow(1 - t, 1.6) * Math.min(1, t * 6);
      sum += b.a * Math.exp(-u * u * 3.2) * fade;
    }
    return sum;
  }

  shadeAt(x: number, y: number, z: number, out: Shade): Shade {
    const cam = this.cam;
    out.light = this.lightAt(y);
    sampleStops(TINT_STOPS, y, out.tint);
    if (this.tone > 0) for (let i = 0; i < 3; i++) out.tint[i] *= lerp(1, TONE[i], this.tone);
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
    // 浅海光照：上方的阳光把身体照得明亮、偏中性，水中的散射光再蒙上一层薄薄的灰蓝
    const sl = this.sunlit;
    if (sl > 0.001) {
      const r = this.sunR;
      out.light = lerp(out.light, lerp(0.6, 1.08, r), sl);
      for (let i = 0; i < 3; i++) out.tint[i] = lerp(out.tint[i], SUN_TINT[i], sl * r);
    }
    this.waterAt(y, out.fogC);
    if (sl > 0.001) {
      const r = this.sunR;
      const k = sl * (0.04 + 0.08 * r);
      for (let i = 0; i < 3; i++) out.fogC[i] = lerp(out.fogC[i], lerp(SUN_HAZE_DEEP[i], SUN_HAZE[i], r), k / Math.max(1e-3, out.fog + (1 - out.fog) * k));
      out.fog += (1 - out.fog) * k;
    }
    return out;
  }

  /**
   * 背景：远处海水的垂直渐变、浅层时朝向海面的明亮辉光，以及从海面射入的光束。
   * 它们都非常柔和，所以先画在 1/4 分辨率的离屏图层上，再一次性放大铺满画面：
   * 层层叠叠的光束不会带来大量的全屏填充。
   */
  drawBackground(rc: RenderCtx): void {
    const { ctx: out, w, h, dpr } = rc;
    const lw = Math.ceil(w * RAY_RES);
    const lh = Math.ceil(h * RAY_RES);
    if (!this.layer) {
      this.layer = document.createElement('canvas');
      this.layerCtx = this.layer.getContext('2d');
    }
    if (this.layer.width !== lw || this.layer.height !== lh) {
      this.layer.width = lw;
      this.layer.height = lh;
    }
    const ctx = this.layerCtx!;
    ctx.setTransform(RAY_RES, 0, 0, RAY_RES, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.paintWater(rc, ctx);
    this.paintRays(rc, ctx);
    this.paintSurface(rc, ctx);
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha = 1;
    out.globalCompositeOperation = 'source-over';
    out.imageSmoothingEnabled = true;
    out.drawImage(this.layer, 0, 0, lw, lh, 0, 0, w * dpr, h * dpr);
    out.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 海水的渐变与天光（CSS 像素坐标，画在离屏图层上） */
  private paintWater(rc: RenderCtx, ctx: CanvasRenderingContext2D): void {
    const { cam, w, h } = rc;
    const far = 400;
    const b = cam.boundsAt(far);
    const top = this.waterAt(b.t, this.tmpA);
    const bot = this.waterAt(b.b, this.tmpB);
    const mid: RGB = [0, 0, 0];
    this.waterAt((b.t + b.b) / 2, mid);
    // 下沉：自上而下的散射天光——开阔、清澈的深蓝海水，上方略亮、下方渐深，深海中也保留一点层次
    const gl = this.glow * (1 - this.sunlit);
    if (gl > 0.01) {
      const k = gl * (1 - 0.55 * smoothstep(80, 1500, cam.cy));
      mixRGB(top, GLOW_TOP, 0.22 * k, top);
      mixRGB(mid, GLOW_MID, 0.05 * k, mid);
      mixRGB(bot, GLOW_BOT, 0.3 * k, bot);
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(top));
    g.addColorStop(0.5, rgba(mid));
    g.addColorStop(1, rgba(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 朝向海面的天光：越靠近海面越亮（深蓝调色时压低，不过曝）
    const sun = this.sunAt(cam.cy) * lerp(1, 0.75, this.tone);
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

  /** 从海面射入的流动光束（加色混合）：远中近三层、从上方扇形散开，柔和而不过曝。 */
  private paintRays(rc: RenderCtx, ctx: CanvasRenderingContext2D): void {
    const { cam, w, h, time } = rc;
    this.beamCount = 0;
    // 浅海光照：参考画面里密密的光柱从海面一直照到画面下缘
    const sl = this.sunlit;
    const sun = lerp(this.rayAt(cam.cy - 10), this.sunR, sl) * this.raysMul * lerp(1, 0.8, this.tone);
    if (sun < 0.02) return;
    const dense = 1 + 1.4 * sl;
    const strong = 1 + 0.55 * sl;
    ctx.globalCompositeOperation = 'lighter';
    const tex = textures().ray;
    // 太阳在画面上方偏左的远处：所有光束从这个方向散开
    const apexX = w * 0.4;
    const apexY = -h * 2.4;
    for (let L = 0; L < RAY_LAYERS.length; L++) {
      const layer = RAY_LAYERS[L];
      // 近处的一层只在镜头靠近时出现：远景里它会与远处的光束叠成一团过亮的光斑
      const near = layer.close ? 1 - smoothstep(45, 90, cam.shot.frameH) : 1;
      if (near < 0.02) continue;
      const n = Math.max(2, Math.round(RAY_COUNT * layer.count * dense));
      const s = cam.scaleAt(layer.z);
      const surfaceY = cam.py + (0 - cam.cy) * s;
      const topY = Math.max(-h * 0.1, surfaceY);
      if (topY > h) continue;
      const len = h * (1.3 + 0.8 * sl);
      const span = w * 1.8;
      const spacing = span / n;
      const camShift = -(cam.cx * s * 0.6);
      for (let i = 0; i < n; i++) {
        const seed = hash1(i * 7 + 3 + L * 101);
        const sway = noise1(time * layer.sway * 0.6 + i * 3.1 + L * 17, 11 + L) * spacing * 0.35;
        const base = ((((i + seed * 0.6) * spacing + camShift + sway) % span) + span) % span - w * 0.4;
        const width = spacing * (0.35 + seed * 0.7) * layer.width;
        // 每束光的亮度只有很慢、很轻的起伏（海面的波浪让光柱缓缓变化），不会一闪一闪
        const flick = 0.7 + 0.15 * (0.5 + 0.5 * noise1(time * 0.06 + seed * 50, 5 + L));
        const a = Math.min(1, layer.alpha * sun * flick * near * strong);
        // 扇形：光束的方向指向上方的太阳；越往下越宽
        const slope = (base - apexX) / (topY - apexY);
        const w1 = width * FAN_SPREAD;
        this.drawBeam(ctx, tex, base, topY, slope, w1, len, a);
        if (this.beamCount < MAX_BEAMS) this.beams[this.beamCount++] = { x: base, top: topY, slope, w0: width, w1, len, a };
        // 光束内部更亮、更细的光丝，形成层次
        if (layer.streak > 0 && seed > 0.35) {
          const off = (hash1(i * 13 + L) - 0.5) * width * 0.5;
          this.drawBeam(ctx, tex, base + off, topY, slope, w1 * 0.24, len * 0.85, a * layer.streak);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * 参考画面里的海面：从下方斜着仰望，画面上缘是一道明亮的天光，上面是一排排被拉长的波光——
   * 近处（画面最上方）宽大、流动得快，越靠近地平线越扁、越密、越暗，下缘柔和地融进光柱里。
   * 与海水、光束画在同一张低分辨率图层上（波光本来就柔和），每排波光是一次按纹理坐标缩放的平铺填充。
   */
  private paintSurface(rc: RenderCtx, ctx: CanvasRenderingContext2D): void {
    const lit = this.sunlit * this.sunR;
    if (lit < 0.02) return;
    const { w, h, time } = rc;
    const k0 = RAY_RES;
    const hb = h * 0.24;
    // 光束按各自的斜率改过变换，这里先恢复图层的坐标（CSS 像素）
    ctx.setTransform(k0, 0, 0, k0, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, hb * 1.8);
    g.addColorStop(0, `rgba(214,234,247,${0.32 * lit})`);
    g.addColorStop(0.25, `rgba(192,220,240,${0.17 * lit})`);
    g.addColorStop(0.55, `rgba(172,206,232,${0.07 * lit})`);
    g.addColorStop(1, 'rgba(160,200,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hb * 1.8);
    const tex = textures().ripple;
    if (!this.ripple) this.ripple = ctx.createPattern(tex, 'repeat-x');
    ctx.fillStyle = this.ripple!;
    ctx.globalCompositeOperation = 'lighter';
    let y0 = -hb * 0.08;
    for (let k = 0; k < 8; k++) {
      const hgt = hb * 0.3 * Math.pow(0.7, k);
      // 每排两层错开、宽窄不同的波光，彼此重叠，避免看出整齐的平铺
      for (let j = 0; j < 2; j++) {
        const tile = hgt * (j ? 5.3 : 8.1);
        const drift = time * tile * (j ? -0.031 : 0.047) + hash1(k * 5 + j) * tile;
        const off = (drift % tile) - tile;
        const sx = tile / tex.width;
        const sy = (hgt * 1.6) / tex.height;
        ctx.globalAlpha = (j ? 0.11 : 0.15) * lit * (1 - k / 9) * (1 - smoothstep(0.2, 0.95, y0 / hb));
        ctx.setTransform(k0 * sx, 0, 0, k0 * sy, k0 * off, k0 * (y0 - hgt * 0.3 * j));
        ctx.fillRect(0, 0, (w - off) / sx, tex.height);
      }
      y0 += hgt;
    }
    ctx.setTransform(k0, 0, 0, k0, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 一束上窄下宽（宽度比见 rayTexture）、按斜率倾斜的光（画在离屏图层上，坐标为 CSS 像素） */
  private drawBeam(ctx: CanvasRenderingContext2D, tex: Tex, x: number, top: number, slope: number, w1: number, len: number, a: number): void {
    if (a < 0.004) return;
    const k = RAY_RES;
    ctx.globalAlpha = a;
    ctx.setTransform((k * w1) / tex.width, 0, (k * slope * len) / tex.height, (k * len) / tex.height, k * (x - w1 / 2), k * top);
    ctx.drawImage(tex, 0, 0);
  }

  /** 暗角、深海局部光的整体调色。 */
  drawGrade(rc: RenderCtx): void {
    const { ctx, w, h, dpr } = rc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const deep = smoothstep(150, 1200, this.depth);
    // 参考画面几乎没有暗角
    const v = this.vignette * (1 - 0.55 * this.sunlit);
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
