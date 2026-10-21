import { clamp, damp, lerp } from '../core/math';
import type { WhaleState } from '../entities/Whale';
import type { EcoState, StoryTimeline } from './StoryTimeline';

/**
 * EcologyManager：管理鲸鱼身体变化、骨骼状态与生态演替。
 *  - 叙事模式：直接采用时间线给出的状态（随进度可逆）；
 *  - 自由探索：拥有自己的“生态时钟”，可暂停 / 正常 / 加速，演替从鲸骨初期逐渐走向成熟群落。
 * 时间倍率平滑过渡，避免加速时生物瞬移。
 */

export type EcoSpeed = 0 | 1 | 4;

/** 正常速度下，探索模式中的演替从初期到成熟约需的秒数 */
const SUCCESSION_SECONDS = 210;

export class EcologyManager {
  speed: EcoSpeed = 1;
  /** 平滑后的实际倍率 */
  rate = 1;
  /** 探索模式的演替进度 0~1 */
  level = 0;
  /** 生态时钟（秒，已乘倍率） */
  clock = 0;
  readonly eco: EcoState = { scav: 0, amph: 0, crabs: 0, enrich: 0, sulfo: 0, dwellers: 0 };

  setSpeed(s: EcoSpeed): void {
    this.speed = s;
  }

  /** 推进时钟，返回本帧的生态 dt。 */
  tick(dt: number, explore: boolean): number {
    const target = explore ? this.speed : 1;
    this.rate = damp(this.rate, target, 3.5, dt);
    if (target === 0 && this.rate < 0.02) this.rate = 0;
    const edt = dt * this.rate;
    this.clock += edt;
    if (explore) this.level = clamp(this.level + edt / SUCCESSION_SECONDS);
    return edt;
  }

  /** 探索模式：鲸骨与周边群落的状态。 */
  exploreState(timeline: StoryTimeline, whale: WhaleState): void {
    const u = lerp(0.725, 0.8, this.level);
    timeline.whaleAt(u, whale);
    whale.visible = 1;
    whale.mats = clamp(whale.mats + this.level * 0.1);
    const e = this.eco;
    e.scav = 0.15;
    e.amph = 0.1;
    e.crabs = 0.85;
    e.enrich = 1;
    e.sulfo = lerp(0.65, 1, this.level);
    e.dwellers = lerp(0.6, 1, this.level);
  }

  /** 探索模式中显示的“鲸落年龄”。 */
  get years(): number {
    return Math.round(lerp(6, 50, this.level));
  }
}
