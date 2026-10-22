import { describe, expect, it } from 'vitest';
import { OPENING_SHOTS, SEGMENTS, segmentScreens, WORLD } from '../src/config/stages';
import { StoryProgressController } from '../src/controllers/StoryProgressController';
import { Camera, type ShotParams } from '../src/core/Camera';
import { StoryTimeline } from '../src/systems/StoryTimeline';

const tl = new StoryTimeline();
const LANDSCAPE = -0.05;

function frameAt(p: number, w = 1440, h = 900) {
  const f = tl.evaluate(p, LANDSCAPE);
  const whale = { ...f.whale1 };
  // 眼睛约在身体参考点前方 1.9 米
  const eye = { x: whale.x + 1.93 * Math.cos(whale.pitch), y: whale.y + 1.93 * Math.sin(whale.pitch) };
  const shot: ShotParams = { tx: 0, ty: 0, frameH: 0, sx: 0, sy: 0, elev: 0, lat: 0 };
  StoryTimeline.shotFrom(f, whale, eye, w / h, shot);
  const cam = new Camera();
  cam.setViewport(w, h);
  cam.setShot(shot);
  return { f, whale, eye, shot, cam, krill: { ...f.krill } };
}

describe('opening: five continuous shots', () => {
  const end = OPENING_SHOTS[OPENING_SHOTS.length - 1].to;

  it('shots tile the opening and run 19–26 s in autoplay', () => {
    expect(OPENING_SHOTS[0].from).toBe(0);
    for (let i = 1; i < OPENING_SHOTS.length; i++) expect(OPENING_SHOTS[i].from).toBe(OPENING_SHOTS[i - 1].to);
    const secs = SEGMENTS.filter((s) => s.to <= end + 1e-9).reduce((a, s) => a + s.seconds, 0);
    expect(secs).toBeGreaterThanOrEqual(19);
    expect(secs).toBeLessThanOrEqual(26);
    // 每个镜头都是关键镜头，并且至少有一整屏的滚动距离可以停留
    for (const s of SEGMENTS.filter((x) => x.to <= end + 1e-9)) {
      expect(s.key).toBe(true);
      expect(segmentScreens(s)).toBeGreaterThanOrEqual(1);
    }
  });

  it('extreme long shot: the whale is small against a vast ocean', () => {
    const { whale, cam } = frameAt(0);
    const len = WORLD.whaleLength * cam.scaleAt(whale.z);
    expect(len / cam.w).toBeLessThan(0.12);
    expect(whale.z).toBeGreaterThan(20);
  });

  it('side tracking shot: the whole body fits in frame', () => {
    const { whale, cam } = frameAt(0.024);
    const len = WORLD.whaleLength * cam.scaleAt(whale.z);
    expect(len / cam.w).toBeGreaterThan(0.2);
    expect(len / cam.w).toBeLessThan(0.75);
  });

  it('low-angle shot: the camera sits below the whale, which passes the upper frame', () => {
    for (const p of [0.04, 0.044]) {
      const { whale, cam } = frameAt(p);
      expect(cam.cy).toBeGreaterThan(whale.y + 4);
      const o = { x: 0, y: 0, s: 0 };
      cam.project(whale.x, whale.y, whale.z, o);
      expect(o.y / cam.h).toBeLessThan(0.5);
    }
  });

  it('eye detail: the camera closes in on the eye', () => {
    const { shot } = frameAt(0.058);
    expect(shot.frameH).toBeLessThan(6);
  });

  it('krill reveal: none at first, then a few strays, then the swarm', () => {
    for (const p of [0, 0.02, 0.045]) {
      const { krill } = frameAt(p);
      expect(krill.visible, `p=${p}`).toBe(0);
      expect(krill.stray, `p=${p}`).toBe(0);
    }
    const a = frameAt(0.06).krill;
    expect(a.stray).toBeGreaterThan(0.9);
    expect(a.visible).toBeLessThan(0.05);
    expect(frameAt(end).krill.visible).toBeGreaterThan(0.95);
  });

  it('the whale moves with weight: unhurried speed and slow turns', () => {
    const dp = 0.0005;
    for (let p = 0; p < end; p += dp) {
      const a = frameAt(p).whale;
      const b = frameAt(p + dp).whale;
      const dt = dp / StoryProgressController.rateAt(p);
      const speed = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt;
      expect(speed, `speed at p=${p.toFixed(4)}`).toBeLessThan(5.5);
      expect(Math.abs(b.pitch - a.pitch) / dt, `turn at p=${p.toFixed(4)}`).toBeLessThan(0.1);
      expect(b.mouth, `mouth at p=${p.toFixed(4)}`).toBeLessThan(0.05);
    }
  });

  it('camera moves smoothly: no jump cuts or fast zooms', () => {
    const dp = 0.0002;
    const o = { x: 0, y: 0, s: 0 };
    // 跟踪鲸鱼头部（眼睛）在画面上的位置
    const screenPos = (fr: ReturnType<typeof frameAt>) => {
      fr.cam.project(fr.eye.x, fr.eye.y, fr.whale.z, o);
      return { x: o.x / fr.cam.h, y: o.y / fr.cam.h };
    };
    let prev = frameAt(0);
    let prevPos = screenPos(prev);
    let maxZoom = 0;
    let maxSlide = 0;
    for (let p = dp; p <= end; p += dp) {
      const fr = frameAt(p);
      const pos = screenPos(fr);
      const dt = dp / StoryProgressController.rateAt(p);
      // 景别每秒变化不超过 40%（缓慢推拉，没有快速变焦）
      maxZoom = Math.max(maxZoom, Math.abs(Math.log(fr.shot.frameH / prev.shot.frameH)) / dt);
      // 鲸鱼头部在画面上的位置每秒移动不超过 0.2 个画面高度（平行跟拍，没有甩镜）
      maxSlide = Math.max(maxSlide, Math.hypot(pos.x - prevPos.x, pos.y - prevPos.y) / dt);
      prev = fr;
      prevPos = pos;
    }
    expect(maxZoom).toBeLessThan(0.4);
    expect(maxSlide).toBeLessThan(0.2);
  });
});

describe('scroll length per segment', () => {
  const adv = StoryProgressController.advance;

  it('one screen of scrolling crosses exactly one opening shot', () => {
    expect(adv(0, 1)).toBeCloseTo(0.014, 9);
    expect(adv(0.014, 1)).toBeCloseTo(0.03, 9);
    expect(adv(0, 0.5)).toBeCloseTo(0.007, 9);
  });

  it('is reversible', () => {
    for (const t of [0.003, 0.05, 0.3, 0.9, 1.02, 2.5]) {
      for (const s of [0.2, 1, 3.7]) expect(adv(adv(t, s), -s)).toBeCloseTo(t, 9);
    }
  });

  it('wraps across the loop seam in both directions', () => {
    const a = adv(0.999, 1);
    expect(a).toBeGreaterThan(1);
    expect(adv(a, -1)).toBeCloseTo(0.999, 9);
    expect(adv(1, -0.01)).toBeLessThan(1);
    expect(adv(1, -0.01)).toBeGreaterThan(0.99);
  });

  it('never rewinds before the very beginning', () => {
    expect(adv(0, -1)).toBe(0);
    expect(adv(0.01, -5)).toBe(0);
  });

  it('a full cycle of scrolling is a sensible length', () => {
    const total = SEGMENTS.reduce((a, s) => a + segmentScreens(s), 0);
    expect(total).toBeGreaterThan(30);
    expect(total).toBeLessThan(45);
    expect(adv(0, total)).toBeCloseTo(1, 6);
  });
});
