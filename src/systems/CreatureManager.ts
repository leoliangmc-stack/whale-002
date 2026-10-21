import { makeShade } from '../core/color';
import { rng } from '../core/math';
import type { Projected } from '../core/Camera';
import type { RenderCtx } from '../core/types';
import { QUALITY, type QualitySettings } from '../config/performance';
import { WORLD } from '../config/stages';
import type { EcoState } from './StoryTimeline';
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
 * - 中层水域生物固定在各自的深度，只在相机经过时更新与绘制。
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
const MID_CULL = 100;

export class CreatureManager {
  private all: Creature[] = [];
  private readonly drawList: Creature[] = [];
  private readonly sh = makeShade();
  private density = -1;
  private mode: CreatureMode = 'story';
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
    list.push(new FishSchool(seed++, n(46), -8, 52, 60, 26, 0.3));
    list.push(new FishSchool(seed++, n(40), 26, 34, 12, 16));
    list.push(new FishSchool(seed++, n(50), 32, 112, 5, 20));
    const lanternY = [280, 430, 560, 700, 840];
    // 分布在下沉路线（x≈30）附近、从近景到远景的不同深度，部分会从镜头前经过
    const midX = () => 30 + (r() - 0.5) * 24;
    const midZ = () => -14 + r() * 28;
    lanternY.forEach((y) => list.push(new LanternfishGroup(seed++, n(9), midX(), y, midZ())));
    [220, 380, 520, 650, 800, 950].forEach((y) => list.push(new CombJelly(seed++, midX(), y, midZ())));
    [640, 880, 1100, 1350, 1560].forEach((y) => list.push(new Atolla(seed++, midX(), y, midZ())));
    [760, 1000, 1250].forEach((y) => list.push(new Siphonophore(seed++, midX(), y, 2 + r() * 14, 4 + r() * 2)));
    // “特写”个体：在下沉/上升途中从镜头前近距离经过
    const nearX = () => 30 + (r() - 0.5) * 9;
    list.push(new CombJelly(seed++, nearX(), 330, -19));
    list.push(new LanternfishGroup(seed++, n(7), nearX(), 610, -17));
    list.push(new Atolla(seed++, nearX(), 1020, -20));
    list.push(new Siphonophore(seed++, nearX(), 1300, -13, 5));
    list.push(new Atolla(seed++, nearX(), 1480, -18));

    // ---------------- 鲸落周边
    list.push(new Atolla(seed++, X - 10, S - 9, 6, true));
    list.push(new Atolla(seed++, X + 12, S - 13, 12, true));
    list.push(new Dumbo(seed++, X - 15, S - 4, 9));
    list.push(new Dumbo(seed++, X + 19, S - 6, 16));

    const hag = n(12);
    for (let i = 0; i < hag; i++) list.push(new Hagfish(seed++, ((i + 0.5) / hag) * 0.9));
    list.push(new SleeperShark(seed++));
    list.push(new Grenadier(seed++, 0.05, X - 7, -2.5));
    list.push(new Grenadier(seed++, 0.3, X + 10, 9));
    list.push(new Grenadier(seed++, 0.6, X - 15, -3.5));
    list.push(new AmphipodSwarm(seed++, n(300)));

    const crabX = [-11, -5, 3, 8, 13, -15];
    const crabZ = [-1.5, -2.5, -1.2, -3, 9, 10];
    const crabs = n(6);
    for (let i = 0; i < crabs; i++) list.push(new Crab(seed++, 0.05 + (i / crabs) * 0.8, X + crabX[i % 6], crabZ[i % 6]));

    const worms = n(22);
    for (let i = 0; i < worms; i++) {
      const x = X - 12 + r() * 22;
      let z = -4 + r() * 10;
      if (z > 0.3 && Math.abs(x - X) < 9) z = -0.3 - r() * 3.5;
      list.push(new Polychaete(seed++, (i / worms) * 0.85, x, z));
    }
    const clams = n(10);
    for (let i = 0; i < clams; i++) {
      const behind = i % 4 === 3;
      list.push(new ClamCluster(seed++, (i / clams) * 0.6, X - 10 + r() * 18, behind ? 8 + r() * 1.5 : -0.7 - r() * 1.8));
    }
    const snails = n(8);
    for (let i = 0; i < snails; i++) {
      if (i < Math.ceil(snails * 0.6)) {
        const x0 = X - 7 + r() * 9;
        list.push(new Snail(seed++, 0, x0, x0 + 0.8 + r() * 1.5, -0.35, true));
      } else {
        const x0 = X - 9 + r() * 16;
        list.push(new Snail(seed++, 0, x0, x0 + 1.2, -1 - r(), false));
      }
    }
    const squats = n(7);
    for (let i = 0; i < squats; i++) {
      const onBone = i < Math.ceil(squats * 0.6);
      list.push(new SquatLobster(seed++, 0, onBone ? X - 6 + r() * 10 : X - 9 + r() * 17, onBone ? -0.4 : -1.2 - r(), onBone));
    }
    const pigs = n(4);
    for (let i = 0; i < pigs; i++) {
      const side = i % 2 ? 1 : -1;
      list.push(new SeaPig(seed++, (i / pigs) * 0.7, X + side * (10 + r() * 8), i % 3 === 2 ? 10 + r() * 2 : -3 - r() * 2));
    }
    const stars = n(8);
    for (let i = 0; i < stars; i++) {
      const side = i % 2 ? 1 : -1;
      list.push(new BrittleStar(seed++, (i / stars) * 0.8, X + side * (4 + r() * 12), i % 3 === 0 ? 8 + r() * 3 : -1 - r() * 4));
    }

    // ---------------- 隐藏发现（只在自由探索出现）
    this.anglerfish = new Anglerfish(seed++);
    this.glowJelly = new GlowJelly(seed++);
    list.push(this.anglerfish, this.glowJelly);

    this.all = list;
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
    const dt = Math.max(0, Math.min(u.dt, 0.5));
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 30))));
    const h = dt / steps;
    for (const c of this.all) {
      c.updatePresence(dt, env);
      if (!c.active || dt <= 0) continue;
      if (c.midwater && Math.abs(c.y - u.camY) > MID_CULL) continue;
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
    for (const c of this.all) {
      if (!c.active || c.alpha <= 0.003) continue;
      if (c.z < zMin || c.z >= zMax) continue;
      if (c.midwater && Math.abs(c.y - cam.cy) > MID_CULL) continue;
      if (!cam.project(c.x, c.y, c.z, P)) continue;
      const r = (Math.max(c.size, c.radius) * 1.2 + (c.custom ? 6 : 0)) * P.s + 24;
      if (P.x + r < 0 || P.x - r > rc.w || P.y + r < 0 || P.y - r > rc.h) continue;
      list.push(c);
    }
    if (list.length === 0) return;
    list.sort((a, b) => b.z - a.z);
    const ctx = rc.ctx;
    for (const c of list) {
      if (c instanceof GlowJelly) c.updateVisibility(rc);
      const a = c.alpha * c.extraAlpha;
      if (a <= 0.003) continue;
      rc.light.shadeAt(c.x, c.y, c.z, this.sh);
      ctx.globalAlpha = a;
      if (c.custom) {
        c.drawCustom(rc, this.sh);
      } else {
        const scale = c.beginLocal(rc);
        c.render(ctx, rc, scale, this.sh);
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
