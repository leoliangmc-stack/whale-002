import { describe, expect, it } from 'vitest';
import { secondsAt, WORLD } from '../src/config/stages';
import { CONTACT_P, DESCENT_END, DESCENT_START, DescentMotion, lowestBelow } from '../src/systems/DescentMotion';
import { StoryTimeline, Y_REST } from '../src/systems/StoryTimeline';
import { LightingManager } from '../src/systems/LightingManager';
import { Camera } from '../src/core/Camera';
import { WHALE_LEN, WhaleBody } from '../src/entities/WhaleBody';

const tl = new StoryTimeline();
const d = tl.descent;
const whale = (p: number) => ({ ...tl.evaluate(p, -0.05).whale1 });
const flow = (p: number) => ({ ...tl.evaluate(p, -0.05).water });
const body = new WhaleBody();

/** 按进度 p 的姿态计算身体几何（含弓形与被动弯曲） */
function shape(p: number): WhaleBody {
  const w = whale(p);
  body.compute({ swim: 0, phase: 0, beat: w.beat, beatPh: w.beatPh, mouth: 0, throat: 0, rest: w.rest, flex: w.flex, nod: w.nod, fluke: w.fluke, arc: w.arc, shrink: 0 });
  return body;
}

/** 脊线在 s 处的世界坐标 */
function spineAt(p: number, s: number): { x: number; y: number } {
  const w = whale(p);
  const f = shape(p).frame(s, 0, { x: 0, y: 0, a: 0 });
  const c = Math.cos(w.pitch);
  const sn = Math.sin(w.pitch);
  return { x: w.x + f.x * c - f.y * sn, y: w.y + f.x * sn + f.y * c };
}

/** 脊线在 s 处、画面上的倾角（弧度，指向吻端的方向，正值向下） */
function tangent(p: number, s: number): number {
  return whale(p).pitch + shape(p).frame(s, 0, { x: 0, y: 0, a: 0 }).a;
}

/** 以故事时间（自动播放的秒数）为步长扫描 [p0, p1] */
function sweep(p0: number, p1: number, dt = 1 / 20): Array<{ p: number; t: number }> {
  const out: Array<{ p: number; t: number }> = [];
  const t0 = secondsAt(p0);
  const t1 = secondsAt(p1);
  let p = p0;
  for (let t = t0; t <= t1; t += dt) {
    while (secondsAt(p) < t && p < p1) p += 1e-6;
    out.push({ p, t });
  }
  return out;
}

/** 第一个满足条件的进度 */
function first(p0: number, p1: number, f: (p: number) => boolean): number {
  for (let p = p0; p <= p1; p += 1e-4) if (f(p)) return p;
  return NaN;
}

const pStop = first(0.3, DESCENT_END, (p) => whale(p).beat < 0.02);
const pSink = first(0.3, DESCENT_END, (p) => flow(p).flowY > 0.51);

describe('descent A: stops swimming before it sinks', () => {
  it('the last tail strokes fade in amplitude and slow in frequency', () => {
    let prev = Infinity;
    for (let p = 0.298; p <= pStop; p += 5e-4) {
      const b = whale(p).beat;
      expect(b).toBeLessThanOrEqual(prev + 1e-9);
      prev = b;
    }
    const freq = (p: number) => {
      const e = 5e-4;
      return (whale(p + e).beatPh - whale(p - e).beatPh) / (secondsAt(p + e) - secondsAt(p - e)) / (2 * Math.PI);
    };
    expect(freq(0.316)).toBeLessThan(freq(0.3) * 0.85);
    expect(freq(0.3)).toBeLessThan(0.2);
  });

  it('stopping and sinking never happen in the same moment', () => {
    expect(pStop).toBeGreaterThan(0.3);
    expect(flow(pStop).flowY).toBeLessThan(0.17);
    // 摆动停止后至少 4 秒才开始明显下沉
    expect(secondsAt(pSink) - secondsAt(pStop)).toBeGreaterThan(4);
  });

  it('keeps gliding forward on its own inertia and stays nearly level', () => {
    const t = secondsAt(pStop);
    const later = sweep(pStop, 0.34).find((s) => s.t >= t + 3)!.p;
    expect(whale(later).x - whale(0.304).x).toBeGreaterThan(1.7);
    expect(Math.abs(whale(pStop).pitch)).toBeLessThan(0.03);
  });
});

describe('descent B: slowly loses its balance', () => {
  it('the head dips first while the tail keeps its height, then the body follows', () => {
    // 只比较相对水体的位置（去掉被压缩的深度）；吻端与尾端取弯曲之后的实际位置
    const vis = (p: number) => d.waterDepth(p) - whale(p).y;
    const snout = (p: number) => spineAt(p, 0).y + vis(p);
    const tail = (p: number) => spineAt(p, 1).y + vis(p);
    const p0 = first(0.315, 0.4, (p) => whale(p).pitch > 0.005);
    const s0 = snout(p0);
    const t0 = tail(p0);
    // 头部先沉下 1.7 米：尾部几乎还在原来的高度
    const p1 = first(p0, 0.4, (p) => snout(p) - s0 > 1.7);
    expect(Math.abs(tail(p1) - t0)).toBeLessThan(0.5);
    // 这一步是缓慢的（数秒），而不是一下子翻过去
    expect(secondsAt(p1) - secondsAt(p0)).toBeGreaterThan(3);
    // 低头先于明显的下沉
    expect(p1).toBeLessThan(pSink + 0.002);
    // 随后整个身体跟随下沉
    const p2 = sweep(p1, 0.4).find((x) => x.t >= secondsAt(p1) + 5)!.p;
    expect(tail(p2) - t0).toBeGreaterThan(1.7);
    expect(snout(p2) - tail(p2)).toBeGreaterThan(snout(p0) - tail(p0) + 1.7);
    // 从水平转到低头的下沉姿态用十几秒，而不是一下子翻过去
    const p3 = first(p0, 0.4, (p) => whale(p).pitch > 0.65);
    expect(secondsAt(p3) - secondsAt(p0)).toBeGreaterThan(11);
  });
});

describe('descent C/D: steady, heavy sinking', () => {
  const samples = sweep(0.322, CONTACT_P);

  it('sinking speed builds smoothly from zero and levels off', () => {
    let vmax = 0;
    let amax = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = flow(samples[i - 1].p).flowY;
      const b = flow(samples[i].p).flowY;
      amax = Math.max(amax, Math.abs(b - a) / (samples[i].t - samples[i - 1].t));
      vmax = Math.max(vmax, b);
    }
    expect(flow(0.322).flowY).toBeLessThan(0.17);
    expect(amax).toBeLessThan(0.51);
    // 缓慢、安静地漂向深海，而不是坠落：相对水体的下沉速度约 2.3 m/s
    expect(vmax).toBeGreaterThan(1.9);
    expect(vmax).toBeLessThan(3);
    // 不会一直加速：深海段的速度不超过稳定段
    expect(flow(0.44).flowY).toBeLessThanOrEqual(flow(0.38).flowY + 1e-6);
  });

  it('posture changes slowly, never flips, and does not keep rocking', () => {
    let reversals = 0;
    let dir = 0;
    let ext = whale(0.37).pitch;
    for (let i = 1; i < samples.length; i++) {
      const w = whale(samples[i].p);
      const prev = whale(samples[i - 1].p);
      expect(w.pitch).toBeGreaterThan(-0.03);
      expect(w.pitch).toBeLessThan(0.85);
      // 最快时也只有约 5°/s
      expect(Math.abs(w.pitch - prev.pitch) / (samples[i].t - samples[i - 1].t)).toBeLessThan(0.09);
      expect(Math.abs(w.flex)).toBeLessThan(0.6);
      expect(Math.abs(w.nod)).toBeLessThan(0.18);
      // 下沉时自下而上的水流把尾叶托向尾柄的延长线
      expect(Math.abs(w.fluke)).toBeLessThan(0.4);
      for (const f of [w.finN, w.finF]) {
        expect(f).toBeGreaterThan(-0.15);
        expect(f).toBeLessThan(0.5);
      }
      if (samples[i].p > 0.37) {
        const dp = w.pitch - ext;
        if (dir >= 0 && dp < -0.003) {
          if (dir > 0) reversals++;
          dir = -1;
          ext = w.pitch;
        } else if (dir <= 0 && dp > 0.003) {
          if (dir < 0) reversals++;
          dir = 1;
          ext = w.pitch;
        } else if ((dir > 0 && w.pitch > ext) || (dir < 0 && w.pitch < ext)) ext = w.pitch;
      }
    }
    // 偶尔的轻微修正可以有，但不能持续摇晃
    expect(reversals).toBeLessThan(8);
  });

  it('fins and tail keep a little passive motion in the deep (not a rigid stone)', () => {
    const range = (k: 'finN' | 'flex', a: number, b: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let p = a; p < b; p += 2e-4) {
        const v = whale(p)[k];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    expect(range('finN', 0.4, 0.44)).toBeGreaterThan(0.03);
    expect(range('flex', 0.4, 0.44)).toBeGreaterThan(0.017);
  });
});

describe('descent: landing and hand-offs', () => {
  it('touches the seabed gently on schedule and settles exactly at the rest pose', () => {
    const touch = first(0.48, DESCENT_END, (p) => {
      const w = whale(p);
      return w.y + lowestBelow(w.pitch) >= WORLD.seabedY - 0.02;
    });
    expect(Math.abs(touch - CONTACT_P)).toBeLessThan(0.004);
    expect(flow(touch - 0.002).flowY).toBeLessThan(0.77);
    const end = whale(DESCENT_END);
    expect(end.x).toBeCloseTo(WORLD.restX, 4);
    expect(end.y).toBeCloseTo(Y_REST, 4);
    expect(end.pitch).toBeCloseTo(0, 4);
    for (const k of ['flex', 'nod', 'fluke', 'finN', 'finF', 'beat'] as const) expect(Math.abs(end[k]), k).toBeLessThan(1e-4);
  });

  it('position, pitch and velocity are continuous where the motion table takes over', () => {
    for (const p of [DESCENT_START, DESCENT_END]) {
      const e = 1e-6;
      const a = whale(p - e);
      const b = whale(p + e);
      for (const k of ['x', 'y', 'pitch'] as const) expect(Math.abs(a[k] - b[k]), `${k}@${p}`).toBeLessThan(1e-3);
      const h = 2e-3;
      const vel = (k: 'x' | 'y' | 'pitch', p0: number, p1: number) => (whale(p1)[k] - whale(p0)[k]) / (secondsAt(p1) - secondsAt(p0));
      for (const k of ['x', 'y', 'pitch'] as const) {
        expect(Math.abs(vel(k, p - h, p) - vel(k, p, p + h)), `velocity ${k}@${p}`).toBeLessThan(0.14);
      }
    }
  });

  it('the camera follows with a little lag and never jumps', () => {
    let prev = tl.evaluate(DESCENT_START, 0).cam;
    let pl = { x: prev.lagX, y: prev.lagY };
    for (let p = DESCENT_START; p <= DESCENT_END; p += 1e-4) {
      const c = tl.evaluate(p, 0).cam;
      expect(Math.hypot(c.lagX, c.lagY)).toBeLessThan(2.6);
      expect(Math.hypot(c.lagX - pl.x, c.lagY - pl.y)).toBeLessThan(0.086);
      pl = { x: c.lagX, y: c.lagY };
      prev = c;
    }
  });
});

describe('descent: water frame (depth compression)', () => {
  it('compression only happens away from the surface and finishes before touchdown', () => {
    const hidden = (p: number) => d.sample(p, {} as never).hidden;
    expect(hidden(0.33)).toBeLessThan(0.05);
    expect(whale(first(0.3, 0.45, (p) => hidden(p) > 1.7)).y).toBeGreaterThan(17);
    expect(hidden(CONTACT_P - 0.01)).toBeCloseTo(hidden(DESCENT_END), 6);
    // 真实深度仍然到达海床
    expect(whale(0.4).y).toBeGreaterThan(900);
  });

  it('the seabed is anchored in the water frame and back in place at touchdown', () => {
    const o = { x: 0, y: 0 };
    d.seabedShift(CONTACT_P, o);
    expect(Math.hypot(o.x, o.y)).toBeLessThan(0.01);
    d.seabedShift(0.6, o);
    expect(o.x === 0 && o.y === 0).toBe(true);
    // 显现前，海床与鲸鱼的距离只按可见下沉缩短
    d.seabedShift(0.45, o);
    const gap = WORLD.seabedY + o.y - whale(0.45).y;
    expect(gap).toBeLessThan(69);
    expect(gap).toBeGreaterThan(15);
  });

  it('a creature met on the way is at its nominal depth when the whale passes it', () => {
    const a = d.anchorFor(760)!;
    expect(a).not.toBeNull();
    const pPass = first(0.33, 0.47, (p) => whale(p).y >= 760);
    const o = { x: 0, y: 0 };
    d.shiftFor(a, pPass, o);
    expect(Math.abs(760 + o.y - whale(pPass).y)).toBeLessThan(1.7);
    // 下沉动作之外不偏移
    d.shiftFor(a, 0.85, o);
    expect(o.y).toBe(0);
  });

  it('is fully reversible: random-order evaluation gives identical states', () => {
    const ps = Array.from({ length: 120 }, (_, i) => DESCENT_START + ((i * 0.6180339887) % 1) * (DESCENT_END - DESCENT_START));
    const a = ps.map((p) => JSON.stringify(whale(p)) + JSON.stringify(tl.evaluate(p, 0).cam));
    const b = [...ps].reverse().map((p) => JSON.stringify(whale(p)) + JSON.stringify(tl.evaluate(p, 0).cam)).reverse();
    expect(b).toEqual(a);
    expect(DescentMotion.covers(0.3)).toBe(true);
    expect(DescentMotion.covers(0.6)).toBe(false);
  });
});

describe('descent: a graceful, quiet drift into the deep', () => {
  it('sinks head-down in a hanging arc, as in the reference painting', () => {
    const deg = Math.PI / 180;
    for (let p = 0.37; p <= 0.44; p += 0.01) {
      const at = `p=${p.toFixed(2)}`;
      const w = whale(p);
      expect(w.arc, at).toBeGreaterThan(0.9);
      expect(w.arc, at).toBeLessThan(1.1);
      // 前半身几乎笔直地斜向下方：胸部约 43°，头部约 46°
      expect(w.pitch, at).toBeGreaterThan(38 * deg);
      expect(w.pitch, at).toBeLessThan(47 * deg);
      expect(tangent(p, 0.1), at).toBeGreaterThan(42 * deg);
      expect(tangent(p, 0.1), at).toBeLessThan(52 * deg);
      expect(Math.abs(tangent(p, 0.1) - tangent(p, 0.42)), at).toBeLessThan(8 * deg);
      // 尾柄顺着长弧垂下，尾端斜向下方约 34°
      expect(tangent(p, 1), at).toBeLessThan(-26 * deg);
      expect(tangent(p, 1), at).toBeGreaterThan(-44 * deg);
      // 背部最高处在体长的六成到八成之间
      let top = 0;
      let topY = Infinity;
      for (let s = 0; s <= 1; s += 0.01) {
        const y = spineAt(p, s).y;
        if (y < topY) {
          topY = y;
          top = s;
        }
      }
      expect(top, at).toBeGreaterThan(0.6);
      expect(top, at).toBeLessThan(0.8);
    }
    // 弧度随低头一起缓缓形成，接近海床时舒展开，交给静卧姿态
    expect(whale(0.32).arc).toBeLessThan(0.05);
    expect(whale(0.488).arc).toBeLessThan(0.12);
    expect(whale(CONTACT_P).arc).toBeLessThan(0.05);
    expect(whale(DESCENT_END).arc).toBeLessThan(1e-4);
    expect(whale(0.488).pitch).toBeLessThan(0.15);
  });

  it('bending keeps the body length and stays smooth', () => {
    for (const p of [0.34, 0.36, 0.4, 0.47]) {
      const b = shape(p);
      let len = 0;
      for (let i = 1; i < b.n; i++) len += Math.hypot(b.px[i] - b.px[i - 1], b.py[i] - b.py[i - 1]);
      expect(Math.abs(len - WHALE_LEN), `p=${p}`).toBeLessThan(0.25);
      // 任意 1 米内方向变化小于 10°
      for (let s = 0; s + 1 / WHALE_LEN <= 1; s += 0.01) {
        const da = Math.abs(tangent(p, s + 1 / WHALE_LEN) - tangent(p, s));
        expect(da, `p=${p} s=${s.toFixed(2)}`).toBeLessThan(0.175);
      }
    }
  });

  it('the pectoral fins spread naturally and sway a little, back in the painted pose before touchdown', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let p = 0.36; p <= 0.46; p += 2e-4) {
      const f = whale(p).fin;
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThan(0.08);
    expect(hi).toBeLessThan(0.3);
    expect(hi - lo).toBeGreaterThan(0.03);
    expect(Math.abs(whale(DESCENT_START + 1e-4).fin)).toBeLessThan(0.01);
    expect(whale(CONTACT_P).fin).toBe(0);
  });

  it('drifts a little forward along its lowered head, but it is sinking, not swimming down', () => {
    for (let p = 0.37; p <= 0.46; p += 0.01) {
      const f = flow(p);
      expect(f.flowX, `p=${p.toFixed(2)}`).toBeGreaterThan(0.4);
      // 运动方向偏离竖直方向 10° ~ 30°
      expect(Math.atan2(f.flowX, f.flowY), `p=${p.toFixed(2)}`).toBeGreaterThan(0.17);
      expect(Math.atan2(f.flowX, f.flowY), `p=${p.toFixed(2)}`).toBeLessThan(0.52);
    }
  });

  it('the upper descent has the light of the reference painting: pale grey-blue water, bright from above', () => {
    const env = (p: number) => ({ ...tl.evaluate(p, 0).env });
    for (let p = 0.31; p <= 0.37; p += 0.01) expect(env(p).sunlit, `p=${p.toFixed(2)}`).toBeCloseTo(1, 3);
    expect(env(0.29).sunlit).toBe(0);
    expect(env(0.44).sunlit).toBe(0);
    // 鲸鱼弯成低头弓形的镜头里：画面上、中、下的海水颜色（不含光柱）与参考画面中光柱之间的海水相近
    const water = (p: number) => {
      const f = tl.evaluate(p, 0);
      const w = { ...f.whale1 };
      const shot = { tx: 0, ty: 0, frameH: 0, sx: 0, sy: 0, elev: 0, lat: 0 };
      StoryTimeline.shotFrom(f, w, w, 1.6, shot);
      const cam = new Camera();
      cam.setViewport(1600, 1000);
      cam.setShot(shot);
      const light = new LightingManager();
      const e = f.env;
      light.update(cam, { vis: e.vis, focusLight: 0, focusX: 0, focusY: 0, bioGlow: 0, rays: 1, vignette: 0, rayLen: e.rayLen, glow: e.glow, tone: e.tone, rim: e.rim, sunlit: e.sunlit });
      const b = cam.boundsAt(400);
      return [b.t, cam.cy, b.b].map((y) => light.waterAt(y, [0, 0, 0]));
    };
    const [top, mid, bot] = water(0.356);
    for (const c of [top, mid, bot]) {
      // 灰蓝：蓝色只比红色高出四五十，而不是饱和的青蓝
      expect(c[2] - c[0]).toBeGreaterThan(30);
      expect(c[2] - c[0]).toBeLessThan(60);
    }
    expect(top[0]).toBeGreaterThan(115);
    expect(mid[0]).toBeGreaterThan(85);
    expect(bot[0]).toBeGreaterThan(50);
    expect(top[0] - bot[0]).toBeGreaterThan(40);
    // 深海仍然是深蓝
    const [, deep] = water(0.45);
    expect(deep[0] + deep[1] + deep[2]).toBeLessThan(200);
  });

  it('sunlight shafts follow it down, then fade before a thousand metres', () => {
    const env = (p: number) => ({ ...tl.evaluate(p, 0).env });
    const rays = (p: number) => Math.exp(-whale(p).y / env(p).rayLen);
    expect(rays(0.35)).toBeGreaterThan(0.6);
    expect(rays(0.375)).toBeGreaterThan(0.15);
    // “一千米以下，阳光再也到达不了”
    expect(rays(0.405)).toBeLessThan(0.07);
    expect(env(0.42).glow).toBeGreaterThan(0.9);
    expect(env(0.42).rim).toBeGreaterThan(0.9);
  });
});
