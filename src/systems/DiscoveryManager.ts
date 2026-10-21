import type { RenderCtx } from '../core/types';
import { storage, type ExploreRecord } from '../core/storage';
import { DISCOVERIES, type DiscoveryDef } from '../config/discoveries';
import { HIDE_ROCK } from '../config/scene';
import { WORLD } from '../config/stages';
import { NARES } from '../entities/WhaleSkeleton';
import type { World } from '../scenes/World';

/**
 * DiscoveryManager：可交互对象的观察记录与隐藏发现。
 * 隐藏发现在满足自然的观察条件（角度、距离、放大倍率）时触发，不使用箭头或任务标记。
 */
export class DiscoveryManager {
  readonly record: ExploreRecord;
  private readonly P = { x: 0, y: 0, s: 0 };
  private readonly W = { x: 0, y: 0 };
  private dwell = new Map<string, number>();

  constructor(private readonly onFound: (d: DiscoveryDef) => void) {
    this.record = storage.record();
  }

  get total(): number {
    return DISCOVERIES.length;
  }

  get found(): number {
    return this.record.discovered.length;
  }

  has(id: string): boolean {
    return this.record.discovered.includes(id);
  }

  unlockExplore(): void {
    if (!this.record.unlocked) {
      this.record.unlocked = true;
      this.save();
    }
  }

  observe(info: string): void {
    if (!this.record.observed.includes(info)) {
      this.record.observed.push(info);
      this.save();
    }
  }

  discover(id: string): void {
    if (this.has(id)) return;
    const d = DISCOVERIES.find((x) => x.id === id);
    if (!d) return;
    this.record.discovered.push(id);
    this.save();
    this.onFound(d);
  }

  reset(): void {
    this.record.discovered.length = 0;
    this.record.observed.length = 0;
    this.save();
  }

  private save(): void {
    storage.saveRecord(this.record);
  }

  /** 条件需要持续满足一小段时间，避免一闪而过的误触发。 */
  private hold(id: string, ok: boolean, dt: number, need = 0.6): void {
    if (this.has(id)) return;
    const t = ok ? (this.dwell.get(id) ?? 0) + dt : 0;
    this.dwell.set(id, t);
    if (t >= need) this.discover(id);
  }

  private onScreen(rc: RenderCtx, x: number, y: number, z: number, inset: number): boolean {
    if (!rc.cam.project(x, y, z, this.P)) return false;
    const mx = rc.w * inset;
    const my = rc.h * inset;
    return this.P.x > mx && this.P.x < rc.w - mx && this.P.y > my && this.P.y < rc.h - my;
  }

  update(rc: RenderCtx, world: World, frameH: number, dt: number): void {
    const cam = rc.cam;
    for (const s of world.creatures.specials()) {
      if (s.id === 'hidden-anglerfish') {
        let ok = frameH < 24 && this.onScreen(rc, s.x, s.y, s.z, 0.08);
        if (ok) {
          // 没有被前景岩石遮挡
          const fx = this.P.x;
          const fy = this.P.y;
          cam.project(HIDE_ROCK.x, WORLD.seabedY, HIDE_ROCK.z, this.P);
          const half = HIDE_ROCK.w * 0.42 * this.P.s;
          const top = this.P.y - HIDE_ROCK.h * 0.85 * this.P.s;
          ok = Math.abs(fx - this.P.x) > half || fy < top;
        }
        this.hold(s.id, ok, dt);
      } else if (s.id === 'hidden-glow') {
        this.hold(s.id, frameH < 20 && this.onScreen(rc, s.x, s.y, s.z, 0.22), dt, 0.8);
      }
    }
    const w = world.whale1;
    if (!this.has('hidden-amphipod') && w.state.tissue < 0.1) {
      w.skeleton.skullToWorld(NARES.x, NARES.y, w.body, w.state, this.W);
      this.hold('hidden-amphipod', frameH < 3.2 && this.onScreen(rc, this.W.x, this.W.y, w.state.z, 0.2), dt, 0.8);
    }
    if (!this.has('hidden-texture') && frameH < 1.25) {
      const bone = w.skeleton.hitTest(rc, w.body, w.state, w.finAngle, rc.w / 2, rc.h / 2);
      this.hold('hidden-texture', !!bone, dt, 1);
    }
  }
}
