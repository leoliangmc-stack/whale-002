import { hex, makeShade, mixRGB, rgba, shadeRGB, type RGB, type Shade } from '../core/color';
import { clamp, hash1, lerp, rng, smoothstep, TAU } from '../core/math';
import type { RenderCtx } from '../core/types';
import { S_FIN, S_GAPE, WHALE_LEN, type WhaleBody } from './WhaleBody';
import type { WhaleState } from './Whale';

/**
 * 座头鲸骨骼（侧视）。所有骨骼都以同一条脊线定位：
 * 分解过程中，软组织逐渐变薄、出现空洞，露出的正是这里的骨骼。
 * 骨骼形状只在构造时生成一次（Path2D），每帧只计算摆放变换，开销很小。
 */

export type BoneKind = 'skull' | 'mandible' | 'vertebra' | 'rib' | 'chevron' | 'scapula' | 'flipper' | 'pelvis';

interface Attach {
  x: number;
  y: number;
  /** 细菌席与食骨蠕虫出现的阈值 */
  thMat: number;
  thOse: number;
  r: number;
  seed: number;
}

interface Bone {
  kind: BoneKind;
  path: Path2D;
  /** 脊线锚点 */
  s: number;
  off: number;
  rot: number;
  far: boolean;
  /** 竖向尺寸（用于渐变） */
  h: number;
  seed: number;
  /** 坍塌时的下沉、旋转和散落 */
  drop: number;
  dropRot: number;
  scatterX: number;
  /** 竖向透视压缩（肋骨向两侧摊开时） */
  splay: number;
  attach: Attach[];
  pores: Array<[number, number, number]>;
  /** 胸鳍骨骼使用鳍的变换 */
  finLocal?: boolean;
}

const BONE = {
  ivory: hex('#e9e1cc'),
  light: hex('#f6f1e2'),
  shadow: hex('#8f9ba6'),
  blue: hex('#a9b6bf'),
  stain: hex('#6f685a'),
  edge: hex('#3b4652'),
  hole: hex('#2a3038'),
  mat: hex('#f2eedb'),
  matYellow: hex('#e8d58a'),
  matOrange: hex('#e3a35a'),
  ose: hex('#d66a7a'),
  oseLight: hex('#f09aa4'),
  root: hex('#7fa36a'),
};

/** 脊柱中心线在脊线上方的高度（米） */
function columnOff(s: number): number {
  if (s < 0.36) return lerp(0.22, 0.42, smoothstep(0.29, 0.36, s));
  if (s < 0.6) return 0.42;
  if (s < 0.86) return lerp(0.42, 0.14, smoothstep(0.6, 0.86, s));
  return lerp(0.14, 0.0, smoothstep(0.86, 0.98, s));
}

export class WhaleSkeleton {
  readonly bones: Bone[] = [];
  private readonly sh: Shade = makeShade();
  private readonly f = { x: 0, y: 0, a: 0 };
  private readonly p = { x: 0, y: 0 };
  private readonly tmp: RGB = [0, 0, 0];
  private readonly tmp2: RGB = [0, 0, 0];
  private col = { ivory: '', light: '', shadow: '', edge: '', hole: '', farIvory: '', farShadow: '' };
  private builtFor = -1;

  constructor(readonly seed = 1) {}

  /** 根据画质（椎骨数量）构建骨骼。 */
  build(vertebraCount: number): void {
    if (this.builtFor === vertebraCount) return;
    this.builtFor = vertebraCount;
    this.bones.length = 0;
    const r = rng(this.seed * 31 + 7);
    const L = WHALE_LEN;

    // ---- 远侧肋骨（最先绘制）
    const ribCount = 14;
    const thoracic: number[] = [];
    const vStart = 0.3;
    const vEnd = 0.975;
    const vs: number[] = [];
    for (let i = 0; i < vertebraCount; i++) {
      // 颈椎紧密、尾椎渐疏
      const t = i / (vertebraCount - 1);
      vs.push(lerp(vStart, vEnd, Math.pow(t, 0.97)));
    }
    const cervical = Math.round(vertebraCount * 0.13);
    for (let i = 0; i < ribCount; i++) thoracic.push(vs[Math.min(vs.length - 1, cervical + i)]);

    for (let i = 0; i < ribCount; i++) {
      const s = thoracic[i];
      const len = ribLen(i, ribCount);
      this.bones.push(this.makeRib(s, len, true, i, r));
    }

    // ---- 下颌骨（远侧）
    this.bones.push(this.makeMandible(true));

    // ---- 椎骨与人字骨
    for (let i = 0; i < vs.length; i++) {
      const s = vs[i];
      const spacing = ((vEnd - vStart) / (vertebraCount - 1)) * L;
      this.bones.push(this.makeVertebra(s, spacing, i, cervical, r));
      if (s > 0.67 && s < 0.87) this.bones.push(this.makeChevron(s, spacing, i));
    }

    // ---- 头骨
    this.bones.push(this.makeSkull());

    // ---- 近侧肋骨
    for (let i = 0; i < ribCount; i++) {
      const s = thoracic[i];
      const len = ribLen(i, ribCount);
      this.bones.push(this.makeRib(s, len, false, i, r));
    }

    // ---- 肩胛骨、退化的骨盆
    this.bones.push(this.makeScapula());
    this.bones.push(this.makePelvis());

    // ---- 下颌骨（近侧）
    this.bones.push(this.makeMandible(false));

    // ---- 胸鳍骨骼
    for (const b of this.makeFlipper()) this.bones.push(b);
  }

  private base(kind: BoneKind, path: Path2D, s: number, off: number, rot: number, h: number, seed: number): Bone {
    return {
      kind,
      path,
      s,
      off,
      rot,
      far: false,
      h,
      seed,
      drop: 0,
      dropRot: 0,
      scatterX: 0,
      splay: 0,
      attach: [],
      pores: [],
    };
  }

  private makeSkull(): Bone {
    const pts: Array<[number, number]> = [
      [-0.22, 0.12],
      [-0.3, -0.12],
      [-0.12, -0.36],
      [0.18, -0.68],
      [0.5, -0.86],
      [0.9, -0.84],
      [1.22, -0.72],
      [1.52, -0.62],
      [1.92, -0.52],
      [2.6, -0.41],
      [3.3, -0.29],
      [3.85, -0.17],
      [4.12, -0.05],
      [4.12, 0.05],
      [3.6, 0.1],
      [2.8, 0.17],
      [2.05, 0.23],
      [1.6, 0.3],
      [1.45, 0.56],
      [1.05, 0.64],
      [0.82, 0.5],
      [0.6, 0.66],
      [0.32, 0.58],
      [0.1, 0.38],
      [-0.05, 0.22],
    ];
    const path = smoothClosed(pts);
    const b = this.base('skull', path, 0.295, 0.22, 0.045, 1.8, 1);
    b.drop = 0.28;
    b.dropRot = 0.05;
    // 头骨顶部的附着点
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const x = lerp(0.1, 3.9, t);
      const y = topOfSkull(x) + 0.05;
      b.attach.push({ x, y, thMat: 0.15 + hash1(i * 3 + 1) * 0.75, thOse: 0.1 + hash1(i * 5 + 2) * 0.8, r: 0.05 + hash1(i) * 0.07, seed: i });
    }
    for (let i = 0; i < 120; i++) {
      const x = lerp(0.1, 3.9, hash1(i * 11 + 4));
      const top = topOfSkull(x);
      const bot = x > 2 ? lerp(0.23, 0.05, (x - 2) / 2.1) : 0.4;
      b.pores.push([x, lerp(top + 0.06, bot - 0.06, hash1(i * 7 + 9)), 0.006 + hash1(i * 3) * 0.012]);
    }
    return b;
  }

  private makeMandible(far: boolean): Bone {
    const len = 3.95;
    const n = 18;
    const top: Array<[number, number]> = [];
    const bot: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = t * len;
      const yc = 0.2 * Math.sin(Math.PI * t) - 0.1 * t;
      let th = 0.4 * (1 - 0.6 * t) + 0.05;
      if (t < 0.15) th += 0.12 * (1 - t / 0.15);
      // 冠状突
      const coronoid = t > 0.12 && t < 0.24 ? -0.22 * Math.sin(((t - 0.12) / 0.12) * Math.PI) : 0;
      top.push([x, yc - th / 2 + coronoid]);
      bot.push([x, yc + th / 2]);
    }
    const pts = [...top, ...bot.reverse()];
    const path = smoothClosed(pts);
    const b = this.base('mandible', path, S_GAPE + 0.012, -0.42, -0.06, 0.6, far ? 2 : 3);
    b.far = far;
    b.drop = far ? 1.05 : 1.15;
    b.dropRot = far ? -0.02 : 0.03;
    b.scatterX = far ? 0.55 : -0.1;
    for (let i = 0; i < 12; i++) {
      const t = 0.08 + (i / 11) * 0.85;
      b.attach.push({ x: t * len, y: 0.2 * Math.sin(Math.PI * t) - 0.1 * t - 0.12, thMat: 0.2 + hash1(i * 9 + (far ? 3 : 4)) * 0.7, thOse: 0.15 + hash1(i * 4 + 8) * 0.8, r: 0.04 + hash1(i * 2) * 0.05, seed: 100 + i + (far ? 50 : 0) });
    }
    return b;
  }

  private makeVertebra(s: number, spacing: number, i: number, cervical: number, r: () => number): Bone {
    const w = i < cervical ? spacing * 0.92 : spacing * 0.8;
    let h: number;
    if (s < 0.33) h = 0.42;
    else if (s < 0.62) h = lerp(0.46, 0.56, smoothstep(0.33, 0.58, s));
    else h = lerp(0.56, 0.1, smoothstep(0.62, 0.98, s));
    let ns: number;
    if (s < 0.33) ns = 0.12;
    else if (s < 0.66) ns = lerp(0.32, 0.5, smoothstep(0.33, 0.55, s));
    else ns = lerp(0.46, 0.0, smoothstep(0.66, 0.86, s));
    const path = new Path2D();
    // 椎体：两端略宽的圆角矩形（沙漏形）
    const hw = w / 2;
    const hh = h / 2;
    path.moveTo(-hw, -hh);
    path.quadraticCurveTo(0, -hh * 0.86, hw, -hh);
    path.quadraticCurveTo(hw + 0.03, 0, hw, hh);
    path.quadraticCurveTo(0, hh * 0.86, -hw, hh);
    path.quadraticCurveTo(-hw - 0.03, 0, -hw, -hh);
    path.closePath();
    // 神经棘：向上并向后倾斜
    if (ns > 0.02) {
      const bw = w * 0.36;
      path.moveTo(-bw, -hh + 0.02);
      path.quadraticCurveTo(-bw * 0.6, -hh - ns * 0.5, -ns * 0.42 - 0.03, -hh - ns);
      path.quadraticCurveTo(-ns * 0.42 + 0.03, -hh - ns - 0.05, -ns * 0.42 + 0.06, -hh - ns + 0.01);
      path.quadraticCurveTo(bw * 0.5, -hh - ns * 0.45, bw, -hh + 0.02);
      path.closePath();
    }
    const b = this.base('vertebra', path, s, columnOff(s), 0, h + ns, 10 + i);
    // 坍塌：脊柱失去支撑后下沉，尾端的椎骨轻微散落
    const mid = Math.sin(Math.PI * clamp((s - 0.3) / 0.7));
    b.drop = 0.35 + mid * 0.35;
    if (s > 0.86) {
      b.scatterX = (r() - 0.5) * 0.7;
      b.dropRot = (r() - 0.5) * 1.2;
      b.drop = 0.55 + r() * 0.2;
    } else {
      b.dropRot = (r() - 0.5) * 0.08;
    }
    const n = 3 + Math.floor(hash1(i * 13) * 3);
    for (let k = 0; k < n; k++) {
      const top = k % 2 === 0;
      b.attach.push({
        x: (hash1(i * 17 + k) - 0.5) * w * (top ? 0.6 : 0.9),
        y: top && ns > 0.05 ? -hh - ns * (0.2 + 0.6 * hash1(i * 5 + k)) : -hh + 0.02,
        thMat: 0.1 + hash1(i * 19 + k * 3) * 0.85,
        thOse: 0.05 + hash1(i * 23 + k * 7) * 0.85,
        r: 0.03 + hash1(i + k) * 0.04,
        seed: 200 + i * 7 + k,
      });
    }
    for (let k = 0; k < 14; k++) {
      b.pores.push([(hash1(i * 29 + k) - 0.5) * w * 0.85, (hash1(i * 31 + k) - 0.5) * h * 0.8, 0.004 + hash1(i * 37 + k) * 0.01]);
    }
    return b;
  }

  private makeChevron(s: number, spacing: number, i: number): Bone {
    const t = (s - 0.67) / 0.2;
    const len = lerp(0.4, 0.1, t);
    const path = new Path2D();
    path.moveTo(-spacing * 0.2, 0);
    path.lineTo(spacing * 0.2, 0);
    path.lineTo(-len * 0.25 + 0.02, len);
    path.lineTo(-len * 0.25 - 0.02, len);
    path.closePath();
    const hgt = lerp(0.5, 0.12, smoothstep(0.62, 0.98, s));
    const b = this.base('chevron', path, s, columnOff(s) - hgt / 2 - 0.02, 0, len, 400 + i);
    b.drop = 0.75;
    b.dropRot = 0.9;
    return b;
  }

  private makeRib(s: number, len: number, far: boolean, i: number, r: () => number): Bone {
    const n = 14;
    const pts: Array<[number, number]> = [];
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    let x = 0;
    let y = 0;
    const phi0 = Math.PI / 2 + 0.46;
    const kappa = -0.62;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const phi = phi0 + kappa * t;
      const w = (i === 0 ? 0.16 : 0.1) * (1 - 0.55 * t) + (k === 0 ? 0.04 : 0);
      const nx = -Math.sin(phi);
      const ny = Math.cos(phi);
      left.push([x + nx * w * 0.5, y + ny * w * 0.5]);
      right.push([x - nx * w * 0.5, y - ny * w * 0.5]);
      pts.push([x, y]);
      x += Math.cos(phi) * (len / n);
      y += Math.sin(phi) * (len / n);
    }
    const path = smoothClosed([...left, ...right.reverse()], true);
    const b = this.base('rib', path, s, columnOff(s) - 0.2, 0, len, 500 + i + (far ? 100 : 0));
    b.far = far;
    b.splay = far ? 0.32 : 0.48;
    b.drop = 0.45;
    b.dropRot = (far ? -0.1 : 0.22) + (r() - 0.5) * 0.12;
    for (let k = 0; k < 4; k++) {
      const t = 0.12 + k * 0.22;
      const idx = Math.round(t * n);
      b.attach.push({ x: pts[idx][0] - 0.03, y: pts[idx][1], thMat: 0.25 + hash1(i * 41 + k) * 0.7, thOse: 0.12 + hash1(i * 43 + k) * 0.8, r: 0.025 + hash1(i * 47 + k) * 0.03, seed: 600 + i * 5 + k + (far ? 300 : 0) });
    }
    for (let k = 0; k < 10; k++) {
      const idx = Math.floor(hash1(i * 53 + k) * n);
      b.pores.push([pts[idx][0], pts[idx][1], 0.004 + hash1(i * 59 + k) * 0.007]);
    }
    return b;
  }

  private makeScapula(): Bone {
    const path = smoothClosed([
      [0, 0.08],
      [-0.12, -0.12],
      [-0.55, -0.62],
      [-0.42, -0.8],
      [0.1, -0.86],
      [0.6, -0.72],
      [0.34, -0.3],
      [0.14, 0.04],
    ]);
    const b = this.base('scapula', path, S_FIN - 0.004, -0.42, 0.05, 1.1, 700);
    b.drop = 0.65;
    b.dropRot = 0.35;
    b.attach.push({ x: 0.1, y: -0.8, thMat: 0.3, thOse: 0.25, r: 0.06, seed: 701 });
    return b;
  }

  private makePelvis(): Bone {
    const path = smoothClosed([
      [-0.18, -0.03],
      [0.0, -0.06],
      [0.18, -0.02],
      [0.2, 0.03],
      [0.0, 0.03],
      [-0.18, 0.04],
    ]);
    const b = this.base('pelvis', path, 0.625, -0.85, -0.3, 0.1, 800);
    b.drop = 0.6;
    b.dropRot = 0.4;
    return b;
  }

  private makeFlipper(): Bone[] {
    const out: Bone[] = [];
    const add = (path: Path2D, seed: number) => {
      const b = this.base('flipper', path, S_FIN, -0.5, 0, 0.3, seed);
      b.finLocal = true;
      b.drop = 0.25;
      out.push(b);
    };
    // 肱骨
    add(capsule(0.05, 0, 0.6, 0, 0.17), 900);
    // 桡骨与尺骨
    add(capsule(0.66, -0.11, 1.5, -0.13, 0.075), 901);
    add(capsule(0.66, 0.1, 1.5, 0.12, 0.07), 902);
    // 腕骨
    const carp = new Path2D();
    for (let i = 0; i < 4; i++) carp.ellipse(1.62 + (i % 2) * 0.1, -0.15 + i * 0.1, 0.07, 0.05, 0, 0, TAU);
    add(carp, 903);
    // 指骨：座头鲸长长的“手指”
    const digits = [
      { y: -0.2, n: 6, end: 0.0 },
      { y: -0.07, n: 11, end: 0.0 },
      { y: 0.06, n: 9, end: 0.02 },
      { y: 0.17, n: 6, end: 0.05 },
    ];
    let seed = 910;
    for (const d of digits) {
      const p = new Path2D();
      let x = 1.82;
      for (let k = 0; k < d.n; k++) {
        const seg = 0.24 * (1 - k * 0.035);
        const y = lerp(d.y, d.end, k / d.n);
        const wdt = 0.055 * (1 - (k / d.n) * 0.6);
        p.ellipse(x + seg / 2, y, seg / 2 - 0.015, wdt, 0, 0, TAU);
        x += seg;
      }
      add(p, seed++);
    }
    return out;
  }

  // ------------------------------------------------------------------

  private computeColors(rc: RenderCtx, st: WhaleState): void {
    const sh = this.sh;
    rc.light.shadeAt(st.x, st.y, st.z, sh);
    const stain = st.burial * 0.4;
    const ivory = mixRGB(BONE.ivory, BONE.stain, stain * 0.5, this.tmp2);
    this.col.ivory = rgba(shadeRGB(ivory, sh, this.tmp));
    this.col.light = rgba(shadeRGB(BONE.light, sh, this.tmp));
    const shadow = mixRGB(BONE.shadow, BONE.stain, stain, this.tmp2);
    this.col.shadow = rgba(shadeRGB(shadow, sh, this.tmp));
    this.col.edge = rgba(shadeRGB(BONE.edge, sh, this.tmp), 0.45);
    this.col.hole = rgba(shadeRGB(BONE.hole, sh, this.tmp));
    sh.light *= 0.62;
    this.col.farIvory = rgba(shadeRGB(BONE.blue, sh, this.tmp));
    this.col.farShadow = rgba(shadeRGB(BONE.shadow, sh, this.tmp));
    sh.light /= 0.62;
  }

  /** 把画布变换设置到某块骨骼的局部坐标（在鲸鱼局部变换之上）。 */
  private place(ctx: CanvasRenderingContext2D, body: WhaleBody, st: WhaleState, b: Bone, finAngle: number, ground: number): void {
    const c = st.collapse;
    if (b.finLocal) {
      body.point(S_FIN, -0.5, this.p);
      const groundDrop = Math.max(0, Math.min(b.drop * c + 0.4 * c, ground - this.p.y - 0.25));
      ctx.translate(this.p.x, this.p.y + groundDrop);
      ctx.rotate(finAngle + 0.06 * c);
      return;
    }
    body.frame(b.s, b.off, this.f);
    let drop = b.drop * c;
    if (b.kind === 'mandible' || b.kind === 'chevron' || b.kind === 'pelvis' || (b.kind === 'vertebra' && b.s > 0.86)) {
      // 落到海床上
      drop = Math.min(drop, Math.max(0, ground - this.f.y - 0.12));
    }
    ctx.translate(this.f.x + b.scatterX * c, this.f.y + drop);
    ctx.rotate(this.f.a + b.rot + b.dropRot * c);
    if (b.splay > 0 && c > 0) {
      ctx.scale(1, 1 - b.splay * c);
      ctx.rotate(-0.08 * c);
    }
  }

  /** 与 place() 相同的骨骼变换（鲸鱼局部坐标），用于构建几何缓存。 */
  private matrixFor(body: WhaleBody, st: WhaleState, b: Bone, finAngle: number, ground: number): DOMMatrix {
    const c = st.collapse;
    const m = new DOMMatrix();
    const DEG = 180 / Math.PI;
    if (b.finLocal) {
      body.point(S_FIN, -0.5, this.p);
      const groundDrop = Math.max(0, Math.min(b.drop * c + 0.4 * c, ground - this.p.y - 0.25));
      m.translateSelf(this.p.x, this.p.y + groundDrop);
      m.rotateSelf((finAngle + 0.06 * c) * DEG);
      return m;
    }
    body.frame(b.s, b.off, this.f);
    let drop = b.drop * c;
    if (b.kind === 'mandible' || b.kind === 'chevron' || b.kind === 'pelvis' || (b.kind === 'vertebra' && b.s > 0.86)) {
      drop = Math.min(drop, Math.max(0, ground - this.f.y - 0.12));
    }
    m.translateSelf(this.f.x + b.scatterX * c, this.f.y + drop);
    m.rotateSelf((this.f.a + b.rot + b.dropRot * c) * DEG);
    if (b.splay > 0 && c > 0) {
      m.scaleSelf(1, 1 - b.splay * c);
      m.rotateSelf(-0.08 * c * DEG);
    }
    return m;
  }

  /**
   * 几何缓存：小骨骼（椎骨、肋骨、指骨……）合并为少数几条路径，附着物与骨孔转换到鲸鱼局部坐标。
   * 只有坍塌程度、鳍角或画质变化时才重建，每帧只需几次填充，移动设备上也很轻量。
   */
  private cache: {
    key: string;
    far: Path2D;
    column: Path2D;
    near: Path2D;
    big: Array<{ b: Bone; m: DOMMatrix }>;
    skull: DOMMatrix;
    att: Float32Array;
    attN: number;
    pores: Float32Array;
    poreN: number;
  } | null = null;

  private ensureCache(body: WhaleBody, st: WhaleState, finAngle: number, ground: number, n: number): NonNullable<WhaleSkeleton['cache']> {
    const key = `${n}|${st.collapse.toFixed(3)}|${finAngle.toFixed(3)}|${st.rest.toFixed(2)}|${st.flex.toFixed(3)}|${st.nod.toFixed(3)}`;
    if (this.cache && this.cache.key === key) return this.cache;
    const far = new Path2D();
    const column = new Path2D();
    const near = new Path2D();
    const big: Array<{ b: Bone; m: DOMMatrix }> = [];
    let skull = new DOMMatrix();
    const attList: number[] = [];
    const poreList: number[] = [];
    const pt = new DOMPoint();
    for (const b of this.bones) {
      const m = this.matrixFor(body, st, b, finAngle, ground);
      if (b.kind === 'skull' || b.kind === 'scapula' || (b.kind === 'mandible' && !b.far)) big.push({ b, m });
      else if (b.far) far.addPath(b.path, m);
      else if (b.kind === 'vertebra' || b.kind === 'chevron') column.addPath(b.path, m);
      else near.addPath(b.path, m);
      if (b.kind === 'skull') skull = m;
      for (const a of b.attach) {
        pt.x = a.x;
        pt.y = a.y;
        const q = m.transformPoint(pt);
        attList.push(q.x, q.y, a.thMat, a.thOse, a.r, a.seed, b.far ? 1 : 0);
      }
      if (!b.far) {
        for (const [x, y, r] of b.pores) {
          pt.x = x;
          pt.y = y;
          const q = m.transformPoint(pt);
          poreList.push(q.x, q.y, r);
        }
      }
    }
    this.cache = {
      key,
      far,
      column,
      near,
      big,
      skull,
      att: new Float32Array(attList),
      attN: attList.length / 7,
      pores: new Float32Array(poreList),
      poreN: poreList.length / 3,
    };
    return this.cache;
  }

  draw(rc: RenderCtx, body: WhaleBody, st: WhaleState, finAngle: number): void {
    this.build(rc.quality.vertebrae);
    const ctx = rc.ctx;
    const vis = st.visible * smoothstep(1, 0.93, st.tissue);
    if (vis <= 0.001) return;
    this.computeColors(rc, st);
    const ground = st.rest > 0.5 ? 1.74 : 99;
    const cache = this.ensureCache(body, st, finAngle, ground, rc.quality.vertebrae);
    const scale = rc.cam.applyTransform(ctx, rc.dpr, st.x, st.y, st.z, st.pitch);
    ctx.globalAlpha = vis;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.col.edge;
    ctx.lineWidth = Math.max(0.012, 1.2 / scale);
    // 统一的顶光渐变（鲸鱼局部坐标）
    const g = ctx.createLinearGradient(0, -1.4, 0, 1.9);
    g.addColorStop(0, this.col.light);
    g.addColorStop(0.4, this.col.ivory);
    g.addColorStop(1, this.col.shadow);
    const gf = ctx.createLinearGradient(0, -1.4, 0, 1.9);
    gf.addColorStop(0, this.col.farIvory);
    gf.addColorStop(1, this.col.farShadow);

    ctx.fillStyle = gf;
    ctx.fill(cache.far);
    ctx.stroke(cache.far);
    ctx.fillStyle = g;
    ctx.fill(cache.column);
    ctx.stroke(cache.column);
    const drawBig = (kind: BoneKind) => {
      for (const { b, m } of cache.big) {
        if (b.kind !== kind) continue;
        ctx.save();
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        const bg = ctx.createLinearGradient(0, -b.h * 0.6, 0, b.h * 0.6);
        bg.addColorStop(0, this.col.light);
        bg.addColorStop(0.45, this.col.ivory);
        bg.addColorStop(1, this.col.shadow);
        ctx.fillStyle = bg;
        ctx.fill(b.path);
        ctx.stroke(b.path);
        if (kind === 'skull') this.skullDetail(ctx, rc, scale);
        ctx.restore();
      }
    };
    drawBig('skull');
    ctx.fillStyle = g;
    ctx.fill(cache.near);
    ctx.stroke(cache.near);
    drawBig('scapula');
    drawBig('mandible');
    if (scale > 260) this.drawPores(ctx, cache.pores, cache.poreN, scale);
    this.drawLife(ctx, rc, cache.att, cache.attN, st, scale);
    ctx.globalAlpha = 1;
  }

  private skullDetail(ctx: CanvasRenderingContext2D, rc: RenderCtx, scale: number): void {
    ctx.fillStyle = this.col.hole;
    ctx.globalAlpha *= 0.85;
    // 骨质鼻孔
    ctx.beginPath();
    ctx.ellipse(NARES.x, NARES.y, 0.17, 0.05, -0.25, 0, TAU);
    ctx.fill();
    // 眼眶
    ctx.beginPath();
    ctx.ellipse(1.18, 0.38, 0.17, 0.1, 0.1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha /= 0.85;
    // 吻部中线与骨缝
    ctx.strokeStyle = this.col.shadow;
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(1.9, -0.25);
    ctx.quadraticCurveTo(3.0, -0.12, 4.0, -0.02);
    ctx.moveTo(0.3, -0.72);
    ctx.quadraticCurveTo(0.7, -0.45, 1.25, -0.55);
    ctx.moveTo(0.35, 0.3);
    ctx.quadraticCurveTo(0.7, 0.1, 1.0, 0.2);
    ctx.stroke();
    // 隐藏发现：躲在鼻孔里的小端足类（只有靠近才看得见）
    if (scale > 110) {
      const a = clamp((scale - 110) / 80);
      const t = rc.eco;
      const peek = 0.5 + 0.5 * Math.sin(t * 0.7);
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * a;
      ctx.save();
      ctx.translate(NARES.x + 0.03, NARES.y - 0.005 - peek * 0.02);
      ctx.rotate(-0.25);
      ctx.fillStyle = this.col.light;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.055, 0.02, 0, Math.PI, TAU);
      ctx.fill();
      ctx.strokeStyle = this.col.light;
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
  }

  /** 头骨局部坐标 → 世界坐标（用于隐藏发现的位置判断）。 */
  skullToWorld(lx: number, ly: number, body: WhaleBody, st: WhaleState, out: { x: number; y: number }): { x: number; y: number } {
    const b = this.bones.find((x) => x.kind === 'skull');
    if (!b) {
      out.x = st.x;
      out.y = st.y;
      return out;
    }
    const c = st.collapse;
    body.frame(b.s, b.off, this.f);
    const a = this.f.a + b.rot + b.dropRot * c;
    const bx = this.f.x + b.scatterX * c + lx * Math.cos(a) - ly * Math.sin(a);
    const by = this.f.y + b.drop * c + lx * Math.sin(a) + ly * Math.cos(a);
    const cs = Math.cos(st.pitch);
    const sn = Math.sin(st.pitch);
    out.x = st.x + bx * cs - by * sn;
    out.y = st.y + bx * sn + by * cs;
    return out;
  }

  private drawPores(ctx: CanvasRenderingContext2D, pores: Float32Array, n: number, scale: number): void {
    const a = clamp((scale - 260) / 400);
    ctx.fillStyle = this.col.hole;
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * a * 0.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pores[i * 3];
      const y = pores[i * 3 + 1];
      const r = pores[i * 3 + 2];
      ctx.moveTo(x + r, y);
      ctx.ellipse(x, y, r, r * 0.75, 0, 0, TAU);
    }
    ctx.fill();
    ctx.globalAlpha = ga;
  }

  /** 骨骼表面的生命：细菌席与食骨蠕虫（Osedax）。所有附着物按颜色合并为少数几次绘制。 */
  private drawLife(ctx: CanvasRenderingContext2D, rc: RenderCtx, att: Float32Array, n: number, st: WhaleState, scale: number): void {
    if (st.mats < 0.01 && st.osedax < 0.01) return;
    const ga = ctx.globalAlpha;
    const sh = this.sh;
    const showFar = st.collapse > 0.3;
    const t = rc.eco;
    const skip = (i: number) => att[i * 7 + 6] > 0 && !showFar;

    // ---- 细菌席：按颜色分三批
    if (st.mats > 0.01) {
      const matCols = [BONE.mat, BONE.matYellow, BONE.matOrange];
      ctx.globalAlpha = ga * 0.6;
      for (let c = 0; c < 3; c++) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (skip(i)) continue;
          const o = i * 7;
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
      if (scale > 120) {
        // 丝状细菌的绒毛边缘
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (skip(i)) continue;
          const o = i * 7;
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

    // ---- 食骨蠕虫
    if (st.osedax > 0.01) {
      const plume = rgba(shadeRGB(BONE.ose, sh, this.tmp, 0.25));
      const detail = scale > 200;
      if (scale >= 70) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (skip(i)) continue;
          const o = i * 7;
          const ko = smoothstep(att[o + 3], att[o + 3] + 0.2, st.osedax);
          if (ko <= 0.01) continue;
          const seed = att[o + 5];
          const cnt = 3 + Math.floor(hash1(seed * 7) * 4);
          for (let k = 0; k < cnt; k++) {
            const ox = (hash1(seed * 13 + k) - 0.5) * 0.18;
            const hgt = (0.04 + hash1(seed * 17 + k) * 0.05) * ko;
            const sway = Math.sin(t * (0.9 + k * 0.13) + seed * 1.7 + k) * 0.012;
            ctx.moveTo(att[o] + ox, att[o + 1]);
            ctx.lineTo(att[o] + ox + sway, att[o + 1] - hgt);
          }
        }
        ctx.globalAlpha = ga;
        ctx.strokeStyle = rgba(shadeRGB(BONE.oseLight, sh, this.tmp, 0.3));
        ctx.lineWidth = Math.max(0.005, 0.6 / scale);
        ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (skip(i)) continue;
        const o = i * 7;
        const ko = smoothstep(att[o + 3], att[o + 3] + 0.2, st.osedax);
        if (ko <= 0.01) continue;
        const x = att[o];
        const y = att[o + 1];
        const seed = att[o + 5];
        const cnt = 3 + Math.floor(hash1(seed * 7) * 4);
        if (scale < 70) {
          // 远观：一小片粉红色的“绒毯”
          const rx = (0.03 + 0.008 * cnt) * ko;
          ctx.moveTo(x + 0.03 + rx, y - 0.02);
          ctx.ellipse(x + 0.03, y - 0.02, rx, 0.022 * ko, 0, 0, TAU);
          continue;
        }
        for (let k = 0; k < cnt; k++) {
          const ox = (hash1(seed * 13 + k) - 0.5) * 0.18;
          const hgt = (0.04 + hash1(seed * 17 + k) * 0.05) * ko;
          const sway = Math.sin(t * (0.9 + k * 0.13) + seed * 1.7 + k) * 0.012;
          const tx = x + ox + sway;
          const ty = y - hgt;
          if (!detail) {
            // 中景：每个羽冠画成一个小圆团
            ctx.moveTo(tx + 0.02, ty - 0.012);
            ctx.arc(tx, ty - 0.012, 0.02, 0, TAU);
            continue;
          }
          for (let q = 0; q < 4; q++) {
            const ang = -Math.PI / 2 + (q - 1.5) * 0.45 + sway * 6;
            const px = tx + Math.cos(ang) * 0.012;
            const py = ty + Math.sin(ang) * 0.016;
            ctx.moveTo(px, py);
            ctx.ellipse(px, py, 0.006, 0.018, ang + Math.PI / 2, 0, TAU);
          }
        }
      }
      ctx.globalAlpha = ga * (scale < 70 ? 0.55 : 1);
      ctx.fillStyle = plume;
      ctx.fill();
      if (scale > 300) {
        // 微观：食骨蠕虫伸入骨头的绿色“根系”
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (skip(i)) continue;
          const o = i * 7;
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
  }

  /** 屏幕坐标命中测试（自由探索中的点击）。 */
  hitTest(rc: RenderCtx, body: WhaleBody, st: WhaleState, finAngle: number, sx: number, sy: number): BoneKind | null {
    if (st.tissue > 0.5) return null;
    this.build(rc.quality.vertebrae);
    const ctx = rc.ctx;
    const ground = st.rest > 0.5 ? 1.74 : 99;
    let hit: BoneKind | null = null;
    for (let i = this.bones.length - 1; i >= 0 && !hit; i--) {
      const b = this.bones[i];
      ctx.save();
      rc.cam.applyTransform(ctx, rc.dpr, st.x, st.y, st.z, st.pitch);
      this.place(ctx, body, st, b, finAngle, ground);
      ctx.lineWidth = 0.15;
      if (ctx.isPointInPath(b.path, sx * rc.dpr, sy * rc.dpr) || ctx.isPointInStroke(b.path, sx * rc.dpr, sy * rc.dpr)) hit = b.kind;
      ctx.restore();
    }
    return hit;
  }

  /** 某类骨骼的世界坐标中心（用于观察点与隐藏发现）。 */
  anchorOf(kind: BoneKind, body: WhaleBody, st: WhaleState, out: { x: number; y: number }): { x: number; y: number } {
    const b = this.bones.find((x) => x.kind === kind && !x.far);
    if (!b) {
      out.x = st.x;
      out.y = st.y;
      return out;
    }
    body.frame(b.s, b.off, this.f);
    const c = Math.cos(st.pitch);
    const s = Math.sin(st.pitch);
    const lx = this.f.x;
    const ly = this.f.y + b.drop * st.collapse;
    out.x = st.x + lx * c - ly * s;
    out.y = st.y + lx * s + ly * c;
    return out;
  }
}

export const NARES = { x: 1.5, y: -0.6 };

function ribLen(i: number, n: number): number {
  if (i === 0) return 1.35;
  return 1.15 + 0.85 * Math.sin((Math.PI * (i + 0.8)) / (n + 1.2));
}

function topOfSkull(x: number): number {
  if (x < 0.5) return lerp(-0.5, -0.86, x / 0.5);
  if (x < 1.52) return lerp(-0.86, -0.62, (x - 0.5) / 1.02);
  return lerp(-0.64, -0.05, (x - 1.52) / 2.6);
}

/** 平滑闭合路径（经过中点的二次曲线）。 */
function smoothClosed(pts: Array<[number, number]>, sharpEnds = false): Path2D {
  const p = new Path2D();
  const n = pts.length;
  if (sharpEnds) {
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      p.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    p.lineTo(pts[n - 1][0], pts[n - 1][1]);
    p.closePath();
    return p;
  }
  const mid = (i: number) => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
  const m0 = mid(n - 1);
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  p.closePath();
  return p;
}

function capsule(x0: number, y0: number, x1: number, y1: number, r: number): Path2D {
  const p = new Path2D();
  const a = Math.atan2(y1 - y0, x1 - x0);
  const nx = -Math.sin(a) * r;
  const ny = Math.cos(a) * r;
  p.moveTo(x0 + nx, y0 + ny);
  p.lineTo(x1 + nx * 0.8, y1 + ny * 0.8);
  p.arc(x1, y1, r * 0.95, a + Math.PI / 2, a - Math.PI / 2, true);
  p.lineTo(x0 - nx, y0 - ny);
  p.arc(x0, y0, r * 1.15, a - Math.PI / 2, a + Math.PI / 2, true);
  p.closePath();
  return p;
}
