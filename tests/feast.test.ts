import { describe, expect, it } from 'vitest';
import { hagCount, SHARK_BITES, woundSize, WOUNDS } from '../src/config/feast';
import { secondsAt } from '../src/config/stages';
import { feastCounts, sharkMouth } from '../src/systems/Feast';
import { StoryTimeline } from '../src/systems/StoryTimeline';
import { Whale } from '../src/entities/Whale';

const tl = new StoryTimeline();
const whale = new Whale(1);
const P = { x: 0, y: 0 };

/** 鲸落在 p 时：伤口中心的世界坐标与镜头的取景 */
function at(p: number) {
  const f = tl.evaluate(p, 0);
  Object.assign(whale.state, f.whale1);
  whale.prepare();
  const shot = StoryTimeline.shotFrom(f, f.whale1, f.whale1, 16 / 9, { tx: 0, ty: 0, frameH: 0, sx: 0, sy: 0, elev: 0, lat: 0 } as never);
  return { f, shot };
}

function woundWorld(i: number): { x: number; y: number } {
  const w = WOUNDS[i];
  whale.body.point(w.s, w.v, P);
  return whale.toWorld(P.x, P.y, { x: 0, y: 0 });
}

describe('stage 6: scavengers feeding on the carcass on the seabed', () => {
  it('each wound appears only once something bites it, then grows', () => {
    for (const w of WOUNDS) {
      expect(woundSize(w, w.p - 1e-4)).toBe(0);
      expect(woundSize(w, w.p + 1e-3)).toBeGreaterThan(0.1);
      let last = 0;
      for (let u = w.p + 1e-4; u < 0.7; u += 0.002) {
        const k = woundSize(w, u);
        expect(k + 1e-9).toBeGreaterThanOrEqual(last);
        last = k;
      }
      expect(last).toBeGreaterThan(0.7);
    }
  });

  it('a sleeper shark has its mouth on the wound exactly while it is latched on, and is gone otherwise', () => {
    SHARK_BITES.forEach((b, i) => {
      // 咬住之前：从远处游来，伤口还没有出现
      const before = sharkMouth(i, b.p - 0.02);
      expect(Math.hypot(before.dx, before.dy)).toBeGreaterThan(4);
      expect(woundSize(b, b.p - 0.02)).toBe(0);
      // 咬住：嘴在伤口上
      for (let u = b.p + 0.002; u < b.p + 0.015; u += 0.001) {
        const m = sharkMouth(i, u);
        expect(m.latch, `bite ${i} u=${u.toFixed(4)}`).toBeGreaterThan(0.99);
        expect(Math.hypot(m.dx, m.dy), `bite ${i}`).toBeLessThan(0.2);
      }
      // 之后游开、淡入黑暗
      expect(sharkMouth(i, b.p + 0.06).alpha).toBe(0);
    });
    // 撕咬之间睡鲨的移动速度合理（不超过约 2 m/s）
    SHARK_BITES.forEach((b, i) => {
      for (let u = b.p - 0.03; u < b.p + 0.05; u += 0.001) {
        const a = sharkMouth(i, u);
        const c = sharkMouth(i, u + 0.001);
        if (a.alpha < 0.05 || c.alpha < 0.05) continue;
        const v = Math.hypot(c.dx - a.dx, c.dy - a.dy) / (secondsAt(u + 0.001) - secondsAt(u));
        expect(v, `bite ${i} u=${u.toFixed(3)}`).toBeLessThan(2.1);
      }
    });
  });

  it('every bite lands on flesh that is still there (not on a hole already eaten away)', () => {
    SHARK_BITES.forEach((b, i) => {
      for (const u of [b.p, b.p + 0.008, b.p + 0.016]) {
        at(u);
        expect(whale.fleshAt(b.s, b.v), `bite ${i} u=${u}`).toBeGreaterThan(0.9);
      }
    });
    for (const w of WOUNDS) {
      at(w.p + 0.004);
      expect(whale.fleshAt(w.s, w.v), `wound at ${w.p}`).toBeGreaterThan(0.9);
    }
  });

  it('hagfish burrow into the wounds in growing numbers and leave as the soft tissue runs out', () => {
    expect(feastCounts(0.555).hag).toBe(0);
    expect(feastCounts(0.6).hag).toBeGreaterThan(8);
    expect(feastCounts(0.65).hag).toBeGreaterThan(feastCounts(0.6).hag);
    expect(feastCounts(0.71).hag).toBe(0);
    for (const w of WOUNDS) expect(hagCount(w, w.p - 1e-3)).toBe(0);
  });

  it('the camera moves in close on each bite (wound in frame, frame under 11 m)', () => {
    SHARK_BITES.forEach((b, i) => {
      const { shot } = at(b.p + 0.006);
      const w = woundWorld(i);
      expect(shot.frameH, `bite ${i}`).toBeLessThan(i === 2 ? 14 : 10);
      expect(Math.abs(w.x - shot.tx), `bite ${i}`).toBeLessThan(shot.frameH * 0.6);
      expect(Math.abs(w.y - shot.ty), `bite ${i}`).toBeLessThan(shot.frameH * 0.4);
    });
  });
});

describe('stage 7: close-ups of the bones', () => {
  it('stops on several bones in close-up: the tail vertebrae, the ribs and the skull / jaw', () => {
    const xs: number[] = [];
    for (const p of [0.726, 0.754, 0.776]) {
      const { shot, f } = at(p);
      expect(shot.frameH, `p=${p}`).toBeLessThan(7.5);
      // 取景中心贴近海床上的骨骼
      expect(1800 - shot.ty, `p=${p}`).toBeLessThan(3.2);
      xs.push(shot.tx - f.whale1.x);
    }
    // 三处特写依次从尾部移向头部，彼此相隔数米
    expect(xs[1] - xs[0]).toBeGreaterThan(4);
    expect(xs[2] - xs[1]).toBeGreaterThan(4);
    // 特写时食骨蠕虫与细菌席已经长满
    const { f } = at(0.726);
    expect(f.whale1.osedax).toBeGreaterThan(0.85);
    expect(f.whale1.mats).toBeGreaterThan(0.5);
  });
});
