import type { Camera } from './Camera';
import type { QualitySettings } from '../config/performance';
import type { LightingManager } from '../systems/LightingManager';

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Layout {
  device: DeviceClass;
  portrait: boolean;
  w: number;
  h: number;
  aspect: number;
  coarse: boolean;
  safe: SafeArea;
  /** 开阔海域构图的整体倾角：竖屏时鲸鱼沿对角线向上游，以便窄画面容纳鲸鱼与磷虾群。 */
  compAngle: number;
}

/** 每帧传给所有绘制模块的上下文。 */
export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  light: LightingManager;
  dpr: number;
  w: number;
  h: number;
  /** 氛围动画时钟（秒），只增不减 */
  time: number;
  /** 生态时钟（秒）：自由探索时可暂停或加速 */
  eco: number;
  dt: number;
  quality: QualitySettings;
  layout: Layout;
  reducedMotion: boolean;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
