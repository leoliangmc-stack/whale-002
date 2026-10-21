import { WORLD } from './stages';

/** 鲸落现场的布局（海床、岩石、隐藏观察点），叙事与自由探索共用。 */

export interface RockDef {
  /** 世界坐标 x（米） */
  x: number;
  /** 深度 z：负值在鲸骨前方（前景），正值在后方 */
  z: number;
  w: number;
  h: number;
  seed: number;
}

const X = WORLD.restX;

export const ROCKS: RockDef[] = [
  { x: X - 18, z: 14, w: 7, h: 3.2, seed: 1 },
  { x: X + 16, z: 22, w: 9, h: 4.5, seed: 2 },
  /** 前景岩石：岩石后方藏着一条鮟鱇鱼（隐藏发现） */
  { x: X + 24, z: -7, w: 5.2, h: 3.4, seed: 3 },
  { x: X - 12, z: -9, w: 3.5, h: 1.8, seed: 4 },
  { x: X + 6, z: 40, w: 12, h: 6, seed: 5 },
  { x: X - 35, z: 30, w: 10, h: 5, seed: 6 },
  { x: X + 38, z: 8, w: 4, h: 2.2, seed: 7 },
  { x: X - 28, z: -4, w: 4.5, h: 2.6, seed: 8 },
  { x: X - 6, z: 70, w: 16, h: 8, seed: 9 },
  { x: X + 30, z: 55, w: 14, h: 7, seed: 10 },
];

export const HIDE_ROCK = ROCKS[2];

/** 隐藏发现的位置 */
export const HIDDEN = {
  anglerfish: { x: X + 25.6, y: WORLD.seabedY - 1.5, z: -2.2 },
  glowJelly: { x: X - 40, y: WORLD.seabedY - 22, z: 10 },
};

/** 自由探索的镜头范围 */
export const EXPLORE_BOUNDS = {
  xMin: X - 46,
  xMax: X + 46,
  yMin: WORLD.seabedY - 42,
  yMax: WORLD.seabedY + 0.5,
  frameMin: 0.55,
  frameMax: 60,
};
