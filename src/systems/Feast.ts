import { hex, makeShade, shade, type Shade } from '../core/color';
import { clamp, hash1, lerp, noise1, smoothstep, TAU } from '../core/math';
import { Track, type Keys } from '../core/Track';
import type { RenderCtx } from '../core/types';
import { hagCount, SHARK_BITES, woundSize, WOUNDS, type Wound } from '../config/feast';
import type { Whale } from '../entities/Whale';

/**
 * Feast：鲸落上的进食（阶段 6）。与 CreatureManager 中四处游动的食腐动物不同，这里是镜头推近时
 * 正在鲸鱼身上进食的“主角”，动作全部由叙事进度决定（倒放、跳转、暂停都得到同一个画面）：
 *  - 睡鲨：从幽暗中慢慢游来，张嘴咬住柔软的腹部，扭转身体、甩头，一点一点把肉撕下来，
 *    含着一块肉退开、吞下，再游回黑暗里（config/feast.ts 的三次撕咬）；
 *  - 盲鳗：把头钻进伤口刮食，身体在伤口外不停扭动，不时把身体打成一个结借力撕扯；
 *  - 端足类：成群覆盖在伤口与周围的体表上，细小的身体不停爬动。
 * 伤口本身由 Whale 按同一张表绘制。
 */

const C = {
  shark: hex('#3a3734'),
  sharkDark: hex('#25231f'),
  sharkBelly: hex('#6f6a63'),
  flesh: hex('#4a1a1c'),
  blubber: hex('#cdbb9f'),
  eye: hex('#0e0f10'),
  eyeShine: hex('#7fa6a8'),
  hag: hex('#b49b9d'),
  hagBack: hex('#8e777e'),
  hagBelly: hex('#d2bdba'),
  amph: hex('#e8d6cb'),
};

/** 睡鲨的一次进食：咬住 bite 号伤口，side 为它游来的一侧（−1 从尾部方向，+1 从头部方向） */
interface SharkPlan {
  bite: number;
  side: number;
  len: number;
  seed: number;
}

const PLANS: SharkPlan[] = [
  { bite: 0, side: -1, len: 3.7, seed: 1 },
  { bite: 1, side: 1, len: 3.3, seed: 2 },
  { bite: 2, side: -1, len: 3.9, seed: 3 },
];

/** 撕咬的节奏（进度，相对咬住的时刻） */
const T_APPROACH = 0.03;
const T_LATCH = 0.017;
const T_LEAVE = 0.05;

/** 嘴（相对伤口，米；+x 指向它游来的反方向）、深度（相对体表，米）、张嘴、扭身与咬住的轨道 */
function sharkTracks(): Record<'dx' | 'dy' | 'dz' | 'mouth' | 'latch' | 'away' | 'chunk' | 'alpha', Track> {
  const k = (rows: Array<[number, number]>): Track => new Track(rows as Keys);
  const a = -T_APPROACH;
  return {
    // 从幽暗中（伤口外 10 米、略高处）慢慢游来，最后几米放慢，咬住；松口后先向后退，再转身游开
    dx: k([[a, -10], [-0.018, -7.2], [-0.012, -4.7], [-0.004, -1.3], [0, 0], [T_LATCH, -0.15], [T_LATCH + 0.004, -1.1], [T_LATCH + 0.014, -3.4], [T_LATCH + 0.024, -6], [T_LEAVE, -8.5]]),
    dy: k([[a, -3.2], [-0.018, -2.6], [-0.012, -1.8], [-0.004, -0.45], [0, 0], [T_LATCH, 0.04], [T_LATCH + 0.004, -0.5], [T_LATCH + 0.014, -1.6], [T_LATCH + 0.024, -2.9], [T_LEAVE, -4]]),
    dz: k([[a, -2.6], [-0.012, -1.1], [-0.004, -0.3], [0, -0.1], [T_LATCH, -0.14], [T_LATCH + 0.014, -1.2], [T_LEAVE, -3]]),
    mouth: k([[a, 0], [-0.009, 0], [-0.003, 1], [0.0015, 0.55], [T_LATCH, 0.6], [T_LATCH + 0.003, 0.35], [T_LATCH + 0.012, 0.1], [T_LATCH + 0.02, 0]]),
    latch: k([[a, 0], [-0.001, 0], [0.002, 1], [T_LATCH - 0.001, 1], [T_LATCH + 0.002, 0], [T_LEAVE, 0]]),
    // 松口之后转身离开（0 面向伤口，1 背向）
    away: k([[a, 0], [T_LATCH + 0.008, 0], [T_LATCH + 0.02, 1], [T_LEAVE, 1]]),
    // 含在嘴里的一块肉：慢慢吞下
    chunk: k([[a, 0], [T_LATCH - 0.003, 0], [T_LATCH + 0.002, 1], [T_LATCH + 0.012, 0.85], [T_LATCH + 0.022, 0], [T_LEAVE, 0]]),
    alpha: k([[a, 0], [a + 0.008, 1], [T_LATCH + 0.03, 1], [T_LEAVE, 0]]),
  };
}

const TR = sharkTracks();
const P3 = { x: 0, y: 0, s: 0 };

export class Feast {
  private u = -1;
  private time = 0;
  private whale: Whale | null = null;
  private readonly sh: Shade = makeShade();
  private readonly tmp = { x: 0, y: 0 };
  private readonly wp = { x: 0, y: 0, z: 0, a: 0 };

  /** 每帧调用：u 为鲸鱼谱系进度（不在进食阶段时传入负值） */
  update(u: number, time: number, whale: Whale): void {
    this.u = u;
    this.time = time;
    this.whale = whale;
  }

  get active(): boolean {
    return this.u > 0.548 && this.u < 0.73 && !!this.whale && this.whale.state.tissue > 0.002;
  }

  /**
   * 给声音系统：正在撕咬的睡鲨（latch 0~1，取最强的一只）、它扭身拉扯的相位（弧度，与画面中的 twist 同一个时钟，
   * sin(tug) 越过 0 时是一次用力的甩头）、张嘴程度与叼着的肉；正在钻食的盲鳗数量。
   */
  sound(): { latch: number; tug: number; mouth: number; chunk: number; approach: number; hag: number } {
    const o = { latch: 0, tug: 0, mouth: 0, chunk: 0, approach: 0, hag: 0 };
    if (!this.active) return o;
    for (const plan of PLANS) {
      const d = this.u - SHARK_BITES[plan.bite].p;
      if (d < -T_APPROACH || d > T_LEAVE) continue;
      const l = TR.latch.at(d);
      if (l >= o.latch) {
        o.latch = l;
        o.tug = (this.time + plan.seed * 7) * TAU * 0.42;
      }
      o.mouth = Math.max(o.mouth, TR.mouth.at(d));
      o.chunk = Math.max(o.chunk, TR.chunk.at(d));
      // 正在游近（0~1）：咬住之前的最后几秒
      o.approach = Math.max(o.approach, TR.alpha.at(d) * smoothstep(-0.02, -0.004, d) * (1 - smoothstep(-0.001, 0.002, d)));
    }
    for (const w of WOUNDS) o.hag += hagCount(w, this.u) * this.whale!.fleshAt(w.s, w.v);
    return o;
  }

  /** 伤口中心的世界坐标、体表朝向镜头的深度与体轴方向 */
  private woundAt(w: Wound, out: { x: number; y: number; z: number; a: number }): typeof out {
    const wh = this.whale!;
    const b = wh.body;
    b.point(w.s, w.v, this.tmp);
    const f = b.frame(w.s, 0, { x: 0, y: 0, a: 0 });
    wh.toWorld(this.tmp.x, this.tmp.y, this.tmp);
    out.x = this.tmp.x;
    out.y = this.tmp.y;
    // 身体是画在 z = state.z 平面上的一张画：伤口里的生物放在它前面一点点，投影才与画中的伤口重合
    out.z = wh.state.z - 0.08;
    out.a = f.a + wh.state.pitch;
    return out;
  }

  draw(rc: RenderCtx): void {
    if (!this.active) return;
    const u = this.u;
    const ctx = rc.ctx;
    ctx.save();
    // 端足类与盲鳗在伤口里，睡鲨在它们前面
    for (let i = 0; i < WOUNDS.length; i++) {
      const w = WOUNDS[i];
      const k = woundSize(w, u);
      if (k <= 0) continue;
      // 这里的肉已经被吃光（分解的空洞）：盲鳗与端足类也就离开了
      const flesh = this.whale!.fleshAt(w.s, w.v);
      if (flesh <= 0.02) continue;
      this.woundAt(w, this.wp);
      ctx.globalAlpha = flesh;
      this.drawAmphipods(rc, w, i, k, flesh);
      this.drawHagfish(rc, w, i, k, flesh);
    }
    for (const plan of PLANS) this.drawShark(rc, plan);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ 盲鳗

  private drawHagfish(rc: RenderCtx, w: Wound, wi: number, k: number, flesh: number): void {
    const count = hagCount(w, this.u) * flesh;
    if (count <= 0.01) return;
    const ctx = rc.ctx;
    const wp = this.wp;
    const R = w.r * k;
    const scale = rc.cam.applyTransform(ctx, rc.dpr, wp.x, wp.y, wp.z - 0.05, 0, false);
    if (scale * 0.6 < 2) return;
    rc.light.shadeAt(wp.x, wp.y, wp.z, this.sh);
    const n = Math.ceil(count);
    const ca = Math.cos(wp.a);
    const sa = Math.sin(wp.a);
    for (let j = 0; j < n; j++) {
      const a = clamp(count - j);
      const seed = wi * 17 + j * 5 + 3;
      const h1 = hash1(seed);
      const h2 = hash1(seed + 1);
      // 头部钻进伤口：伤口内的一点（沿体轴方向拉长）
      const th = h1 * TAU;
      const rr = R * (0.15 + 0.55 * h2);
      const lx = Math.cos(th) * rr;
      const ly = Math.sin(th) * rr * 0.6;
      const hx = lx * ca - ly * sa;
      const hy = lx * sa + ly * ca;
      // 身体从伤口向外伸出：大致背离伤口中心，偏向上方（伤口在朝上的腹部）
      const out = Math.atan2(hy - 0.35 * R, hx) + (hash1(seed + 2) - 0.5) * 1.4;
      this.hagBody(ctx, scale, hx, hy, out, 0.52 + 0.22 * hash1(seed + 3), seed, a);
    }
  }

  /** 一条钻在伤口里的盲鳗：从头部（伤口里）向尾部绘制，身体扭动，不时打一个结 */
  private hagBody(ctx: CanvasRenderingContext2D, scale: number, x0: number, y0: number, dir: number, L: number, seed: number, alpha: number): void {
    const t = this.time;
    const n = 16;
    const xs = HX;
    const ys = HY;
    const ph = hash1(seed + 7) * TAU;
    // 打结：每隔十几秒一次，持续几秒
    const kc = (t * 0.075 + hash1(seed + 9)) % 1;
    const knot = kc < 0.22 ? Math.sin((kc / 0.22) * Math.PI) : 0;
    // 撕扯：扭动更快、更用力
    const pull = 0.5 + 0.5 * Math.sin(t * 0.9 + ph);
    let x = x0;
    let y = y0;
    let ang = dir;
    const seg = L / (n - 1);
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      xs[i] = x;
      ys[i] = y;
      const wave = Math.sin(t * (5 + 2.5 * pull) + ph - s * 7) * (0.18 + 0.5 * s) * (0.6 + 0.4 * pull);
      // 结：头后一段身体转一整圈
      const loop = knot * (s > 0.18 && s < 0.6 ? (TAU / 0.42) * (1 / (n - 1)) * 1.05 : 0);
      ang += (wave - (i > 0 ? Math.sin(t * (5 + 2.5 * pull) + ph - ((i - 1) / (n - 1)) * 7) * (0.18 + 0.5 * ((i - 1) / (n - 1))) * (0.6 + 0.4 * pull) : 0)) + loop;
      x += Math.cos(ang) * seg;
      y += Math.sin(ang) * seg;
    }
    const sh = this.sh;
    ctx.globalAlpha = alpha;
    if (scale * L < 14) {
      ctx.strokeStyle = shade(C.hag, sh);
      ctx.lineWidth = 0.04;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.stroke();
      return;
    }
    const width = (s: number) => (s < 0.08 ? 0.022 + s * 0.2 : 0.038 - 0.014 * s) * (s > 0.8 ? 1 + (s - 0.8) * 1.4 : 1);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const j = Math.min(n - 1, i + 1);
      const k = Math.max(0, i - 1);
      const tx = xs[j] - xs[k];
      const ty = ys[j] - ys[k];
      const tl = Math.hypot(tx, ty) || 1;
      const wv = width(i / (n - 1));
      const px = xs[i] + (ty / tl) * wv;
      const py = ys[i] - (tx / tl) * wv;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = Math.min(n - 1, i + 1);
      const k = Math.max(0, i - 1);
      const tx = xs[j] - xs[k];
      const ty = ys[j] - ys[k];
      const tl = Math.hypot(tx, ty) || 1;
      const wv = width(i / (n - 1));
      ctx.lineTo(xs[i] - (ty / tl) * wv, ys[i] + (tx / tl) * wv);
    }
    ctx.closePath();
    ctx.fillStyle = shade(C.hag, sh);
    ctx.fill();
    // 背侧更暗的一道
    ctx.strokeStyle = shade(C.hagBack, sh, 0.7);
    ctx.lineWidth = 0.018;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(xs[1], ys[1]);
    for (let i = 2; i < n - 1; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
    // 头部埋在伤口里：一圈暗色
    ctx.fillStyle = 'rgba(30,10,12,0.55)';
    ctx.beginPath();
    ctx.ellipse(xs[0], ys[0], 0.045, 0.03, Math.atan2(ys[1] - ys[0], xs[1] - xs[0]), 0, TAU);
    ctx.fill();
  }

  // ------------------------------------------------------------------ 端足类

  private drawAmphipods(rc: RenderCtx, w: Wound, wi: number, k: number, flesh: number): void {
    const u = this.u;
    const dens = smoothstep(0.56, 0.585, u) * (1 - smoothstep(0.69, 0.715, u)) * flesh;
    if (dens <= 0.01) return;
    const ctx = rc.ctx;
    const wp = this.wp;
    const scale = rc.cam.applyTransform(ctx, rc.dpr, wp.x, wp.y, wp.z - 0.02, 0, false);
    // 每只约 1.5 厘米：太小时看不见，不画
    if (scale * 0.015 < 0.6) return;
    rc.light.shadeAt(wp.x, wp.y, wp.z, this.sh);
    const R = w.r * Math.max(0.35, k);
    const n = Math.round((w.kind === 'shark' ? 70 : 34) * dens);
    const t = this.time;
    const ca = Math.cos(wp.a);
    const sa = Math.sin(wp.a);
    ctx.fillStyle = shade(C.amph, this.sh, 0.85 * flesh);
    for (let j = 0; j < n; j++) {
      const seed = wi * 131 + j * 3;
      // 伤口边缘最密：半径在 0.5~1.5 倍之间，缓慢爬动
      const th = hash1(seed) * TAU + 0.25 * noise1(t * 0.12 + j, seed);
      const rr = R * (0.45 + 1.05 * hash1(seed + 1)) + 0.06 * noise1(t * 0.2 + j * 1.3, seed + 5);
      const lx = Math.cos(th) * rr;
      const ly = Math.sin(th) * rr * 0.62;
      const x = lx * ca - ly * sa;
      const y = lx * sa + ly * ca;
      const len = 0.012 + 0.008 * hash1(seed + 2);
      ctx.beginPath();
      ctx.ellipse(x, y, len, len * 0.42, th + 1.2 + Math.sin(t * 3 + j), 0, TAU);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ 睡鲨

  private drawShark(rc: RenderCtx, plan: SharkPlan): void {
    const bite = SHARK_BITES[plan.bite];
    const d = this.u - bite.p;
    if (d < -T_APPROACH || d > T_LEAVE) return;
    const alpha = TR.alpha.at(d);
    if (alpha <= 0.003) return;
    const wp = this.woundAt(bite, this.wp);
    const L = plan.len;
    const side = plan.side;
    const t = this.time + plan.seed * 7;
    const latch = TR.latch.at(d);
    const away = TR.away.at(d);
    const mouth = TR.mouth.at(d);
    const chunk = TR.chunk.at(d);
    // 咬住时：扭转身体（绕体轴转动）与甩头，向后拉扯
    const twist = latch * 0.85 * Math.sin(t * TAU * 0.42);
    const shake = latch * 0.11 * Math.sin(t * TAU * 0.85 + 0.6);
    const tug = latch * 0.12 * (1 + Math.sin(t * TAU * 0.42 - 0.8));
    // 嘴的位置：从伤口向它游来的一侧偏开（咬住时向后拉扯）
    const mx = wp.x + side * (-TR.dx.at(d) + tug);
    const my = wp.y + TR.dy.at(d);
    const mz = wp.z + TR.dz.at(d);
    // 朝向：游向伤口时面向伤口（从左边来则朝右），离开时转身
    const face = side < 0 ? 1 : -1;
    const yaw = lerp(face > 0 ? 0 : Math.PI, face > 0 ? Math.PI : 0, smoothstep(0, 1, away));
    const c = Math.cos(yaw);
    // 低头：咬住朝上的腹部时头略向下，离开时缓缓抬头
    const tilt = (0.32 * smoothstep(-0.012, -0.002, d) * (1 - away) - 0.18 * away + shake) * 1;
    // 嘴在身体局部坐标中的位置 → 身体原点
    const lmx = L * 0.41;
    const lmy = L * 0.075 + 0.04 * L * mouth;
    const sx = Math.abs(c) < 0.1 ? 0.1 * Math.sign(c || 1) : c;
    const tc = Math.cos(tilt * c);
    const ts = Math.sin(tilt * c);
    const ox = mx - (lmx * sx * tc - lmy * ts);
    const oy = my - (lmx * sx * ts + lmy * tc);
    const ctx = rc.ctx;
    const scale = rc.cam.applyTransform(ctx, rc.dpr, ox, oy, mz, 0, false);
    if (!rc.cam.project(ox, oy, mz, P3)) return;
    rc.light.shadeAt(ox, oy, mz, this.sh);
    ctx.rotate(tilt * c);
    ctx.scale(sx, 1);
    ctx.globalAlpha = alpha;
    const swim = (1 - latch) * (0.5 + 0.5 * smoothstep(0, 1, Math.abs(TR.dx.at(d + 0.002) - TR.dx.at(d)) * 60));
    this.sharkBody(ctx, scale, L, t, twist, mouth, chunk, swim + latch * 1.2);
  }

  /**
   * 太平洋睡鲨（侧视，面朝 +x，单位米）：圆筒形的粗壮身体，短而圆的吻，嘴在吻部下方，小眼睛，
   * 两个很小的背鳍靠后，没有臀鳍，尾鳍下叶较发达；体色是带斑驳的暗灰褐色。
   * twist 为绕体轴的转动（弧度）：背鳍与尾鳍随之变矮，腹部较浅的颜色转到侧面来。
   */
  private sharkBody(ctx: CanvasRenderingContext2D, scale: number, L: number, t: number, twist: number, mouth: number, chunk: number, beat: number): void {
    const sh = this.sh;
    const ct = Math.cos(twist);
    const st = Math.sin(twist);
    // 侧视轮廓：x ∈ [−0.42L, 0.5L]，上缘 / 下缘（向下为正）
    const top = (x: number) => {
      const u = x / L;
      if (u > 0.36) return -0.105 * L * Math.sqrt(Math.max(0, 1 - ((u - 0.36) / 0.145) ** 2)) * 0.92 + 0.01 * L;
      if (u > 0.05) return -0.105 * L;
      return -0.105 * L * (0.28 + 0.72 * Math.pow((u + 0.42) / 0.47, 0.9)) + 0.006 * L * (1 - (u + 0.42) / 0.47);
    };
    const bot = (x: number) => {
      const u = x / L;
      if (u > 0.3) return 0.095 * L * Math.sqrt(Math.max(0, 1 - ((u - 0.3) / 0.205) ** 2)) + 0.012 * L * (u > 0.44 ? 1 : 0);
      if (u > 0.0) return 0.1 * L;
      return 0.1 * L * (0.32 + 0.68 * Math.pow((u + 0.42) / 0.42, 0.85));
    };
    const sweep = Math.sin(t * TAU * (0.35 + 0.25 * beat)) * (0.25 + 0.35 * beat);
    const body = shade(C.shark, sh);
    const dark = shade(C.sharkDark, sh);
    const belly = shade(C.sharkBelly, sh);
    // 尾鳍（歪尾：上叶长，下叶较发达）
    ctx.save();
    ctx.translate(-0.41 * L, 0.005 * L);
    ctx.scale(0.55 + 0.45 * Math.cos(sweep), Math.max(0.3, Math.abs(ct)));
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(0.03 * L, -0.03 * L);
    ctx.bezierCurveTo(-0.06 * L, -0.06 * L, -0.15 * L, -0.11 * L, -0.215 * L, -0.15 * L);
    ctx.quadraticCurveTo(-0.19 * L, -0.07 * L, -0.165 * L, -0.012 * L);
    ctx.quadraticCurveTo(-0.17 * L, 0.04 * L, -0.19 * L, 0.095 * L);
    ctx.bezierCurveTo(-0.11 * L, 0.07 * L, -0.04 * L, 0.04 * L, 0.03 * L, 0.03 * L);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 身体轮廓
    const N = 22;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = lerp(-0.42 * L, 0.5 * L, i / N);
        if (i === 0) ctx.moveTo(x, top(x));
        else ctx.lineTo(x, top(x));
      }
      for (let i = N; i >= 0; i--) {
        const x = lerp(-0.42 * L, 0.5 * L, i / N);
        ctx.lineTo(x, bot(x));
      }
      ctx.closePath();
    };
    // 背鳍、胸鳍与腹鳍（根部落在轮廓上）
    const fin = (x: number, h: number, back: number, up: boolean) => {
      const y = up ? top(x) + 0.004 * L : bot(x) - 0.004 * L;
      const s = up ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x + back * 0.15, y);
      ctx.quadraticCurveTo(x - back * 0.2, y + s * h * 1.05, x - back * 0.75, y + s * h);
      ctx.quadraticCurveTo(x - back * 0.7, y + s * h * 0.4, x - back * 0.95, y);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = dark;
    fin(0.02 * L, 0.055 * L * ct, 0.085 * L, true);
    fin(-0.19 * L, 0.05 * L * ct, 0.075 * L, true);
    fin(-0.14 * L, 0.035 * L, 0.06 * L, false);
    // 身体：上暗下浅，转动时较浅的腹部转到侧面
    const g = ctx.createLinearGradient(0, -0.105 * L, 0, 0.1 * L);
    const bt = clamp(0.6 - 0.32 * st);
    g.addColorStop(0, dark);
    g.addColorStop(clamp(bt - 0.32), body);
    g.addColorStop(bt, body);
    g.addColorStop(1, belly);
    ctx.fillStyle = g;
    path();
    ctx.fill();
    // 斑驳的皮肤与上方透下的微光
    ctx.save();
    path();
    ctx.clip();
    for (let k = 0; k < 14; k++) {
      const h1 = hash1(k * 3 + 11);
      const x = lerp(-0.38, 0.42, h1) * L;
      const y = lerp(-0.08, 0.05, hash1(k * 5 + 7)) * L;
      ctx.fillStyle = k % 3 ? 'rgba(18,16,14,0.16)' : 'rgba(150,145,138,0.08)';
      ctx.beginPath();
      ctx.ellipse(x, y, (0.03 + 0.04 * hash1(k * 7 + 3)) * L, (0.012 + 0.015 * hash1(k * 9 + 1)) * L, 0.2 * (hash1(k) - 0.5), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = shade(C.sharkBelly, sh, 0.35);
    ctx.lineWidth = 0.008 * L;
    ctx.beginPath();
    for (let i = 2; i <= N - 2; i++) {
      const x = lerp(-0.42 * L, 0.5 * L, i / N);
      if (i === 2) ctx.moveTo(x, top(x) + 0.006 * L);
      else ctx.lineTo(x, top(x) + 0.006 * L);
    }
    ctx.stroke();
    // 胸鳍：鳃裂之后、体侧下方，压在身体上
    ctx.fillStyle = dark;
    ctx.beginPath();
    const px = 0.24 * L;
    const py = 0.045 * L;
    ctx.moveTo(px + 0.03 * L, py);
    ctx.quadraticCurveTo(px - 0.02 * L, py + 0.09 * L, px - 0.085 * L, py + 0.1 * L * (0.7 + 0.3 * ct));
    ctx.quadraticCurveTo(px - 0.05 * L, py + 0.03 * L, px - 0.04 * L, py - 0.005 * L);
    ctx.closePath();
    ctx.fill();
    // 嘴：吻部下方的一道弧；张嘴时下颌向下打开，露出暗色的口腔与一排细小的牙
    const jaw = 0.065 * L * mouth;
    const mx0 = 0.33 * L;
    const mx1 = 0.45 * L;
    const my = 0.065 * L;
    if (mouth > 0.02) {
      ctx.fillStyle = 'rgba(16,8,9,0.95)';
      ctx.beginPath();
      ctx.moveTo(mx0, my);
      ctx.quadraticCurveTo((mx0 + mx1) / 2, my - 0.02 * L, mx1, my - 0.012 * L);
      ctx.quadraticCurveTo(mx1 - 0.01 * L, my + jaw * 0.8, (mx0 + mx1) / 2, my + jaw);
      ctx.quadraticCurveTo(mx0 + 0.01 * L, my + jaw * 0.6, mx0, my);
      ctx.fill();
      ctx.fillStyle = 'rgba(215,205,190,0.75)';
      for (let k = 0; k < 6; k++) {
        const x = lerp(mx0 + 0.015 * L, mx1 - 0.012 * L, k / 5);
        const y = my - 0.012 * L - 0.008 * L * Math.sin((k / 5) * Math.PI);
        ctx.beginPath();
        ctx.moveTo(x - 0.004 * L, y);
        ctx.lineTo(x + 0.004 * L, y);
        ctx.lineTo(x, y + 0.012 * L);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(16,10,10,0.6)';
      ctx.lineWidth = 0.005 * L;
      ctx.beginPath();
      ctx.moveTo(mx0, my);
      ctx.quadraticCurveTo((mx0 + mx1) / 2, my - 0.012 * L, mx1, my - 0.01 * L);
      ctx.stroke();
    }
    // 嘴里含着的一块肉：暗红的肌肉连着一点白色的鲸脂
    if (chunk > 0.02) {
      const r = 0.06 * L * chunk;
      const cx = (mx0 + mx1) / 2 + 0.03 * L;
      const cy = my + jaw * 0.55;
      ctx.fillStyle = shade(C.blubber, sh, 0.9);
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.5, cy - r * 0.2, r * 0.75, r * 0.45, 0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(C.flesh, sh);
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.15, r, r * 0.62, 0.25, 0, TAU);
      ctx.fill();
    }
    if (scale * L > 50) {
      // 小眼睛与鳃裂
      const ey = -0.03 * L * (0.6 + 0.4 * ct);
      ctx.fillStyle = shade(C.eye, sh);
      ctx.beginPath();
      ctx.ellipse(0.405 * L, ey, 0.011 * L, 0.008 * L, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(C.eyeShine, sh, 0.5);
      ctx.beginPath();
      ctx.arc(0.408 * L, ey - 0.003 * L, 0.0035 * L, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(14,12,11,0.55)';
      ctx.lineWidth = 0.004 * L;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const gx = (0.305 - k * 0.016) * L;
        ctx.moveTo(gx, -0.02 * L);
        ctx.quadraticCurveTo(gx - 0.006 * L, 0.01 * L, gx - 0.004 * L, 0.045 * L);
      }
      ctx.stroke();
    }
  }
}

const HX = new Float32Array(16);
const HY = new Float32Array(16);

/** 第 i 次撕咬的睡鲨在 u 时：嘴相对伤口的偏移（米，不含咬住时的拉扯）、是否咬住、可见程度 */
export function sharkMouth(i: number, u: number): { dx: number; dy: number; latch: number; alpha: number } {
  const plan = PLANS[i];
  const d = u - SHARK_BITES[plan.bite].p;
  if (d < -T_APPROACH || d > T_LEAVE) return { dx: 0, dy: 0, latch: 0, alpha: 0 };
  return { dx: plan.side * -TR.dx.at(d), dy: TR.dy.at(d), latch: TR.latch.at(d), alpha: TR.alpha.at(d) };
}

/** 调试：某一进度下正在进食的生物数量 */
export function feastCounts(u: number): { sharks: number; hag: number } {
  let sharks = 0;
  for (const p of PLANS) {
    const d = u - SHARK_BITES[p.bite].p;
    if (d > -T_APPROACH && d < T_LEAVE && TR.alpha.at(d) > 0.01) sharks++;
  }
  let hag = 0;
  for (const w of WOUNDS) hag += hagCount(w, u);
  return { sharks, hag };
}
