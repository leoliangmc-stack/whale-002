import type { ShotParams } from '../core/Camera';
import { clamp, damp, smoothstep, TAU, window4 } from '../core/math';
import type { RenderCtx } from '../core/types';
import type { CameraController } from '../controllers/CameraController';
import { StoryProgressController } from '../controllers/StoryProgressController';
import { StoryTimeline, WHALE_SWITCH, type StoryFrame } from '../systems/StoryTimeline';
import { DescentMotion } from '../systems/DescentMotion';
import { WORLD } from '../config/stages';
import { LOWER_MAX } from '../entities/WhaleBody';
import type { World } from './World';
import type { Whale } from '../entities/Whale';
import type { Wake } from '../systems/ParticleManager';

/**
 * 模式 A：沉浸式循环叙事。每帧只做一件事——由 storyProgress 求出世界状态，
 * 再把它分发给鲸鱼、磷虾、镜头、光照、粒子与生物系统。
 */
export class NarrativeScene {
  private readonly shot: ShotParams = { tx: 0, ty: 0, frameH: 20, sx: 0.5, sy: 0.5, elev: 0, lat: 0 };
  private readonly eye = { x: 0, y: 0 };
  private readonly tmp = { x: 0, y: 0 };
  frame!: StoryFrame;
  private warm = 0;
  /** 停下时的悬停轻摆累积的相位（两头鲸鱼共用，循环衔接处一致） */
  private idle = 0;
  /** 尾叶相对身体的位置与速度（推水） */
  private readonly fluke = { rx: 0, ry: 0, vx: 0, vy: 0, valid: false };

  /** 跳转后让生物“就位”：用若干次大步长模拟，使出现的生物已到达各自的位置。 */
  requestWarmup(seconds = 7): void {
    this.warm = seconds;
  }

  constructor(
    private readonly world: World,
    private readonly camera: CameraController,
    private readonly progress: StoryProgressController,
  ) {
    world.creatures.setDescent(world.timeline.descent);
  }

  update(rc: RenderCtx, dt: number, frozen = false): StoryFrame {
    const { world, camera, progress } = this;
    const p = progress.p;
    const f = world.timeline.evaluate(p, rc.layout.compAngle);
    this.frame = f;
    const w1 = world.whale1;
    const w2 = world.whale2;
    Object.assign(w1.state, f.whale1);
    Object.assign(w2.state, f.whale2);

    // 拍尾相位由故事时间决定，因此拍尾频率天然与游动速度相匹配；
    // 用户停下（或暂停）时，鲸鱼放缓为悬停般的轻摆：相位继续缓慢前进，幅度略微减小
    const rate = StoryProgressController.rateAt(p);
    const motion = frozen ? 0 : clamp(Math.abs(progress.velocity) / Math.max(1e-5, rate * 0.5));
    this.idle += dt * TAU * 0.11 * (1 - motion) * (frozen ? 0.4 : 1);
    for (const w of [w1, w2]) {
      w.phase = w.state.phase + this.idle;
      w.state.swim *= 0.6 + 0.4 * motion;
    }
    w1.prepare();
    w2.prepare();

    // 镜头
    const ref = p < WHALE_SWITCH ? w1 : w2;
    w1.eyePoint(this.eye);
    StoryTimeline.shotFrom(f, ref.state, this.eye, rc.layout.aspect, this.shot);
    camera.applyStory(this.shot, rc.time, rc.reducedMotion ? 0 : 1);

    // 光照：深海中的局部暖光跟随鲸落
    world.lighting.update(camera.cam, {
      vis: f.env.vis,
      focusLight: f.env.focusLight,
      focusX: w1.state.x,
      focusY: w1.state.y,
      bioGlow: f.env.bioGlow,
      rays: 1,
      vignette: f.env.vignette,
      lookUp: clamp(-this.shot.elev / 6),
      rayLen: f.env.rayLen,
      glow: f.env.glow,
      tone: f.env.tone,
      rim: f.env.rim,
      sunlit: f.env.sunlit,
    });

    // 磷虾：由正在接近的那头鲸鱼提供嘴与吻端位置
    const feeder = p < 0.5 ? w1 : w2;
    const k = world.krill;
    feeder.mouthPoint(this.tmp);
    k.mouth.x = this.tmp.x;
    k.mouth.y = this.tmp.y;
    k.mouth.z = feeder.state.z;
    k.mouth.open = feeder.state.mouth;
    feeder.snoutPoint(this.tmp);
    k.snout.x = this.tmp.x;
    k.snout.y = this.tmp.y;
    k.update(f.krill, rc.time, rc.quality.krill, rc.reducedMotion);

    world.seabed.enrich = f.eco.enrich;
    world.seabed.mats = w1.state.mats;
    world.seabed.focusX = w1.state.x;
    // 下沉途中，海床随水体参照系移动，并且只在鲸鱼接近时才从幽暗中显现
    const sb = world.timeline.descent.seabedShift(p, this.tmp);
    world.seabed.shiftX = sb.x;
    world.seabed.shiftY = sb.y;
    world.seabed.reveal = DescentMotion.covers(p) ? 1 - smoothstep(10, 32, WORLD.seabedY + sb.y - (w1.state.y + LOWER_MAX)) : 1;

    // 水体参照系：海洋雪与途中的生物随水体漂移；鲸鱼身体经过时推开附近的颗粒
    const water = f.water;
    const pm = world.particles;
    pm.waterX = water.x;
    pm.waterY = water.y;
    const wk = pm.wake;
    wk.amt = water.wake;
    const mover = p < WHALE_SWITCH ? w1 : w2;
    if (wk.amt > 0) {
      mover.toWorld(-1.9, 0.26, this.tmp);
      wk.x = this.tmp.x;
      wk.y = this.tmp.y;
      wk.z = mover.state.z;
      wk.pitch = mover.state.pitch;
      wk.vx = water.flowX;
      wk.vy = water.flowY;
    }
    this.flukeWash(mover, wk, dt, water.wake * clamp(mover.state.swim + mover.state.beat));

    const cu = { mode: 'story' as const, p, eco: f.eco, camY: camera.cam.cy, dt: frozen ? dt * 0.25 : dt, time: rc.time, reduced: rc.reducedMotion };
    if (this.warm > 0) {
      for (let t = 0; t < this.warm; t += 0.5) world.creatures.update({ ...cu, dt: 0.5 });
      this.warm = 0;
    }
    world.creatures.update(cu);

    const r = world.render;
    r.surface = f.surface.aerial > 0.001 ? f.surface : null;
    r.sediment = f.env.sediment;
    r.breath2 = f.surface.breath2;
    r.bubbles = window4(p, 0.222, 0.232, 0.26, 0.29) * 0.8 + window4(p, 0.112, 0.118, 0.13, 0.15) * 0.6;
    // 快速上升（磷虾回到上层海洋）时减少海洋雪，避免高速闪动
    r.snow = 1 - 0.6 * window4(p, 0.86, 0.875, 0.905, 0.92);
    r.feeding = f.krill.feed > 0 && f.krill.feed < 1 ? feeder : smoothstep(0.07, 0.075, p) > 0 && p < 0.2 ? feeder : null;
    world.particles.update(rc, dt);
    return f;
  }

  /**
   * 尾叶推水：尾叶相对身体的速度（逐帧差分，去掉身体本身的移动），驱动颗粒的局部位移。
   * 只是绘制时的位移场，跳转或暂停时平滑地消失。
   */
  private flukeWash(w: Whale, wk: Wake, dt: number, amt: number): void {
    const f = this.fluke;
    w.flukePoint(this.tmp);
    const bx = w.state.x;
    const by = w.state.y;
    const rx = this.tmp.x - bx;
    const ry = this.tmp.y - by;
    let vx = 0;
    let vy = 0;
    if (f.valid && dt > 1e-4) {
      vx = (rx - f.rx) / dt;
      vy = (ry - f.ry) / dt;
      // 跳转、切换鲸鱼时不要产生突然的推动
      if (Math.hypot(vx, vy) > 6) vx = vy = 0;
    }
    f.rx = rx;
    f.ry = ry;
    f.valid = true;
    f.vx = damp(f.vx, vx, 8, dt);
    f.vy = damp(f.vy, vy, 8, dt);
    wk.flukeX = this.tmp.x;
    wk.flukeY = this.tmp.y;
    wk.flukeVx = f.vx;
    wk.flukeVy = f.vy;
    wk.flukeAmt = amt;
  }

  get currentShot(): ShotParams {
    return this.shot;
  }
}
