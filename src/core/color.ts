// 颜色工具与“水下着色”。所有程序化绘制的颜色都经过 shade()，
// 从而统一受深度光照、水体雾化和局部光源影响。

export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const s = h.replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mixRGB(a: RGB, b: RGB, t: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function rgba(c: RGB, a = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : +a.toFixed(3)})`;
}

/** 多段颜色渐变采样：stops 为 [位置, 颜色]。 */
export function sampleStops(stops: ReadonlyArray<readonly [number, RGB]>, x: number, out: RGB = [0, 0, 0]): RGB {
  if (x <= stops[0][0]) return copy(stops[0][1], out);
  const n = stops.length;
  if (x >= stops[n - 1][0]) return copy(stops[n - 1][1], out);
  let i = 0;
  while (i < n - 2 && x > stops[i + 1][0]) i++;
  const t = (x - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
  return mixRGB(stops[i][1], stops[i + 1][1], t, out);
}

export function copy(c: RGB, out: RGB): RGB {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
  return out;
}

/** 一个物体在当前位置受到的光照与雾化。 */
export interface Shade {
  /** 亮度倍率 */
  light: number;
  /** 光色（逐通道倍率，深海偏蓝） */
  tint: RGB;
  /** 暖色局部光（如探照灯/散射光）强度 */
  warm: number;
  /** 雾化比例 0~1 */
  fog: number;
  /** 雾色（即该处海水颜色） */
  fogC: RGB;
}

export function makeShade(): Shade {
  return { light: 1, tint: [1, 1, 1], warm: 0, fog: 0, fogC: [10, 40, 80] };
}

const WARM: RGB = hex('#F2C77C');
const tmp: RGB = [0, 0, 0];

/** 对基础色应用光照与雾化，返回 CSS 颜色字符串。 */
export function shade(c: RGB, sh: Shade, a = 1, boost = 0): string {
  shadeRGB(c, sh, tmp, boost);
  return rgba(tmp, a);
}

export function shadeRGB(c: RGB, sh: Shade, out: RGB, boost = 0): RGB {
  const l = sh.light * (1 + boost);
  const w = sh.warm;
  let r = c[0] * l * sh.tint[0] + c[0] * w * (WARM[0] / 255) * 0.55;
  let g = c[1] * l * sh.tint[1] + c[1] * w * (WARM[1] / 255) * 0.55;
  let b = c[2] * l * sh.tint[2] + c[2] * w * (WARM[2] / 255) * 0.55;
  const f = sh.fog;
  r = r + (sh.fogC[0] - r) * f;
  g = g + (sh.fogC[1] - g) * f;
  b = b + (sh.fogC[2] - b) * f;
  out[0] = r > 255 ? 255 : r;
  out[1] = g > 255 ? 255 : g;
  out[2] = b > 255 ? 255 : b;
  return out;
}

/** 自发光颜色（生物发光）：只受雾化影响，不受环境光影响。 */
export function glow(c: RGB, sh: Shade, a = 1): string {
  const f = sh.fog * 0.85;
  tmp[0] = c[0] + (sh.fogC[0] - c[0]) * f;
  tmp[1] = c[1] + (sh.fogC[1] - c[1]) * f;
  tmp[2] = c[2] + (sh.fogC[2] - c[2]) * f;
  return rgba(tmp, a * (1 - sh.fog * 0.6));
}

export const PALETTE = {
  deep: hex('#071B35'),
  mid: hex('#103D62'),
  glowCyan: hex('#36C8C5'),
  softCyan: hex('#8DDCD0'),
  warm: hex('#F2C77C'),
  boneIvory: hex('#E9E0CB'),
  boneShadow: hex('#8796A3'),
  boneBlueGrey: hex('#A9B6BF'),
  krill: hex('#E8572E'),
  krillDeep: hex('#C23A22'),
  whaleDark: hex('#2B333D'),
  whaleMid: hex('#46505C'),
  whaleBelly: hex('#C9CED2'),
  sand: hex('#6E6A5E'),
  sandLight: hex('#8F8A7A'),
  rock: hex('#3E4650'),
  white: hex('#FFFFFF'),
  sky: hex('#BFE3F5'),
};
