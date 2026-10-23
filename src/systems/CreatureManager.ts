import { makeShade } from '../core/color';
import { rng, smoothstep } from '../core/math';
import type { Projected } from '../core/Camera';
import type { RenderCtx } from '../core/types';
import { QUALITY, type QualitySettings } from '../config/performance';
import { WORLD } from '../config/stages';
import type { EcoState } from './StoryTimeline';
import { DESCENT_START, DescentMotion } from './DescentMotion';
import { Creature, type CreatureEnv } from '../entities/creatures/base';
import { Atolla, CombJelly, Dumbo, FishSchool, LanternfishGroup, Siphonophore } from '../entities/creatures/midwater';
import { AmphipodSwarm, Crab, Grenadier, Hagfish, SleeperShark } from '../entities/creatures/scavengers';
import { BrittleStar, ClamCluster, Polychaete, SeaPig, Snail, SquatLobster } from '../entities/creatures/benthos';
import { Anglerfish, GlowJelly } from '../entities/creatures/specials';

/**
 * CreatureManager：管理所有深海生物的出现、行为更新、分层绘制与点击命中。
 *
 * - 叙事模式：出现与否由 StoryTimeline 给出的生态状态驱动，数量随进度平滑增减；
 * - 自由探索：显示鲸骨阶段的完整群落，以及两个隐藏发现；
 * - 中层水域生物固定在各自的深度，只在相机经过时更新与绘制；
 * - 叙事下沉途中，深度被艺术化压缩：少数“相遇”的生物锚定在水体参照系中，随鲸鱼的可见下沉
 *   缓慢地从身边经过；其余中层生物在这段时间隐去，让深海越来越空旷。
 */

export type CreatureMode = 'story' | 'explore';

export interface CreatureUpdate {
  mode: CreatureMode;
  /** 叙事进度（story 模式） */
  p: number;
  eco: EcoState;
  /** 相机深度（米） */
  camY: number;
  /** 已按生态时间缩放的秒数（暂停时为 0） */
  dt: number;
  /** 氛围时钟（秒） */
  time: number;
  reduced?: boolean;
}

export interface Special {
  id: 'hidden-anglerfish' | 'hidden-glow';
  x: number;
  y: number;
  z: number;
}

export interface Hit {
  info: string;
  target: { x: number; y: number; z: number };
}

interface NearestDist {
  nearestDist(rc: RenderCtx, sx: number, sy: number): number;
}

const P: Projected = { x: 0, y: 0, s: 0 };
const MID_CULL = 171;
/** 相遇的生物在水体参照系中的最小间隔（米）：越深越稀疏 */
const ENCOUNTER_GAP = (wy: number) => 15.4 + 8.6 * smoothstep(42.9, 94.3, wy);
/** 第一次相遇至少在鲸鱼开始下沉的位置以下这么远（米），停止游动与失去平衡时画面里只有鲸鱼 */
const ENCOUNTER_CLEAR = 20.6;
/** 中层生物只在光线明显变暗之后才从幽暗中显现（进度） */
const EMERGE: readonly [number, number] = [0.35, 0.362];

export class CreatureManager {
  private all: Creature[] = [];
  private readonly drawList: Creature[] = [];
  private readonly sh = makeShade();
  private density = -1;
  private mode: CreatureMode = 'story';
  private descent: DescentMotion | null = null;
  private planned = false;
  private storyP = -1;
  private readonly shift = { x: 0, y: 0 };
  private anglerfish: Anglerfish | null = null;
  private glowJelly: GlowJelly | null = null;
  private readonly specialOut: Special[] = [
    { id: 'hidden-anglerfish', x: 0, y: 0, z: 0 },
    { id: 'hidden-glow', x: 0, y: 0, z: 0 },
  ];
  private readonly env: CreatureEnv = {
    mode: 'story',
    p: 0,
    eco: { scav: 0, amph: 0, crabs: 0, enrich: 0, sulfo: 0, dwellers: 0 },
    camY: 0,
    time: 0,
    reduced: false,
  };

  constructor() {
    this.setQuality(QUALITY[1]);
  }

  setQuality(q: QualitySettings): void {
    if (Math.abs(q.creatureDensity - this.density) < 1e-3) return;
    this.density = q.creatureDensity;
    this.build(q.creatureDensity);
  }

  /** 当前存在的生物数量（调试用）。 */
  get activeCount(): number {
    let n = 0;
    for (const c of this.all) if (c.active) n++;
    return n;
  }

  private build(d: number): void {
    const r = rng(20241021);
    const X = WORLD.restX;
    const S = WORLD.seabedY;
    const n = (k: number) => Math.max(1, Math.round(k * d));
    const list: Creature[] = [];
    let seed = 1;

    // ---------------- 中层水域
    // 开场的鱼群：随开场构图绕锚点 (0, 60) 放大；第二群略深一些，不进入海面呼吸的镜头
    list.push(new FishSchool(seed++, n(46), -13.7, 46.3, 102.9, 44.6, 0.3));
    list.push(new FishSchool(seed++, n(40), 44.6, 26, 20.6, 27.4));
    list.push(new FishSchool(seed++, n(50), 54.9, 149.1, 8.6, 34.3));
    const lanternY = [280, 430, 560, 700, 840];
    // 分布在下沉路线（x≈51）附近、从近景到远景的不同深度，部分会从镜头前经过
    const midX = () => X + (r() - 0.5) * 41.1;
    const midZ = () => -24 + r() * 48;
    lanternY.forEach((y) => list.push(new LanternfishGroup(seed++, n(9), midX(), y, midZ())));
    [220, 380, 520, 650, 800, 950].forEach((y) => list.push(new CombJelly(seed++, midX(), y, midZ())));
    [640, 880, 1100, 1350, 1560].forEach((y) => list.push(new Atolla(seed++, midX(), y, midZ())));
    [760, 1000, 1250].forEach((y) => list.push(new Siphonophore(seed++, midX(), y, 3.4 + r() * 24, 4 + r() * 2)));
    // “特写”个体：在下沉/上升途中从镜头前近距离经过
    const nearX = () => X + (r() - 0.5) * 15.4;
    list.push(new CombJelly(seed++, nearX(), 330, -32.6));
    list.push(new LanternfishGroup(seed++, n(7), nearX(), 610, -29.1));
    list.push(new Atolla(seed++, nearX(), 1020, -34.3));
    list.push(new Siphonophore(seed++, nearX(), 1300, -22.3, 5));
    list.push(new Atolla(seed++, nearX(), 1480, -30.9));

    // ---------------- 鲸落周边
    list.push(new Atolla(seed++, X - 17.1, S - 15.4, 10.3, true));
    list.push(new Atolla(seed++, X + 20.6, S - 22.3, 20.6, true));
    list.push(new Dumbo(seed++, X - 25.7, S - 6.9, 15.4));
    list.push(new Dumbo(seed++, X + 32.6, S - 10.3, 27.4));

    const hag = n(12);
    for (let i = 0; i < hag; i++) list.push(new Hagfish(seed++, ((i + 0.5) / hag) * 0.9));
    list.push(new SleeperShark(seed++));
    list.push(new Grenadier(seed++, 0.05, X - 12, -4.3));
    list.push(new Grenadier(seed++, 0.3, X + 17.1, 15.4));
    list.push(new Grenadier(seed++, 0.6, X - 25.7, -6));
    list.push(new AmphipodSwarm(seed++, n(300)));

    const crabX = [-18.9, -8.6, 5.1, 13.7, 22.3, -25.7];
    const crabZ = [-2.6, -4.3, -2.1, -5.1, 15.4, 17.1];
    const crabs = n(6);
    for (let i = 0; i < crabs; i++) list.push(new Crab(seed++, 0.05 + (i / crabs) * 0.8, X + crabX[i % 6], crabZ[i % 6]));

    const worms = n(22);
    for (let i = 0; i < worms; i++) {
      const x = X - 20.6 + r() * 37.7;
      let z = -6.9 + r() * 17.1;
      if (z > 0.5 && Math.abs(x - X) < 15.4) z = -0.5 - r() * 6;
      list.push(new Polychaete(seed++, (i / worms) * 0.85, x, z));
    }
    const clams = n(10);
    for (let i = 0; i < clams; i++) {
      const behind = i % 4 === 3;
      list.push(new ClamCluster(seed++, (i / clams) * 0.6, X - 17.1 + r() * 30.9, behind ? 13.7 + r() * 2.6 : -1.2 - r() * 3.1));
    }
    const snails = n(8);
    for (let i = 0; i < snails; i++) {
      if (i < Math.ceil(snails * 0.6)) {
        const x0 = X - 12 + r() * 15.4;
        list.push(new Snail(seed++, 0, x0, x0 + 0.8 + r() * 1.5, -0.35, true));
      } else {
        const x0 = X - 15.4 + r() * 27.4;
        list.push(new Snail(seed++, 0, x0, x0 + 1.2, -1.7 - r() * 1.7, false));
      }
    }
    const squats = n(7);
    for (let i = 0; i < squats; i++) {
      const onBone = i < Math.ceil(squats * 0.6);
      list.push(new SquatLobster(seed++, 0, onBone ? X - 10.3 + r() * 17.1 : X - 15.4 + r() * 29.1, onBone ? -0.4 : -2.1 - r() * 1.7, onBone));
    }
    const pigs = n(4);
    for (let i = 0; i < pigs; i++) {
      const side = i % 2 ? 1 : -1;
      list.push(new SeaPig(seed++, (i / pigs) * 0.7, X + side * (17.1 + r() * 13.7), i % 3 === 2 ? 17.1 + r() * 3.4 : -5.1 - r() * 3.4));
    }
    const stars = n(8);
    for (let i = 0; i < stars; i++) {
      const side = i % 2 ? 1 : -1;
      list.push(new BrittleStar(seed++, (i / stars) * 0.8, X + side * (6.9 + r() * 20.6), i % 3 === 0 ? 13.7 + r() * 5.1 : -1.7 - r() * 6.9));
    }

    // ---------------- 隐藏发现（只在自由探索出现）
    this.anglerfish = new Anglerfish(seed++);
    this.glowJelly = new GlowJelly(seed++);
    list.push(this.anglerfish, this.glowJelly);

    for (const c of list) if (c.midwater) c.homeY = c.y;
    this.all = list;
    this.planned = false;
  }

  /** 叙事下沉的动作表（用于把途中的生物锚定在水体参照系中）。 */
  setDescent(d: DescentMotion): void {
    if (this.descent === d) return;
    this.descent = d;
    this.planned = false;
  }

  /** 选出下沉途中与鲸鱼相遇的少数生物：按水体中的位置排序，保持足够的间隔。 */
  private plan(): void {
    this.planned = true;
    const d = this.descent;
    const cands: Creature[] = [];
    for (const c of this.all) {
      c.encounter = false;
      c.water = null;
      if (!c.midwater || !d) continue;
      c.water = d.anchorFor(c.homeY);
      if (c.water) cands.push(c);
    }
    cands.sort((a, b) => a.water!.wy - b.water!.wy);
    const start = d ? d.waterDepth(DESCENT_START) + ENCOUNTER_CLEAR : 0;
    let last = -1e9;
    let lastKind: unknown = null;
    for (const c of cands) {
      const wy = c.water!.wy;
      if (wy < start || wy - last < ENCOUNTER_GAP(wy) || c.constructor === lastKind) continue;
      c.encounter = true;
      last = wy;
      lastKind = c.constructor;
    }
  }

  /** 下沉途中，未被选为相遇的中层生物的隐去程度 */
  private veilAt(p: number): number {
    return DescentMotion.covers(p) ? smoothstep(DESCENT_START, 0.33, p) : 0;
  }

  /** 下沉途中中层生物的可见度：相遇的生物在光线变暗后浮现，其余隐去 */
  private descentAlpha(c: Creature, p: number): number {
    if (!c.midwater || !DescentMotion.covers(p)) return 1;
    return c.encounter ? smoothstep(EMERGE[0], EMERGE[1], p) : 1 - this.veilAt(p);
  }

  /** 计算本帧的水体偏移，写入 c.shiftX / shiftY */
  private place(c: Creature, story: boolean): void {
    c.shiftX = c.shiftY = 0;
    if (!story || !c.water || !this.descent) return;
    this.descent.shiftFor(c.water, this.storyP, this.shift);
    c.shiftX = this.shift.x;
    c.shiftY = this.shift.y;
  }

  private get inDescent(): boolean {
    return this.mode === 'story' && this.descent !== null && DescentMotion.covers(this.storyP);
  }

  update(u: CreatureUpdate): void {
    const env = this.env;
    env.mode = u.mode;
    env.p = u.p;
    env.eco = u.eco;
    env.camY = u.camY;
    env.time = u.time;
    env.reduced = !!u.reduced;
    this.mode = u.mode;
    this.storyP = u.mode === 'story' ? u.p : -1;
    const story = this.inDescent;
    if (story && !this.planned) this.plan();
    const dt = Math.max(0, Math.min(u.dt, 0.5));
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 30))));
    const h = dt / steps;
    for (const c of this.all) {
      c.updatePresence(dt, env);
      if (!c.active || dt <= 0) continue;
      if (c.midwater) {
        this.place(c, story);
        if (Math.abs(c.y + c.shiftY - u.camY) > MID_CULL) continue;
      }
      for (let i = 0; i < steps; i++) {
        c.clock += h;
        c.step(h, env);
      }
    }
  }

  drawLayer(rc: RenderCtx, zMin: number, zMax: number): void {
    const list = this.drawList;
    list.length = 0;
    const cam = rc.cam;
    const story = this.inDescent;
    for (const c of this.all) {
      if (!c.active || c.alpha <= 0.003) continue;
      if (c.z < zMin || c.z >= zMax) continue;
      if (c.midwater) {
        if (story && this.descentAlpha(c, this.storyP) <= 0.001) continue;
        this.place(c, story);
        if (Math.abs(c.y + c.shiftY - cam.cy) > MID_CULL) continue;
      } else {
        c.shiftX = c.shiftY = 0;
      }
      if (!cam.project(c.x + c.shiftX, c.y + c.shiftY, c.z, P)) continue;
      const r = (Math.max(c.size, c.radius) * 1.2 + (c.custom ? 6 : 0)) * P.s + 24;
      if (P.x + r < 0 || P.x - r > rc.w || P.y + r < 0 || P.y - r > rc.h) continue;
      list.push(c);
    }
    if (list.length === 0) return;
    list.sort((a, b) => b.z - a.z);
    const ctx = rc.ctx;
    for (const c of list) {
      if (c instanceof GlowJelly) c.updateVisibility(rc);
      const a = c.alpha * c.extraAlpha * (story ? this.descentAlpha(c, this.storyP) : 1);
      if (a <= 0.003) continue;
      rc.light.shadeAt(c.x, c.y, c.z, this.sh);
      ctx.globalAlpha = a;
      // 随水体漂移：以平移镜头的方式绘制，生物自身的形状与动画不受影响
      const sx = c.shiftX;
      const sy = c.shiftY;
      if (sx !== 0 || sy !== 0) {
        cam.cx -= sx;
        cam.cy -= sy;
      }
      if (c.custom) {
        c.drawCustom(rc, this.sh);
      } else {
        const scale = c.beginLocal(rc);
        c.render(ctx, rc, scale, this.sh);
      }
      if (sx !== 0 || sy !== 0) {
        cam.cx += sx;
        cam.cy += sy;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  hitTest(rc: RenderCtx, sx: number, sy: number): Hit | null {
    let best: Creature | null = null;
    let bestScore = 1e9;
    const cam = rc.cam;
    for (const c of this.all) {
      if (!c.active || c.alpha * c.extraAlpha < 0.25) continue;
      if (c.midwater && Math.abs(c.y - cam.cy) > MID_CULL) continue;
      let score: number;
      const nd = (c as unknown as Partial<NearestDist>).nearestDist;
      if (typeof nd === 'function') {
        const d = nd.call(c, rc, sx, sy);
        if (d > 22) continue;
        score = d / 22 + 0.2;
      } else {
        if (!cam.project(c.x, c.y - c.size * 0.3, c.z, P)) continue;
        const r = Math.max(18, c.radius * P.s);
        const d = Math.hypot(P.x - sx, P.y - sy);
        if (d > r) continue;
        score = d / r;
      }
      // 同等距离时优先更靠近镜头的生物
      score += (c.z - cam.cz) * 0.0005;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) return null;
    return { info: best.info, target: best.hitPoint(rc, sx, sy) };
  }

  specials(): Special[] {
    if (this.mode !== 'explore' || !this.anglerfish || !this.glowJelly) return [];
    const a = this.specialOut[0];
    a.x = this.anglerfish.x;
    a.y = this.anglerfish.y;
    a.z = this.anglerfish.z;
    const g = this.specialOut[1];
    g.x = this.glowJelly.x;
    g.y = this.glowJelly.y;
    g.z = this.glowJelly.z;
    return this.specialOut;
  }
}
