import { Whale } from '../entities/Whale';
import { KrillSwarm } from '../entities/KrillSwarm';
import { CreatureManager } from '../systems/CreatureManager';
import { EcologyManager } from '../systems/EcologyManager';
import { Feast } from '../systems/Feast';
import { LightingManager } from '../systems/LightingManager';
import { OceanSurface } from '../systems/OceanSurface';
import { ParticleManager } from '../systems/ParticleManager';
import { Seabed } from '../systems/Seabed';
import { StoryTimeline, type SurfaceState } from '../systems/StoryTimeline';

/**
 * 叙事与自由探索共用的深海世界：同一套实体、系统与视觉资源。
 */
export class World {
  readonly timeline = new StoryTimeline();
  readonly lighting = new LightingManager();
  /** 开场的鲸鱼（之后成为鲸落） */
  readonly whale1 = new Whale(1);
  /** 循环末尾从远处出现的新鲸鱼（与开场鲸鱼外观一致，保证无缝衔接） */
  readonly whale2 = new Whale(1);
  readonly krill = new KrillSwarm();
  readonly seabed = new Seabed();
  readonly surface = new OceanSurface();
  readonly particles = new ParticleManager();
  readonly creatures = new CreatureManager();
  readonly ecology = new EcologyManager();
  /** 鲸落上正在进食的食腐动物（阶段 6） */
  readonly feast = new Feast();

  /** 本帧的渲染参数（由当前场景设置） */
  readonly render = {
    surface: null as SurfaceState | null,
    sediment: 0,
    breath2: 0,
    bubbles: 0,
    /** 海洋雪数量倍率 */
    snow: 1,
    /** 哪头鲸鱼正在滤食（被吞入的磷虾画在它的口腔里） */
    feeding: null as Whale | null,
  };
}
