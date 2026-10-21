// 通用数学工具：插值、缓动、确定性随机数与平滑噪声。
// 所有叙事状态都由 storyProgress 推导，因此这里的函数必须是纯函数。

export const TAU = Math.PI * 2;

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** 把 v 从 [a0,a1] 映射到 [b0,b1]，并夹紧。 */
export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return lerp(b0, b1, clamp(invLerp(a0, a1, v)));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 进入 [a,b] 时升到 1，离开 [c,d] 时降回 0 的平滑窗口。 */
export function window4(x: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
}

export const ease = {
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
};

export function fract(x: number): number {
  return x - Math.floor(x);
}

/** 永远返回非负余数。 */
export function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

/** 帧率无关的指数逼近：rate 越大越快。 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let d = target - current;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return current + d * (1 - Math.exp(-rate * dt));
}

/** 整数哈希 → [0,1)，用于确定性的个体参数。 */
export function hash1(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hash2(a: number, b: number): number {
  return hash1(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
}

/** 可复现的伪随机序列（mulberry32）。 */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一维平滑值噪声，输出约 [-1,1]。 */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, seed) * 2 - 1;
  const b = hash2(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

/** 二维平滑值噪声，输出约 [-1,1]。 */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const s = seed * 1013;
  const a = hash2(ix + s, iy) * 2 - 1;
  const b = hash2(ix + 1 + s, iy) * 2 - 1;
  const c = hash2(ix + s, iy + 1) * 2 - 1;
  const d = hash2(ix + 1 + s, iy + 1) * 2 - 1;
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/** 分形叠加噪声。 */
export function fbm1(x: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x * freq, seed + o * 17) * amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

export function fbm2(x: number, y: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * freq, y * freq, seed + o * 31) * amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum;
}

/** Catmull-Rom 一维样条（用于剖面曲线采样）。 */
export function sampleProfile(points: ReadonlyArray<readonly [number, number]>, s: number): number {
  const n = points.length;
  if (s <= points[0][0]) return points[0][1];
  if (s >= points[n - 1][0]) return points[n - 1][1];
  let i = 0;
  while (i < n - 2 && s > points[i + 1][0]) i++;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n - 1, i + 2)];
  const t = (s - p1[0]) / (p2[0] - p1[0]);
  const h = p2[0] - p1[0];
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * h;
  const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}
