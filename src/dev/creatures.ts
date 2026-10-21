// 开发用：生物图鉴页。每个格子渲染一个物种，最后两格是鲸落现场的整体群落。
import { Camera } from '../core/Camera';
import { makeShade } from '../core/color';
import { QUALITY } from '../config/performance';
import { WORLD } from '../config/stages';
import { LightingManager } from '../systems/LightingManager';
import { CreatureManager } from '../systems/CreatureManager';
import type { RenderCtx, Layout } from '../core/types';
import type { Creature, CreatureEnv } from '../entities/creatures/base';
import { carcassTop } from '../entities/creatures/base';
import { Atolla, CombJelly, Dumbo, FishSchool, LanternfishGroup, Siphonophore } from '../entities/creatures/midwater';
import { AmphipodSwarm, Crab, Grenadier, Hagfish, SleeperShark } from '../entities/creatures/scavengers';
import { BrittleStar, ClamCluster, Polychaete, SeaPig, Snail, SquatLobster } from '../entities/creatures/benthos';
import { Anglerfish, GlowJelly } from '../entities/creatures/specials';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const W = Number(params.get('w') ?? 1600), H = Number(params.get('h') ?? 1000);
canvas.width = W; canvas.height = H;
const main = canvas.getContext('2d')!;
const X = WORLD.restX, S = WORLD.seabedY;
const layout: Layout = { device: 'desktop', portrait: false, w: W, h: H, aspect: W / H, coarse: false, safe: { top: 0, right: 0, bottom: 0, left: 0 }, compAngle: 0 };
const fullEco = { scav: 1, amph: 1, crabs: 1, enrich: 1, sulfo: 1, dwellers: 1 };
const env: CreatureEnv = { mode: 'explore', p: 0.75, eco: fullEco, camY: 0, time: 0, reduced: false };

type Cell = { label: string; tx: number; ty: number; frameH: number; seabed?: boolean; carcass?: boolean; items?: Creature[]; mgr?: { eco: typeof fullEco; mode: 'story' | 'explore'; secs: number } };
const cells: Cell[] = [
  { label: 'fishSchool', tx: 32, ty: 112, frameH: 9, items: [new FishSchool(1, 50, 32, 112, 0, 20)] },
  { label: 'lanternfish', tx: 18, ty: 560, frameH: 4, items: [new LanternfishGroup(2, 9, 18, 560, 0)] },
  { label: 'combJelly', tx: 20, ty: 380, frameH: 1.1, items: [new CombJelly(3, 20, 380, 0)] },
  { label: 'atolla', tx: 20, ty: 880, frameH: 1.6, items: [new Atolla(4, 20, 880, 0)] },
  { label: 'siphonophore', tx: 20, ty: 1002, frameH: 7, items: [new Siphonophore(5, 20, 1000, 0, 5)] },
  { label: 'dumbo', tx: X, ty: S - 4, frameH: 1.4, seabed: true, items: [new Dumbo(6, X, S - 4, 0)] },
  { label: 'hagfish', tx: X, ty: S - 1, frameH: 1.8, seabed: true, items: [new Hagfish(7, 0), new Hagfish(77, 0)] },
  { label: 'sleeperShark', tx: X, ty: S - 3.3, frameH: 6, seabed: true, items: [new SleeperShark(8)] },
  { label: 'grenadier', tx: X, ty: S - 1.1, frameH: 2.2, seabed: true, items: [new Grenadier(9, 0, X, 0)] },
  { label: 'amphipods', tx: X - 2, ty: S - 0.9, frameH: 1.4, seabed: true, carcass: true, items: [new AmphipodSwarm(10, 300)] },
  { label: 'crab', tx: X + 8, ty: S - 0.25, frameH: 1.0, seabed: true, items: [new Crab(11, 0, X + 8, 0)] },
  { label: 'polychaete + clams', tx: X - 4, ty: S - 0.12, frameH: 0.9, seabed: true, items: [new Polychaete(12, 0, X - 4.2, 0), new Polychaete(13, 0, X - 3.9, 0.2), new ClamCluster(14, 0, X - 3.6, 0.1)] },
  { label: 'snail + squat lobster (bone)', tx: X - 2, ty: S - 1.6, frameH: 1.0, seabed: true, items: [new Snail(15, 0, X - 2.3, X - 1.6, 0, true), new SquatLobster(16, 0, X - 1.8, 0, true)] },
  { label: 'seaPig + brittleStar', tx: X + 12, ty: S - 0.2, frameH: 1.3, seabed: true, items: [new SeaPig(17, 0, X + 12, 0), new BrittleStar(18, 0, X + 12.45, 0.1)] },
  { label: 'anglerfish', tx: X + 25.6, ty: S - 1.5, frameH: 1.6, seabed: true, items: [new Anglerfish(19)] },
  { label: 'glowJelly (hidden)', tx: X - 40, ty: S - 22, frameH: 1.6, items: [new GlowJelly(20)] },
  { label: 'story p≈0.62 scavengers', tx: X - 1, ty: S - 2, frameH: 18, seabed: true, carcass: true, mgr: { eco: { scav: 1, amph: 1, crabs: 1, enrich: 0.3, sulfo: 0, dwellers: 0 }, mode: 'story', secs: 25 } },
  { label: 'explore bone community', tx: X - 1, ty: S - 2, frameH: 14, seabed: true, carcass: true, mgr: { eco: { scav: 0.15, amph: 0.1, crabs: 0.8, enrich: 1, sulfo: 1, dwellers: 1 }, mode: 'explore', secs: 25 } },
  { label: 'explore close-up', tx: X - 3, ty: S - 0.8, frameH: 4, seabed: true, carcass: true, mgr: { eco: { scav: 0.15, amph: 0.1, crabs: 0.8, enrich: 1, sulfo: 1, dwellers: 1 }, mode: 'explore', secs: 25 } },
  { label: 'midwater sinking view', tx: 30, ty: Number(params.get('ty') ?? 1020), frameH: 26, mgr: { eco: { scav: 0, amph: 0, crabs: 0, enrich: 0, sulfo: 0, dwellers: 0 }, mode: 'story', secs: 10 } },
];

const only = params.get('i');
if (only !== null) { const c = cells[Number(only)]; cells.length = 0; cells.push(c); }
const cols = only !== null ? 1 : 5;
const rows = Math.ceil(cells.length / cols);
const cw = Math.floor(W / cols), ch = Math.floor(H / rows);
const light = new LightingManager();
const sh = makeShade();

function drawSeabed(rc: RenderCtx, carcass: boolean): void {
  const { ctx, cam, dpr, w, h } = rc;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = { x: 0, y: 0, s: 0 };
  cam.project(0, S, 400, P);
  const hy = P.y;
  const g = ctx.createLinearGradient(0, hy, 0, h);
  g.addColorStop(0, '#0d2238'); g.addColorStop(1, '#3c3f42');
  ctx.fillStyle = g; ctx.fillRect(0, hy, w, h - hy);
  if (carcass) {
    cam.applyTransform(ctx, dpr, 0, 0, 0, 0, false);
    ctx.fillStyle = 'rgba(70,78,88,0.95)';
    ctx.beginPath();
    for (let x = X - 8.1; x <= X + 5.9; x += 0.2) ctx.lineTo(x, carcassTop(x, 0.4));
    ctx.lineTo(X + 5.9, S); ctx.lineTo(X - 8.1, S); ctx.closePath(); ctx.fill();
  }
}

cells.forEach((cell, i) => {
  const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
  const off = document.createElement('canvas'); off.width = cw; off.height = ch;
  const ctx = off.getContext('2d')!;
  const cam = new Camera(); cam.setViewport(cw, ch);
  cam.setShot({ tx: cell.tx, ty: cell.ty, frameH: cell.frameH, sx: 0.5, sy: 0.5, elev: cell.seabed ? cell.frameH * 0.12 : 0, lat: 0 });
  const deep = cell.ty > 1000;
  light.update(cam, { vis: 60, focusLight: deep ? 0.75 : 0, focusX: cell.tx, focusY: cell.ty, bioGlow: 0, rays: 1, vignette: 0.2 });
  const rc: RenderCtx = { ctx, cam, light, dpr: 1, w: cw, h: ch, time: 5, eco: 5, dt: 1 / 30, quality: QUALITY[2], layout, reducedMotion: false };
  light.drawBackground(rc);
  if (cell.seabed) drawSeabed(rc, !!cell.carcass);
  if (cell.mgr) {
    const m = new CreatureManager();
    m.setQuality(QUALITY[2]);
    for (let k = 0; k < cell.mgr.secs * 30; k++) m.update({ mode: cell.mgr.mode, p: 0.62, eco: cell.mgr.eco, camY: cell.ty, dt: 1 / 30, time: k / 30 });
    m.drawLayer(rc, 8, 1e9); m.drawLayer(rc, -0.5, 8); m.drawLayer(rc, -1e9, -0.5);
    (window as unknown as Record<string, unknown>)['__mgr' + i] = m;
  } else if (cell.items) {
    env.camY = cell.ty;
    for (const c of cell.items) {
      c.active = true; c.alpha = 1; c.wanted = true;
      if (c instanceof Hagfish || c instanceof Grenadier || c instanceof Crab || c instanceof Dumbo || c instanceof SleeperShark || c instanceof SeaPig) { (c as Creature).spawn(env); }
      for (let k = 0; k < 12 * 30; k++) { const h = 1 / 30; c.clock += h; c.step(h, env); if (c instanceof SleeperShark || c instanceof Dumbo) { if (k > 30 * 6) break; } }
      if (c instanceof SleeperShark) { c.x = cell.tx; }
      if (c instanceof Dumbo || c instanceof Grenadier || c instanceof Hagfish) { c.x = cell.tx + (c.x - cell.tx) * 0; c.y = cell.ty + (c instanceof Hagfish ? (c.seed === 77 ? 0.4 : -0.3) : 0); c.z = 0; }
      if (c instanceof Crab || c instanceof SeaPig) c.x = c instanceof SeaPig ? cell.tx - 0.2 : cell.tx;
      c.driver(env);
      if (c === cell.items[0] && !(c instanceof Hagfish) && !(c instanceof Crab) && !(c instanceof SeaPig)) {
        cam.setShot({ tx: c.x, ty: c.y - (c.custom ? 0 : c.size * 0.2), frameH: cell.frameH, sx: 0.5, sy: 0.5, elev: cell.seabed ? cell.frameH * 0.12 : 0, lat: 0 });
        if (cell.label === 'anglerfish' || c instanceof GlowJelly) c.z = 0;
        light.update(cam, { vis: 60, focusLight: deep ? 0.75 : 0, focusX: c.x, focusY: c.y, bioGlow: 0, rays: 1, vignette: 0.2 });
        light.drawBackground(rc);
        if (cell.seabed) drawSeabed(rc, !!cell.carcass);
      }
      if (c instanceof GlowJelly) c.updateVisibility(rc);
      light.shadeAt(c.x, c.y, c.z, sh);
      ctx.globalAlpha = c.alpha * c.extraAlpha;
      if (c.custom) c.drawCustom(rc, sh); else { const s = c.beginLocal(rc); c.render(ctx, rc, s, sh); }
      ctx.globalAlpha = 1;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  main.drawImage(off, ox, oy);
  main.fillStyle = '#fff'; main.font = '13px sans-serif'; main.fillText(cell.label, ox + 6, oy + 16);
  main.strokeStyle = 'rgba(255,255,255,0.2)'; main.strokeRect(ox, oy, cw, ch);
});
(window as unknown as { __done: boolean }).__done = true;
