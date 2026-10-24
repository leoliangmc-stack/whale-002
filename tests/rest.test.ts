import { describe, expect, it } from 'vitest';
import { secondsAt } from '../src/config/stages';
import { CONTACT_P } from '../src/systems/DescentMotion';
import { StoryTimeline, Y_REST } from '../src/systems/StoryTimeline';
import { FIN_LEN, Whale } from '../src/entities/Whale';
import { REST_GROUND, restSpineDY, UPPER, WHALE_LEN, WhaleBody } from '../src/entities/WhaleBody';
import { sampleProfile } from '../src/core/math';

const tl = new StoryTimeline();

/** 静卧姿态下的身体几何（局部坐标，+y 向下；海床在 y = REST_GROUND）：肚子朝上 */
function restBody(rest = 1): WhaleBody {
  const b = new WhaleBody();
  b.compute({ swim: 0, phase: 0, beat: 0, beatPh: 0, mouth: 0, throat: 0, rest, flex: 0, nod: 0, fluke: 0, arc: 0, roll: Math.PI, shrink: 0 });
  return b;
}

/** s 处着地一侧（肚子朝上时是背部）离海床的距离（负值为压入沉积物的深度） */
function gapAt(b: WhaleBody, s: number): number {
  const p = b.belly(s, { x: 0, y: 0 });
  return REST_GROUND - p.y;
}

function maxGap(b: WhaleBody, s0: number, s1: number): number {
  let m = -Infinity;
  for (let s = s0; s <= s1 + 1e-9; s += 0.01) m = Math.max(m, gapAt(b, s));
  return m;
}

describe('rest pose: weight and contact', () => {
  const b = restBody();

  it('lies belly-up: the broad back presses into the soft sediment, but only a little', () => {
    // 着地的是背侧的轮廓
    const i = b.indexAt(0.42);
    expect(b.lo[i]).toBeCloseTo(sampleProfile(UPPER, b.s[i]), 2);
    const sink = -Math.min(gapAt(b, 0.3), gapAt(b, 0.38), gapAt(b, 0.46));
    expect(sink).toBeGreaterThan(0.2);
    expect(sink).toBeLessThan(0.69);
  });

  it('no part of the body hovers evenly above the seabed', () => {
    // 从头顶到尾端都贴着海床，没有悬空的一段
    expect(maxGap(b, 0.1, 1)).toBeLessThan(0.45);
    // 沉重的头骨放低、头顶贴着海床，吻端尖自然地微微翘起
    expect(Math.abs(gapAt(b, 0.1))).toBeLessThan(0.3);
    expect(gapAt(b, 0.015)).toBeGreaterThan(0.1);
    expect(gapAt(b, 0.015)).toBeLessThan(0.8);
  });

  it('the tail stock rests on its keel and the flukes reach the seabed', () => {
    // 尾柄以背脊着地，压进软泥不深（很小的背鳍在 0.76~0.81 之间，可以压得更深一点）
    for (const [a, c] of [[0.6, 0.75], [0.82, 0.98]]) {
      for (let s = a; s <= c; s += 0.01) expect(gapAt(b, s), `s=${s.toFixed(2)}`).toBeGreaterThan(-0.45);
    }
    for (let s = 0.76; s <= 0.81; s += 0.01) expect(gapAt(b, s)).toBeGreaterThan(-0.85);
    expect(Math.abs(gapAt(b, 0.99))).toBeLessThan(0.21);
  });

  it('is gently curved, not a straight log, and head and tail are not on one line', () => {
    const n = b.n;
    // 脊线偏离吻端—尾端弦线的最大距离
    const x0 = b.px[0];
    const y0 = b.py[0];
    const x1 = b.px[n - 1];
    const y1 = b.py[n - 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let dev = 0;
    for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs((x1 - x0) * (y0 - b.py[i]) - (x0 - b.px[i]) * (y1 - y0)) / len);
    expect(dev).toBeGreaterThan(0.69);
    // 尾柄比头部垂得更低
    expect(b.py[n - 1] - b.py[0]).toBeGreaterThan(0.3);
  });

  it('bends smoothly without kinks and without stretching the body', () => {
    const n = b.n;
    const dir = (i: number) => Math.atan2(b.py[i + 1] - b.py[i], b.px[i + 1] - b.px[i]);
    const arcTo: number[] = [0];
    for (let i = 1; i < n; i++) arcTo.push(arcTo[i - 1] + Math.hypot(b.px[i] - b.px[i - 1], b.py[i] - b.py[i - 1]));
    // 任意 1 米长的一段脊线内，方向变化不超过约 10°（没有关节断裂般的折角）
    let maxTurn = 0;
    for (let i = 0; i < n - 1; i++) {
      let j = i;
      while (j < n - 2 && arcTo[j] - arcTo[i] < 1) j++;
      const d = dir(j) - dir(i);
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
    }
    expect(maxTurn).toBeLessThan(0.18);
    // 体长变化不超过 0.5%
    expect(Math.abs(arcTo[n - 1] - WHALE_LEN) / WHALE_LEN).toBeLessThan(0.005);
  });

  it('settles in order: the belly first, then the head, the tail last', () => {
    const reach = (s: number) => {
      const full = restSpineDY(s, 1);
      for (let r = 0; r <= 1; r += 0.005) if (Math.abs(restSpineDY(s, r) - full) < 0.1 * Math.abs(full)) return r;
      return 1;
    };
    expect(reach(0.38)).toBeLessThan(reach(0.02));
    expect(reach(0.02)).toBeLessThan(reach(0.95));
  });
});

describe('rest pose: the painted flipper', () => {
  const w = new Whale(1);
  tl.whaleAt(0.54, w.state);
  w.prepare();
  /** 鳍尖的世界 y（含翻身与胸鳍的转动） */
  const tip = (v: Whale) => {
    const root = v.finRoot({ x: 0, y: 0 });
    const a = v.finDir();
    const lx = root.x + FIN_LEN * Math.cos(a);
    const ly = root.y + FIN_LEN * Math.sin(a);
    return v.state.y + lx * Math.sin(v.state.pitch) + ly * Math.cos(v.state.pitch);
  };

  // 肚子朝上：胸鳍保持画中的姿态（与之后露出的鳍骨一致），从朝上的腹侧斜向后上方伸进水里
  it('lies belly-up with the flipper in its natural pose, reaching up from the belly side', () => {
    expect(w.state.roll).toBe(Math.PI);
    expect(w.state.fin).toBe(0);
    const root = w.finRoot({ x: 0, y: 0 });
    expect(root.y).toBeLessThan(0);
    expect(tip(w)).toBeLessThan(w.state.y + root.y);
  });

  it('never cuts into the seabed while the whale is approaching and settling', () => {
    const v = new Whale(1);
    for (let p = 0.48; p <= 0.52; p += 0.0005) {
      tl.whaleAt(p, v.state);
      v.prepare();
      expect(tip(v), `p=${p.toFixed(4)}`).toBeLessThan(v.state.seabed - 0.5);
    }
  });
});

describe('landing timeline', () => {
  it('rest builds up monotonically over several seconds after the first touch', () => {
    let prev = -1;
    for (let p = CONTACT_P - 0.002; p <= 0.53; p += 0.0005) {
      const r = tl.evaluate(p, 0).whale1.rest;
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
    const done = (() => {
      for (let p = CONTACT_P; p < 0.55; p += 0.0002) if (tl.evaluate(p, 0).whale1.rest > 0.999) return p;
      return 1;
    })();
    const secs = secondsAt(done) - secondsAt(CONTACT_P);
    expect(secs).toBeGreaterThan(3.5);
    expect(secs).toBeLessThan(7);
    expect(tl.evaluate(0.53, 0).whale1.y).toBeCloseTo(Y_REST, 4);
  });

  it('the sediment cloud starts at touchdown and has settled before the time skip', () => {
    expect(tl.evaluate(CONTACT_P - 0.001, 0).env.sediment).toBe(0);
    expect(tl.evaluate(CONTACT_P + 0.002, 0).env.sediment).toBeGreaterThan(0);
    // “数天后”出现时（0.553），沉降已基本结束（ParticleManager 在 13 秒后不再绘制）
    expect(secondsAt(0.553) - secondsAt(CONTACT_P)).toBeGreaterThan(11);
  });
});
