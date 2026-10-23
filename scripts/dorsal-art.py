"""
从上方俯视的蓝鲸：生成 public/assets/whale/dorsal.webp（高空俯视镜头用的背面画）。

whale-kit 里只有侧视的画和一张从正下方看的腹面画（whale-below.webp，不在仓库中）。
俯视与仰视的轮廓相同，所以这里用腹面画的轮廓（透明度），在轮廓内画上背部：
  - 身体：俯视中离脊线的相对距离 u 对应横截面上从背脊到体侧最宽处的位置，
    取侧视的画中体轴上方相应高度的皮肤（背脊在侧视的上缘，体侧最宽处在体轴附近）；
    按 |u| 线性取画，避开背脊附近那几行（按 cos 取会把画的上缘拉成一道道横纹）。
    左右两侧取画中不同的位置（沿体轴错开一小段），斑纹不会左右镜像；脊线附近两侧渐变；
  - 顶光：越靠近体侧越暗，脊线上一道柔和的亮；
  - 胸鳍与尾叶：沿用同一列体侧的皮肤，略暗；
  - 喷气孔（前方有一道防溅脊）与很小、很靠后的背鳍。
朝向与腹面画相同：吻端在右，尾叶在左，体轴水平居中。

用法：python3 scripts/dorsal-art.py <whale-kit/images/web/whale-below.webp>   （需要 numpy 与 Pillow）
"""
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SWIM = os.path.join(ROOT, 'public/assets/whale/swim.webp')
OUT = os.path.join(ROOT, 'public/assets/whale/dorsal.webp')
ART_TS = os.path.join(ROOT, 'src/entities/WhaleArt.ts')
BODY_TS = os.path.join(ROOT, 'src/entities/WhaleBody.ts')

# 腹面画中的吻端尖、尾叶缺刻（中线上最靠前的尾叶后缘）、体轴所在的行，以及胸鳍所在的列（那里的轮廓含胸鳍）
SNOUT_BX = 2047
NOTCH_BX = 103
AXIS_BY = 388
FIN_COLS = (1370, 1520)
# 尾柄最细处之后是尾叶
FLUKE_BX = 260
# 两侧取画时沿体轴错开的距离（体长比例）
SIDE_SHIFT = 0.045


def ts_number(src, name):
    return float(re.search(r'const ' + name + r'\s*=\s*([0-9.]+)\s*\*\s*ART_[WH]', src).group(1))


def profile(src, name):
    body = re.search(r'export const ' + name + r'[^=]*=\s*\[([\s\S]*?)\];', src).group(1)
    pts = [(float(a), float(b)) for a, b in re.findall(r'\[\s*([-0-9.]+),\s*([-0-9.]+)\s*\]', body)]
    return np.array([p[0] for p in pts]), np.array([p[1] for p in pts])


art_src = open(ART_TS, encoding='utf-8').read()
body_src = open(BODY_TS, encoding='utf-8').read()
ART_W = int(re.search(r'export const ART_W = (\d+)', art_src).group(1))
ART_H = int(re.search(r'export const ART_H = (\d+)', art_src).group(1))
SNOUT_X = ts_number(art_src, 'SNOUT_X') * ART_W
SNOUT_Y = ts_number(art_src, 'SNOUT_Y') * ART_H
NOTCH_X = ts_number(art_src, 'NOTCH_X') * ART_W
NOTCH_Y = ts_number(art_src, 'NOTCH_Y') * ART_H
AXIS_PX = np.hypot(SNOUT_X - NOTCH_X, SNOUT_Y - NOTCH_Y)
DX = (SNOUT_X - NOTCH_X) / AXIS_PX
DY = (SNOUT_Y - NOTCH_Y) / AXIS_PX
WHALE_LEN = float(re.search(r'export const WHALE_LEN = ([0-9.]+)', body_src).group(1))
US, UV = profile(body_src, 'UPPER')

below = np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(np.float64) / 255.0
H, W = below.shape[:2]
alpha = below[..., 3]
swim = np.asarray(Image.open(SWIM).convert('RGBA')).astype(np.float64) / 255.0


def sample(img, x, y):
    """双线性取样（x、y 为同形状的数组）"""
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    b = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def skin(s, v):
    """侧视的画中，体轴上 s 处、体轴上方 v（0~1，按背侧轮廓高度）处的颜色"""
    s = np.clip(s, -0.005, 1.0)
    ax = SNOUT_X - DX * AXIS_PX * s
    ay = SNOUT_Y - DY * AXIS_PX * s
    up = np.interp(np.clip(s, 0, 1), US, UV) * AXIS_PX / WHALE_LEN
    # 体轴的“上方”法线
    return sample(swim, ax + DY * v * up, ay - DX * v * up)[..., :3]


# 每列身体的半宽：轮廓的半宽，胸鳍所在的列按两侧插值，尾叶区域取尾柄的宽度
cols = np.arange(W)
half = np.zeros(W)
for x in range(W):
    c = np.where(alpha[:, x] > 0.5)[0]
    half[x] = (c.max() - c.min()) / 2 if len(c) else 0
f0, f1 = FIN_COLS
half[f0:f1] = np.interp(np.arange(f0, f1), [f0 - 1, f1], [half[f0 - 1], half[f1]])
half[:FLUKE_BX] = half[FLUKE_BX]
half = np.maximum(half, 1)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
s = (SNOUT_BX - xx) / (SNOUT_BX - NOTCH_BX)
u = (yy - AXIS_BY) / half[None, :]
au = np.clip(np.abs(u), 0, 1)
# 头部的体侧下方是嘴线，从上方看不到：头部只取到体侧中部以上
vmin = 0.1 + 0.28 * (1 - np.clip((s - 0.2) / 0.1, 0, 1))
v = 0.86 - (0.86 - vmin) * au
c_a = skin(s, v)
c_b = skin(s + SIDE_SHIFT, v)
c_side = np.where((u >= 0)[..., None], c_a, c_b)
# 脊线附近两侧渐变，没有接缝
blend = np.clip((0.18 - np.abs(u)) / 0.36, 0, 1)[..., None]
color = c_side * (1 - blend) + (c_a + c_b) / 2 * blend

# 顶光：越靠近体侧越暗，脊线上一道柔和的亮
light = 0.74 + 0.26 * np.power(np.clip(1 - au * au, 0, 1), 0.45) + 0.05 * np.exp(-(u / 0.12) ** 2)
# 胸鳍、尾叶：轮廓在身体之外的部分。皮肤沿鳍的长度方向取画（横向也变化，不会拉成横纹）
# 尾柄与尾叶之间在约 40 像素内渐变
outside = np.maximum((np.abs(u) > 1.0).astype(np.float64), np.clip((FLUKE_BX + 20 - xx) / 40, 0, 1))
# （坐标都是连续的，不取模，鳍上没有接缝）
off = np.abs(yy - AXIS_BY)
fluke = xx < FLUKE_BX + 20
fin_v = np.where(fluke, 0.2 + 0.6 * np.clip(off / (H / 2), 0, 1), 0.15 + 0.7 * np.clip((off - half[None, :]) / 340.0, 0, 1))
fin_s = np.where(fluke, 0.8 + 0.18 * np.clip(xx / (FLUKE_BX + 20), 0, 1), 0.27 + 0.12 * np.clip((xx - FIN_COLS[0]) / (FIN_COLS[1] - FIN_COLS[0]), 0, 1))
fin = skin(fin_s, fin_v) * 0.8
color = fin * outside[..., None] + color * light[..., None] * (1 - outside[..., None])
# 背部比侧视画中的体侧更深一些、对比更强
color = np.clip(0.5 + (color - 0.5) * 1.15, 0, 1) * 0.8
color = np.clip(color, 0, 1)

img = Image.fromarray((np.dstack([color, np.ones_like(alpha)]) * 255).round().astype(np.uint8), 'RGBA')

# 喷气孔（两道向后张开的细缝，前方是一道微微隆起的防溅脊）与背鳍（约 79%，很小）：画得很淡，随后整体柔化
marks = Image.new('RGBA', img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(marks)
px_per_m = (SNOUT_BX - NOTCH_BX) / WHALE_LEN
bx = SNOUT_BX - 0.16 * (SNOUT_BX - NOTCH_BX)
d.ellipse([bx + 0.15 * px_per_m, AXIS_BY - 0.42 * px_per_m, bx + 0.75 * px_per_m, AXIS_BY + 0.42 * px_per_m], fill=(200, 216, 226, 34))
for side_sign in (-1, 1):
    pts = [(bx + 0.1 * px_per_m - t * 0.5 * px_per_m, AXIS_BY + side_sign * (0.04 + 0.13 * t) * px_per_m) for t in np.linspace(0, 1, 9)]
    d.line(pts, fill=(22, 30, 38, 170), width=max(2, int(0.045 * px_per_m)))
fx = SNOUT_BX - 0.79 * (SNOUT_BX - NOTCH_BX)
d.ellipse([fx - 0.5 * px_per_m, AXIS_BY - 0.07 * px_per_m, fx + 0.35 * px_per_m, AXIS_BY + 0.07 * px_per_m], fill=(30, 40, 48, 110))

img.alpha_composite(marks.filter(ImageFilter.GaussianBlur(1.2)))

# 画上去的细节稍微柔化，与水彩的笔触一致；透明度保持腹面画的轮廓
rgb = img.convert('RGB').filter(ImageFilter.GaussianBlur(0.6))
out = Image.merge('RGBA', (*rgb.split(), Image.fromarray((alpha * 255).round().astype(np.uint8))))
out.save(OUT, 'WEBP', quality=86, method=6)
print('wrote', OUT, out.size, os.path.getsize(OUT), 'bytes')
