import { hash2, rng, TAU } from './math';

/**
 * 程序化生成的小型纹理（精灵）。正式美术资源到位后，可通过 AssetRegistry
 * 用同名图片替换这些纹理，而无需改动绘制逻辑。
 */

export type Tex = HTMLCanvasElement | HTMLImageElement;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return [c, ctx];
}

/** 柔和圆形光斑（白色，使用时通过 globalAlpha 与混合模式着色）。 */
export function softDot(size = 64, hardness = 0.0, color = '255,255,255'): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(Math.max(0.01, hardness), `rgba(${color},${hardness > 0 ? 0.9 : 0.75})`);
  g.addColorStop(0.55, `rgba(${color},0.28)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/**
 * 接触阴影：高斯衰减的深色软斑（中心不透明、边缘完全消失、没有可见的圆边），
 * 叠加成鲸鱼、鳍与尾叶在海床上的分区域软阴影。
 */
export function softShadow(size = 64, color = '3,7,13'): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    g.addColorStop(t, `rgba(${color},${(Math.exp(-3.2 * t * t) - Math.exp(-3.2)) / (1 - Math.exp(-3.2))})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** 团状水雾（多个软圆叠加的不规则云团）。 */
export function mistPuff(size = 96, seed = 1): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const r = rng(seed);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * size * 0.18;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const rad = size * (0.18 + r() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return c;
}

/**
 * 可平铺的焦散纹理：通过对 Voronoi 单元边缘的距离取亮度，得到水面折射光网。
 */
export function causticTile(size = 256, seed = 7): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const cells = 7;
  const pts: Array<[number, number]> = [];
  const r = rng(seed);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + r()) / cells, (j + r()) / cells]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let d1 = 9;
      let d2 = 9;
      for (const p of pts) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const dx = u - (p[0] + ox);
            const dy = v - (p[1] + oy);
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) d2 = d;
          }
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const k = Math.max(0, 1 - edge * cells * 2.2);
      const a = Math.pow(k, 3.2);
      const idx = (y * size + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 斑驳的皮肤纹理（灰度，叠加在鲸鱼身体上增加质感）。 */
export function skinTexture(w = 512, h = 160, seed = 3): Tex {
  const [c, ctx] = makeCanvas(w, h);
  const r = rng(seed);
  for (let i = 0; i < 520; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 1 + r() * r() * 9;
    const light = r() > 0.55;
    ctx.fillStyle = light ? `rgba(255,255,255,${0.05 + r() * 0.1})` : `rgba(0,0,0,${0.05 + r() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rad * (1 + r()), rad, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** 近景皮肤细节（可平铺）：细小的毛孔、浅色斑点与几道柔和的褶痕。 */
export function skinDetailTile(size = 256, seed = 11): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const r = rng(seed);
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(ox, oy);
  };
  for (let i = 0; i < 700; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 0.6 + r() * r() * 2.6;
    const dark = r() > 0.35;
    const a = dark ? 0.1 + r() * 0.16 : 0.05 + r() * 0.1;
    ctx.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    wrap((ox, oy) => {
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, rad * 1.3, rad, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x = r() * size;
    const y = r() * size;
    const len = 18 + r() * 50;
    const bend = (r() - 0.5) * 16;
    ctx.strokeStyle = `rgba(0,0,0,${0.06 + r() * 0.06})`;
    ctx.lineWidth = 0.8 + r() * 1.2;
    wrap((ox, oy) => {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.quadraticCurveTo(x + ox + len / 2, y + oy + bend, x + ox + len, y + oy + bend * 0.3);
      ctx.stroke();
    });
  }
  return c;
}

/** 海面俯视纹理：多方向细浪的高光。 */
export function waveTile(size = 256, seed = 5): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  const waves: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 9; i++) {
    const kx = Math.round((r() * 2 - 1) * 5) || 1;
    const ky = Math.round((r() * 2 - 1) * 5) || 1;
    waves.push([kx, ky, r() * Math.PI * 2, 0.4 + r() * 0.6]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hsum = 0;
      for (const [kx, ky, ph, a] of waves) hsum += a * Math.sin(((x * kx + y * ky) / size) * Math.PI * 2 + ph);
      const n = hash2(x, y);
      const v = Math.max(0, hsum / 3.2) ** 2.4 + n * 0.04;
      const idx = (y * size + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.min(255, v * 210);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * 从水下仰望的海面波光（可平铺）：一道道被拉长、边缘起伏的明亮波峰，像参考画面上缘那层发亮的水面。
 * 每一层是沿竖向重复、横向缓缓起伏的波峰线，几层不同疏密的叠在一起。
 */
export function surfaceRippleTile(w = 256, h = 128, seed = 9): Tex {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const r = rng(seed);
  const layers = [3, 4, 6, 9].map((ky, i) => ({
    ky,
    kx: 1 + (i % 3),
    a1: 0.12 + r() * 0.1,
    a2: 0.05 + r() * 0.05,
    p0: r(),
    p1: r(),
    p2: r(),
    wt: 1 - i * 0.18,
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      let s = 0;
      for (const L of layers) {
        const ph = v * L.ky + L.p0 + L.a1 * Math.sin(TAU * (u * L.kx + L.p1)) + L.a2 * Math.sin(TAU * (u * (L.kx + 2) + L.p2));
        const crest = Math.pow(0.5 + 0.5 * Math.cos(TAU * ph), 7);
        // 波峰沿横向时亮时暗，断成一段段
        const seg = 0.55 + 0.45 * Math.sin(TAU * (u * (L.kx + 3) + L.p2 + v * 0.5));
        s += crest * seg * L.wt;
      }
      const a = Math.min(1, Math.pow(s, 1.2));
      const idx = (y * w + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 磷虾精灵：头朝右，橙红色半透明身体、细足与黑色复眼。 */
export function krillSprite(size = 48, deep = false): Tex {
  const [c, ctx] = makeCanvas(size, Math.round(size * 0.5));
  const w = size;
  const h = size * 0.5;
  ctx.translate(w * 0.5, h * 0.5);
  const s = w / 48;
  ctx.scale(s, s);
  const body = deep ? 'rgba(214,74,46,0.95)' : 'rgba(240,104,58,0.95)';
  const light = deep ? 'rgba(250,150,110,0.8)' : 'rgba(255,186,140,0.85)';
  // 腹部节段（向左弯曲的尾部）
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(14, -2);
  ctx.quadraticCurveTo(4, -6, -8, -4);
  ctx.quadraticCurveTo(-17, -2, -21, 2);
  ctx.lineTo(-17, 4);
  ctx.quadraticCurveTo(-6, 3, 8, 4);
  ctx.quadraticCurveTo(14, 3, 14, -2);
  ctx.fill();
  // 尾扇
  ctx.beginPath();
  ctx.moveTo(-20, 2);
  ctx.lineTo(-24, -1);
  ctx.lineTo(-23, 5);
  ctx.closePath();
  ctx.fill();
  // 背部高光
  ctx.strokeStyle = light;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(12, -2.6);
  ctx.quadraticCurveTo(0, -5.6, -14, -2);
  ctx.stroke();
  // 胸足
  ctx.strokeStyle = 'rgba(240,120,80,0.7)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) {
    const x = 9 - i * 3.2;
    ctx.beginPath();
    ctx.moveTo(x, 3.5);
    ctx.lineTo(x - 2.5, 8.5);
    ctx.stroke();
  }
  // 触角
  ctx.beginPath();
  ctx.moveTo(15, -2);
  ctx.quadraticCurveTo(21, -7, 24, -9);
  ctx.moveTo(15, -1);
  ctx.quadraticCurveTo(22, -3, 24, -2);
  ctx.stroke();
  // 复眼
  ctx.fillStyle = 'rgba(20,10,10,0.95)';
  ctx.beginPath();
  ctx.arc(14, -1, 2.3, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** 海床沉积物的颗粒噪声纹理。 */
export function sedimentTile(size = 128, seed = 9): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const r = rng(seed);
  for (let i = 0; i < 900; i++) {
    const x = r() * size;
    const y = r() * size;
    const a = 0.04 + r() * 0.1;
    ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 1 + r() * 2, 1 + r() * 1.5);
  }
  return c;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 扇形光束底部与顶部的宽度比 */
export const FAN_SPREAD = 2.1;

/**
 * 光束：上窄下宽的柔和光柱，每一行都是同样的高斯横截面，宽度从顶部的 1/FAN_SPREAD 线性增加到底部的整幅；
 * 沿长度渐隐。纹理宽度对应光束底部的宽度。
 */
export function rayTexture(w = 128, h = 256): Tex {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const fadeV = Math.pow(1 - v, 1.6) * smoothstep01(Math.min(1, v * 6));
    const f = (1 + (FAN_SPREAD - 1) * v) / FAN_SPREAD;
    for (let x = 0; x < w; x++) {
      const u = ((x / (w - 1)) * 2 - 1) / f;
      const a = Math.exp(-u * u * 3.2) * fadeV;
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 边缘较硬的圆斑（用于软组织上的空洞）。 */
export function holeDot(size = 64): Tex {
  const [c, ctx] = makeCanvas(size, size);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,1)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export interface TextureSet {
  dot: Tex;
  dotHard: Tex;
  mist: Tex[];
  caustic: Tex;
  skin: Tex;
  wave: Tex;
  ripple: Tex;
  krill: Tex;
  krillDeep: Tex;
  sediment: Tex;
  ray: Tex;
  hole: Tex;
  skinDetail: Tex;
  shadow: Tex;
}

let cached: TextureSet | null = null;

export function textures(): TextureSet {
  if (cached) return cached;
  cached = {
    dot: softDot(64),
    dotHard: softDot(32, 0.35),
    mist: [mistPuff(96, 1), mistPuff(96, 2), mistPuff(96, 3)],
    caustic: causticTile(256),
    skin: skinTexture(),
    wave: waveTile(256),
    ripple: surfaceRippleTile(),
    krill: krillSprite(48),
    krillDeep: krillSprite(48, true),
    sediment: sedimentTile(),
    ray: rayTexture(),
    hole: holeDot(),
    skinDetail: skinDetailTile(),
    shadow: softShadow(),
  };
  return cached;
}

/** 允许正式资源覆盖程序化纹理（见 AssetRegistry）。 */
export function overrideTexture(key: keyof TextureSet, tex: Tex): void {
  const set = textures() as unknown as Record<string, unknown>;
  set[key] = tex;
}
