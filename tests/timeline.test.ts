import { describe, expect, it } from 'vitest';
import { CAPTIONS, SEGMENTS, STAGES, WORLD } from '../src/config/stages';
import { makeWhaleState } from '../src/entities/Whale';
import { StoryTimeline, Y_REST, type KrillState } from '../src/systems/StoryTimeline';
import type { ShotParams } from '../src/core/Camera';

const tl = new StoryTimeline();

function shotAt(p: number, comp: number, aspect: number): ShotParams {
  const f = tl.evaluate(p, comp);
  const whale = p < 0.875 ? f.whale1 : f.whale2;
  const out: ShotParams = { tx: 0, ty: 0, frameH: 0, sx: 0, sy: 0, elev: 0, lat: 0 };
  // 眼睛点在测试中用鲸鱼中心近似
  return { ...StoryTimeline.shotFrom(f, whale, whale, aspect, out) };
}

describe('stage configuration', () => {
  it('stages tile [0,1) without gaps', () => {
    expect(STAGES[0].start).toBe(0);
    for (let i = 1; i < STAGES.length; i++) expect(STAGES[i].start).toBeCloseTo(STAGES[i - 1].end);
    expect(STAGES[STAGES.length - 1].end).toBe(1);
  });
  it('autoplay segments tile [0,1) without gaps', () => {
    expect(SEGMENTS[0].from).toBe(0);
    for (let i = 1; i < SEGMENTS.length; i++) expect(SEGMENTS[i].from).toBeCloseTo(SEGMENTS[i - 1].to);
    expect(SEGMENTS[SEGMENTS.length - 1].to).toBe(1);
  });
  it('captions are ordered and inside the cycle', () => {
    for (const c of CAPTIONS) {
      expect(c.from).toBeGreaterThanOrEqual(0);
      expect(c.to).toBeLessThanOrEqual(1);
      expect(c.to).toBeGreaterThan(c.from);
    }
  });
});

describe('seamless loop (p → 1 matches p = 0)', () => {
  for (const [name, comp, aspect] of [
    ['landscape', -0.05, 16 / 9],
    ['portrait', -0.73, 390 / 844],
  ] as const) {
    it(`${name}: new whale at the end equals the opening whale`, () => {
      const end = tl.evaluate(1 - 1e-7, comp);
      const w2 = { ...end.whale2 };
      const start = tl.evaluate(0, comp);
      const w1 = { ...start.whale1 };
      for (const k of ['x', 'y', 'z', 'pitch', 'swim', 'mouth', 'throat', 'eye', 'life', 'tissue'] as const) {
        expect(Math.abs(w2[k] - w1[k]), `whale.${k}`).toBeLessThan(1e-3);
      }
      expect(w2.visible).toBeCloseTo(1, 3);
    });

    it(`${name}: whale velocity matches across the seam`, () => {
      const e = 1e-4;
      const a = tl.evaluate(1 - e, comp).whale2.x;
      const b = { ...tl.evaluate(1 - 2 * e, comp).whale2 }.x;
      const vEnd = (a - b) / e;
      const c = tl.evaluate(e, comp).whale1.x;
      const d = { ...tl.evaluate(2 * e, comp).whale1 }.x;
      const vStart = (d - c) / e;
      expect(Math.abs(vEnd - vStart) / Math.max(1, Math.abs(vStart))).toBeLessThan(0.05);
    });

    it(`${name}: krill swarm equals the opening swarm`, () => {
      const k1: KrillState = { ...tl.evaluate(1 - 1e-6, comp).krill };
      const k0: KrillState = { ...tl.evaluate(0, comp).krill };
      for (const k of ['visible', 'x', 'y', 'z', 'rx', 'ry', 'rz', 'heading', 'agg', 'feed', 'scatter', 'deep'] as const) {
        expect(Math.abs(k1[k] - k0[k]), `krill.${k}`).toBeLessThan(1e-3);
      }
    });

    it(`${name}: camera is continuous across the seam`, () => {
      const s1 = shotAt(1 - 1e-6, comp, aspect);
      const s0 = shotAt(0, comp, aspect);
      for (const k of ['tx', 'ty', 'frameH', 'sx', 'sy', 'elev', 'lat'] as const) {
        expect(Math.abs(s1[k] - s0[k]), `shot.${k}`).toBeLessThan(2e-3);
      }
    });
  }

  it('lighting and environment are continuous across the seam', () => {
    const a = { ...tl.evaluate(1 - 1e-6, -0.05).env };
    const b = { ...tl.evaluate(0, -0.05).env };
    // sediment 在 0 与 1 时都不绘制（沉积物云尚未扬起 / 已完全沉降），因此只比较其余通道
    for (const k of Object.keys(a) as Array<keyof typeof a>) if (k !== 'sediment') expect(Math.abs(a[k] - b[k]), k).toBeLessThan(1e-3);
  });
});

describe('narrative continuity', () => {
  it('camera never jumps between frames anywhere in the cycle', () => {
    const N = 20000;
    let prev = shotAt(0, -0.05, 16 / 9);
    let worst = 0;
    let at = 0;
    for (let i = 1; i <= N; i++) {
      const p = i / N;
      const s = shotAt(p >= 1 ? 0 : p, -0.05, 16 / 9);
      // 单步（1/20000 圈）位移相对于景别的比例
      const d = Math.hypot(s.tx - prev.tx, s.ty - prev.ty) / Math.max(1, s.frameH);
      if (d > worst) {
        worst = d;
        at = p;
      }
      prev = s;
    }
    expect(worst, `largest camera step at p=${at.toFixed(4)}`).toBeLessThan(0.25);
  });

  it('the whale comes to rest on the seabed and decays gradually', () => {
    const f = tl.evaluate(0.52, -0.05);
    expect(f.whale1.y).toBeCloseTo(Y_REST, 1);
    expect(f.whale1.rest).toBeCloseTo(1, 2);
    let prev = 1;
    for (let p = 0.5; p <= 0.75; p += 0.002) {
      const t = tl.evaluate(p, 0).whale1.tissue;
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - t).toBeLessThan(0.05); // 没有突然消失
      prev = t;
    }
    expect(prev).toBeCloseTo(0, 3);
  });

  it('is fully reversible: evaluating out of order gives identical states', () => {
    const ps = [0.9, 0.1, 0.6, 0.3, 0.75, 0.02, 0.45];
    const first = ps.map((p) => JSON.stringify(tl.evaluate(p, -0.05).whale1));
    const again = [...ps].reverse().map((p) => JSON.stringify(tl.evaluate(p, -0.05).whale1)).reverse();
    expect(again).toEqual(first);
  });

  it('the whale lineage stays above the seabed', () => {
    const w = makeWhaleState();
    for (let u = -0.13; u <= 0.88; u += 0.001) {
      tl.whaleAt(u, w);
      expect(w.y).toBeLessThanOrEqual(WORLD.seabedY - 1.5);
    }
  });
});
