import { describe, expect, it } from 'vitest';
import { makeWhaleState } from '../src/entities/Whale';
import { StoryTimeline } from '../src/systems/StoryTimeline';
import { lineageAt, lineageSeconds, SWIM_END, SWIM_START } from '../src/systems/SwimMotion';

const tl = new StoryTimeline();
const w = makeWhaleState();
const whale = (u: number) => ({ ...tl.whaleAt(u, w) });

/** 以故事时间（秒）为步长采样谱系 */
function sweep(t0: number, t1: number, dt = 1 / 20): Array<{ t: number; u: number }> {
  const out: Array<{ t: number; u: number }> = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) out.push({ t, u: lineageAt(t) });
  return out;
}

/** 侧视平面内的速度（m/s）与水平面内的总速度 */
function velocity(u: number, dt = 0.05) {
  const t = lineageSeconds(u);
  const a = whale(lineageAt(t - dt / 2));
  const b = whale(lineageAt(t + dt / 2));
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, vz: (b.z - a.z) / dt, om: (b.pitch - a.pitch) / dt };
}

const OPEN_END = lineageSeconds(0.075);

describe('swimming: rhythm of the tail', () => {
  it('alternates slow powerful strokes with short glides', () => {
    const amps = sweep(0, OPEN_END).map(({ u }) => whale(u).swim);
    expect(Math.max(...amps)).toBeGreaterThan(0.95);
    // 仰拍时，身体静静地从上方滑过
    for (const t of [12, 13, 14]) expect(whale(lineageAt(t)).swim, `t=${t}`).toBeLessThan(0.3);
    // 侧面跟拍里能看到一次完整有力的拍尾
    for (const t of [6, 7, 8, 9]) expect(whale(lineageAt(t)).swim, `t=${t}`).toBeGreaterThan(0.9);
  });

  it('beats slowly, like the slowest of the rorquals, and never mechanically evenly', () => {
    const freqs: number[] = [];
    for (const { u } of sweep(-30, 40, 0.5)) {
      const e = 0.05;
      const t = lineageSeconds(u);
      const f = (whale(lineageAt(t + e)).phase - whale(lineageAt(t - e)).phase) / (2 * e) / (2 * Math.PI);
      freqs.push(f);
      expect(f).toBeGreaterThan(0.12);
      expect(f).toBeLessThan(0.24);
    }
    expect(Math.max(...freqs) - Math.min(...freqs)).toBeGreaterThan(0.04);
  });

  it('strokes harder before the lunge, then glides with the mouth open', () => {
    expect(whale(0.0715).swim).toBeGreaterThan(1);
    for (let u = 0.084; u <= 0.096; u += 0.002) {
      const s = whale(u);
      expect(s.mouth).toBeGreaterThan(0.5);
      expect(s.swim).toBeLessThan(0.2);
    }
  });

  it('the stroke phase is the same for both whales at the loop seam', () => {
    const end = { ...tl.evaluate(1 - 1e-7, -0.05).whale2 };
    const start = { ...tl.evaluate(0, -0.05).whale1 };
    expect(Math.abs(end.phase - start.phase)).toBeLessThan(1e-3);
  });
});

describe('swimming: weight and inertia', () => {
  it('speed changes smoothly in time (no jumps at shot boundaries)', () => {
    // 冲刺滤食时张开的大嘴让身体以约 0.5 m/s² 减速，这是最急的变化；镜头段边界处没有速度突变
    let prev = velocity(lineageAt(-30));
    for (const { u } of sweep(-30, 44, 0.1).slice(1)) {
      const v = velocity(u);
      const acc = Math.hypot(v.vx - prev.vx, v.vy - prev.vy) / 0.1;
      expect(acc, `u=${u.toFixed(4)}`).toBeLessThan(0.6);
      prev = v;
    }
  });

  it('is not a constant-speed glide: it slows while gliding and surges after strokes', () => {
    // 仰拍中的滑行：速度持续下降
    const a = velocity(lineageAt(11.5)).vx;
    const b = velocity(lineageAt(14.5)).vx;
    expect(b).toBeLessThan(a - 0.15);
    // 冲刺：张嘴前加速，张嘴后迅速减速
    const before = velocity(lineageAt(21)).vx;
    const lunge = velocity(lineageAt(25)).vx;
    const engulf = velocity(lineageAt(31)).vx;
    expect(lunge).toBeGreaterThan(before + 0.4);
    expect(engulf).toBeLessThan(lunge * 0.6);
  });

  it('the body points where it is going (no sideways sliding), turning gently', () => {
    for (const { u } of sweep(0, lineageSeconds(0.095), 0.25)) {
      const v = velocity(u);
      const path = Math.atan2(v.vy, Math.hypot(v.vx, v.vz));
      expect(Math.abs(whale(u).pitch - path), `u=${u.toFixed(4)}`).toBeLessThan(0.07);
      expect(Math.abs(v.om), `u=${u.toFixed(4)}`).toBeLessThan(0.07);
    }
  });

  it('adjusts its depth: holds, dives gently, then levels out in front of the krill', () => {
    const pitch = (t: number) => whale(lineageAt(t)).pitch;
    expect(pitch(3)).toBeLessThan(0.08);
    expect(pitch(16)).toBeGreaterThan(0.15);
    expect(pitch(16)).toBeLessThan(0.26);
    expect(Math.abs(pitch(26))).toBeLessThan(0.05);
  });
});

describe('swimming: fins, passive layers, camera and water', () => {
  it('the pectoral fins adjust their angle and spread a little in glides', () => {
    const fins = sweep(-30, OPEN_END).map(({ u }) => whale(u).fin);
    expect(Math.max(...fins) - Math.min(...fins)).toBeGreaterThan(0.08);
    for (const f of fins) expect(Math.abs(f)).toBeLessThan(0.2);
    expect(whale(lineageAt(13)).fin).toBeGreaterThan(whale(lineageAt(8)).fin + 0.05);
  });

  it('the fins rest in the painted pose whenever the mouth or throat is open', () => {
    for (let u = 0.073; u < SWIM_END; u += 0.001) {
      const s = whale(u);
      if (s.mouth > 0.001 || s.throat > 0.001) expect(s.fin).toBe(0);
    }
  });

  it('the camera follows with a little mass, and hands over without a jump', () => {
    let worst = 0;
    for (let p = 0; p < SWIM_END; p += 0.0005) worst = Math.max(worst, Math.hypot(tl.evaluate(p, -0.05).cam.lagX, tl.evaluate(p, -0.05).cam.lagY));
    expect(worst).toBeGreaterThan(0.2);
    expect(worst).toBeLessThan(1.2);
    const f = tl.evaluate(SWIM_END - 1e-4, -0.05).cam;
    expect(Math.hypot(f.lagX, f.lagY)).toBeLessThan(1e-3);
  });

  it('the body pushes the water aside while it swims close to the camera plane', () => {
    const f = tl.evaluate(0.04, -0.05);
    expect(f.water.wake).toBeGreaterThan(0.5);
    expect(f.water.flowX).toBeGreaterThan(2.5);
    // 远处（尚未游近）时不扰动颗粒
    expect(tl.evaluate(0.001, -0.05).water.wake).toBeLessThan(0.05);
  });

  it('hands back to the keyframed surfacing without a jump', () => {
    const e = 1e-7;
    const a = whale(SWIM_END - e);
    const b = whale(SWIM_END + e);
    for (const k of ['x', 'y', 'z', 'pitch', 'swim', 'fin', 'flex', 'nod'] as const) {
      expect(Math.abs(a[k] - b[k]), k).toBeLessThan(0.01);
    }
    expect(Math.abs(whale(SWIM_START + 1e-6).x - whale(SWIM_START).x)).toBeLessThan(0.01);
  });
});
