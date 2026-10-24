/**
 * 离线混音：用浏览器里同一个声音导演（src/systems/audio/director.ts）与同一张剪辑表，把一整圈叙事
 * （从 p = 0 到下一圈的开头，含循环接缝）按自动播放的节奏混成 WAV，供 scripts/sound-report.py 测量响度、
 * 峰值、削波、旁白压低与接缝。没法用耳朵听，所以用客观指标检查。
 *
 * 用法：npx vite-node scripts/sound-mix.ts -- [--out 目录] [--to 1.04] [--no-vo]
 *   画面数据（相机深度、拍尾相位、下沉速度、生态、撕咬）由 StoryTimeline / Whale / Feast 在 node 里计算，
 *   与 NarrativeScene 的顺序相同；旁白读 public/assets/narration/index.json，没有时用占位：
 *   按字幕字数估算时长（约 4.2 字 / 秒）、带音节起伏的语音频段噪声，归一化到 −18 LUFS（与 narration-tts.py 一致）。
 *
 * 执行层模拟 WebAudio 的行为：setTargetAtTime 的指数逼近、BiquadFilter 低通、StereoPanner 的等功率声像、
 * 单声道素材的 −3 dB 补偿、主增益（界面音量 100%）与安全限幅器（−2 dBFS、20:1、3 ms / 250 ms）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CAPTIONS, secondsAt } from '../src/config/stages';
import { StoryProgressController } from '../src/controllers/StoryProgressController';
import { Camera, type ShotParams } from '../src/core/Camera';
import { Whale } from '../src/entities/Whale';
import { AudioDirector, type AudioFrame, type MixPlan } from '../src/systems/audio/director';
import { AIR_BEDS, BEDS, DUCK_DB, OFF_DB, type BedId, type DuckClass } from '../src/systems/audio/plan';
import { Feast } from '../src/systems/Feast';
import { StoryTimeline, WHALE_SWITCH } from '../src/systems/StoryTimeline';

const SR = 48000;
const FPS = 30;
const BLOCK = SR / FPS;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = path.resolve(opt('--out', path.join(os.tmpdir(), 'whale-fall-mix')));
const TO = Number(opt('--to', '1.04'));
const VO = !args.includes('--no-vo');
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ 素材

interface Clip {
  ch: Float32Array[];
  dur: number;
  lufs: number;
  loop?: [number, number];
}

function decode(file: string): Float32Array[] {
  const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file]).toString().trim();
  const n = Number(info.split('\n')[0]) || 1;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ar', String(SR), 'pipe:1'], { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const len = Math.floor(all.length / n);
  const ch: Float32Array[] = [];
  for (let c = 0; c < n; c++) {
    const a = new Float32Array(len);
    for (let i = 0; i < len; i++) a[i] = all[i * n + c];
    ch.push(a);
  }
  return ch;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/manifest.json'), 'utf8')) as {
  audio: Record<string, { file: string; lufs: number; loop?: [number, number] }>;
};
const clips = new Map<string, Clip>();
for (const [key, e] of Object.entries(manifest.audio)) {
  const ch = decode(path.join(ROOT, 'public/assets', e.file));
  clips.set(key, { ch, dur: ch[0].length / SR, lufs: e.lufs, loop: e.loop });
}

// ------------------------------------------------------------------ 响度（BS.1770，48 kHz）

function kweight(x: Float32Array): Float64Array {
  const y = new Float64Array(x.length);
  const s = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const h = [1, -2, 1, -1.99004745483398, 0.99007225036621];
  let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const u = s[0] * v + s[1] * a1 + s[2] * a2 - s[3] * b1 - s[4] * b2;
    a2 = a1; a1 = v; b2 = b1; b1 = u;
    const w = h[0] * u + h[1] * c1 + h[2] * c2 - h[3] * d1 - h[4] * d2;
    c2 = c1; c1 = u; d2 = d1; d1 = w;
    y[i] = w;
  }
  return y;
}

function lufsI(ch: Float32Array[]): number {
  const k = ch.map(kweight);
  const n = SR * 0.4;
  const hop = SR * 0.1;
  const z: number[] = [];
  for (let i = 0; i + n <= k[0].length; i += hop) {
    let p = 0;
    for (const c of k) for (let j = i; j < i + n; j++) p += c[j] * c[j];
    z.push(p / n);
  }
  const L = (v: number) => -0.691 + 10 * Math.log10(v + 1e-20);
  const g1 = z.filter((v) => L(v) > -70);
  if (!g1.length) return -70;
  const rel = L(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
  const g2 = g1.filter((v) => L(v) > rel);
  return L(g2.reduce((a, b) => a + b, 0) / g2.length);
}

// ------------------------------------------------------------------ 旁白（真实录音或占位）

interface VoClip {
  i: number;
  ch: Float32Array[];
}

function placeholder(i: number): Float32Array {
  const c = CAPTIONS[i];
  const chars = (c.text + (c.sub ?? '')).replace(/[，。、；：！？“”…—\s,.]/g, '').length;
  const pauses = ((c.text + (c.sub ?? '')).match(/[，。、；：！？…—]/g) ?? []).length;
  const dur = chars / 4.2 + pauses * 0.25 + (c.sub ? 0.35 : 0) + 0.2;
  const n = Math.round(dur * SR);
  const x = new Float32Array(n);
  // 确定性的噪声（不随机）：线性同余
  let seed = 12345 + i * 777;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let lp = 0;
  let lp2 = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    lp += 0.3 * (rnd() - lp);
    lp2 += 0.02 * (lp - lp2);
    const hp = lp - lp2;
    const syl = Math.pow(Math.abs(Math.sin(Math.PI * 4.3 * t)), 1.5);
    const edge = Math.min(1, t / 0.05, (dur - t) / 0.08);
    x[j] = hp * syl * Math.max(0, edge);
  }
  const l = lufsI([x]);
  const g = Math.pow(10, (-18 - l) / 20);
  for (let j = 0; j < n; j++) x[j] *= g;
  return x;
}

function loadVo(): VoClip[] {
  const dir = path.join(ROOT, 'public/assets/narration');
  const idx = path.join(dir, 'index.json');
  if (fs.existsSync(idx)) {
    const list = JSON.parse(fs.readFileSync(idx, 'utf8')) as Array<{ i: number; file: string }>;
    return list.map((c) => ({ i: c.i, ch: decode(path.join(dir, c.file)) }));
  }
  return CAPTIONS.map((_, i) => ({ i, ch: [placeholder(i)] }));
}
const voClips = VO ? loadVo() : [];
const voReal = fs.existsSync(path.join(ROOT, 'public/assets/narration/index.json'));

/** 旁白的简化模拟（与 Narration 相同的规则：进入新字幕时开始；上一条没读完就排队，最多等 3.5 s） */
class VoSim {
  playing: { i: number; pos: number; len: number } | null = null;
  queued: { i: number; since: number } | null = null;
  lastCap = -1;
  readonly state = { speaking: false, nextStartIn: Infinity };
  constructor(private readonly clips: Map<number, Float32Array[]>) {}
  capAt(p: number): number {
    let k = -1;
    for (let i = 0; i < CAPTIONS.length; i++) if (p >= CAPTIONS[i].from && p < CAPTIONS[i].to) k = i;
    return k;
  }
  update(p: number, time: number): void {
    const cap = this.capAt(p);
    if (cap !== this.lastCap && cap >= 0) {
      this.lastCap = cap;
      const c = CAPTIONS[cap];
      const into = (secondsAt(p) - secondsAt(c.from)) / Math.max(0.5, secondsAt(c.to) - secondsAt(c.from));
      if (into <= 0.45 && this.clips.has(cap)) {
        if (this.playing) this.queued = { i: cap, since: time };
        else this.playing = { i: cap, pos: 0, len: this.clips.get(cap)![0].length };
      }
    } else if (cap < 0) this.lastCap = -1;
    if (this.queued && !this.playing) {
      if (time - this.queued.since < 3.5) this.playing = { i: this.queued.i, pos: 0, len: this.clips.get(this.queued.i)![0].length };
      this.queued = null;
    }
    this.state.speaking = !!this.playing;
    let best = Infinity;
    if (this.queued && this.playing) best = (this.playing.len - this.playing.pos) / SR;
    else for (let i = 0; i < CAPTIONS.length; i++) if (CAPTIONS[i].from > p && this.clips.has(i)) best = Math.min(best, secondsAt(CAPTIONS[i].from) - secondsAt(p));
    this.state.nextStartIn = best;
  }
  render(n: number, out: Float32Array[]): void {
    const pl = this.playing;
    if (!pl) return;
    const ch = this.clips.get(pl.i)!;
    for (let j = 0; j < n && pl.pos < pl.len; j++, pl.pos++) {
      const l = ch[0][pl.pos];
      const r = (ch[1] ?? ch[0])[pl.pos];
      // 旁白是单声道：与 StereoPanner 居中一样按等功率放在中间
      out[0][j] += ch.length === 1 ? l * Math.SQRT1_2 : l;
      out[1][j] += ch.length === 1 ? r * Math.SQRT1_2 : r;
    }
    if (pl.pos >= pl.len) this.playing = null;
  }
}

// ------------------------------------------------------------------ 执行层（模拟 WebAudio）

class Lowpass {
  private z = [0, 0, 0, 0, 0, 0, 0, 0];
  private b = [1, 0, 0, 0, 0];
  freq = 1000;
  set(hz: number): void {
    this.freq = hz;
    const w = (2 * Math.PI * Math.min(hz, SR * 0.45)) / SR;
    const al = Math.sin(w) / (2 * 0.7071);
    const c = Math.cos(w);
    const a0 = 1 + al;
    this.b = [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0];
  }
  run(x: number, ch: number): number {
    const z = this.z;
    const o = ch * 4;
    const [b0, b1, b2, a1, a2] = this.b;
    const y = b0 * x + b1 * z[o] + b2 * z[o + 1] - a1 * z[o + 2] - a2 * z[o + 3];
    z[o + 1] = z[o];
    z[o] = x;
    z[o + 3] = z[o + 2];
    z[o + 2] = y;
    return y;
  }
}

const db2g = (db: number) => Math.pow(10, db / 20);
const expK = (tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-1 / (tau * SR)));

interface BedState {
  id: BedId;
  on: boolean;
  pos: number;
  g: number;
  lp: Lowpass;
  silent: number;
}

interface Shot {
  vid: number;
  id: string;
  clip: Clip;
  pos: number;
  g: number;
  fade: number | null;
  fadeStep: number;
  pan: number;
  panTo?: number;
  panStep: number;
  duck: DuckClass;
  lp: Lowpass | null;
}

const beds = new Map<BedId, BedState>();
for (const id of BEDS) {
  const lp = new Lowpass();
  lp.set(2000);
  beds.set(id, { id, on: false, pos: 0, g: 0, lp, silent: 0 });
}
const shots: Shot[] = [];
const busG: Record<string, number> = { bed: 1, air: 1, sfx: 1, hero: 1, free: 1, whale: 1, gull: 1, sperm: 1, ui: 1 };
let pauseG = 1;

const director = new AudioDirector((id) => clips.get(id)?.dur, (id) => clips.has(id));
const tl = new StoryTimeline();
const w1 = new Whale(1);
const w2 = new Whale(1);
const feast = new Feast();
const cam = new Camera();
cam.setViewport(1440, 900);
const shot: ShotParams = { tx: 0, ty: 0, frameH: 20, sx: 0.5, sy: 0.5, elev: 0, lat: 0 };
const eye = { x: 0, y: 0 };
const vo = new VoSim(new Map(voClips.map((c) => [c.i, c.ch])));

const totalSec = secondsAt(1) * TO + 1;
const N = Math.ceil(totalSec * SR);
const stems: Record<string, Float32Array[]> = {};
for (const k of ['mix', 'bed', 'sfx', 'bio', 'vo']) stems[k] = [new Float32Array(N), new Float32Array(N)];
const log: { frames: unknown[]; events: unknown[]; limiter: { maxGr: number; overs: number; prePeak: number } } = {
  frames: [],
  events: [],
  limiter: { maxGr: 0, overs: 0, prePeak: 0 },
};

let total = 0;
let time = 0;
let frameIdx = 0;
let limG = 1;
const thr = db2g(-2);
const atk = expK(0.003);
const rel = expK(0.25);

function frameData(): AudioFrame {
  const p = total - Math.floor(total);
  const f = tl.evaluate(p, 0);
  Object.assign(w1.state, f.whale1);
  Object.assign(w2.state, f.whale2);
  w1.phase = w1.state.phase;
  w2.phase = w2.state.phase;
  w1.prepare();
  w2.prepare();
  const ref = p < WHALE_SWITCH ? w1 : w2;
  w1.eyePoint(eye);
  StoryTimeline.shotFrom(f, ref.state, eye, 1440 / 900, shot);
  cam.setShot(shot);
  feast.update(p, time, w1);
  const mover = p < WHALE_SWITCH ? w1 : w2;
  const beat = p >= 0.262 && p < 0.33;
  vo.update(p, time);
  return {
    mode: 'story',
    p,
    total,
    paused: false,
    velocity: StoryProgressController.rateAt(p),
    autoRate: StoryProgressController.rateAt(p),
    camDepth: cam.cy,
    stroke: beat ? { phase: w1.state.beatPh, amp: w1.state.beat } : { phase: mover.phase, amp: mover.state.swim * mover.state.visible },
    sink: p > 0.3 && p < 0.5 ? Math.max(0, f.water.flowY) : 0,
    eco: f.eco,
    feast: p > 0.55 && p < 0.72 ? feast.sound() : null,
    vo: VO ? vo.state : null,
  };
}

function execute(plan: MixPlan, now: number): void {
  for (const c of plan.fade) {
    const s = shots.find((x) => x.vid === c.vid);
    if (s && s.fade === null) {
      s.fade = s.g;
      s.fadeStep = s.g / Math.max(1, c.dur * SR);
    }
  }
  for (const c of plan.play) {
    const clip = clips.get(c.id);
    if (!clip) continue;
    const delay = Math.round((c.at - now) * SR);
    let lp: Lowpass | null = null;
    if (c.lpf) {
      lp = new Lowpass();
      lp.set(c.lpf);
    }
    shots.push({
      vid: c.vid, id: c.id, clip, pos: -Math.max(0, delay), g: db2g(c.db - clip.lufs), fade: null, fadeStep: 0,
      pan: c.pan, panTo: c.panTo, panStep: c.panTo !== undefined ? (c.panTo - c.pan) / ((c.panDur ?? 2) * SR) : 0, duck: c.duck, lp,
    });
    log.events.push({ t: now + Math.max(0, delay) / SR, p: total, id: c.id, db: c.db, label: c.label, duck: c.duck });
  }
}

const tmp = { bed: [new Float32Array(BLOCK), new Float32Array(BLOCK)], air: [new Float32Array(BLOCK), new Float32Array(BLOCK)] };

for (let start = 0; start + BLOCK <= N; start += BLOCK) {
  const dt = 1 / FPS;
  const f = frameData();
  const now = start / SR;
  const plan = director.step(dt, f, now);
  execute(plan, now);

  // 循环床
  for (const k of ['bed', 'air'] as const) for (const c of tmp[k]) c.fill(0);
  const tau = plan.bedTau;
  for (const b of beds.values()) {
    const lv = plan.beds[b.id];
    const clip = clips.get(b.id);
    if (!clip) continue;
    const on = lv.db > OFF_DB && lv.w > 1e-4;
    const mono = clip.ch.length === 1;
    const target = on ? lv.w * db2g(lv.db - clip.lufs - (mono ? 3.01 : 0)) : 0;
    if (on && !b.on) {
      b.on = true;
      const [a, e] = clip.loop ?? [0, clip.dur];
      b.pos = Math.round((a + ((now * 0.618) % (e - a))) * SR);
      b.g = 0;
    }
    if (!b.on) continue;
    b.lp.set(b.lp.freq + (Math.min(lv.lpf, SR * 0.45) - b.lp.freq) * (1 - Math.exp(-dt / tau)));
    const k = expK(tau);
    const [a, e] = clip.loop ?? [0, clip.dur];
    const la = Math.round(a * SR);
    const le = Math.round(e * SR);
    const dst = AIR_BEDS.has(b.id) ? tmp.air : tmp.bed;
    for (let j = 0; j < BLOCK; j++) {
      b.g += (target - b.g) * k;
      if (b.pos >= le) b.pos = la + (b.pos - le);
      for (let c = 0; c < 2; c++) {
        const src = clip.ch[mono ? 0 : c];
        dst[c][j] += b.lp.run(src[b.pos], c) * b.g;
      }
      b.pos++;
    }
    b.silent = target > 0 ? 0 : b.silent + dt;
    if (b.silent > 3) b.on = false;
  }

  // 母线增益：旁白压低与暂停
  const want: Record<string, number> = {};
  for (const k of Object.keys(busG)) want[k] = db2g((DUCK_DB as Record<string, number>)[k] * plan.duck);
  const kb = expK(0.03);
  const kp = expK(plan.pauseTau);
  const pauseT = db2g(plan.pauseDb);

  const out = { sfx: [new Float32Array(BLOCK), new Float32Array(BLOCK)], bio: [new Float32Array(BLOCK), new Float32Array(BLOCK)], vo: [new Float32Array(BLOCK), new Float32Array(BLOCK)] };
  // 一次性音效（按各自的母线增益）
  const busNow = { ...busG };
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const ch = s.clip.ch;
    const mono = ch.length === 1;
    const dst = s.duck === 'whale' ? out.bio : out.sfx;
    for (let j = 0; j < BLOCK; j++) {
      if (s.pos < 0) {
        s.pos++;
        continue;
      }
      if (s.pos >= ch[0].length) break;
      if (s.fade !== null) {
        s.g = Math.max(0, s.g - s.fadeStep);
      }
      const bg = busNow[s.duck] ?? 1;
      let l = ch[0][s.pos];
      let r = (ch[1] ?? ch[0])[s.pos];
      if (s.lp) {
        l = s.lp.run(l, 0);
        r = mono ? l : s.lp.run(r, 1);
      }
      // StereoPanner：单声道等功率；立体声按 WebAudio 的平衡算法
      const pan = s.pan;
      const x = mono ? (pan + 1) / 2 : pan <= 0 ? pan + 1 : pan;
      const gl = Math.cos((x * Math.PI) / 2);
      const gr = Math.sin((x * Math.PI) / 2);
      let ol: number, or: number;
      if (mono) {
        ol = l * gl;
        or = l * gr;
      } else if (pan <= 0) {
        ol = l + r * gl;
        or = r * gr;
      } else {
        ol = l * gl;
        or = r + l * gr;
      }
      dst[0][j] += ol * s.g * bg;
      dst[1][j] += or * s.g * bg;
      if (s.panTo !== undefined) s.pan = s.panStep > 0 ? Math.min(s.panTo, s.pan + s.panStep) : Math.max(s.panTo, s.pan + s.panStep);
      s.pos++;
    }
    if (s.pos >= ch[0].length || (s.fade !== null && s.g <= 0)) shots.splice(i, 1);
  }
  for (const k of Object.keys(busG)) busG[k] += (want[k] - busG[k]) * (1 - Math.pow(1 - kb, BLOCK));

  // 旁白
  vo.render(BLOCK, out.vo);

  // 汇总、主增益（界面音量 100%）与安全限幅器
  const air2500 = -3 * plan.duck; // 空气床的 2.5 kHz 峰值衰减：在测量里忽略（≤ 3 dB 的窄带）
  void air2500;
  for (let j = 0; j < BLOCK; j++) {
    pauseG += (pauseT - pauseG) * kp;
    const i = start + j;
    for (let c = 0; c < 2; c++) {
      const bed = (tmp.bed[c][j] * busG.bed + tmp.air[c][j] * busG.air) * pauseG;
      stems.bed[c][i] = bed;
      stems.sfx[c][i] = out.sfx[c][j];
      stems.bio[c][i] = out.bio[c][j];
      stems.vo[c][i] = out.vo[c][j];
    }
    const L = stems.bed[0][i] + stems.sfx[0][i] + stems.bio[0][i] + stems.vo[0][i];
    const R = stems.bed[1][i] + stems.sfx[1][i] + stems.bio[1][i] + stems.vo[1][i];
    const pk = Math.max(Math.abs(L), Math.abs(R));
    log.limiter.prePeak = Math.max(log.limiter.prePeak, pk);
    if (pk > db2g(-1)) log.limiter.overs++;
    const want2 = pk > thr ? (thr * Math.pow(pk / thr, 1 / 20)) / pk : 1;
    limG += (want2 - limG) * (want2 < limG ? atk : rel);
    log.limiter.maxGr = Math.min(log.limiter.maxGr, 20 * Math.log10(limG));
    stems.mix[0][i] = L * limG;
    stems.mix[1][i] = R * limG;
  }

  if (frameIdx % 3 === 0) {
    log.frames.push({
      t: now, p: f.p, total, depth: Math.round(f.camDepth * 10) / 10, duck: Math.round(plan.duck * 100) / 100, speaking: vo.state.speaking,
      beds: Object.fromEntries(BEDS.map((id) => [id, plan.beds[id].db > OFF_DB && plan.beds[id].w > 1e-4 ? Math.round((plan.beds[id].db + 20 * Math.log10(plan.beds[id].w)) * 10) / 10 : null])),
      shots: shots.length,
    });
  }
  frameIdx++;
  time += dt;
  total += StoryProgressController.rateAt(total - Math.floor(total)) * dt;
  if (total > TO) break;
}

function writeWav(file: string, ch: Float32Array[], len: number): void {
  const n = len;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(ch[0][i], 44 + i * 8);
    buf.writeFloatLE(ch[1][i], 48 + i * 8);
  }
  fs.writeFileSync(file, buf);
}

const len = Math.min(N, Math.round(time * SR));
const tag = VO ? 'vo' : 'novo';
for (const k of Object.keys(stems)) writeWav(path.join(OUT, `${tag}-${k}.wav`), stems[k], len);
fs.writeFileSync(path.join(OUT, `${tag}-log.json`), JSON.stringify({ ...log, seconds: time, cycleSeconds: secondsAt(1), voReal }, null, 0));
console.log(`${tag}: ${time.toFixed(1)} s rendered, ${log.events.length} one-shots, limiter max GR ${log.limiter.maxGr.toFixed(2)} dB, pre-limiter peak ${(20 * Math.log10(log.limiter.prePeak)).toFixed(2)} dBFS, samples over −1 dBFS ${log.limiter.overs}, narration ${voReal ? 'real' : 'placeholder'}`);
