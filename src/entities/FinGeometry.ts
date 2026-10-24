import { sampleProfile } from '../core/math';
import { AXIS_ANGLE, AXIS_PX, axisPx, FIN_PIVOT, FIN_POLY, sAtPx } from './WhaleArt';
import { DORSAL, LOWER, UPPER, WHALE_LEN } from './WhaleBody';

/**
 * 胸鳍的三维姿态（下沉途中）。
 *
 * 须鲸的胸鳍几乎是一块硬的桨：肘关节被肱骨远端的骨脊锁死，指间关节也几乎不能动，
 * 能转动的主要是肩关节（腕部只剩很小的屈伸）。生命结束后肌肉不再出力，胸鳍就是一块
 * 以肩关节为铰链的被动平板：水动力的力矩把它像风向标一样转向相对水流的方向，
 * 只有在水流把它推向身体时才被体侧挡住、贴着体侧顺向后方；水流很弱时回到画中的自然姿态。
 *
 * 方向用三个分量表示（单位向量，都在鲸鱼局部的“俯仰平面 + 镜头方向”里）：
 *   a：沿体轴指向尾部，h：垂直于体轴、指向局部上方（背部朝上时是背侧），z：指向镜头。
 * 鳍根在横截面上的位置随翻身转动（与 WhaleBody.rolledHeight 同一个椭圆截面模型）。
 * side = 1 是游动时的近侧胸鳍，−1 是远侧；肚子朝上时，原来远侧的胸鳍转到了镜头这一侧。
 */

/** 鳍根（画中的支点）所在的 s 与离体轴的距离（米，负值在体轴下方） */
export const FIN_ROOT_S = sAtPx(FIN_PIVOT.x);
export const FIN_ROOT_OFF = (axisPx(FIN_ROOT_S, { x: 0, y: 0 }).y - FIN_PIVOT.y) * (WHALE_LEN / AXIS_PX);

/** 画中胸鳍：鳍根指向鳍尖的方向（画框像素中的单位向量）与鳍长（画像素） */
export const FIN_PAINT_DIR = (() => {
  let best = 0;
  let tx = 0;
  let ty = 0;
  for (const [x, y] of FIN_POLY) {
    const d = Math.hypot(x - FIN_PIVOT.x, y - FIN_PIVOT.y);
    if (d > best) {
      best = d;
      tx = x - FIN_PIVOT.x;
      ty = y - FIN_PIVOT.y;
    }
  }
  return { x: tx / best, y: ty / best, len: best };
})();

/** 画中胸鳍偏离体轴（指向尾部的方向）的角度（弧度，正值偏向腹侧） */
const PAINT_OFF_AXIS = (() => {
  const bx = -Math.cos(AXIS_ANGLE);
  const by = -Math.sin(AXIS_ANGLE);
  // 画框 y 向下：叉积为负表示鳍尖在体轴下方（腹侧）
  const cross = bx * FIN_PAINT_DIR.y - by * FIN_PAINT_DIR.x;
  const dot = bx * FIN_PAINT_DIR.x + by * FIN_PAINT_DIR.y;
  return Math.atan2(-cross, dot);
})();

const U_R = sampleProfile(UPPER, FIN_ROOT_S);
const L_R = sampleProfile(LOWER, FIN_ROOT_S);
const W_R = sampleProfile(DORSAL, FIN_ROOT_S);
/** 鳍根在横截面上的角度（近侧；sin φ 是画中的相对高度） */
const PHI_NEAR = Math.asin(Math.max(-1, Math.min(1, FIN_ROOT_OFF / (FIN_ROOT_OFF >= 0 ? U_R : L_R))));

export interface Vec3 {
  a: number;
  h: number;
  z: number;
}

/** 鳍根在横截面上的角度 */
export function finRootPhi(side: number): number {
  return side > 0 ? PHI_NEAR : Math.PI - PHI_NEAR;
}

/** 截面上 (h, z) 绕体轴转动 ρ（与 rolledHeight 一致：ρ 为正时腹部先转向镜头） */
function rollHZ(h: number, z: number, rho: number, out: Vec3): Vec3 {
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  out.h = h * c + z * s;
  out.z = z * c - h * s;
  return out;
}

/** 鳍根处体表的外法线（单位向量，翻身之后） */
export function finNormal(side: number, rho: number, out: Vec3): Vec3 {
  const phi = finRootPhi(side);
  const s = Math.sin(phi);
  const R = s >= 0 ? U_R : L_R;
  const h = s / R;
  const z = Math.cos(phi) / W_R;
  const l = Math.hypot(h, z);
  out.a = 0;
  return rollHZ(h / l, z / l, rho, out);
}

/** 画中的自然姿态随身体翻身之后的方向（两侧相同：侧视的画中远侧胸鳍与近侧对称） */
export function finNeutral(rho: number, out: Vec3): Vec3 {
  out.a = Math.cos(PAINT_OFF_AXIS);
  return rollHZ(-Math.sin(PAINT_OFF_AXIS), 0, rho, out);
}
