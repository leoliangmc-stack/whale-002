import type { ShotParams } from '../core/Camera';
import type { RenderCtx } from '../core/types';
import type { CameraController } from '../controllers/CameraController';
import { WORLD } from '../config/stages';
import type { World } from './World';

export type ZoomLevel = '广角' | '中景' | '近景' | '微观';

export interface ExploreHit {
  info: string;
  target: { x: number; y: number; z: number } | null;
}

/**
 * 模式 B：深海自由探索。复用同一个深海世界：鲸骨、群落与环境保持鲸骨栖息地阶段，
 * 生态演替由 EcologyManager 的生态时钟推进（可暂停 / 加速）。
 */
export class ExploreScene {
  readonly overview = { x: WORLD.restX - 2.57, y: WORLD.seabedY - 7.2, frameH: 39.4 };
  private readonly fakeKrill = { visible: 0, x: 0, y: 0, z: 0, rx: 1, ry: 1, rz: 1, heading: 0, agg: 1, feed: 0, scatter: 0, deep: 0, stray: 0, align: 0, sx: 0, sy: 0, sz: 0 };

  constructor(
    private readonly world: World,
    private readonly camera: CameraController,
  ) {}

  enter(from: ShotParams, portrait: boolean): void {
    const ov = this.overviewFor(portrait);
    this.camera.enterExplore(from, ov);
  }

  overviewFor(portrait: boolean): { x: number; y: number; frameH: number } {
    return portrait ? { x: this.overview.x, y: this.overview.y - 5.14, frameH: 61.7 } : { ...this.overview };
  }

  update(rc: RenderCtx, dt: number): number {
    const { world, camera } = this;
    const edt = world.ecology.tick(dt, true);
    const w1 = world.whale1;
    world.ecology.exploreState(world.timeline, w1.state);
    w1.prepare();
    world.whale2.state.visible = 0;
    camera.updateExplore(dt);
    world.lighting.update(camera.cam, {
      vis: 50,
      focusLight: 0.78,
      focusX: w1.state.x,
      focusY: w1.state.y,
      bioGlow: 0.9,
      rays: 0,
      vignette: 0.45,
    });
    world.krill.update(this.fakeKrill, rc.time, 0, rc.reducedMotion);
    world.seabed.enrich = 1;
    world.seabed.reveal = 1;
    world.seabed.shiftX = world.seabed.shiftY = 0;
    world.particles.wake.amt = 0;
    world.seabed.mats = w1.state.mats;
    world.seabed.focusX = w1.state.x;
    world.feast.update(-1, rc.time, w1);
    world.creatures.update({ mode: 'explore', p: 0.78, eco: world.ecology.eco, camY: camera.cam.cy, dt: edt, time: rc.time, reduced: rc.reducedMotion });
    const r = world.render;
    r.surface = null;
    r.sediment = 0;
    r.breath2 = 0;
    r.bubbles = 0;
    r.snow = world.ecology.rate < 0.05 ? 0.6 : 1;
    r.feeding = null;
    world.particles.update(rc, edt);
    return edt;
  }

  zoomLevel(frameH: number): ZoomLevel {
    if (frameH > 37.7) return '广角';
    if (frameH > 12) return '中景';
    if (frameH > 1.8) return '近景';
    return '微观';
  }

  /** 点击命中：生物优先，其次鲸骨，再次岩石与海底。 */
  hitTest(rc: RenderCtx, sx: number, sy: number): ExploreHit | null {
    const { world } = this;
    const c = world.creatures.hitTest(rc, sx, sy);
    if (c) return { info: c.info, target: c.target };
    const w = world.whale1;
    const bone = w.skeleton.hitTest(rc, w.body, w.state, w.finPose, sx, sy);
    if (bone) {
      const info = bone === 'chevron' ? 'vertebra' : bone === 'scapula' ? 'flipper' : bone;
      return { info, target: null };
    }
    if (world.seabed.hitRock(rc, sx, sy)) return { info: 'rock', target: null };
    // 空旷的水中：介绍漂浮的“海洋雪”
    const P = { x: 0, y: 0 };
    rc.cam.unproject(sx, sy, 0, P);
    if (P.y < WORLD.seabedY - 5.1) return { info: 'marineSnow', target: null };
    return null;
  }
}
