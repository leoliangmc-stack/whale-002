import { makeShade, type Shade } from '../core/color';
import { clamp, hash1, lerp, noise1, smoothstep, TAU } from '../core/math';
import { textures } from '../core/textures';
import type { RenderCtx } from '../core/types';
import type { KrillState } from '../systems/StoryTimeline';

/**
 * 磷虾群。每只磷虾的位置 = 群体中心 + 椭球内的“家位置” × 群体形状 + 个体噪声漂移。
 * 群体参数（中心、形状、聚集度、捕食进度）全部来自叙事时间线，因此倒放时
 * 被吞入的磷虾会自然“回到”群体中；个体的小幅运动使用氛围时钟，彼此不同步。
 */

const MAX = 1200;

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
  private readonly order = new Float32Array(MAX);
  // 每帧结果
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly ang = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly cap = new Float32Array(MAX);
  private count = 0;
  private readonly sh: Shade = makeShade();
  state: KrillState | null = null;
  /** 嘴部位置（世界坐标），由鲸鱼提供 */
  mouth = { x: 0, y: 0, z: 0, open: 0 };
  snout = { x: -999, y: 0 };

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
    }
  }

  update(st: KrillState, time: number, count: number, reduced: boolean): void {
    this.state = st;
    this.count = Math.min(MAX, count);
    if (st.visible <= 0.001) return;
    const n = this.count;
    // 群体朝向：沿 heading 方向拉长
    const ch = Math.cos(st.heading);
    const shd = Math.sin(st.heading);
    const wander = lerp(2.6, 0.55, st.agg) * (reduced ? 0.5 : 1);
    const breathe = 1 + 0.07 * Math.sin(time * 0.31);
    const speedK = reduced ? 0.5 : 1;
    for (let i = 0; i < n; i++) {
      const vis = clamp((st.visible - this.order[i] * 0.98) * 18);
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
      // 躲避鲸鱼吻部
      const sx = x - this.snout.x;
      const sy = y - this.snout.y;
      const sd2 = sx * sx + sy * sy;
      if (sd2 < 30) {
        const sd = Math.sqrt(sd2) + 0.01;
        const push = (1 - sd / 5.5) * 1.6 * (1 - st.feed * 0.5);
        if (push > 0) {
          x += (sx / sd) * push;
          y += (sy / sd) * push;
        }
      }
      // 被吞入：沿水流被吸进张开的嘴
      let c = 0;
      if (st.feed > 0) {
        c = smoothstep(this.eatTh[i], this.eatTh[i] + 0.2, st.feed);
        if (c > 0) {
          const e = c * c * (3 - 2 * c);
          const mx = this.mouth.x + this.hx[i] * 1.1 - 0.4;
          const my = this.mouth.y + this.hy[i] * 0.7;
          x = lerp(x, mx, e);
          y = lerp(y, my, e);
          z = lerp(z, this.mouth.z + this.hz[i] * 0.3, e);
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
    if (!st || st.visible <= 0.001) return;
    const { ctx, cam, dpr } = rc;
    const tex = st.deep > 0.5 ? textures().krillDeep : textures().krill;
    const tw = tex.width;
    const th = tex.height;
    const sh = this.sh;
    rc.light.shadeAt(st.x, st.y, st.z, sh);
    // 磷虾是画面中的重要角色：保证在深海与远景中仍清晰可辨
    const light = Math.max(0.78, Math.min(1.15, sh.light + sh.warm * 0.6 + 0.25));
    // 群体的整体“质量感”：柔和的橙色雾团
    if (layer === 'behind') this.drawHaze(rc, light);
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
        // 远处：小点
        const r = Math.max(0.75, L * 0.45);
        ctx.globalAlpha = alpha * Math.min(1, L * 0.5 + 0.5);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillRect(P.x - r, P.y - r * 0.6, r * 2, r * 1.2);
        dots++;
        continue;
      }
      const ang = this.ang[i];
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const flip = cos < 0 ? -1 : 1;
      const k = (L / tw) * dpr;
      // 头朝运动方向；朝左时垂直翻转以保持背部朝上
      ctx.setTransform(cos * k, sin * k, -sin * k * flip, cos * k * flip, P.x * dpr, P.y * dpr);
      ctx.globalAlpha = alpha * Math.min(1, light + 0.15);
      ctx.drawImage(tex, -tw / 2, -th / 2);
    }
    void dots;
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
    const a = 0.3 * k * Math.min(1, light);
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
