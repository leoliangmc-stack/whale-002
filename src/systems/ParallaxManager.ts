import type { RenderCtx } from '../core/types';
import { WORLD } from '../config/stages';
import type { World } from '../scenes/World';

/**
 * ParallaxManager：2.5D 分层渲染管线。所有对象都有真实的深度 z，由透视相机统一投影，
 * 因此各层天然以不同速度移动、形成视差；这里负责按层次组织绘制顺序：
 *
 *   背景层：海水渐变 → 海面天花板 / 天空 → 光束 → 远处山脊 → 远景颗粒与生物
 *   中景层：海床与后方岩石 → 后方磷虾 → 鲸鱼（口腔 → 被吞入的磷虾 → 身体 / 骨骼）→ 中景生物
 *   前景层：沉积物云、水雾、气泡 → 前方磷虾 → 前景岩石与海鳃 → 前景生物 → 近处颗粒
 *   光影层：分屏水线 → 生物发光 → 暗角与调色 → 高空俯视镜头（交叉溶解）
 */
const PROF = typeof location !== 'undefined' && location.search.includes('prof');
export const profile: Record<string, number> = {};
let mark = 0;
function lap(name: string): void {
  if (!PROF) return;
  const t = performance.now();
  profile[name] = (profile[name] ?? 0) * 0.95 + (t - mark) * 0.05;
  mark = t;
}

export class ParallaxManager {
  render(rc: RenderCtx, world: World): void {
    if (PROF) mark = performance.now();
    const { lighting, seabed, surface, particles, creatures, krill, whale1, whale2 } = world;
    const r = world.render;
    const aerialFull = !!r.surface && r.surface.aerial >= 0.999;

    if (!aerialFull) {
      // ---------------- 背景层
      lighting.drawBackground(rc);
      lap('bg');
      surface.drawCeiling(rc);
      const wl = surface.drawSky(rc);
      lighting.drawRays(rc);
      lap('surface+rays');
      seabed.drawFar(rc);
      particles.drawSnow(rc, false, wl ?? -1e9, r.snow);
      creatures.drawLayer(rc, 8, 1e9);
      lap('far');

      // ---------------- 中景层
      seabed.drawGround(rc);
      lap('ground');
      krill.draw(rc, 'behind', 0.5);
      lap('krillBehind');
      const whales = whale2.state.z > whale1.state.z ? [whale2, whale1] : [whale1, whale2];
      for (const w of whales) {
        if (!w.onScreen(rc)) continue;
        w.drawInterior(rc);
        if (r.feeding === w) krill.draw(rc, 'captured');
        w.draw(rc);
      }
      lap('whales');
      creatures.drawLayer(rc, -0.5, 8);
      lap('creaturesMid');

      // ---------------- 前景层
      particles.drawSediment(rc, r.sediment, WORLD.restX, WORLD.seabedY);
      if (r.breath2 > 0 && r.breath2 < 1) {
        const P = { x: 0, y: 0 };
        whale1.blowholePoint(P);
        particles.drawSpout(rc, r.breath2, P.x, Math.min(P.y, 0), whale1.state.z);
      }
      if (r.bubbles > 0.01) {
        const P = { x: 0, y: 0 };
        whale1.blowholePoint(P);
        particles.drawBubbles(rc, P.x, P.y, whale1.state.z - 0.5, r.bubbles);
      }
      lap('particles');
      krill.draw(rc, 'front', 0.5);
      lap('krillFront');
      seabed.drawNear(rc);
      creatures.drawLayer(rc, -1e9, -0.5);
      particles.drawSnow(rc, true, wl ?? -1e9, r.snow);
      lap('near');

      // ---------------- 光影层
      if (wl !== null) surface.drawSplitOverlay(rc, wl, this.whaleBack(rc, world));
      lighting.drawBioSparks(rc);
      lighting.drawGrade(rc);
      lap('grade');
    }
    if (r.surface) {
      const P = { x: 0, y: 0, s: 0 };
      const ok = rc.cam.project(whale1.state.x, whale1.state.y, whale1.state.z, P);
      surface.drawAerial(rc, r.surface, whale1.phase, whale1.state.swim, ok ? P : null);
    }
  }

  /** 分屏镜头中鲸背露出水面的屏幕范围（用于浪花）。 */
  private whaleBack(rc: RenderCtx, world: World): { x0: number; x1: number } | null {
    const w = world.whale1;
    if (w.state.visible <= 0 || w.state.y > 2.2) return null;
    const P = { x: 0, y: 0 };
    const S = { x: 0, y: 0, s: 0 };
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let s = 0.08; s <= 0.75; s += 0.03) {
      w.body.point(s, 1, P);
      const wx = w.state.x + P.x * Math.cos(w.state.pitch) - P.y * Math.sin(w.state.pitch);
      const wy = w.state.y + P.x * Math.sin(w.state.pitch) + P.y * Math.cos(w.state.pitch);
      if (wy > 0.05) continue;
      if (!rc.cam.project(wx, 0, w.state.z, S)) continue;
      x0 = Math.min(x0, S.x);
      x1 = Math.max(x1, S.x);
    }
    return x0 < x1 ? { x0: x0 - 10, x1: x1 + 10 } : null;
  }
}
