import { clamp } from '../../core/math';
import {
  airWeight,
  bedLevels,
  biteAt,
  CUES,
  EXPLORE_CALLS,
  inSeamGuard,
  shakeLevel,
  strokeLevel,
  views,
  type BedId,
  type BedLevel,
  type Cue,
  type DuckClass,
  type EcoLevels,
  type View,
} from './plan';

/**
 * AudioDirector：声音的“导演”——把每一帧的画面数据变成要执行的指令（纯逻辑，不碰 WebAudio）。
 * AudioManager 在浏览器里执行这些指令；scripts/sound-mix.ts 用同一个导演离线混出一整圈来检查。
 *
 *  - 连续层：每帧给出各循环床的目标电平、视角权重与低通（plan.ts 的纯函数）；
 *  - 一次性音效：用累计进度（含圈数）判断正向越过，同一帧内越过的 cue 按先后换算成秒排程；
 *    速度比、主角间隔、旁白空档、接缝保护、倒退与跳转的淡出都在这里决定（cue sheet 1.7、4.3）；
 *  - 旁白压低：按旁白的 speaking / nextStartIn 算出 0~1 的压低包络（提前 0.15 s、0.25 s 压下，
 *    人声结束 0.4 s 后 1 s 恢复，两句间隔小于 2 s 时保持）。
 * 不用随机数：变体按序号轮换。
 */

export interface AudioFrame {
  mode: 'story' | 'explore' | 'intro';
  /** 当前循环内的进度 [0,1) */
  p: number;
  /** 累计进度（含圈数，StoryProgressController.shown）；缺省时用 p */
  total?: number;
  paused: boolean;
  /** 实际推进速度（进度 / 秒） */
  velocity: number;
  /** 这一段的自动播放速度（进度 / 秒，StoryProgressController.rateAt(p)） */
  autoRate?: number;
  /** 本帧是跳转 / 重新开始 / 进出自由探索（画面在做 0.9 s 的溶解） */
  jumped?: boolean;
  /** 相机深度（米，正值在水下，camera.cam.cy） */
  camDepth: number;
  /** 拍尾：相位（弧度）与幅度（开场到滤食为游动，0.262–0.33 为下沉动作的最后几次摆尾） */
  stroke?: { phase: number; amp: number } | null;
  /** 下沉时鲸鱼相对水体的速度（m/s） */
  sink?: number;
  /** 生态数量（叙事中来自时间线，探索中来自生态时钟） */
  eco?: EcoLevels | null;
  /** 阶段 6：睡鲨是否正咬住（0~1）与扭身相位（弧度，sin 的峰值是一次甩头） */
  feast?: { latch: number; tug: number } | null;
  /** 旁白：是否在说话、下一句还有多少秒开始 */
  vo?: { speaking: boolean; nextStartIn: number } | null;
  /** 探索模式的景别（米） */
  zoomFrameH?: number;
}

export interface PlayCmd {
  vid: number;
  id: string;
  /** 开始的绝对时间（秒，与 step 的 now 同一时钟） */
  at: number;
  db: number;
  duck: DuckClass;
  pan: number;
  panTo?: number;
  panDur?: number;
  lpf?: number;
  label: string;
}

export interface FadeCmd {
  vid: number;
  at: number;
  dur: number;
}

export interface MixPlan {
  beds: Record<BedId, BedLevel>;
  /** 连续层平滑的时间常数（秒） */
  bedTau: number;
  /** 暂停时连续层整体 −6 dB；pauseTau 为它的时间常数 */
  pauseDb: number;
  pauseTau: number;
  /** 旁白压低包络 0~1 */
  duck: number;
  play: PlayCmd[];
  fade: FadeCmd[];
}

interface Voice {
  vid: number;
  id: string;
  group: string;
  start: number;
  end: number;
  /** 触发它的累计进度（倒退越过时淡出） */
  trigger: number;
  view: View;
  whale: boolean;
  hero: boolean;
  fading: boolean;
}

interface Pending {
  cue: Cue;
  trigger: number;
}

const TAU = Math.PI * 2;
/** 同时活动的一次性音源上限（循环床另算，总数 ≤ 16） */
const MAX_SHOTS = 7;

export class AudioDirector {
  private lastTotal = NaN;
  private lastMode: AudioFrame['mode'] = 'intro';
  private voices: Voice[] = [];
  private pending: Pending[] = [];
  private nextVid = 1;
  private lastHero = -1e9;
  private lastStroke = NaN;
  private lastShake = NaN;
  private strokeN = 0;
  private shakeN = 0;
  private jumpUntil = -1;
  private started = 0;
  // 旁白压低
  private duckLevel = 0;
  private voSilentFor = 99;
  /** 没有 vo 数据时由 setDuck 提供的压低程度 */
  externalDuck = 0;
  // 探索模式
  private exploreClock = 0;
  private exploreNextCall = 40;
  private exploreCalls = 0;
  private exploreNextTick = 2;
  private exploreTicks = 0;

  /**
   * @param durationOf 素材时长（秒），未加载时为 undefined
   * @param ready 素材是否已经可以播放（还没解码好的 cue 直接跳过，不播放任何替代声音）
   */
  constructor(
    private readonly durationOf: (id: string) => number | undefined,
    private readonly ready: (id: string) => boolean = (id) => durationOf(id) !== undefined,
  ) {}

  /** 正在响的一次性音效数量（调试与测试用） */
  get activeCount(): number {
    return this.voices.filter((v) => !v.fading).length;
  }

  step(dt: number, f: AudioFrame, now: number): MixPlan {
    const plan: MixPlan = { beds: bedLevels({ mode: f.mode, p: f.p, depth: f.camDepth, sink: f.sink ?? 0, eco: f.eco ?? null }), bedTau: 0.25, pauseDb: 0, pauseTau: 0.33, duck: 0, play: [], fade: [] };
    this.voices = this.voices.filter((v) => v.end > now);
    const total = f.total ?? f.p;
    const delta = Number.isNaN(this.lastTotal) ? 0 : total - this.lastTotal;
    const jumped = !!f.jumped || f.mode !== this.lastMode || Math.abs(delta) > 0.03;

    // 第一次开始：所有床从静音 2.5 s 淡入
    if (f.mode !== 'intro') this.started += dt;
    const fadeIn = clamp(this.started / 2.5);
    for (const id in plan.beds) plan.beds[id as BedId].w *= fadeIn;

    if (jumped) {
      // 跳转：连续层 0.9 s 交叉渐变到新状态；正在响的一次性音效 0.5 s 淡出；等待中的鲸鸣取消
      this.jumpUntil = now + 0.9;
      for (const v of this.voices) this.fadeVoice(plan, v, now, 0.5);
      this.pending = [];
      this.lastStroke = this.lastShake = NaN;
    }
    if (now < this.jumpUntil) plan.bedTau = 0.3;

    // 暂停：连续层 −6 dB（1 s 压下，0.6 s 恢复）
    plan.pauseDb = f.paused && f.mode === 'story' ? -6 : 0;
    plan.pauseTau = f.paused ? 0.33 : 0.2;

    plan.duck = this.duckEnvelope(dt, f);

    if (f.mode === 'story' && !jumped) {
      const v = views(f.p);
      // 倒退越过正在响的音效的触发点：0.3 s 淡出（鲸鸣 1 s）；视角翻转：属于另一侧的音效 0.3 s 淡出
      for (const vc of this.voices) {
        if (vc.fading) continue;
        if (total < vc.trigger - 1e-6) this.fadeVoice(plan, vc, now, vc.whale ? 1 : 0.3);
        else if (vc.view === 'air' && airWeight(v) < 0.3) this.fadeVoice(plan, vc, now, 0.3);
        else if (vc.view === 'uw' && v.uw < 0.15) this.fadeVoice(plan, vc, now, 0.3);
      }
      if (delta < 0) this.pending = [];
      if (delta > 0) this.forward(plan, f, total, delta, dt, now);
      this.releasePending(plan, f, total, now);
    } else if (f.mode === 'explore' && !jumped) {
      this.explore(plan, f, dt, now);
    } else if (f.mode !== 'story') {
      this.pending = [];
    }

    this.lastTotal = total;
    this.lastMode = f.mode;
    return plan;
  }

  // ------------------------------------------------------------ 正向越过

  private forward(plan: MixPlan, f: AudioFrame, total: number, delta: number, dt: number, now: number): void {
    const rate = f.autoRate && f.autoRate > 0 ? f.autoRate : delta / Math.max(dt, 1e-3);
    const r = Math.max(0, f.velocity) / rate;
    const speed = delta / Math.max(dt, 1e-3);
    const from = this.lastTotal;
    const base = Math.floor(from);
    const crossed: Array<{ cue: Cue; t: number }> = [];
    for (const k of [base, base + 1]) {
      for (const cue of CUES) {
        const t = k + cue.p;
        if (t > from && t <= total) crossed.push({ cue, t });
      }
    }
    crossed.sort((a, b) => a.t - b.t);
    for (const { cue, t } of crossed) {
      const at = now + Math.max(0, dt - (total - t) / speed);
      if (!this.allowed(cue, f, r, at)) continue;
      if (cue.latest !== undefined && f.vo?.speaking) {
        this.pending.push({ cue, trigger: t });
        continue;
      }
      this.start(plan, cue, t, at, 0);
    }

    // 动态的一次性音效：只在正常速度的正向播放中
    if (f.paused || r > 1.6 || inSeamGuard(f.p) || this.sentenceSoon(f)) {
      this.syncPhases(f);
      return;
    }
    // 拍尾：上拍最用力的时刻（相位越过 π/2 + 2πk），三个变体按序号轮换
    const s = f.stroke;
    if (s) {
      const k = Math.floor((s.phase - Math.PI / 2) / TAU);
      if (k === this.lastStroke + 1 && s.amp >= 0.2) {
        const lv = strokeLevel(f.p);
        const db = lv === null ? -99 : lv + 20 * Math.log10(Math.min(1, s.amp));
        // 低于 −50 的拍尾听不见，不占用音源
        if (db > -50) this.dynamic(plan, ['F01a', 'F01b', 'F01c'][this.strokeN++ % 3], 'F01', db, total, now, 'sfx');
      }
      this.lastStroke = k;
    } else this.lastStroke = NaN;
    // 甩头：咬住期间 |sin(扭身相位)| 每次到达峰值
    const fe = f.feast;
    if (fe && fe.latch > 0.5) {
      const k = Math.floor((fe.tug - Math.PI / 2) / Math.PI);
      const b = biteAt(f.p);
      if (k === this.lastShake + 1 && b >= 0) this.dynamic(plan, this.shakeN++ % 2 ? 'F18b' : 'F18a', 'F18s', shakeLevel(b), total, now, 'sfx');
      this.lastShake = k;
    } else this.lastShake = NaN;
  }

  private syncPhases(f: AudioFrame): void {
    this.lastStroke = f.stroke ? Math.floor((f.stroke.phase - Math.PI / 2) / TAU) : NaN;
    this.lastShake = f.feast && f.feast.latch > 0.5 ? Math.floor((f.feast.tug - Math.PI / 2) / Math.PI) : NaN;
  }

  /** 旁白的新一句在 0.5 s 内开始 */
  private sentenceSoon(f: AudioFrame): boolean {
    return !!f.vo && !f.vo.speaking && f.vo.nextStartIn < 0.5;
  }

  private allowed(cue: Cue, f: AudioFrame, r: number, at: number): boolean {
    if (inSeamGuard(cue.p)) return false;
    if (!this.ready(cue.id)) return false;
    if (r > 3.5) return false;
    const whale = cue.latest !== undefined;
    if (r > 1.6 && (!cue.hero || whale)) return false;
    if (cue.hero && at - this.lastHero < 2) return false;
    const leading = cue.hero || cue.duck === 'hero' || cue.duck === 'free';
    if (!leading && this.sentenceSoon(f)) return false;
    return true;
  }

  private releasePending(plan: MixPlan, f: AudioFrame, total: number, now: number): void {
    if (!this.pending.length) return;
    const keep: Pending[] = [];
    for (const pd of this.pending) {
      const latest = pd.trigger - pd.cue.p + (pd.cue.latest ?? pd.cue.p);
      if (!f.vo?.speaking && this.voSilentFor >= 0.5) this.start(plan, pd.cue, pd.trigger, now, 0);
      else if (total >= latest) this.start(plan, pd.cue, pd.trigger, now, -8);
      else keep.push(pd);
    }
    this.pending = keep;
  }

  private start(plan: MixPlan, cue: Cue, trigger: number, at: number, extraDb: number): void {
    const dur = this.durationOf(cue.id) ?? 10;
    if (cue.hero) this.lastHero = at;
    this.limitShots(plan, cue.id, at);
    const vid = this.nextVid++;
    this.voices.push({ vid, id: cue.id, group: cue.id, start: at, end: at + dur, trigger, view: cue.view, whale: cue.latest !== undefined, hero: !!cue.hero, fading: false });
    plan.play.push({ vid, id: cue.id, at, db: cue.db + extraDb, duck: cue.duck, pan: cue.pan ?? 0, panTo: cue.panTo, panDur: cue.panDur, label: cue.label });
  }

  private dynamic(plan: MixPlan, id: string, group: string, db: number, total: number, now: number, duck: DuckClass, pan = 0, lpf?: number): void {
    if (!this.ready(id)) return;
    const dur = this.durationOf(id) ?? 3;
    // 同一编号最多同时 2 个：第三个出现时淡出最早的
    const same = this.voices.filter((v) => v.group === group && !v.fading);
    if (same.length >= 2) this.fadeVoice(plan, same[0], now, 0.3);
    this.limitShots(plan, id, now);
    const vid = this.nextVid++;
    this.voices.push({ vid, id, group, start: now, end: now + dur, trigger: total, view: 'uw', whale: id.startsWith('V'), hero: false, fading: false });
    plan.play.push({ vid, id, at: now, db, duck, pan, lpf, label: group });
  }

  private limitShots(plan: MixPlan, id: string, now: number): void {
    const live = this.voices.filter((v) => !v.fading);
    if (live.length < MAX_SHOTS) return;
    const victim = live.find((v) => !v.hero && v.id !== id) ?? live[0];
    this.fadeVoice(plan, victim, now, 0.3);
  }

  private fadeVoice(plan: MixPlan, v: Voice, now: number, dur: number): void {
    if (v.fading) return;
    v.fading = true;
    v.end = Math.min(v.end, Math.max(now, v.start) + dur);
    plan.fade.push({ vid: v.vid, at: now, dur });
  }

  // ------------------------------------------------------------ 旁白压低

  private duckEnvelope(dt: number, f: AudioFrame): number {
    const vo = f.vo;
    if (!vo) {
      this.duckLevel = clamp(this.externalDuck);
      return this.duckLevel;
    }
    if (vo.speaking) this.voSilentFor = 0;
    else this.voSilentFor += dt;
    let want: number;
    if (vo.speaking || vo.nextStartIn <= 0.15) want = 1;
    else if (this.voSilentFor < 0.4) want = this.duckLevel > 0 ? 1 : 0;
    else if (this.duckLevel > 0 && this.voSilentFor + vo.nextStartIn < 2.0) want = 1;
    else want = 0;
    const rate = want > this.duckLevel ? 1 / 0.25 : 1 / 1.0;
    const step = rate * dt;
    this.duckLevel = want > this.duckLevel ? Math.min(want, this.duckLevel + step) : Math.max(want, this.duckLevel - step);
    return this.duckLevel;
  }

  // ------------------------------------------------------------ 自由探索

  private explore(plan: MixPlan, f: AudioFrame, dt: number, now: number): void {
    this.exploreClock += dt;
    if (this.exploreClock >= this.exploreNextCall) {
      const i = this.exploreCalls++;
      const id = EXPLORE_CALLS.ids[i % EXPLORE_CALLS.ids.length];
      if (this.ready(id)) this.dynamic(plan, id, 'Vx', EXPLORE_CALLS.db, 0, now, 'whale', i % 2 ? 0.3 : -0.3, EXPLORE_CALLS.lpf);
      this.exploreNextCall = this.exploreClock + EXPLORE_CALLS.gaps[i % EXPLORE_CALLS.gaps.length];
    }
    // 推近（景别 < 20 m）时骨上的细碎声，密度随骨上的生物数量；景别 > 30 m 时不放
    const fh = f.zoomFrameH ?? 99;
    const dwell = clamp(f.eco?.dwellers ?? 0);
    if (fh < 30 && dwell > 0.05) {
      this.exploreNextTick -= dt * (fh < 20 ? 1 : 0.5);
      if (this.exploreNextTick <= 0) {
        const k = this.exploreTicks++;
        this.dynamic(plan, ['F21a', 'F21c', 'F21b', 'F21d'][k % 4], 'F21', [-36, -38, -35][k % 3], 0, now, 'sfx', [-0.3, 0.2, 0.05, 0.35, -0.15][k % 5]);
        this.exploreNextTick = 6 - 3 * dwell + [0, 0.7, 0.3, 1.1][k % 4];
      }
    }
  }
}
