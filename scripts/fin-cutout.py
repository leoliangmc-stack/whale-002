"""
从游动的画（public/assets/whale/swim.webp）中切出胸鳍下方的身体：生成 swim-fin-under.webp。

画中的胸鳍与身体是一体的。为了让胸鳍能绕根部单独转动，需要知道“胸鳍下面的身体”长什么样：
胸鳍的轮廓（FIN_POLY）定义在 src/entities/WhaleArt.ts 中，本脚本从那里读取，在轮廓内补画身体：
  - 颜色：以轮廓外的皮肤为边界做调和填充（大尺度的明暗过渡），再叠加沿体轴方向复制的细节
    （喉腹褶是沿体轴的横线，按行复制能让褶沟自然地接上）；
  - 透明度：腹部下缘按两侧的位置逐列插值，保持清晰的边缘。
运行时（WhaleArt.ts 的 cutFin）只在轮廓内用这张补丁替换原画，并把原画中轮廓内的像素作为单独的胸鳍图层。

用法：python3 scripts/fin-cutout.py   （需要 numpy 与 Pillow）
"""
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'public/assets/whale/swim.webp')
OUT = os.path.join(ROOT, 'public/assets/whale/swim-fin-under.webp')
TS = os.path.join(ROOT, 'src/entities/WhaleArt.ts')


def read_ts_const(name):
    src = open(TS, encoding='utf-8').read()
    m = re.search(name + r'[^=]*=\s*(\[[\s\S]*?\])\s*(?:as const)?;', src)
    return [int(v) for v in re.findall(r'-?\d+', m.group(1))]


nums = read_ts_const('FIN_POLY')
POLY = list(zip(nums[0::2], nums[1::2]))
RX, RY, RW, RH = read_ts_const('FIN_RECT')

img = Image.open(ART).convert('RGBA')
A = np.asarray(img).astype(np.float64) / 255.0
H, W = A.shape[:2]

# 轮廓覆盖率（4 倍超采样），向外再放宽 2 像素：补丁必须覆盖运行时抗锯齿的边缘
SS = 4
mi = Image.new('L', (RW * SS, RH * SS), 0)
ImageDraw.Draw(mi).polygon([((x - RX + 0.5) * SS, (y - RY + 0.5) * SS) for x, y in POLY], fill=255)
mi = mi.filter(ImageFilter.MaxFilter(2 * 2 * SS + 1))
hole = np.asarray(mi.resize((RW, RH), Image.BOX)) > 0

R = A[RY:RY + RH, RX:RX + RW]
alpha = R[..., 3]

# ---- 透明度：腹部下缘（alpha = 0.5 处）在胸鳍两侧的高度，逐列线性插值
def edge_y(x):
    col = A[:, x, 3]
    idx = np.where(col[440:620] > 0.5)[0]
    return 440 + idx[-1] + (col[440 + idx[-1]] - 0.5) / max(1e-3, col[440 + idx[-1]] - col[440 + idx[-1] + 1])


cols = np.where(hole.any(axis=0))[0]
bottom = [c for c in cols if hole[:, c][RH - 30:].any()]
xl = RX + (min(bottom) if bottom else cols[0]) - 3
xr = RX + (max(bottom) if bottom else cols[-1]) + 3
el, er = edge_y(xl), edge_y(xr)
inpA = alpha.copy()
for j in range(RH):
    for i in range(RW):
        if not hole[j, i]:
            continue
        x = RX + i
        t = min(1.0, max(0.0, (x - xl) / (xr - xl)))
        d = (RY + j) - (el + (er - el) * t)
        s = min(1.0, max(0.0, (d + 1.5) / 3.3))
        inpA[j, i] = 1 - s * s * (3 - 2 * s)

# ---- 颜色：调和填充（只用不透明的已知像素作边界）
col = R[..., :3].copy()
known = (~hole) & (alpha > 0.6)
U = np.where(known[..., None], col, 0.75)
for _ in range(6000):
    Up = np.pad(U, ((1, 1), (1, 1), (0, 0)), mode='edge')
    N = (Up[:-2, 1:-1] + Up[2:, 1:-1] + Up[1:-1, :-2] + Up[1:-1, 2:]) / 4
    U = np.where(known[..., None], col, N)

# ---- 细节：沿行（≈ 体轴方向）从轮廓两侧复制纹理，只取高频部分
P = A.copy()
P[..., :3] *= P[..., 3:4]
blur = np.asarray(img.filter(ImageFilter.GaussianBlur(5))).astype(np.float64) / 255
B = blur.copy()
B[..., :3] *= B[..., 3:4]
detail = np.zeros((RH, RW, 3))
for j in range(RH):
    row = np.where(hole[j])[0]
    if len(row) == 0:
        continue
    l, r = row[0], row[-1]
    span = r - l + 1
    y = RY + j
    for i in range(l, r + 1):
        t = (i - l + 0.5) / span
        xa = max(0, RX + i - span)
        xb = min(W - 1, RX + i + span)
        rc = (1 - t) * P[y, xa] + t * P[y, xb]
        lp = (1 - t) * B[y, xa] + t * B[y, xb]
        if rc[3] > 0.3 and lp[3] > 0.05:
            detail[j, i] = rc[:3] / rc[3] - lp[:3] / lp[3]

inpC = np.clip(U + detail, 0, 1)
out = np.where(hole[..., None], np.dstack([inpC, inpA]), R)
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(OUT, quality=92, method=6)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
