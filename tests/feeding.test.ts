import { describe, expect, it } from 'vitest';
import { progressAtSeconds } from '../src/config/stages';
import { Camera, type ShotParams } from '../src/core/Camera';
import { KrillSwarm } from '../src/entities/KrillSwarm';
import { Whale } from '../src/entities/Whale';
import { S_EYE, S_REF, WHALE_LEN } from '../src/entities/WhaleBody';
import { MOUTH_OPEN, StoryTimeline } from '../src/systems/StoryTimeline';
import { PerformanceMonitor } from '../src/systems/PerformanceMonitor';

const tl = new StoryTimeline();
const LANDSCAPE = -0.05;

/** 进度 p 时鲸鱼（参考点）在画面中的位置与镜头景别 */
function onScreen(p: number, w = 1440, h = 900) {
  const f = tl.evaluate(p, LANDSCAPE);
  const whale = { ...f.whale1 };
  const d = (S_REF - S_EYE) * WHALE_LEN;
  const eye = { x: whale.x + d * Math.cos(whale.pitch), y: whale.y + d * Math.sin(whale.pitch) };
  const shot: ShotParams = { tx: 0, ty: 0, frameH: 0, sx: 0, sy: 0, elev: 0, lat: 0 };
  StoryTimeline.shotFrom(f, whale, eye, w / h, shot);
  const cam = new Camera();
  cam.setViewport(w, h);
  cam.setShot(shot);
  const o = { x: 0, y: 0, s: 0 };
  cam.project(whale.x, whale.y, whale.z, o);
  return { x: o.x / w, y: o.y / h, frameH: shot.frameH, fk: f.cam.fk, cam, whale };
}

describe('act 1: a steady camera from the side mid shot to the lunge', () => {
  it('the whale holds its place in the frame instead of bobbing up and down', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 19; t <= 38; t += 0.25) {
      const s = onScreen(progressAtSeconds(t));
      lo = Math.min(lo, s.y);
      hi = Math.max(hi, s.y);
      // 镜头只跟着鲸鱼，不再向虾群来回偏移
      expect(s.fk).toBe(0);
    }
    expect(hi - lo).toBeLessThan(0.05);
  });

  it('pulls back once and holds, and drifts across the frame in one direction only', () => {
    let prevH = 0;
    let turns = 0;
    let dir = 0;
    let prevX = onScreen(progressAtSeconds(22)).x;
    for (let t = 15; t <= 38; t += 0.25) {
      const s = onScreen(progressAtSeconds(t));
      if (t > 19) expect(s.frameH, `t=${t}`).toBeGreaterThanOrEqual(prevH - 0.02);
      prevH = s.frameH;
      if (t >= 22.25) {
        const d = Math.sign(s.x - prevX);
        if (d !== 0 && dir !== 0 && d !== dir) turns++;
        if (d !== 0) dir = d;
        prevX = s.x;
      }
    }
    expect(turns).toBe(0);
  });

  it('the body does not nod up and down: level from the krill reveal through the lunge', () => {
    for (let t = 22; t <= 33; t += 0.5) expect(Math.abs(tl.evaluate(progressAtSeconds(t), 0).whale1.pitch), `t=${t}`).toBeLessThan(0.06);
  });
});

describe('act 1: the krill swarm and the open mouth', () => {
  it('the aim point is the middle of the open gape', () => {
    const w = new Whale(1);
    Object.assign(w.state, { x: 0, y: 0, z: 0, pitch: 0, mouth: 1, throat: 1, swim: 0 });
    w.prepare();
    const m = w.mouthPoint({ x: 0, y: 0 });
    expect(Math.abs(MOUTH_OPEN.x - m.x)).toBeLessThan(0.5);
    expect(MOUTH_OPEN.y).toBeGreaterThan(m.y);
    expect(MOUTH_OPEN.y).toBeLessThan(m.y + 1);
  });

  it('the swarm lies on the line the open mouth is moving along', () => {
    for (let p = 0.07; p <= 0.105; p += 0.0025) {
      const f = tl.evaluate(p, LANDSCAPE);
      const w = f.whale1;
      const c = Math.cos(w.pitch);
      const s = Math.sin(w.pitch);
      const mx = w.x + MOUTH_OPEN.x * c - MOUTH_OPEN.y * s;
      const my = w.y + MOUTH_OPEN.x * s + MOUTH_OPEN.y * c;
      // 虾团中心到这条线的距离
      const off = -(f.krill.x - mx) * s + (f.krill.y - my) * c;
      expect(Math.abs(off), `p=${p.toFixed(4)}`).toBeLessThan(0.05);
      // 虾团在嘴的前方（或者正在被吞下）
      expect((f.krill.x - mx) * c + (f.krill.y - my) * s, `p=${p.toFixed(4)}`).toBeGreaterThan(-6);
    }
  });

  it('only the krill in front of the mouth are swallowed; the rest stay outside and scatter', () => {
    const k = new KrillSwarm();
    const f = tl.evaluate(0.1, LANDSCAPE);
    const w = new Whale(1);
    Object.assign(w.state, f.whale1);
    w.prepare();
    const m = w.mouthPoint({ x: 0, y: 0 });
    Object.assign(k.mouth, { x: m.x, y: m.y, z: w.state.z, open: w.state.mouth, a: w.state.pitch });
    Object.assign(k.body, { x: w.state.x, y: w.state.y });
    k.update({ ...f.krill }, 10, 1500, false);
    const priv = k as unknown as { cap: Float32Array; hy: Float32Array; hz: Float32Array; alpha: Float32Array };
    let eaten = 0;
    let total = 0;
    for (let i = 0; i < 1500; i++) {
      if (priv.alpha[i] <= 0) continue;
      total++;
      const off = Math.hypot(priv.hy[i] * 4.8, priv.hz[i] * 5.2 * 0.9);
      if (priv.cap[i] > 0) {
        eaten++;
        // 被吞下的都在嘴的范围之内
        expect(off).toBeLessThan(3.4 * 1.16);
      }
    }
    // 吞下的是正对着嘴的一部分，而不是整个虾团
    expect(eaten / total).toBeGreaterThan(0.2);
    expect(eaten / total).toBeLessThan(0.75);
  });
});

describe('automatic quality: no back-and-forth switching', () => {
  it('after recovering once, a second drop is final', () => {
    const tiers: number[] = [];
    const pm = new PerformanceMonitor(2, (t) => tiers.push(t));
    const run = (ms: number, secs: number) => {
      for (let t = 0; t < secs * 1000; t += ms) pm.sample(ms);
    };
    run(16.7, 4);
    run(40, 6);
    expect(pm.tier).toBe(1);
    run(8.3, 30);
    expect(pm.tier).toBe(2);
    run(40, 8);
    expect(pm.tier).toBe(1);
    run(8.3, 60);
    expect(pm.tier).toBe(1);
    expect(tiers).toEqual([1, 2, 1]);
  });
});
