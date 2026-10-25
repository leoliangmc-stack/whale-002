import { describe, expect, it } from 'vitest';
import { SHARK_BITES } from '../src/config/feast';
import { secondsAt } from '../src/config/stages';
import { AudioDirector, type AudioFrame } from '../src/systems/audio/director';
import { AIR_BEDS, BEDS, bedLevels, CUES, inSeamGuard, OFF_DB, strokeLevel, views, type BedId } from '../src/systems/audio/plan';
import manifestJson from '../public/assets/manifest.json';

// 测试在 node 里运行；项目没有安装 node 的类型声明，这里按需动态导入
const fs = (await import('node:fs' as string)) as {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
  readFileSync(p: string, enc: string): string;
};
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);
const file = (rel: string) => ROOT + rel;
const manifest = manifestJson as unknown as {
  audio: Record<string, { file: string; batch: number; lufs: number; loop?: [number, number] }>;
};

const DUR: Record<string, number> = {};
for (const k of Object.keys(manifest.audio)) DUR[k] = k.startsWith('A') ? 30 : 3;

function frame(p: number, extra: Partial<AudioFrame> = {}): AudioFrame {
  return { mode: 'story', p, total: p, paused: false, velocity: 0.002, autoRate: 0.002, camDepth: 20, ...extra };
}

/** 按自动播放的速度从 a 走到 b（累计进度），返回触发的素材编号（按顺序）与导演 */
function run(a: number, b: number, opts: { speed?: number; vo?: (t: number) => AudioFrame['vo']; d?: AudioDirector } = {}) {
  const d = opts.d ?? new AudioDirector((id) => DUR[id]);
  const dt = 1 / 30;
  const rate = 0.0025;
  const speed = opts.speed ?? 1;
  const played: Array<{ id: string; total: number; db: number; t: number }> = [];
  let total = a;
  let t = 0;
  d.step(dt, frame(total % 1, { total, velocity: rate * speed, autoRate: rate }), t);
  while (total < b) {
    total += rate * speed * dt;
    t += dt;
    const plan = d.step(dt, frame(total % 1, { total, velocity: rate * speed, autoRate: rate, vo: opts.vo?.(t) ?? null }), t);
    for (const c of plan.play) played.push({ id: c.id, total, db: c.db, t });
  }
  return { played, d, t };
}

describe('sound plan: continuous layers are pure functions of the picture', () => {
  it('beds are continuous across the loop seam (same values on both sides)', () => {
    const a = bedLevels({ mode: 'story', p: 0.9999, depth: 12.5, sink: 0, eco: null });
    const b = bedLevels({ mode: 'story', p: 0.0001, depth: 12.5, sink: 0, eco: null });
    for (const id of BEDS) {
      expect(Math.abs(a[id].db - b[id].db), id).toBeLessThan(0.05);
      expect(Math.abs(a[id].w - b[id].w), id).toBeLessThan(0.01);
      expect(Math.abs(Math.log(a[id].lpf / b[id].lpf)), id).toBeLessThan(0.01);
    }
  });

  it('point of view: no underwater sound in the aerial shot, only air in the air', () => {
    const on = (l: { db: number; w: number }) => l.db > OFF_DB && l.w > 1e-3;
    const air = bedLevels({ mode: 'story', p: 0.17, depth: -200, sink: 0, eco: null });
    for (const id of BEDS) expect(on(air[id]), id).toBe(id === 'A04');
    // 水线中景：近处的拍打为主，水下床压到约 0.2（−14 dB）
    const wl = views(0.21);
    expect(wl.wl).toBeCloseTo(1, 3);
    expect(wl.uw).toBeCloseTo(0.2, 3);
    const uw = bedLevels({ mode: 'story', p: 0.25, depth: 10, sink: 0, eco: null });
    for (const id of AIR_BEDS) expect(on(uw[id]), id).toBe(false);
    expect(on(uw.A01)).toBe(true);
    // 出水的水下层在 0.4 秒内（0.154–0.155）交叉淡出
    expect(views(0.1538).uw).toBeGreaterThan(0.99);
    expect(views(0.1552).uw).toBeLessThan(0.01);
  });

  it('depth curves: deep bed only below ~100 m, open-water bed gone below 300 m', () => {
    const at = (d: number, id: BedId) => bedLevels({ mode: 'story', p: 0.42, depth: d, sink: 0, eco: null })[id].db;
    expect(at(80, 'A03')).toBeLessThan(OFF_DB);
    expect(at(1300, 'A03')).toBeCloseTo(-32, 1);
    expect(at(400, 'A01')).toBeLessThan(OFF_DB);
    expect(at(1000, 'A07')).toBeCloseTo(-30, 1);
  });

  it('sinking flow grows with the square of the sinking speed', () => {
    const at = (s: number) => bedLevels({ mode: 'story', p: 0.4, depth: 1000, sink: s, eco: null }).A08.db;
    expect(at(2.3)).toBeCloseTo(-28, 1);
    expect(at(1.15)).toBeCloseTo(-28 - 12.04, 1);
    expect(at(0.1)).toBeLessThan(OFF_DB);
  });

  it('tail strokes are not triggered in the air or during the long descent', () => {
    expect(strokeLevel(0.17)).toBeNull();
    expect(strokeLevel(0.6)).toBeNull();
    expect(strokeLevel(0.047)).toBe(-26);
  });
});

describe('sound plan: one-shot cues', () => {
  it('every cue has an asset, none is inside the loop-seam guard, cues are sorted', () => {
    for (const c of CUES) {
      expect(manifest.audio[c.id], c.id).toBeDefined();
      expect(inSeamGuard(c.p), c.label).toBe(false);
    }
    for (let i = 1; i < CUES.length; i++) expect(CUES[i].p).toBeGreaterThanOrEqual(CUES[i - 1].p);
  });

  it('shark bites follow the picture data (bite + 0.001, tear + 0.016)', () => {
    for (const b of SHARK_BITES) {
      expect(CUES.some((c) => c.id.startsWith('F17') && Math.abs(c.p - (b.p + 0.001)) < 1e-9)).toBe(true);
      expect(CUES.some((c) => /^F18[cd]$/.test(c.id) && Math.abs(c.p - (b.p + 0.016)) < 1e-9)).toBe(true);
    }
  });
});

describe('sound director: triggering', () => {
  it('forward playback triggers each cue once, in order', () => {
    const { played } = run(0, 0.25);
    const ids = played.map((x) => x.id).filter((id) => !id.startsWith('F01'));
    expect(ids).toEqual(CUES.filter((c) => c.p < 0.25).map((c) => c.id));
  });

  it('the loop seam does not lose or repeat cues (cumulative progress)', () => {
    const { played } = run(0.97, 1.05);
    const ids = played.map((x) => x.id).filter((id) => !id.startsWith('F01'));
    // 第二圈：新的鲸鱼入场时远处的叫声（p 0.008，在接缝保护区之外）、巨体滑过、近处的鲸鸣
    expect(ids).toEqual(['V03', 'F02', 'V01']);
    expect(played.every((x) => !inSeamGuard(x.total % 1))).toBe(true);
  });

  it('reverse playback never triggers; fast scrolling keeps only the leading sounds, at least 2 s apart', () => {
    const d = new AudioDirector((id) => DUR[id]);
    let total = 0.3;
    let n = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      total -= 0.004 / 30;
      n += d.step(1 / 30, frame(total, { total, velocity: -0.004 }), t).play.length;
    }
    expect(n).toBe(0);

    const fast = run(0, 0.25, { speed: 2.5 }).played;
    const ids = fast.map((x) => x.id);
    for (const id of ids) expect(CUES.find((c) => c.id === id)?.hero, id).toBe(true);
    expect(ids.some((id) => id.startsWith('V'))).toBe(false);
    for (let i = 1; i < fast.length; i++) expect(fast[i].t - fast[i - 1].t).toBeGreaterThanOrEqual(2 - 1e-9);

    expect(run(0, 0.25, { speed: 4 }).played.length).toBe(0);
  });

  it('a jump fades what is playing and triggers nothing', () => {
    const d = new AudioDirector((id) => DUR[id]);
    const V01 = CUES.find((c) => c.id === 'V01')!;
    const { t } = run(0, V01.p + 0.002, { d });
    expect(d.activeCount).toBeGreaterThan(0);
    const plan = d.step(1 / 30, frame(0.6, { total: 0.6, jumped: true }), t + 1 / 30);
    expect(plan.play.length).toBe(0);
    expect(plan.fade.length).toBeGreaterThan(0);
    expect(plan.bedTau).toBeCloseTo(0.3);
  });

  it('whale calls wait for the narration to finish (+0.5 s), or play −8 dB at the latest point', () => {
    // 旁白一直说到 V01 的触发点之后 1 秒：V01 等旁白结束 0.5 秒后才唱；一直在说话时，到最晚的时刻以 −8 dB 唱
    const V01 = CUES.find((c) => c.id === 'V01')!;
    const until = (end: number) => (t: number) => ({ speaking: t < end, nextStartIn: Infinity });
    const tV = V01.p / 0.0025;
    const end = V01.latest! + 0.003;
    const a = run(0, end, { vo: until(tV + 1) }).played.find((x) => x.id === 'V01')!;
    expect(a.t).toBeGreaterThanOrEqual(tV + 1.5 - 0.05);
    expect(a.db).toBe(-19);
    const b = run(0, end, { vo: until(99) }).played.find((x) => x.id === 'V01')!;
    expect(b.total).toBeGreaterThanOrEqual(V01.latest!);
    expect(b.db).toBe(-27);
  });
  it('a waiting whale call keeps waiting while the story is paused, and plays after resume + 0.5 s of silence', () => {
    const d = new AudioDirector((id) => DUR[id]);
    const dt = 1 / 30;
    const rate = 0.0025;
    const V01 = CUES.find((c) => c.id === 'V01')!;
    let total = V01.p - 0.002;
    let t = 0;
    const ids: Array<{ id: string; t: number }> = [];
    const step = (paused: boolean, speaking: boolean) => {
      if (!paused) total += rate * dt;
      t += dt;
      const plan = d.step(dt, frame(total, { total, paused, velocity: paused ? 0 : rate, autoRate: rate, vo: { speaking, nextStartIn: Infinity } }), t);
      for (const c of plan.play) ids.push({ id: c.id, t });
    };
    step(false, true);
    // 旁白在说话时越过 V01 的触发点：进入等待
    while (total < V01.p + 0.0005) step(false, true);
    expect(ids.some((x) => x.id === 'V01')).toBe(false);
    // 暂停 5 秒：旁白停在半句（不在说话），鲸鸣仍然等待
    for (let i = 0; i < 150; i++) step(true, false);
    expect(ids.some((x) => x.id === 'V01')).toBe(false);
    // 继续播放：旁白接着把这句读完（1 秒），然后安静
    for (let i = 0; i < 30; i++) step(false, true);
    expect(ids.some((x) => x.id === 'V01')).toBe(false);
    const quietAt = t;
    for (let i = 0; i < 30; i++) step(false, false);
    const v = ids.find((x) => x.id === 'V01');
    expect(v).toBeDefined();
    expect(v!.t - quietAt).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });
});

describe('sound director: narration ducking envelope', () => {
  it('starts 0.15 s ahead, is down within 0.25 s, holds through short gaps, releases 0.4 s + 1 s after', () => {
    const d = new AudioDirector((id) => DUR[id]);
    const dt = 1 / 100;
    const env: number[] = [];
    // 句子 A：2–5 s；句子 B：6.5–9 s（间隔 1.5 s < 2 s，保持压低）；之后安静
    const speaking = (t: number) => (t >= 2 && t < 5) || (t >= 6.5 && t < 9);
    const next = (t: number) => (t < 2 ? 2 - t : t >= 5 && t < 6.5 ? 6.5 - t : Infinity);
    for (let t = 0; t < 14; t += dt) env.push(d.step(dt, frame(0.5, { total: 0.5, velocity: 0, vo: { speaking: speaking(t), nextStartIn: next(t) } }), t).duck);
    const at = (t: number) => env[Math.round(t / dt)];
    expect(at(1.8)).toBe(0);
    expect(at(1.86)).toBeGreaterThan(0);
    expect(at(2.12)).toBe(1);
    expect(at(5.9)).toBe(1); // 句间保持
    expect(at(9.35)).toBe(1); // 结束后 0.4 s 内不动
    expect(at(9.9)).toBeGreaterThan(0.4);
    expect(at(10.5)).toBe(0);
  });
});

describe('sound assets', () => {
  it('manifest files exist, total size ≤ 3 MB, loops are sane and long enough', () => {
    let total = 0;
    for (const [k, e] of Object.entries(manifest.audio)) {
      const f = file('public/assets/' + e.file);
      expect(fs.existsSync(f), k).toBe(true);
      total += fs.statSync(f).size;
      expect([0, 1, 2, 3, 4]).toContain(e.batch);
      expect(e.lufs).toBeLessThan(-14);
      if (k.startsWith('A')) {
        expect(e.loop, k).toBeDefined();
        expect(e.loop![1] - e.loop![0], k).toBeGreaterThanOrEqual(12);
      }
    }
    expect(total).toBeLessThanOrEqual(3 * 1024 * 1024);
    for (const id of BEDS) expect(manifest.audio[id], id).toBeDefined();
  });

  it('no synthesized narrative sound, no random timing, no setTimeout scheduling, no convolver', () => {
    const src = ['src/systems/AudioManager.ts', 'src/systems/audio/director.ts', 'src/systems/audio/plan.ts'].map((f) => fs.readFileSync(file(f), 'utf8')).join('\n');
    expect(src.match(/createOscillator/g)?.length ?? 0).toBe(1); // 只有界面的“新发现”提示音
    expect(src).not.toMatch(/Math\.random|setTimeout|createConvolver|createBuffer\(/);
  });

  it('opening cues land where the picture is (reference seconds)', () => {
    // 出水的“破水”在 F06 开始后 0.6 s，对齐画面水线扫过中央（p ≈ 0.1545）
    const f06 = CUES.find((c) => c.id === 'F06')!;
    expect(secondsAt(0.1545) - secondsAt(f06.p)).toBeCloseTo(0.6, 2);
  });
});
