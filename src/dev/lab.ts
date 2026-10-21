// 开发用：在多个格子里渲染不同状态的鲸鱼，便于检查造型。
import { Camera } from '../core/Camera';
import { QUALITY } from '../config/performance';
import { LightingManager } from '../systems/LightingManager';
import { Whale } from '../entities/Whale';
import type { RenderCtx, Layout } from '../core/types';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const W = 1600, H = 1000, dpr = 1;
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d')!;
const params = new URLSearchParams(location.search);
const mode = params.get('m') ?? 'grid';

const layout: Layout = { device: 'desktop', portrait: false, w: W, h: H, aspect: W / H, coarse: false, safe: { top: 0, right: 0, bottom: 0, left: 0 }, compAngle: 0 };

type Cell = { label: string; y: number; frameH: number; ox?: number; oy?: number; set: (w: Whale) => void };
const cells: Cell[] = mode === 'eye' ? [
  { label: 'eye open', y: 8, frameH: 2.2, ox: 1.95, oy: 0.0, set: (w) => { w.state.eye = 1; } },
  { label: 'eye half', y: 8, frameH: 2.2, ox: 1.95, oy: 0.0, set: (w) => { w.state.eye = 0.5; } },
  { label: 'eye closed', y: 8, frameH: 2.2, ox: 1.95, oy: 0.0, set: (w) => { w.state.eye = 0; } },
  { label: 'head', y: 8, frameH: 7, ox: 3, oy: 0.3, set: (w) => { w.state.mouth = 0; } },
] : [
  { label: 'swim', y: 60, frameH: 18, set: () => {} },
  { label: 'mouth 0.5', y: 60, frameH: 18, set: (w) => { w.state.mouth = 0.5; w.state.throat = 0.4; } },
  { label: 'mouth 1', y: 60, frameH: 18, set: (w) => { w.state.mouth = 1; w.state.throat = 1; } },
  { label: 'throat full closed', y: 60, frameH: 18, set: (w) => { w.state.mouth = 0.0; w.state.throat = 0.8; } },
  { label: 'sinking', y: 600, frameH: 18, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.eye = 0; w.state.bend = 0.3; w.state.pitch = 0.1; } },
  { label: 'rest', y: 1798.3, frameH: 18, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.eye = 0; w.state.rest = 1; } },
  { label: 'decay 0.6', y: 1798.3, frameH: 18, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.eye = 0; w.state.rest = 1; w.state.tissue = 0.6; } },
  { label: 'decay 0.25', y: 1798.3, frameH: 18, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.eye = 0; w.state.rest = 1; w.state.tissue = 0.25; w.state.collapse = 0.2; } },
  { label: 'skeleton', y: 1798.3, frameH: 18, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.rest = 1; w.state.tissue = 0; w.state.collapse = 0.0; } },
  { label: 'skeleton collapsed + life', y: 1798.3, frameH: 18, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.rest = 1; w.state.tissue = 0; w.state.collapse = 1; w.state.mats = 0.8; w.state.osedax = 0.9; w.state.burial = 0.5; } },
  { label: 'skull close', y: 1798.3, frameH: 4, ox: 3.5, oy: 0, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.rest = 1; w.state.tissue = 0; w.state.collapse = 1; w.state.mats = 0.8; w.state.osedax = 0.9; } },
  { label: 'vertebra micro', y: 1798.3, frameH: 0.9, ox: -1.5, oy: -0.6, set: (w) => { w.state.swim = 0; w.state.life = 0; w.state.rest = 1; w.state.tissue = 0; w.state.collapse = 1; w.state.mats = 0.8; w.state.osedax = 0.9; } },
];

const only = params.get('i');
if (only !== null) { const c = cells[Number(only)]; cells.length = 0; cells.push(c); }
const cols = only !== null ? 1 : mode === 'eye' ? 2 : 4;
const rows = Math.ceil(cells.length / cols);
const cw = W / cols, ch = H / rows;
const light = new LightingManager();
const phase = Number(params.get('phase') ?? 1.2);

cells.forEach((cell, i) => {
  const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
  const cam = new Camera();
  cam.setViewport(cw, ch);
  cam.setShot({ tx: (cell.ox ?? 0), ty: cell.y + (cell.oy ?? 0), frameH: cell.frameH, sx: 0.5, sy: 0.5, elev: 0, lat: 0 });
  light.update(cam, { vis: 70, focusLight: cell.y > 1000 ? 0.7 : 0, focusX: 0, focusY: cell.y, bioGlow: 0, rays: 1, vignette: 0 });
  const w = new Whale(1);
  w.state.y = cell.y;
  w.phase = phase;
  cell.set(w);
  w.prepare();
  ctx.save();
  ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
  // 局部画布偏移：通过包一层平移实现
  const off = document.createElement('canvas');
  off.width = cw; off.height = ch;
  const octx = off.getContext('2d')!;
  const rc: RenderCtx = { ctx: octx, cam, light, dpr, w: cw, h: ch, time: 3, eco: 3, dt: 0.016, quality: QUALITY[2], layout, reducedMotion: false };
  light.drawBackground(rc);
  if (cell.y > 1000) {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    const P = { x: 0, y: 0, s: 0 }; cam.project(0, 1800, 0, P);
    octx.fillStyle = '#2a3036'; octx.fillRect(0, P.y, cw, ch - P.y);
  }
  w.drawInterior(rc);
  w.draw(rc);
  ctx.drawImage(off, cx, cy);
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText(cell.label, cx + 8, cy + 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.strokeRect(cx, cy, cw, ch);
});
(window as unknown as { __done: boolean }).__done = true;
