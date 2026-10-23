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
  { x: X - 30.9, z: 24, w: 9.1, h: 4.2, seed: 1 },
  { x: X + 27.4, z: 37.7, w: 11.7, h: 5.9, seed: 2 },
  /** 前景岩石：岩石后方藏着一条鮟鱇鱼（隐藏发现） */
  { x: X + 41.1, z: -12, w: 6.8, h: 4.4, seed: 3 },
  { x: X - 20.6, z: -15.4, w: 4.6, h: 2.3, seed: 4 },
  { x: X + 10.3, z: 68.6, w: 15.6, h: 7.8, seed: 5 },
  { x: X - 60, z: 51.4, w: 13, h: 6.5, seed: 6 },
  { x: X + 65.1, z: 13.7, w: 5.2, h: 2.9, seed: 7 },
  { x: X - 48, z: -6.9, w: 5.9, h: 3.4, seed: 8 },
  { x: X - 10.3, z: 120, w: 20.8, h: 10.4, seed: 9 },
  { x: X + 51.4, z: 94.3, w: 18.2, h: 9.1, seed: 10 },
];

export const HIDE_ROCK = ROCKS[2];

/** 隐藏发现的位置：鮟鱇鱼紧贴在前景岩石的后方 */
export const HIDDEN = {
  anglerfish: { x: HIDE_ROCK.x + 2.1, y: WORLD.seabedY - 1.95, z: HIDE_ROCK.z + 4.8 },
  glowJelly: { x: X - 68.6, y: WORLD.seabedY - 37.7, z: 17.1 },
};

/** 自由探索的镜头范围 */
export const EXPLORE_BOUNDS = {
  xMin: X - 78.9,
  xMax: X + 78.9,
  yMin: WORLD.seabedY - 72,
  yMax: WORLD.seabedY + 0.5,
  frameMin: 0.55,
  frameMax: 102.9,
};
