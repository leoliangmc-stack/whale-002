import { hex, makeShade, rgba, shadeRGB, type RGB, type Shade } from '../core/color';
import { clamp, hash1, rng, sampleProfile, smoothstep, TAU } from '../core/math';
import type { RenderCtx } from '../core/types';
import { ART_H, ART_W, AXIS_ANGLE, AXIS_PX, axisPx, mipLevel, sAtPx, whaleArt, type AlphaMask, type Mipped } from './WhaleArt';
import { WHALE_LEN, type WhaleBody } from './WhaleBody';
import type { FinPose, WhaleState } from './Whale';

/**
 * 蓝鲸骨骼：whale-kit 中与身体画同一取景的骨骼画，按与身体相同的脊线切成条带绘制，
 * 所以分解过程中从空洞里露出的骨头与身体严格对齐。
 *  - 坍塌：失去软组织的支撑后，整副骨架朝海床压低——胸腔里的肋骨向两侧摊开（侧视中变矮），
 *    脊柱随之落下，头骨只略微下沉；
 *  - 骨面上的生命：细菌席与食骨蠕虫长在骨头朝上的表面上，这些位置是从骨骼画的轮廓里找出来的；
 *  - 自由探索中的点击：把屏幕点换算回画中的像素，按所在区域判断是哪一类骨头。
 * 鲸落肚子朝上躺在海床上（见 WhaleBody 的静卧姿态），骨骼画与身体画一样沿体轴上下翻转：
 * 脊柱贴着海床，肋骨朝上，头骨倒扣着；“朝上的骨面”相应地是画中骨头的下缘。
 */

export type BoneKind = 'skull' | 'mandible' | 'vertebra' | 'rib' | 'chevron' | 'scapula' | 'flipper' | 'pelvis';

const BONE = {
  stain: hex('#6f685a'),
  mat: hex('#f2eedb'),
  matYellow: hex('#e8d58a'),
  matOrange: hex('#e3a35a'),
  ose: hex('#c8475a'),
  oseLight: hex('#ec8f98'),
  root: hex('#7fa36a'),
  light: hex('#f6f1e2'),
};

const matCache = new Map<string, HTMLCanvasElement>();

/**
 * 细菌席的精灵：边缘柔和、带一点斑驳的薄膜（近看时代替实心的椭圆）。按着色之后的颜色缓存
 * （颜色随深度与光照缓慢变化，量化之后只会生成少数几张）。
 */
function matSprite(col: RGB, kind: number): HTMLCanvasElement {
  const key = `${kind}:${col[0] >> 3},${col[1] >> 3},${col[2] >> 3}`;
  let c = matCache.get(key);
  if (c) return c;
  if (matCache.size > 24) matCache.clear();
  const [r, g, b] = col.map((v) => Math.round(clamp(v, 0, 255)));
  c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, `rgba(${r},${g},${b},0.92)`);
  gr.addColorStop(0.55, `rgba(${r},${g},${b},0.7)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.setTransform(1, 0, 0, 0.38, 0, 0);
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  x.setTransform(1, 0, 0, 1, 0, 0);
  // 斑驳：一些更亮、更暗的小点
  for (let k = 0; k < 40; k++) {
    const px = 20 + hash1(k * 7 + kind) * 88;
    const py = 14 + hash1(k * 13 + kind) * 22;
    x.fillStyle = k % 3 ? 'rgba(255,255,245,0.16)' : 'rgba(40,40,34,0.12)';
    x.beginPath();
    x.ellipse(px, py, 2 + hash1(k * 3) * 5, 1 + hash1(k * 5) * 2, 0, 0, TAU);
    x.fill();
  }
  matCache.set(key, c);
  return c;
}

/** 头骨上的骨质鼻孔（画框像素）：隐藏发现里的小端足类躲在这里 */
export const NARES = { x: 2297, y: 168 };

// ------------------------------------------------------------------ 画中骨骼的分区（画框像素）

/** 头骨后缘；其后是颈椎 */
const SKULL_X = 2030;
/** 头骨与下颌骨的分界（下颌骨在吻部下方） */
const JAW_Y = 285;
/** 脊柱（椎体）中心线的高度 */
const COLUMN: ReadonlyArray<readonly [number, number]> = [
  [0.26, 150],
  [0.3, 136],
  [0.4, 115],
  [0.5, 122],
  [0.6, 136],
  [0.7, 165],
  [0.8, 201],
  [0.9, 265],
  [1, 330],
  [1.05, 416],
  [1.1, 460],
];

/** 画中某个骨骼像素属于哪一类骨头 */
export function boneKindAt(x: number, y: number): BoneKind {
  if (x >= SKULL_X) return y >= JAW_Y && x >= 2040 ? 'mandible' : 'skull';
  // 退化的骨盆：胸腔后方、脊柱下面一小段不与脊柱相连的骨头
  if (x >= 1240 && x <= 1340 && y >= 250 && y <= 290) return 'pelvis';
  const s = sAtPx(x);
  if (y < sampleProfile(COLUMN, s) + 50) return 'vertebra';
  if (x >= 1590 && x <= 1880 && y >= 410 + 0.37 * (1880 - x)) return 'flipper';
  if (x >= 1765 && x <= 1935 && y >= 200 && y <= 430) return 'scapula';
  if (s >= 0.27 && s <= 0.62) return 'rib';
  // 尾椎下方的人字骨
  return 'chevron';
}

/**
 * 坍塌程度 c 时 s 处的竖向压缩：胸腔压得最低（肋骨向两侧摊开），尾椎也贴向海床；
 * 头骨与下颌骨整体只略微下沉（在头部保持不变，不会被压出台阶）。
 */
function collapseK(s: number, c: number): number {
  const chest = smoothstep(0.27, 0.42, s) * (1 - smoothstep(0.5, 0.82, s));
  const tail = smoothstep(0.55, 0.9, s);
  return 1 - c * (0.12 + 0.52 * chest + 0.32 * tail);
}

/** 每类骨头上附着点的数量上限 */
const ATTACH_CAP: Record<BoneKind, number> = { skull: 70, mandible: 34, vertebra: 120, rib: 90, chevron: 14, scapula: 14, flipper: 18, pelvis: 4 };
/** 每类骨头上细菌席斑块的大小（米） */
const ATTACH_R: Record<BoneKind, number> = { skull: 0.09, mandible: 0.07, vertebra: 0.06, rib: 0.045, chevron: 0.04, scapula: 0.07, flipper: 0.04, pelvis: 0.04 };

interface Anchor {
  x: number;
  y: number;
  kind: BoneKind;
  thMat: number;
  thOse: number;
  r: number;
  seed: number;
}

/** 骨骼画的条带：比身体画切得更细，坍塌时相邻条带的压缩程度几乎相同，看不出台阶 */
const SLICES = 160;

interface Slice {
  x0: number;
  x1: number;
  s: number;
  px: number;
  py: number;
  a: number;
  /** 坍塌：竖向压缩与偏移（朝海床压低），以及让相邻条带在脊柱高度处衔接的剪切 */
  ky: number;
  by: number;
  sh: number;
  /** 海床在体轴下方的距离（米） */
  g: number;
}

export class WhaleSkeleton {
  private readonly sh: Shade = makeShade();
  private readonly tmp: RGB = [0, 0, 0];
  private readonly f = { x: 0, y: 0, a: 0 };
  private readonly p = { x: 0, y: 0 };
  private readonly slices: Slice[] = [];
  private anchors: Anchor[] | null = null;
  /** 羽状鳃的控制点（复用） */
  private readonly pinn: number[] = [];
  /** 画面沿体轴上下翻转（肚子朝上）时为 −1 */
  private flip = 1;
  /** 附着点是按哪个朝向找出来的 */
  private anchorsFlip = 0;
  /** 附着点在鲸鱼局部坐标中的位置：x, y, thMat, thOse, r, seed */
  private att = new Float32Array(0);

  constructor(readonly seed = 1) {
    const w = ART_W / SLICES;
    for (let j = SLICES - 1; j >= 0; j--) {
      const x0 = j * w;
      this.slices.push({ x0, x1: x0 + w, s: sAtPx(x0 + w / 2), px: 0, py: 0, a: 0, ky: 1, by: 0, sh: 0, g: 0 });
    }
  }

  /** 骨骼的可见程度：软组织开始变薄时才逐渐显现 */
  visibility(st: WhaleState): number {
    return st.visible * smoothstep(1, 0.93, st.tissue);
  }

  /**
   * 摆放条带：沿身体的脊线；坍塌时每条带朝海床压缩。ground(lx) 给出局部 x 处海床的局部 y
   * （没有着地时为 null，不做压缩）。
   */
  prepare(body: WhaleBody, st: WhaleState, ground: ((lx: number) => number) | null): void {
    const L = WHALE_LEN;
    const f = this.f;
    const c = ground ? st.collapse : 0;
    this.flip = st.roll >= Math.PI - 1e-3 ? -1 : 1;
    let lastX = 0;
    let lastY = 0;
    let lastS = 0;
    let a1 = 0;
    for (const sl of this.slices) {
      const s = sl.s;
      if (s <= 1) {
        body.frame(Math.max(0, s), 0, f);
        sl.a = f.a;
        sl.px = f.x;
        sl.py = f.y;
        if (s < 0) {
          sl.px += -s * L * Math.cos(f.a);
          sl.py += -s * L * Math.sin(f.a);
        }
        lastX = sl.px;
        lastY = sl.py;
        lastS = s;
        a1 = f.a;
      } else {
        // 尾椎沿最后一段脊线的方向继续
        if (lastS < 1) {
          body.frame(1, 0, f);
          lastX = f.x;
          lastY = f.y;
          lastS = 1;
          a1 = f.a;
        }
        const d = (s - lastS) * L;
        sl.px = lastX - d * Math.cos(a1);
        sl.py = lastY - d * Math.sin(a1);
        sl.a = a1;
        lastX = sl.px;
        lastY = sl.py;
        lastS = s;
      }
      sl.ky = collapseK(s, c);
      sl.g = ground ? Math.max(0.3, ground(sl.px) - sl.py) : 0;
      sl.by = (1 - sl.ky) * sl.g;
    }
    // 每条带内部压缩程度并不相同：用剪切让脊柱（最连贯的一条横向骨骼）在条带之间连续
    const n = this.slices.length;
    const W = (ART_W / SLICES) * (L / AXIS_PX);
    const mpp = L / AXIS_PX;
    for (let j = 0; j < n; j++) {
      const sl = this.slices[j];
      if (c <= 0) {
        sl.sh = 0;
        continue;
      }
      const fw = this.slices[Math.max(0, j - 1)];
      const bw = this.slices[Math.min(n - 1, j + 1)];
      const col = (sampleProfile(COLUMN, sl.s) - axisPx(sl.s, this.p).y) * mpp * this.flip;
      const at = (k: number, g: number) => g + k * (col - g);
      const yf = at((sl.ky + fw.ky) / 2, (sl.g + fw.g) / 2);
      const yb = at((sl.ky + bw.ky) / 2, (sl.g + bw.g) / 2);
      sl.sh = (yf - yb) / W;
    }
    if (!this.anchors || this.anchorsFlip !== this.flip) this.buildAnchors();
  }

  /** 按条带把骨骼画贴到弯曲（坍塌）的骨架上（使用 ctx 当前的局部变换）。 */
  drawSlices(ctx: CanvasRenderingContext2D, art: Mipped): void {
    const B = ctx.getTransform();
    const mpp = WHALE_LEN / AXIS_PX;
    const lv = mipLevel(Math.hypot(B.a, B.b) * mpp);
    const img = art.levels[lv];
    const r = 1 / (1 << lv);
    const ct = Math.cos(AXIS_ANGLE);
    const stt = Math.sin(AXIS_ANGLE);
    const A = this.p;
    for (const sl of this.slices) {
      const cf = Math.cos(sl.a);
      const sf = Math.sin(sl.a);
      // 肚子朝上：画面沿体轴上下翻转
      const ky = sl.ky * this.flip;
      const sh = sl.sh;
      // 画像素 → 体轴坐标 (U, V) → (u, v) = (U, sh·U + ky·V)·mpp + (0, by) → 局部坐标
      const a = mpp * (cf * ct - sf * (sh * ct - ky * stt));
      const c = mpp * (cf * stt - sf * (sh * stt + ky * ct));
      const b = mpp * (sf * ct + cf * (sh * ct - ky * stt));
      const d = mpp * (sf * stt + cf * (sh * stt + ky * ct));
      axisPx(sl.s, A);
      const e = sl.px - sf * sl.by - (a * A.x + c * A.y);
      const g = sl.py + cf * sl.by - (b * A.x + d * A.y);
      ctx.setTransform(B.a * a + B.c * b, B.b * a + B.d * b, B.a * c + B.c * d, B.b * c + B.d * d, B.a * e + B.c * g + B.e, B.b * e + B.d * g + B.f);
      const x0 = Math.max(0, sl.x0 - 1);
      const w = Math.min(ART_W, sl.x1 + 1) - x0;
      ctx.drawImage(img, x0 * r, 0, w * r, ART_H * r, x0, 0, w, ART_H);
    }
    ctx.setTransform(B);
  }

  /** 埋藏：沉积物把骨头染成灰褐色（在离屏图层中，只作用于骨头本身） */
  stain(ctx: CanvasRenderingContext2D, st: WhaleState, w: number, h: number): void {
    const k = 0.35 * st.burial;
    if (k < 0.01) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba(BONE.stain, k);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /** 画框像素 → 鲸鱼局部坐标（按所在条带的摆放与坍塌） */
  localOf(x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
    const j = clamp(SLICES - 1 - Math.floor(x / (ART_W / SLICES)), 0, SLICES - 1);
    const sl = this.slices[j];
    const mpp = WHALE_LEN / AXIS_PX;
    const A = axisPx(sl.s, this.p);
    const dx = x - A.x;
    const dy = y - A.y;
    const ct = Math.cos(AXIS_ANGLE);
    const st = Math.sin(AXIS_ANGLE);
    const U = dx * ct + dy * st;
    const u = U * mpp;
    const v = ((-dx * st + dy * ct) * sl.ky * this.flip + U * sl.sh) * mpp + sl.by;
    const c = Math.cos(sl.a);
    const s = Math.sin(sl.a);
    out.x = sl.px + u * c - v * s;
    out.y = sl.py + u * s + v * c;
    return out;
  }

  /** 鲸鱼局部坐标 → 画框像素（localOf 的逆变换，按局部 x 最近的条带） */
  private artOf(lx: number, ly: number, out: { x: number; y: number }): { x: number; y: number } {
    let best = this.slices[0];
    let bd = Infinity;
    for (const sl of this.slices) {
      const d = Math.abs(sl.px - lx);
      if (d < bd) {
        bd = d;
        best = sl;
      }
    }
    const sl = best;
    const c = Math.cos(sl.a);
    const s = Math.sin(sl.a);
    const dx = lx - sl.px;
    const dy = ly - sl.py;
    const mpp = WHALE_LEN / AXIS_PX;
    const u = dx * c + dy * s;
    const v = (-dx * s + dy * c - sl.by - sl.sh * u) / (sl.ky * this.flip);
    const ct = Math.cos(AXIS_ANGLE);
    const st = Math.sin(AXIS_ANGLE);
    const A = axisPx(sl.s, this.p);
    out.x = A.x + (u * ct - v * st) / mpp;
    out.y = A.y + (u * st + v * ct) / mpp;
    return out;
  }

  /**
   * 在骨骼画中找出骨头朝上的表面（从上方扫描时从透明进入骨头的位置；肚子朝上时画面翻转，
   * 朝上的是画中骨头的下缘），以及肋骨朝向尾部的边缘，按骨骼类别各取一部分作为细菌席与食骨蠕虫的附着点。
   */
  private buildAnchors(): void {
    const art = whaleArt();
    if (!art) return;
    this.anchorsFlip = this.flip;
    const m: AlphaMask = art.skeletonMask;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.data[y * m.w + x]);
    const found: Record<BoneKind, Array<[number, number]>> = { skull: [], mandible: [], vertebra: [], rib: [], chevron: [], scapula: [], flipper: [], pelvis: [] };
    const up = this.flip;
    for (let x = 1; x < m.w; x += 2) {
      for (let y = 2; y < m.h - 2; y++) {
        if (at(x, y - 2 * up) < 60 && at(x, y) > 170) found[boneKindAt(x * m.step, y * m.step)].push([x * m.step, y * m.step + 2 * up]);
      }
    }
    for (let y = 1; y < m.h; y += 3) {
      for (let x = 2; x < m.w; x++) {
        if (at(x - 2, y) < 60 && at(x, y) > 170 && boneKindAt(x * m.step, y * m.step) === 'rib') found.rib.push([x * m.step + 2, y * m.step]);
      }
    }
    const r = rng(this.seed * 131 + 5);
    const list: Anchor[] = [];
    let seed = 0;
    for (const kind of Object.keys(found) as BoneKind[]) {
      const pts = found[kind];
      const cap = ATTACH_CAP[kind];
      // 均匀抽样（带一点随机），保持沿骨头的分布
      const stepN = Math.max(1, pts.length / cap);
      for (let i = 0; i < cap && i * stepN < pts.length; i++) {
        const [x, y] = pts[Math.min(pts.length - 1, Math.floor(i * stepN + r() * stepN * 0.9))];
        list.push({
          x,
          y,
          kind,
          thMat: 0.1 + hash1(seed * 19 + 3) * 0.85,
          thOse: 0.05 + hash1(seed * 23 + 7) * 0.85,
          r: ATTACH_R[kind] * (0.6 + hash1(seed * 7) * 0.9),
          seed: seed,
        });
        seed++;
      }
    }
    this.anchors = list;
    this.att = new Float32Array(list.length * 6);
  }

  // ------------------------------------------------------------------ 骨面上的生命

  /** 细菌席与食骨蠕虫（Osedax），在鲸鱼局部坐标中绘制（ctx 已设为局部变换）。 */
  drawLife(ctx: CanvasRenderingContext2D, rc: RenderCtx, st: WhaleState, scale: number): void {
    const anchors = this.anchors;
    if (!anchors || (st.mats < 0.01 && st.osedax < 0.01)) return;
    const att = this.att;
    const n = anchors.length;
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      this.localOf(a.x, a.y, this.p);
      const o = i * 6;
      att[o] = this.p.x;
      att[o + 1] = this.p.y;
      att[o + 2] = a.thMat;
      att[o + 3] = a.thOse;
      att[o + 4] = a.r;
      att[o + 5] = a.seed;
    }
    rc.light.shadeAt(st.x, st.y, st.z, this.sh);
    const sh = this.sh;
    const ga = ctx.globalAlpha;
    const t = rc.eco;

    // ---- 细菌席：按颜色分三批。远看是骨面上的一层薄膜；近看是边缘柔和、带丝状绒毛的一片
    if (st.mats > 0.01) {
      const matCols = [BONE.mat, BONE.matYellow, BONE.matOrange];
      if (scale > 110) {
        for (let c = 0; c < 3; c++) {
          const spr = matSprite(shadeRGB(matCols[c], sh, this.tmp, 0.15), c);
          ctx.globalAlpha = ga * 0.85;
          for (let i = 0; i < n; i++) {
            const o = i * 6;
            const km = smoothstep(att[o + 2], att[o + 2] + 0.25, st.mats);
            if (km <= 0.01) continue;
            const kind = hash1(att[o + 5] * 3);
            if ((kind > 0.92 ? 2 : kind > 0.7 ? 1 : 0) !== c) continue;
            const r = att[o + 4] * (0.25 + 1.05 * km);
            ctx.drawImage(spr, att[o] - r * 1.7, att[o + 1] - r * 0.72, r * 3.4, r * 1.2);
          }
        }
      } else {
        ctx.globalAlpha = ga * 0.6;
        for (let c = 0; c < 3; c++) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const o = i * 6;
            const km = smoothstep(att[o + 2], att[o + 2] + 0.25, st.mats);
            if (km <= 0.01) continue;
            const kind = hash1(att[o + 5] * 3);
            if ((kind > 0.92 ? 2 : kind > 0.7 ? 1 : 0) !== c) continue;
            const r = att[o + 4] * (0.25 + 1.05 * km);
            const x = att[o];
            const y = att[o + 1] - r * 0.15;
            ctx.moveTo(x + r * 1.5, y);
            ctx.ellipse(x, y, r * 1.5, r * 0.5, 0, 0, TAU);
          }
          ctx.fillStyle = rgba(shadeRGB(matCols[c], sh, this.tmp, 0.15));
          ctx.fill();
        }
      }
      ctx.globalAlpha = ga * 0.6;
      if (scale > 120) {
        // 丝状细菌的绒毛边缘
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const o = i * 6;
          const km = smoothstep(att[o + 2], att[o + 2] + 0.25, st.mats);
          if (km <= 0.01) continue;
          const r = att[o + 4] * (0.25 + 1.05 * km);
          const seed = att[o + 5];
          for (let k = 0; k < 7; k++) {
            const fx = att[o] + (k / 6 - 0.5) * r * 2.6;
            const hgt = r * (0.25 + 0.35 * hash1(seed * 11 + k));
            const sway = Math.sin(t * 0.8 + k + seed) * hgt * 0.25;
            ctx.moveTo(fx, att[o + 1] - r * 0.2);
            ctx.lineTo(fx + sway, att[o + 1] - r * 0.2 - hgt);
          }
        }
        ctx.strokeStyle = rgba(shadeRGB(BONE.mat, sh, this.tmp, 0.15));
        ctx.lineWidth = Math.max(0.004, 0.8 / scale);
        ctx.stroke();
      }
    }

    // ---- 食骨蠕虫（Osedax）：从骨头里伸出的半透明躯干，顶端一簇红色的羽状鳃，随水流轻轻摆动。
    // 近看时一个附着点上是一小片密集的群落；远看时只是骨面上一层粉红色的“绒毯”
    if (st.osedax > 0.01) {
      const plume = rgba(shadeRGB(BONE.ose, sh, this.tmp, 0.25));
      const close = scale >= 110;
      const fine = scale > 220;
      // 屏幕之外的附着点不画（特写时绝大部分都在画面之外）
      const B = ctx.getTransform();
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      const vis = (x: number, y: number) => {
        const sx = B.a * x + B.c * y + B.e;
        const sy = B.b * x + B.d * y + B.f;
        return sx > -60 && sx < W + 60 && sy > -60 && sy < H + 60;
      };
      const worms = (i: number) => {
        const seed = att[i * 6 + 5];
        return close ? 7 + Math.floor(hash1(seed * 7) * 7) : 3 + Math.floor(hash1(seed * 7) * 4);
      };
      if (scale >= 70) {
        // 躯干
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const o = i * 6;
          const ko = smoothstep(att[o + 3], att[o + 3] + 0.2, st.osedax);
          if (ko <= 0.01 || !vis(att[o], att[o + 1])) continue;
          const seed = att[o + 5];
          const cnt = worms(i);
          for (let k = 0; k < cnt; k++) {
            const ox = (hash1(seed * 13 + k) - 0.5) * (close ? 0.26 : 0.18);
            const hgt = (0.025 + hash1(seed * 17 + k) * 0.035) * ko;
            const sway = Math.sin(t * (0.9 + k * 0.13) + seed * 1.7 + k) * 0.01;
            ctx.moveTo(att[o] + ox, att[o + 1]);
            ctx.quadraticCurveTo(att[o] + ox + sway * 0.3, att[o + 1] - hgt * 0.6, att[o] + ox + sway, att[o + 1] - hgt);
          }
        }
        ctx.globalAlpha = ga * 0.85;
        ctx.strokeStyle = rgba(shadeRGB(BONE.oseLight, sh, this.tmp, 0.3));
        ctx.lineWidth = Math.max(0.004, 0.6 / scale);
        ctx.stroke();
      }
      ctx.beginPath();
      const pinn: number[] = this.pinn;
      pinn.length = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        const ko = smoothstep(att[o + 3], att[o + 3] + 0.2, st.osedax);
        if (ko <= 0.01) continue;
        const x = att[o];
        const y = att[o + 1];
        const seed = att[o + 5];
        if (scale < 70) {
          const cnt = 3 + Math.floor(hash1(seed * 7) * 4);
          const rx = (0.04 + 0.01 * cnt) * ko;
          ctx.moveTo(x + 0.03 + rx, y - 0.02);
          ctx.ellipse(x + 0.03, y - 0.02, rx, 0.03 * ko, 0, 0, TAU);
          continue;
        }
        if (!vis(x, y)) continue;
        const cnt = worms(i);
        for (let k = 0; k < cnt; k++) {
          const ox = (hash1(seed * 13 + k) - 0.5) * (close ? 0.26 : 0.18);
          const hgt = (0.025 + hash1(seed * 17 + k) * 0.035) * ko;
          const sway = Math.sin(t * (0.9 + k * 0.13) + seed * 1.7 + k) * 0.01;
          const tx = x + ox + sway;
          const ty = y - hgt;
          if (!close) {
            ctx.moveTo(tx + 0.02, ty - 0.012);
            ctx.arc(tx, ty - 0.012, 0.02, 0, TAU);
            continue;
          }
          // 4 条羽状鳃：从顶端向上、向两侧弯出，随水流一起摆动
          const len = (0.03 + 0.018 * hash1(seed * 23 + k)) * (0.6 + 0.4 * ko);
          const flow = Math.sin(t * 0.7 + seed * 0.3) * 0.25 + Math.sin(t * (1.6 + 0.2 * k) + k) * 0.08;
          for (let q = 0; q < 4; q++) {
            const ang = -Math.PI / 2 + (q - 1.5) * 0.42 + flow;
            const ex = tx + Math.cos(ang) * len;
            const ey = ty + Math.sin(ang) * len;
            const bx = tx + Math.cos(ang - 0.35) * len * 0.55;
            const by = ty + Math.sin(ang - 0.35) * len * 0.55;
            ctx.moveTo(tx, ty);
            ctx.quadraticCurveTo(bx, by, ex, ey);
            if (fine) pinn.push(tx, ty, bx, by, ex, ey);
          }
        }
      }
      ctx.globalAlpha = ga * (scale < 70 ? 0.55 : 1);
      if (close) {
        ctx.strokeStyle = plume;
        ctx.lineWidth = Math.max(0.0045, 0.9 / scale);
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.fillStyle = plume;
        ctx.fill();
      }
      if (fine && pinn.length) {
        // 羽状鳃两侧细小的羽枝
        ctx.beginPath();
        for (let j = 0; j < pinn.length; j += 6) {
          for (let m = 1; m <= 4; m++) {
            const u = m / 5;
            const iu = 1 - u;
            const px = iu * iu * pinn[j] + 2 * iu * u * pinn[j + 2] + u * u * pinn[j + 4];
            const py = iu * iu * pinn[j + 1] + 2 * iu * u * pinn[j + 3] + u * u * pinn[j + 5];
            const dx = pinn[j + 4] - pinn[j];
            const dy = pinn[j + 5] - pinn[j + 1];
            const l = Math.hypot(dx, dy) || 1;
            const w = 0.006 * (1 - u * 0.5);
            ctx.moveTo(px - (dy / l) * w, py + (dx / l) * w);
            ctx.lineTo(px + (dy / l) * w, py - (dx / l) * w);
          }
        }
        ctx.strokeStyle = rgba(shadeRGB(BONE.oseLight, sh, this.tmp, 0.3));
        ctx.lineWidth = Math.max(0.002, 0.5 / scale);
        ctx.stroke();
      }
      if (scale > 300) {
        // 微观：食骨蠕虫伸入骨头的绿色“根系”
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const o = i * 6;
          if (smoothstep(att[o + 3], att[o + 3] + 0.2, st.osedax) <= 0.01) continue;
          const seed = att[o + 5];
          for (let k = 0; k < 4; k++) {
            const ox = (hash1(seed * 19 + k) - 0.5) * 0.16;
            ctx.moveTo(att[o] + ox, att[o + 1]);
            ctx.quadraticCurveTo(att[o] + ox + 0.02, att[o + 1] + 0.03, att[o] + ox - 0.01, att[o + 1] + 0.06);
          }
        }
        ctx.strokeStyle = rgba(shadeRGB(BONE.root, sh, this.tmp), 0.7);
        ctx.lineWidth = 0.6 / scale;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = ga;
    this.drawAmphipod(ctx, rc, scale);
  }

  /** 隐藏发现：躲在头骨鼻孔里的小端足类，只有靠得很近才看得见 */
  private drawAmphipod(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number): void {
    if (scale <= 110) return;
    const a = clamp((scale - 110) / 80);
    const t = rc.eco;
    const peek = 0.5 + 0.5 * Math.sin(t * 0.7);
    const P = this.localOf(NARES.x, NARES.y, this.p);
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * a;
    ctx.save();
    ctx.translate(P.x + 0.03, P.y - 0.01 - peek * 0.02);
    ctx.rotate(-0.15);
    const light = rgba(shadeRGB(BONE.light, this.sh, this.tmp));
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.055, 0.02, 0, Math.PI, TAU);
    ctx.fill();
    ctx.strokeStyle = light;
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    ctx.moveTo(0.05, -0.01);
    ctx.quadraticCurveTo(0.08, -0.05 - Math.sin(t * 3) * 0.01, 0.1, -0.04);
    ctx.moveTo(0.05, -0.008);
    ctx.quadraticCurveTo(0.09, -0.03, 0.11, -0.015 + Math.sin(t * 2.4) * 0.008);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0.04, -0.012, 0.006, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = ga;
  }

  /** 画框像素 → 世界坐标（用于隐藏发现的位置判断）。 */
  skullToWorld(lx: number, ly: number, _body: WhaleBody, st: WhaleState, out: { x: number; y: number }): { x: number; y: number } {
    const p = this.localOf(lx, ly, { x: 0, y: 0 });
    const cs = Math.cos(st.pitch);
    const sn = Math.sin(st.pitch);
    out.x = st.x + p.x * cs - p.y * sn;
    out.y = st.y + p.x * sn + p.y * cs;
    return out;
  }

  /** 屏幕坐标命中测试（自由探索中的点击）：换算回画中的像素，查透明度与分区。 */
  hitTest(rc: RenderCtx, _body: WhaleBody, st: WhaleState, _fin: FinPose, sx: number, sy: number): BoneKind | null {
    const art = whaleArt();
    if (st.tissue > 0.5 || !art) return null;
    const P = rc.cam.unproject(sx, sy, st.z, { x: 0, y: 0 });
    const dx = P.x - st.x;
    const dy = P.y - st.y;
    const cs = Math.cos(st.pitch);
    const sn = Math.sin(st.pitch);
    const q = this.artOf(dx * cs + dy * sn, -dx * sn + dy * cs, { x: 0, y: 0 });
    const m = art.skeletonMask;
    // 允许点在骨头旁边一点点（手指与鼠标都不必精确）
    const R = 3;
    const mx = Math.round(q.x / m.step);
    const my = Math.round(q.y / m.step);
    for (let r = 0; r <= R; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const x = mx + ox;
          const y = my + oy;
          if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
          if (m.data[y * m.w + x] > 128) return boneKindAt(x * m.step, y * m.step);
        }
      }
    }
    return null;
  }
}
