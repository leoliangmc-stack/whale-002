import { hex, makeShade, mixRGB, rgba, shade, shadeRGB, type RGB, type Shade } from '../core/color';
import { clamp, fbm1, hash1, lerp, rng, smoothstep, TAU } from '../core/math';
import type { RenderCtx } from '../core/types';
import { ROCKS, type RockDef } from '../config/scene';
import { WORLD } from '../config/stages';

/**
 * 海床：透视地面、远处海底山脊、岩石、沉积物细节、前景的海鳃与玻璃海绵，
 * 以及鲸落周围逐渐形成的“有机质富集晕”和沉积物上的细菌斑。
 * 属于 ParallaxManager 的分层结构：far（山脊）→ ground（地面与 z>0 的物体）→ near（z<0 的前景）。
 */

type FeatureKind = 'pebble' | 'mound' | 'ripple' | 'burrow' | 'seapen' | 'sponge' | 'crinoid';

interface Feature {
  kind: FeatureKind;
  x: number;
  z: number;
  s: number;
  seed: number;
}

interface Rock {
  def: RockDef;
  path: Path2D;
  growths: Array<{ x: number; y: number; s: number; kind: number }>;
}

interface Ridge {
  z: number;
  xs: Float32Array;
  hs: Float32Array;
}

const C = {
  sand: hex('#5f6260'),
  sandFar: hex('#3a4656'),
  rock: hex('#4a525c'),
  rockLight: hex('#717a83'),
  rockDark: hex('#262c33'),
  pebble: hex('#8d8676'),
  burrow: hex('#2c2a26'),
  seapen: hex('#c9a27e'),
  sponge: hex('#d8d3c4'),
  crinoid: hex('#b9746a'),
  halo: hex('#2b2b2b'),
  mat: hex('#ece6cf'),
  ridge: hex('#3a4654'),
};

export class Seabed {
  readonly y = WORLD.seabedY;
  private features: Feature[] = [];
  private rocks: Rock[] = [];
  private ridges: Ridge[] = [];
  private readonly sh: Shade = makeShade();
  private readonly tmp: RGB = [0, 0, 0];
  private readonly P = { x: 0, y: 0, s: 0 };
  private built = -1;
  /** 富集晕与沉积物细菌斑（由生态状态设置） */
  enrich = 0;
  mats = 0;
  focusX = WORLD.restX;
  /**
   * 海床从幽暗中显现的程度（0~1）。一千八百米深处没有阳光，下沉时海床只有在鲸鱼接近时
   * 才逐渐从深蓝的水雾里浮现；其余时候为 1。
   */
  reveal = 1;
  /**
   * 叙事下沉途中，海床与海洋雪一样属于水体参照系：以这个偏移（米）绘制，
   * 鲸鱼相对海床的接近速度就是它相对水体的可见下沉速度。接触海床时偏移恰好为 0。
   */
  shiftX = 0;
  shiftY = 0;

  /** 以水体参照系的偏移平移镜头（尚未显现时不绘制） */
  private begin(rc: RenderCtx): boolean {
    if (this.reveal <= 0.001) return false;
    rc.cam.cx -= this.shiftX;
    rc.cam.cy -= this.shiftY;
    return true;
  }

  private end(rc: RenderCtx): void {
    rc.cam.cx += this.shiftX;
    rc.cam.cy += this.shiftY;
  }

  drawFar(rc: RenderCtx): void {
    if (!this.begin(rc)) return;
    this.farLayer(rc);
    this.end(rc);
  }

  drawGround(rc: RenderCtx): void {
    if (!this.begin(rc)) return;
    this.groundLayer(rc);
    this.end(rc);
  }

  drawNear(rc: RenderCtx): void {
    if (!this.begin(rc)) return;
    this.nearLayer(rc);
    this.end(rc);
  }

  /** 叠加“尚未显现”的水雾 */
  private haze(sh: Shade): void {
    if (this.reveal < 1) sh.fog = 1 - (1 - sh.fog) * clamp(this.reveal);
  }

  build(detail: number): void {
    if (this.built === detail) return;
    this.built = detail;
    const r = rng(42);
    const X = WORLD.restX;
    this.features = [];
    const n = Math.round(900 * detail);
    for (let i = 0; i < n; i++) {
      const z = -12 + Math.pow(r(), 1.6) * 150;
      const spread = 70 + z * 0.9;
      const x = X + (r() * 2 - 1) * spread;
      const t = r();
      let kind: FeatureKind = 'pebble';
      if (t > 0.985) kind = 'sponge';
      else if (t > 0.95) kind = 'seapen';
      else if (t > 0.925) kind = 'crinoid';
      else if (t > 0.86) kind = 'mound';
      else if (t > 0.78) kind = 'burrow';
      else if (t > 0.66) kind = 'ripple';
      this.features.push({ kind, x, z, s: 0.5 + r() * 1.2, seed: i });
    }
    // 前景的几株海鳃 / 海绵，形成视差遮挡
    const fg: Array<[number, number, FeatureKind]> = [
      [X - 15.4, -10.3, 'seapen'],
      [X + 18.9, -8.6, 'sponge'],
      [X - 37.7, -12.9, 'crinoid'],
      [X + 32.6, -15.4, 'seapen'],
      [X - 5.1, -17.1, 'sponge'],
      [X + 56.6, -10.3, 'crinoid'],
    ];
    fg.forEach(([x, z, kind], i) => this.features.push({ kind, x, z, s: 1.6, seed: 5000 + i }));
    this.features.sort((a, b) => b.z - a.z);

    this.rocks = ROCKS.map((def) => this.makeRock(def));
    this.rocks.sort((a, b) => b.def.z - a.def.z);

    this.ridges = [];
    const ridgeZ = [150, 270, 430];
    ridgeZ.forEach((z, k) => {
      const m = 90;
      const xs = new Float32Array(m);
      const hs = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        const x = X - 700 + (i / (m - 1)) * 1400;
        xs[i] = x;
        hs[i] = Math.max(0, 18 + k * 22 + fbm1(x * 0.006 + k * 10, 7 + k, 4) * (40 + k * 40));
      }
      this.ridges.push({ z, xs, hs });
    });
  }

  private makeRock(def: RockDef): Rock {
    const r = rng(def.seed * 977);
    const path = new Path2D();
    const n = 9;
    const pts: Array<[number, number]> = [];
    // 圆润的巨石：超椭圆上半部 + 少量起伏，底部略微埋入沉积物
    const lean = (r() - 0.5) * 0.35;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = Math.PI + t * Math.PI;
      const rr = 0.86 + r() * 0.2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.8) * def.w * 0.5 * rr + lean * def.w * (1 + sa) * 0.3;
      const y = -Math.pow(Math.abs(sa), 0.7) * def.h * rr;
      pts.push([x, y]);
    }
    path.moveTo(pts[0][0], 0.2);
    path.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    path.lineTo(pts[n][0], pts[n][1]);
    path.lineTo(pts[n][0], 0.2);
    path.closePath();
    const growths: Rock['growths'] = [];
    for (let i = 0; i < 4; i++) {
      const idx = 2 + Math.floor(r() * (pts.length - 4));
      growths.push({ x: pts[idx][0], y: pts[idx][1] + 0.05, s: 0.12 + r() * 0.22, kind: r() });
    }
    return { def, path, growths };
  }

  /** 点击是否落在某块岩石上（由近到远检测） */
  hitRock(rc: RenderCtx, sx: number, sy: number): boolean {
    const { ctx, cam, dpr } = rc;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      if (r.def.z - cam.cz < 1) continue;
      ctx.save();
      cam.applyTransform(ctx, dpr, r.def.x, this.y, r.def.z);
      const hit = ctx.isPointInPath(r.path, sx * dpr, sy * dpr);
      ctx.restore();
      if (hit) return true;
    }
    return false;
  }

  /** 海床是否出现在画面中 */
  visible(rc: RenderCtx): boolean {
    const b = rc.cam.boundsAt(0);
    return b.b > this.y - 103 && rc.cam.cy < this.y + 1;
  }

  /** 地面在深度 z 处的屏幕 y */
  private groundY(rc: RenderCtx, z: number): number {
    const cam = rc.cam;
    return cam.py + (this.y - cam.cy) * cam.scaleAt(z);
  }

  private farLayer(rc: RenderCtx): void {
    if (!this.visible(rc)) return;
    this.build(rc.quality.seabedDetail);
    const { ctx, cam, dpr } = rc;
    const sh = this.sh;
    for (const r of this.ridges) {
      rc.light.shadeAt(cam.cx, this.y - 40, r.z, sh);
      sh.fog = Math.min(0.94, sh.fog + 0.15);
      this.haze(sh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = shade(C.ridge, sh);
      ctx.beginPath();
      const s = cam.scaleAt(r.z);
      const base = cam.py + (this.y - cam.cy) * s;
      let started = false;
      for (let i = 0; i < r.xs.length; i++) {
        const sx = cam.px + (r.xs[i] - cam.cx) * s;
        if (sx < -400 || sx > rc.w + 400) continue;
        const sy = base - r.hs[i] * s;
        if (!started) {
          ctx.moveTo(sx, base + 2);
          started = true;
        }
        ctx.lineTo(sx, sy);
      }
      if (started) {
        ctx.lineTo(rc.w + 400, base + 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** 地面 + 位于主体后方（z ≥ 0）的岩石与细节 */
  private groundLayer(rc: RenderCtx): void {
    if (!this.visible(rc)) return;
    this.build(rc.quality.seabedDetail);
    const { ctx, cam, dpr, w, h } = rc;
    const sh = this.sh;
    const horizon = this.groundY(rc, 2000);
    if (horizon > h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 地面渐变：从远处的雾色到近处被光照亮的沉积物
    const g = ctx.createLinearGradient(0, horizon, 0, h);
    const zs = [400, 120, 40, 12, 0, -cam.dist * 0.6];
    for (const z of zs) {
      const yy = this.groundY(rc, z);
      const t = clamp((yy - horizon) / Math.max(1, h - horizon));
      rc.light.shadeAt(this.focusX + 103, this.y, z, sh);
      this.haze(sh);
      const base = mixRGB(C.sandFar, C.sand, smoothstep(160, 10, z), this.tmp);
      g.addColorStop(t, rgba(shadeRGB(base, sh, this.tmp)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(0, horizon - 1), w, h - horizon + 1);

    // 主体周围被局部光照亮的地面
    if (rc.light.focusLight > 0.01 && cam.project(rc.light.focusX, this.y, 0, this.P)) {
      const R = 44.6 * this.P.s;
      const yy = this.P.y;
      ctx.save();
      ctx.translate(this.P.x, yy);
      ctx.scale(1, 0.22 + 0.25 * clamp(cam.shot.elev / 8));
      const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      const fl = rc.light.focusLight * clamp(this.reveal);
      lg.addColorStop(0, `rgba(196,190,160,${0.3 * fl})`);
      lg.addColorStop(0.5, `rgba(170,170,150,${0.12 * fl})`);
      lg.addColorStop(1, 'rgba(150,160,150,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-R, -R, R * 2, R * 2);
      ctx.restore();
    }

    this.drawHalo(rc);
    this.drawFeatures(rc, 0, 1e9);
    this.drawRocks(rc, 0, 1e9);
  }

  /** 前景（z<0）：岩石、海鳃等，产生视差遮挡 */
  private nearLayer(rc: RenderCtx): void {
    if (!this.visible(rc)) return;
    this.drawFeatures(rc, -1e9, 0);
    this.drawRocks(rc, -1e9, 0);
  }

  /** 鲸落周围：富含有机质的深色沉积物，以及其上的白色细菌斑 */
  private drawHalo(rc: RenderCtx): void {
    if (this.enrich < 0.01) return;
    const { ctx, cam, dpr } = rc;
    if (!cam.project(WORLD.restX - 1.71, this.y, 0, this.P)) return;
    const sh = this.sh;
    rc.light.shadeAt(WORLD.restX, this.y, 0, sh);
    this.haze(sh);
    const yNear = this.groundY(rc, -8.6);
    const yFar = this.groundY(rc, 10.3);
    const ry = Math.max(2, (yNear - yFar) / 2);
    const rx = 20.6 * this.P.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(this.P.x, (yNear + yFar) / 2);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, shade(C.halo, sh, 0.55 * this.enrich));
    g.addColorStop(0.7, shade(C.halo, sh, 0.25 * this.enrich));
    g.addColorStop(1, shade(C.halo, sh, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (this.mats > 0.01) {
      ctx.fillStyle = shade(C.mat, sh, 1, 0.2);
      for (let i = 0; i < 40; i++) {
        const th = hash1(i * 7 + 1);
        const k = smoothstep(th, th + 0.2, this.mats);
        if (k <= 0) continue;
        const ang = hash1(i * 7 + 2) * TAU;
        const d = Math.sqrt(hash1(i * 7 + 3));
        const x = WORLD.restX - 1.71 + Math.cos(ang) * d * 17.1;
        const z = Math.sin(ang) * d * 8.6;
        if (!cam.project(x, this.y, z, this.P)) continue;
        const s = (0.14 + hash1(i * 7 + 4) * 0.38) * this.P.s * k;
        ctx.globalAlpha = 0.3 * k;
        ctx.beginPath();
        ctx.ellipse(this.P.x, this.P.y, s * 1.6, s * 0.3, 0, 0, TAU);
        ctx.ellipse(this.P.x + s * 1.2, this.P.y + s * 0.1, s * 0.8, s * 0.18, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawFeatures(rc: RenderCtx, zMin: number, zMax: number): void {
    const { ctx, cam, dpr, time } = rc;
    const sh = this.sh;
    const P = this.P;
    const b = cam.boundsAt(0, 20);
    const sway = rc.reducedMotion ? 0.3 : 1;
    for (const f of this.features) {
      if (f.z < zMin || f.z >= zMax) continue;
      if (f.z - cam.cz < 1.5) continue;
      if (!cam.project(f.x, this.y, f.z, P)) continue;
      const span = (b.r - b.l) * (1 + f.z / Math.max(1, cam.dist)) * 0.6;
      if (Math.abs(f.x - cam.cx) > span + 10) continue;
      if (P.x < -80 || P.x > rc.w + 80 || P.y < -10 || P.y > rc.h + 300) continue;
      const s = P.s;
      const size = f.s * s;
      if (size < 0.6 && f.kind !== 'seapen' && f.kind !== 'sponge') continue;
      rc.light.shadeAt(f.x, this.y, f.z, sh);
      this.haze(sh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      switch (f.kind) {
        case 'pebble': {
          const ps = Math.min(size, 60);
          ctx.fillStyle = shade(C.pebble, sh, 0.7);
          ctx.beginPath();
          ctx.ellipse(P.x, P.y - ps * 0.04, ps * 0.09, ps * 0.045, 0, 0, TAU);
          ctx.fill();
          break;
        }
        case 'mound': {
          ctx.fillStyle = shade(C.sand, sh, 0.2, 0.15);
          ctx.beginPath();
          ctx.ellipse(P.x, P.y, size * 0.6, size * 0.12, 0, Math.PI, TAU);
          ctx.fill();
          ctx.fillStyle = shade(C.burrow, sh, 0.7);
          ctx.beginPath();
          ctx.ellipse(P.x, P.y - size * 0.1, size * 0.06, size * 0.025, 0, 0, TAU);
          ctx.fill();
          break;
        }
        case 'ripple': {
          ctx.strokeStyle = shade(C.sand, sh, 0.35, 0.25);
          ctx.lineWidth = Math.max(0.5, size * 0.03);
          ctx.beginPath();
          ctx.moveTo(P.x - size * 0.8, P.y);
          ctx.quadraticCurveTo(P.x, P.y - size * 0.05, P.x + size * 0.8, P.y);
          ctx.stroke();
          break;
        }
        case 'burrow': {
          ctx.fillStyle = shade(C.burrow, sh, 0.6);
          ctx.beginPath();
          ctx.ellipse(P.x, P.y, size * 0.07, size * 0.025, 0, 0, TAU);
          ctx.fill();
          break;
        }
        case 'seapen':
          this.drawSeapen(ctx, P.x, P.y, s * f.s, sh, time * sway + f.seed);
          break;
        case 'sponge':
          this.drawSponge(ctx, P.x, P.y, s * f.s, sh);
          break;
        case 'crinoid':
          this.drawCrinoid(ctx, P.x, P.y, s * f.s, sh, time * sway + f.seed);
          break;
      }
    }
  }

  private drawSeapen(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, sh: Shade, t: number): void {
    const hgt = 0.55 * s;
    const lean = Math.sin(t * 0.5) * 0.08 * hgt;
    ctx.strokeStyle = shade(C.seapen, sh, 0.85);
    ctx.lineWidth = Math.max(0.6, 0.02 * s);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.3, y - hgt * 0.5, x + lean, y - hgt);
    ctx.stroke();
    ctx.fillStyle = shade(C.seapen, sh, 0.7, 0.1);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t2 = 0.35 + (i / n) * 0.62;
      const px = x + lean * t2 * t2;
      const py = y - hgt * t2;
      const lw = 0.07 * s * Math.sin(Math.PI * ((i + 1) / (n + 1)));
      ctx.beginPath();
      ctx.ellipse(px - lw * 0.7, py, lw, lw * 0.25, -0.5, 0, TAU);
      ctx.ellipse(px + lw * 0.7, py, lw, lw * 0.25, 0.5, 0, TAU);
      ctx.fill();
    }
  }

  private drawSponge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, sh: Shade): void {
    const hgt = 0.34 * s;
    const wdt = 0.08 * s;
    const g = ctx.createLinearGradient(x - wdt, 0, x + wdt, 0);
    g.addColorStop(0, shade(C.sponge, sh, 0.25));
    g.addColorStop(0.5, shade(C.sponge, sh, 0.5, 0.1));
    g.addColorStop(1, shade(C.sponge, sh, 0.22));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - wdt * 0.4, y);
    ctx.quadraticCurveTo(x - wdt * 1.2, y - hgt * 0.6, x - wdt, y - hgt);
    ctx.lineTo(x + wdt, y - hgt);
    ctx.quadraticCurveTo(x + wdt * 1.2, y - hgt * 0.6, x + wdt * 0.4, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(C.rockDark, sh, 0.6);
    ctx.beginPath();
    ctx.ellipse(x, y - hgt, wdt, wdt * 0.25, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade(C.sponge, sh, 0.25);
    ctx.lineWidth = Math.max(0.5, s * 0.006);
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(x - wdt, y - hgt * (i / 5));
      ctx.lineTo(x + wdt, y - hgt * (i / 5));
      ctx.stroke();
    }
  }

  private drawCrinoid(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, sh: Shade, t: number): void {
    const hgt = 0.6 * s;
    const lean = Math.sin(t * 0.4) * 0.05 * hgt;
    ctx.strokeStyle = shade(C.crinoid, sh, 0.8);
    ctx.lineWidth = Math.max(0.6, 0.012 * s);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - lean, y - hgt * 0.6, x + lean, y - hgt);
    ctx.stroke();
    const cx = x + lean;
    const cy = y - hgt;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 9 - 0.5) * 2.4 + Math.sin(t * 0.7 + i) * 0.08;
      const L = 0.16 * s;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(a) * L * 0.6, cy + Math.sin(a) * L * 0.6 - L * 0.1, cx + Math.cos(a) * L, cy + Math.sin(a) * L + L * 0.25);
      ctx.stroke();
    }
  }

  private drawRocks(rc: RenderCtx, zMin: number, zMax: number): void {
    const { ctx, cam, dpr } = rc;
    const sh = this.sh;
    for (const r of this.rocks) {
      const d = r.def;
      if (d.z < zMin || d.z >= zMax) continue;
      if (d.z - cam.cz < 1) continue;
      const P = this.P;
      if (!cam.project(d.x, this.y, d.z, P)) continue;
      if (P.x + d.w * P.s < 0 || P.x - d.w * P.s > rc.w) continue;
      rc.light.shadeAt(d.x, this.y, d.z, sh);
      this.haze(sh);
      const near = d.z < 0;
      if (near) sh.light *= 0.55;
      cam.applyTransform(ctx, dpr, d.x, this.y, d.z);
      const g = ctx.createLinearGradient(0, -d.h, 0, 0.2);
      g.addColorStop(0, shade(C.rockLight, sh));
      g.addColorStop(0.45, shade(C.rock, sh));
      g.addColorStop(1, shade(C.rockDark, sh));
      ctx.fillStyle = g;
      ctx.fill(r.path);
      // 接地阴影
      ctx.fillStyle = shade(C.rockDark, sh, 0.5);
      ctx.beginPath();
      ctx.ellipse(0, 0.15, d.w * 0.6, d.h * 0.06, 0, 0, TAU);
      ctx.fill();
      for (const gr of r.growths) {
        ctx.fillStyle = gr.kind > 0.6 ? shade(C.sponge, sh, 0.8) : shade(C.crinoid, sh, 0.7);
        ctx.beginPath();
        ctx.ellipse(gr.x, gr.y - gr.s * 0.4, gr.s * 0.25, gr.s * 0.5, 0, 0, TAU);
        ctx.fill();
      }
      void lerp;
    }
  }
}
