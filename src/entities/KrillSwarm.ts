import { makeShade, type Shade } from '../core/color';
import { clamp, hash1, lerp, noise1, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import type { KrillState } from '../systems/StoryTimeline';

/**
 * 磷虾群。每只磷虾的位置 = 群体中心 + 椭球内的“家位置” × 群体形状 + 个体噪声漂移。
 * 群体参数（中心、形状、聚集度、捕食进度）全部来自叙事时间线，因此倒放时
 * 被吞入的磷虾会自然“回到”群体中；个体的小幅运动使用氛围时钟，彼此不同步。
 *
 * 滤食：时间线把虾团对准张开的嘴（群体的长轴就是鲸鱼前进的方向）。只有离这条轴不远、
 * 正好在嘴的范围内的磷虾会被吞下——随着涌进嘴里的水流先向轴线收拢（喇叭口），再越来越快地被吸进嘴里，
 * 被拉成细长的一道；嘴的范围之外的磷虾被头部推开的水流带向两侧，然后散开，不会穿过身体。
 */

const MAX = 1500;
/** 张开的嘴吞下的范围：离前进方向的轴线不超过这个距离（米，侧视中的上下与前后方向） */
const ENGULF_R = 3.4;
/** 身体的侧视半高（米，含鼓起的喉囊）与半宽：没被吞下的磷虾绕过身体 */
const BODY_H = 2.7;
const BODY_W = 2.6;
/** 零星磷虾（磷虾群出现之前，从鲸鱼头部前方漂过） */
const STRAYS = 12;
/**
 * 远处成群的小磷虾：几张斑点图叠在群体的不同位置与深度上（群体坐标，−1~1），各自缓慢漂移、转动。
 * f 为沿群体方向的位置：前缘（朝向鲸鱼）先被吞掉。
 */
const SPECKS = [
  { x: -0.35, y: 0.1, z: 0.55, r: 0.95, f: 0.2 },
  { x: 0.3, y: -0.15, z: 0.35, r: 0.85, f: 0.75 },
  { x: 0.0, y: 0.05, z: 0.1, r: 1.05, f: 0.5 },
  { x: -0.15, y: -0.2, z: -0.1, r: 0.8, f: 0.35 },
  { x: 0.4, y: 0.2, z: -0.3, r: 0.75, f: 0.85 },
  { x: -0.45, y: -0.05, z: -0.5, r: 0.7, f: 0.1 },
  { x: 0.1, y: 0.3, z: 0.75, r: 0.8, f: 0.6 },
  { x: 0.15, y: -0.3, z: -0.7, r: 0.65, f: 0.65 },
];

export class KrillSwarm {
  readonly n = MAX;
  // 个体参数（构造时生成，永不重新分配）
  private readonly hx = new Float32Array(MAX);
  private readonly hy = new Float32Array(MAX);
  private readonly hz = new Float32Array(MAX);
  private readonly ph = new Float32Array(MAX);
  private readonly sp = new Float32Array(MAX);
  private readonly sz = new Float32Array(MAX);
  private readonly eatTh = new Float32Array(MAX);
  /** 是否在张开的嘴的范围内（0/1，边缘处按个体略有不同） */
  private readonly inMouth = new Float32Array(MAX);
  /** 平滑变化的数量：画质自动升降时，磷虾在一两秒内逐渐增减，而不是一下子少掉一半 */
  private countF = -1;
  private lastTime = 0;
  private readonly order = new Float32Array(MAX);
  // 每帧结果
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly ang = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly cap = new Float32Array(MAX);
  private count = 0;
  private readonly strayOff = new Float32Array(STRAYS * 4);
  private readonly sxs = new Float32Array(STRAYS);
  private readonly sys = new Float32Array(STRAYS);
  private readonly szs = new Float32Array(STRAYS);
  private readonly sang = new Float32Array(STRAYS);
  private readonly sh: Shade = makeShade();
  state: KrillState | null = null;
  /** 嘴部位置（世界坐标）、张开程度与前进方向（弧度），由鲸鱼提供 */
  mouth = { x: 0, y: 0, z: 0, open: 0, a: 0 };
  snout = { x: -999, y: 0 };
  /** 鲸鱼身体参考点与体长方向的范围（米，参考点之前 / 之后），没被吞下的磷虾绕开身体 */
  body = { x: 0, y: 0, front: 10.1, back: 13.9 };

  constructor() {
    for (let i = 0; i < MAX; i++) {
      // 椭球内的均匀分布，并偏向群体前缘稍密
      let x = 0;
      let y = 0;
      let z = 0;
      let k = 0;
      do {
        x = hash1(i * 3 + 1) * 2 - 1;
        y = hash1(i * 3 + 2 + k * 7919) * 2 - 1;
        z = hash1(i * 3 + 3 + k * 104729) * 2 - 1;
        k++;
      } while (x * x + y * y + z * z > 1 && k < 8);
      this.hx[i] = x;
      this.hy[i] = y;
      this.hz[i] = z;
      this.ph[i] = hash1(i * 11 + 5) * 100;
      this.sp[i] = 0.6 + hash1(i * 13 + 7) * 0.8;
      this.sz[i] = 0.75 + hash1(i * 17 + 9) * 0.6;
      this.order[i] = hash1(i * 19 + 3);
      // 被吞阈值：群体沿游动方向（朝向鲸鱼）的前缘先被吞入
      this.eatTh[i] = clamp(0.04 + (1 - x) * 0.33 + hash1(i * 23) * 0.2);
      // 嘴的范围按冲刺滤食时的群体形状（见 StoryTimeline 的 ry / rz）判断，每只磷虾固定，倒放时同样可逆
      this.inMouth[i] = Math.hypot(y * 4.8, z * 5.2 * 0.9) < ENGULF_R * (0.85 + 0.3 * hash1(i * 29 + 4)) ? 1 : 0;
    }
    for (let i = 0; i < STRAYS; i++) {
      this.strayOff[i * 4] = -1.5 + (i / (STRAYS - 1)) * 8.5 + (hash1(i * 41 + 1) - 0.5) * 0.8;
      this.strayOff[i * 4 + 1] = (hash1(i * 41 + 2) - 0.5) * 3.4;
      this.strayOff[i * 4 + 2] = -1.2 + hash1(i * 41 + 3) * 2;
      this.strayOff[i * 4 + 3] = hash1(i * 41 + 4) * 100;
    }
  }

  update(st: KrillState, time: number, count: number, reduced: boolean): void {
    this.state = st;
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.countF = this.countF < 0 ? count : this.countF + (count - this.countF) * (1 - Math.exp(-dt * 1.5));
    this.count = Math.min(MAX, Math.ceil(this.countF));
    if (st.stray > 0.001) {
      const k = reduced ? 0.5 : 1;
      for (let i = 0; i < STRAYS; i++) {
        const ph = this.strayOff[i * 4 + 3];
        const t = time * 0.18 * k + ph;
        this.sxs[i] = st.sx + this.strayOff[i * 4] + noise1(t, 7) * 0.35;
        this.sys[i] = st.sy + this.strayOff[i * 4 + 1] + noise1(t + 19, 8) * 0.25;
        this.szs[i] = st.sz + this.strayOff[i * 4 + 2];
        this.sang[i] = Math.PI + noise1(t * 0.7 + 5, 9) * 0.6;
      }
    }
    if (st.visible <= 0.001) return;
    const n = this.count;
    // 群体朝向：沿 heading 方向拉长
    const ch = Math.cos(st.heading);
    const shd = Math.sin(st.heading);
    // 鲸鱼的前进方向与嘴
    const m = this.mouth;
    const ha = Math.cos(m.a);
    const hb = Math.sin(m.a);
    const b = this.body;
    const wander = lerp(2.6, 0.55, st.agg) * (reduced ? 0.5 : 1);
    const breathe = 1 + 0.07 * Math.sin(time * 0.31);
    const speedK = reduced ? 0.5 : 1;
    for (let i = 0; i < n; i++) {
      const vis = clamp((st.visible - this.order[i] * 0.98) * 18) * clamp(this.countF - i);
      this.alpha[i] = vis;
      if (vis <= 0) continue;
      const t = time * 0.22 * this.sp[i] * speedK + this.ph[i];
      // 椭球形状，整体缓慢旋转、呼吸
      const lx = this.hx[i] * st.rx * breathe;
      const ly = this.hy[i] * st.ry * (2 - breathe);
      const swirl = 0.15 * Math.sin(time * 0.05 + this.hy[i] * 2);
      const rx = lx * Math.cos(swirl) - ly * Math.sin(swirl);
      const ry = lx * Math.sin(swirl) + ly * Math.cos(swirl);
      let x = st.x + rx * ch - ry * shd + noise1(t, 1) * wander;
      let y = st.y + rx * shd + ry * ch + noise1(t + 37, 2) * wander * 0.7;
      let z = st.z + this.hz[i] * st.rz + noise1(t + 71, 3) * wander * 0.6;
      // 吞食后剩余个体向外散开
      if (st.scatter > 0) {
        const k = st.scatter * (1.2 + this.order[i]);
        x += this.hx[i] * k * 3;
        y += this.hy[i] * k * 2.2;
        z += this.hz[i] * k * 2;
      }
      // 被吞入：只有嘴的范围内的磷虾，前缘先被吞下
      let c = 0;
      if (st.feed > 0 && this.inMouth[i] > 0) c = smoothstep(this.eatTh[i], this.eatTh[i] + 0.16, st.feed);
      if (c > 0) {
        // 相对嘴的坐标：沿前进方向 d、垂直于前进方向 lat；涌进嘴里的水流先把它向轴线收拢（喇叭口），
        // 再越来越快地把它拉进嘴里（c² ：开始时几乎不动，最后一下子被吸进去）
        const rx0 = x - m.x;
        const ry0 = y - m.y;
        const d = rx0 * ha + ry0 * hb;
        const lat = -rx0 * hb + ry0 * ha;
        const conv = smoothstep(0, 0.75, c);
        const d2 = lerp(d, -1.1 + 0.5 * this.hx[i], c * c);
        const lat2 = lat * (1 - conv) + this.hy[i] * 0.6 * conv;
        x = m.x + d2 * ha - lat2 * hb;
        y = m.y + d2 * hb + lat2 * ha;
        z = lerp(z, m.z + this.hz[i] * 0.4, conv);
      } else {
        // 躲避鲸鱼吻部
        const sx = x - this.snout.x;
        const sy = y - this.snout.y;
        const sd2 = sx * sx + sy * sy;
        if (sd2 < 30) {
          const sd = Math.sqrt(sd2) + 0.01;
          const push = (1 - sd / 5.5) * 1.6;
          if (push > 0) {
            x += (sx / sd) * push;
            y += (sy / sd) * push;
          }
        }
        // 没被吞下、离身体太近的磷虾被头部推开的水流带到身体两侧（前方或后方），不会穿过身体
        if (st.feed > 0 || st.align > 0.5) {
          const bx = x - b.x;
          const by = y - b.y;
          const along = bx * ha + by * hb;
          const across = -bx * hb + by * ha;
          const w = smoothstep(-b.back, -b.back + 4, along) * (1 - smoothstep(b.front, b.front + 2.5, along)) * (1 - smoothstep(BODY_H, BODY_H + 1.2, Math.abs(across)));
          const dz = z - m.z;
          const need = BODY_W * w;
          if (Math.abs(dz) < need) z = m.z + (dz >= 0 ? need : -need);
        }
      }
      this.cap[i] = c;
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      // 朝向：群体方向 + 个体摆动；被吞时朝向嘴
      let a = st.heading + noise1(t * 1.3 + 13, 4) * 0.5;
      if (c > 0.05) a = lerp(a, Math.atan2(this.mouth.y - y, this.mouth.x - x), Math.min(1, c * 2));
      this.ang[i] = a;
    }
  }

  /**
   * 绘制：layer = 'behind'（z>zSplit，鲸鱼之后的远景）、'front'（z≤zSplit）、
   * 'captured'（已进入口腔、夹在口腔与身体之间）。
   */
  draw(rc: RenderCtx, layer: 'behind' | 'front' | 'captured', zSplit = 0): void {
    const st = this.state;
    if (!st) return;
    const { ctx, cam, dpr } = rc;
    const tex = st.deep > 0.5 ? textures().krillDeep : textures().krill;
    const tw = tex.width;
    const th = tex.height;
    const sh = this.sh;
    rc.light.shadeAt(st.x, st.y, st.z, sh);
    // 磷虾是画面中的重要角色：保证在深海与远景中仍清晰可辨
    const light = Math.max(0.78, Math.min(1.15, sh.light + sh.warm * 0.6 + 0.25));
    if (layer !== 'captured' && st.stray > 0.01) this.drawStrays(rc, layer, zSplit, tex, light);
    if (st.visible <= 0.001) return;
    // 群体的整体“质量感”：柔和的橙色雾团，以及密密麻麻的小磷虾
    if (layer === 'behind') this.drawHaze(rc, light);
    if (layer !== 'captured') this.drawSpecks(rc, layer, zSplit, light);
    const P = { x: 0, y: 0, s: 0 };
    const n = this.count;
    // 体长（米，适度夸大以便辨认）；远景时再放大一些，保持群体的颗粒感
    const len = 0.11 * Math.max(1, Math.pow(cam.shot.frameH / 15, 0.65));
    let dots = 0;
    ctx.fillStyle = st.deep > 0.5 ? `rgb(${(226 * light) | 0},${(80 * light) | 0},${(52 * light) | 0})` : `rgb(${(246 * light) | 0},${(110 * light) | 0},${(62 * light) | 0})`;
    for (let i = 0; i < n; i++) {
      const a = this.alpha[i];
      if (a <= 0) continue;
      const c = this.cap[i];
      const captured = c > 0.35;
      if (layer === 'captured' ? !captured : captured) continue;
      const z = this.pz[i];
      if (layer === 'behind' && z <= zSplit) continue;
      if (layer === 'front' && z > zSplit) continue;
      if (!cam.project(this.px[i], this.py[i], z, P)) continue;
      if (P.x < -20 || P.y < -20 || P.x > rc.w + 20 || P.y > rc.h + 20) continue;
      const L = len * this.sz[i] * P.s;
      // 雾化：越远越透明（与海水融合）
      const fog = clamp(1 - Math.exp(-Math.max(0, z - cam.cz - cam.dist * 0.6) / Math.max(10, rc.light.vis)));
      const alpha = a * (1 - fog) * (captured ? 1 - smoothstep(0.85, 1, c) : 1);
      if (alpha <= 0.02) continue;
      if (L < 2.6) {
        // 远处：小点（被吸入时沿水流拉长）
        const r = Math.max(0.75, L * 0.45);
        const sk = c > 0.02 ? 1 + 2.6 * c * c : 1;
        ctx.globalAlpha = alpha * Math.min(1, L * 0.5 + 0.5);
        const ca = Math.cos(this.ang[i]);
        const sa = Math.sin(this.ang[i]);
        ctx.setTransform(ca * dpr * sk, sa * dpr * sk, -sa * dpr, ca * dpr, P.x * dpr, P.y * dpr);
        ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
        dots++;
        continue;
      }
      const ang = this.ang[i];
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const flip = cos < 0 ? -1 : 1;
      const k = (L / tw) * dpr;
      // 被吸进嘴里的磷虾随越来越快的水流被拉成细长的一道
      const sk = c > 0.02 ? 1 + 2.6 * c * c * (1 - smoothstep(0.75, 1, c)) : 1;
      // 头朝运动方向；朝左时垂直翻转以保持背部朝上
      ctx.setTransform(cos * k * sk, sin * k * sk, (-sin * k * flip) / Math.sqrt(sk), (cos * k * flip) / Math.sqrt(sk), P.x * dpr, P.y * dpr);
      ctx.globalAlpha = alpha * Math.min(1, light + 0.15);
      ctx.drawImage(tex, -tw / 2, -th / 2);
    }
    void dots;
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 零星的几只磷虾：先于磷虾群出现，从鲸鱼头部前方缓缓漂过。 */
  private drawStrays(rc: RenderCtx, layer: 'behind' | 'front', zSplit: number, tex: CanvasImageSource & { width: number; height: number }, light: number): void {
    const st = this.state!;
    const { ctx, cam, dpr } = rc;
    const P = { x: 0, y: 0, s: 0 };
    const tw = tex.width;
    const th = tex.height;
    for (let i = 0; i < STRAYS; i++) {
      const z = this.szs[i];
      if (layer === 'behind' ? z <= zSplit : z > zSplit) continue;
      if (!cam.project(this.sxs[i], this.sys[i], z, P)) continue;
      if (P.x < -40 || P.y < -40 || P.x > rc.w + 40 || P.y > rc.h + 40) continue;
      const L = 0.14 * (0.85 + 0.3 * hash1(i * 7)) * P.s;
      if (L < 1.5) continue;
      const ang = this.sang[i];
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const flip = cos < 0 ? -1 : 1;
      const k = (L / tw) * dpr;
      ctx.setTransform(cos * k, sin * k, -sin * k * flip, cos * k * flip, P.x * dpr, P.y * dpr);
      ctx.globalAlpha = st.stray * Math.min(1, light + 0.1);
      ctx.drawImage(tex, -tw / 2, -th / 2);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 远处成群的小磷虾（斑点图）：在鲸鱼前后两层分别绘制 */
  private drawSpecks(rc: RenderCtx, layer: 'behind' | 'front', zSplit: number, light: number): void {
    const st = this.state!;
    const { ctx, cam, dpr, time } = rc;
    const texs = st.deep > 0.5 ? textures().krillSpecksDeep : textures().krillSpecks;
    const base = st.visible * (0.5 + 0.5 * st.agg) * (1 - 0.85 * st.scatter) * Math.min(1, light);
    if (base < 0.02) return;
    const ch = Math.cos(st.heading);
    const shd = Math.sin(st.heading);
    const P = { x: 0, y: 0, s: 0 };
    // 画质较低时只画前几层（排在前面的几层分布在群体的中心与前后）
    const layers = Math.min(SPECKS.length, rc.quality.krillSpecks);
    for (let j = 0; j < layers; j++) {
      const q = SPECKS[j];
      const z = st.z + q.z * st.rz;
      if (layer === 'behind' ? z <= zSplit : z > zSplit) continue;
      // 鲸鱼张嘴吞下时，前缘的虾群先被吞下：正对着嘴的几层随水流收拢、被拉长着吸进嘴里，
      // 嘴的范围之外的几层只是变稀、随后散开
      const eaten = smoothstep(0.1 + 0.55 * (1 - q.f), 0.4 + 0.55 * (1 - q.f), st.feed);
      const onAxis = 1 - smoothstep(ENGULF_R * 0.6, ENGULF_R * 1.5, Math.hypot(q.y * 4.8, q.z * 5.2 * 0.9));
      const suck = onAxis * eaten;
      const spread = 1 + st.scatter * (1.4 + q.r);
      const lx = (q.x + 0.06 * Math.sin(time * 0.05 + j * 1.7)) * st.rx * spread;
      const ly = (q.y + 0.06 * Math.cos(time * 0.04 + j * 2.3)) * st.ry * spread;
      let wx = st.x + lx * ch - ly * shd;
      let wy = st.y + lx * shd + ly * ch;
      let wz = z;
      let rot = st.heading + 0.25 * Math.sin(time * 0.02 + j);
      if (suck > 0.001) {
        const e = suck * suck;
        rot = lerp(rot, Math.atan2(this.mouth.y - wy, this.mouth.x - wx), Math.min(1, suck * 2));
        wx = lerp(wx, this.mouth.x, e);
        wy = lerp(wy, this.mouth.y, e);
        wz = lerp(wz, this.mouth.z, e);
      }
      if (!cam.project(wx, wy, wz, P)) continue;
      const fog = clamp(1 - Math.exp(-Math.max(0, wz - cam.cz - cam.dist * 0.6) / Math.max(10, rc.light.vis)));
      const a = base * (1 - eaten * lerp(0.45, 1, onAxis)) * (1 - fog) * 0.7;
      if (a < 0.01) continue;
      const shrink = 1 - 0.8 * suck;
      const rx = st.rx * q.r * spread * P.s * shrink * (1 + 0.5 * suck);
      const ry = st.ry * q.r * spread * P.s * shrink;
      const tex = texs[j % texs.length];
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const kx = ((2 * rx) / tex.width) * dpr;
      const ky = ((2 * ry) / tex.height) * dpr;
      ctx.setTransform(c * kx, s * kx, -s * ky, c * ky, P.x * dpr, P.y * dpr);
      ctx.globalAlpha = a;
      ctx.drawImage(tex, -tex.width / 2, -tex.height / 2);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawHaze(rc: RenderCtx, light: number): void {
    const st = this.state!;
    const { ctx, cam, dpr } = rc;
    const P = { x: 0, y: 0, s: 0 };
    if (!cam.project(st.x, st.y, st.z + st.rz * 0.5, P)) return;
    const k = st.visible * (0.35 + 0.65 * st.agg) * (1 - st.feed * 0.6) * (1 - st.scatter * 0.7);
    if (k < 0.02) return;
    const rx = st.rx * P.s * 1.25;
    const ry = st.ry * P.s * 1.3;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(st.heading);
    ctx.scale(1, ry / Math.max(1, rx));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    const a = 0.38 * k * Math.min(1, light);
    g.addColorStop(0, `rgba(240,112,62,${a})`);
    g.addColorStop(0.55, `rgba(226,92,52,${a * 0.45})`);
    g.addColorStop(1, 'rgba(210,80,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
