/**
 * 蓝鲸的绘画资源（public/assets/whale/，来自 whale-kit，见 README「蓝鲸绘画资源」）。
 *
 * swim / lunge / skeleton 是同一头蓝鲸、同一取景的三张侧视画（面朝右，吻端在右）：
 * 游动、张嘴滤食、骨骼。三张画裁切到同一个画框，锚点通用，可以交叉淡入淡出或上下叠放。
 * eye-open / eye-closed 是同一只眼睛的特写，已在预处理中把原画的暖色夕阳光改为水下的冷色顶光，
 * 并羽化了边缘，可以直接叠在身体画的眼睛上。
 *
 * 身体坐标：沿体轴的 s（0 吻端尖 ~ 1 尾叶缺刻），以及离体轴的距离（米，正值向背侧）。
 * 体轴就是吻端尖到尾叶缺刻的连线，与 WhaleBody 的脊线一一对应。
 */

/** 画框尺寸（像素） */
export const ART_W = 2870;
export const ART_H = 640;

/** 吻端尖、尾叶缺刻（画框像素） */
const SNOUT_X = 0.99123 * ART_W;
const SNOUT_Y = 0.40612 * ART_H;
const NOTCH_X = 0.10728 * ART_W;
const NOTCH_Y = 0.43027 * ART_H;

/** 体轴长度（像素）与方向（吻端方向，单位向量） */
export const AXIS_PX = Math.hypot(SNOUT_X - NOTCH_X, SNOUT_Y - NOTCH_Y);
const DX = (SNOUT_X - NOTCH_X) / AXIS_PX;
const DY = (SNOUT_Y - NOTCH_Y) / AXIS_PX;
/** 体轴在画中的倾角（弧度） */
export const AXIS_ANGLE = Math.atan2(DY, DX);

/** 画框左右两端对应的 s（吻端之前留有一点空白；尾叶在缺刻之后） */
export const ART_S0 = (SNOUT_X - ART_W) / (AXIS_PX * DX);
export const ART_S1 = SNOUT_X / (AXIS_PX * DX);

/** 体轴上 s 处在画中的位置（像素） */
export function axisPx(s: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = SNOUT_X - DX * AXIS_PX * s;
  out.y = SNOUT_Y - DY * AXIS_PX * s;
  return out;
}

/** 画中一列像素 x 对应的 s */
export function sAtPx(x: number): number {
  return (SNOUT_X - x) / (AXIS_PX * DX);
}

/** 眼睛特写（预处理后的横条，宽 1024 像素）：瞳孔位置与在鲸鱼身上覆盖的尺寸（占体长的比例） */
export const EYE_ART = {
  w: 1024,
  h: 610,
  /** 瞳孔（画像素） */
  px: 0.481 * 1024,
  py: 0.445 * 1024 - 150,
  /** 特写的边长相当于体长的 0.94 / 14（原画按 14 米体长标定） */
  sizeOfLen: 0.94 / 14,
  /** 眼裂的宽、高（占特写边长的比例） */
  almondW: 0.31,
  almondH: 0.106,
};

/** 身体画中眼睛（瞳孔）的位置：s 与离体轴的距离（占体长的比例，负值在体轴下方） */
export const ART_EYE_S = (SNOUT_X - 0.78216 * ART_W) / (AXIS_PX * DX);
export const ART_EYE_OFF = -((0.42545 * ART_H - (SNOUT_Y - DY * AXIS_PX * ART_EYE_S)) / AXIS_PX);

/**
 * 游动的画中胸鳍的轮廓（画框像素，含鳍缘的描线）。胸鳍可以绕根部单独转动：
 * 加载时把轮廓内的像素切成单独的图层，轮廓内的身体换成 swim-fin-under.webp 中补画的皮肤
 * （由 scripts/fin-cutout.py 按同一个轮廓生成，修改轮廓后需要重新运行）。
 */
export const FIN_POLY: ReadonlyArray<readonly [number, number]> = [
  [1848, 348], [1820, 362], [1796, 377], [1773, 397], [1747, 423], [1721, 450], [1696, 475], [1671, 497], [1650, 515],
  [1635, 528], [1628, 540], [1634, 551], [1652, 556], [1673, 556], [1702, 552], [1732, 544], [1762, 535], [1795, 524],
  [1830, 503], [1866, 473], [1906, 438], [1941, 408], [1964, 388], [1980, 371], [1976, 354], [1944, 346], [1895, 343],
];
/** 胸鳍图层与补丁在画框中的范围：x, y, w, h */
export const FIN_RECT = [1620, 335, 368, 229] as const;
/** 胸鳍转动的支点（画框像素）：鳍根中部，肩关节在它上方的体内 */
export const FIN_PIVOT = { x: 1912, y: 362 };

/** 一张身体画及其预先缩小的版本（1/2、1/4、1/8）：远处的鲸鱼用小图绘制，避免缩小时的条纹与闪烁 */
export interface Mipped {
  levels: CanvasImageSource[];
}

/** 骨骼画的透明度（半分辨率）：用于点击命中与在骨面上放置细菌席、食骨蠕虫 */
export interface AlphaMask {
  w: number;
  h: number;
  /** 每像素对应的画框像素数 */
  step: number;
  data: Uint8Array;
}

export interface WhaleArtSet {
  swim: Mipped;
  /** 游动的画，去掉胸鳍（轮廓内换成补画的皮肤）；与 fin 一起使用时胸鳍可以单独转动 */
  swimBody: Mipped;
  /** 胸鳍图层（FIN_RECT 范围内，画框像素） */
  fin: Mipped;
  lunge: Mipped;
  skeleton: Mipped;
  skeletonMask: AlphaMask;
  eyeOpen: HTMLImageElement;
  eyeClosed: HTMLImageElement;
}

function alphaMask(img: HTMLImageElement, step: number): AlphaMask {
  const w = Math.ceil(ART_W / step);
  const h = Math.ceil(ART_H / step);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3];
  return { w, h, step, data };
}

function mip(img: CanvasImageSource, w0 = ART_W, h0 = ART_H): Mipped {
  const levels: CanvasImageSource[] = [img];
  let src: CanvasImageSource = img;
  let w = w0;
  let h = h0;
  for (let i = 0; i < 3; i++) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    levels.push(c);
    src = c;
  }
  return { levels };
}

/** 选择缩小级别：每个画像素在屏幕上占 ratio 个设备像素 */
export function mipLevel(ratio: number): number {
  if (ratio >= 0.7) return 0;
  if (ratio >= 0.35) return 1;
  if (ratio >= 0.18) return 2;
  return 3;
}

/**
 * 把游动的画分成“无鳍的身体”与“胸鳍”两层：轮廓内（抗锯齿的覆盖率 m）身体换成补画的皮肤，
 * 胸鳍图层是原画乘以 m。两层按原位叠放时与原画一致。
 */
function cutFin(swim: HTMLImageElement, under: HTMLImageElement): { body: HTMLCanvasElement; fin: HTMLCanvasElement } {
  const [rx, ry, rw, rh] = FIN_RECT;
  const canvas = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const pixels = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const ctx = canvas(rw, rh).getContext('2d', { willReadFrequently: true })!;
    draw(ctx);
    return ctx.getImageData(0, 0, rw, rh);
  };
  const orig = pixels((c) => c.drawImage(swim, -rx, -ry));
  const patch = pixels((c) => c.drawImage(under, 0, 0));
  const mask = pixels((c) => {
    c.beginPath();
    for (const [x, y] of FIN_POLY) c.lineTo(x - rx + 0.5, y - ry + 0.5);
    c.closePath();
    c.fill();
  });
  const O = orig.data;
  const Q = patch.data;
  const M = mask.data;
  const finData = new ImageData(rw, rh);
  const F = finData.data;
  for (let i = 0; i < O.length; i += 4) {
    const m = M[i + 3] / 255;
    if (m <= 0) continue;
    // 身体：预乘颜色的线性混合
    const ao = O[i + 3] / 255;
    const aq = Q[i + 3] / 255;
    const a = ao * (1 - m) + aq * m;
    for (let k = 0; k < 3; k++) {
      F[i + k] = O[i + k];
      O[i + k] = a > 1e-4 ? (O[i + k] * ao * (1 - m) + Q[i + k] * aq * m) / a : 0;
    }
    F[i + 3] = O[i + 3] * m;
    O[i + 3] = a * 255;
  }
  const body = canvas(ART_W, ART_H);
  const bctx = body.getContext('2d')!;
  bctx.drawImage(swim, 0, 0);
  bctx.putImageData(orig, rx, ry);
  const fin = canvas(rw, rh);
  fin.getContext('2d')!.putImageData(finData, 0, 0);
  return { body, fin };
}

let art: WhaleArtSet | null = null;
let loading: Promise<WhaleArtSet | null> | null = null;

/** 已加载的绘画（加载完成前为 null，此时鲸鱼不绘制）。 */
export function whaleArt(): WhaleArtSet | null {
  return art;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + src));
    img.src = src;
  });
}

/** 加载全部绘画（只加载一次）。 */
export function loadWhaleArt(base = './assets/whale/'): Promise<WhaleArtSet | null> {
  if (!loading) {
    loading = Promise.all(['swim', 'lunge', 'skeleton', 'eye-open', 'eye-closed', 'swim-fin-under'].map((n) => loadImage(base + n + '.webp')))
      .then(async (imgs) => {
        // 先解码，避免第一次绘制时卡顿
        await Promise.all(imgs.map((i) => i.decode?.().catch(() => undefined)));
        const [swim, lunge, skeleton, eyeOpen, eyeClosed, under] = imgs;
        const cut = cutFin(swim, under);
        art = {
          swim: mip(swim),
          swimBody: mip(cut.body),
          fin: mip(cut.fin, FIN_RECT[2], FIN_RECT[3]),
          lunge: mip(lunge),
          skeleton: mip(skeleton),
          skeletonMask: alphaMask(skeleton, 2),
          eyeOpen,
          eyeClosed,
        };
        return art;
      })
      .catch((e) => {
        console.error(e);
        return null;
      });
  }
  return loading;
}
