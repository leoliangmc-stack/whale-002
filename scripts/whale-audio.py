"""
从 MBARI 的 Pacific Sound 水听器录音中截取真实的蓝鲸叫声，生成 public/assets/audio/ 中的声音素材。

用法：python3 scripts/whale-audio.py [输出目录]（需要 numpy、scipy 与带 libmp3lame 的 ffmpeg）

来源：MBARI Pacific Sound（Monterey Bay 加速研究系统 MARS 海底观测站，水深 891 米），
2 kHz 降采样数据集 s3://pacific-sound-2khz，CC BY 4.0（https://registry.opendata.aws/pacific-sound/）。
脚本按字节范围只下载需要的几分钟，不会下载整天的文件。

蓝鲸的叫声在 10~90 赫兹，大多低于人耳（尤其是手机扬声器）能听到的范围。和 NOAA、MBARI 公开展示时一样，
这里把录音整体加速 SPEED 倍（音高与节奏一起提高），不做任何合成：
  - 东北太平洋蓝鲸的“歌”：脉冲状的 A 叫声（约 80 赫兹）后接长而平稳、缓缓下滑的 B 叫声（三次谐波约 43 赫兹）；
  - 远处许多蓝鲸与长须鲸（20 赫兹脉冲）的合唱，作为开阔海域的背景声。
处理：压低短促的宽带脉冲 → 按每个频率的噪声底做温和的谱减（去掉船只与水流的宽带噪声）→ 只保留 10~120 赫兹 → 加速 → 淡入淡出、响度归一。
"""

import os
import subprocess
import sys
import tempfile
import urllib.request

import numpy as np
from scipy import signal

BUCKET = 'https://pacific-sound-2khz.s3.amazonaws.com'
FS = 2000
BYTES = 3  # 24 位单声道
HEADER = 332
SPEED = 6

# 截取的片段：（日期文件, 当天的起始秒, 时长秒, 输出名, 谱减强度）
CLIPS = [
    # 2018-11-10 04:13 UTC 起：一头离观测站很近的蓝鲸，完整的 A-B 歌声单元
    ('2018/11/MARS-20181110T000000Z-2kHz.wav', 4 * 3600 + 836, 40, 'blue-whale-ab', 1.6),
    ('2018/11/MARS-20181110T000000Z-2kHz.wav', 4 * 3600 + 928, 66, 'blue-whale-ab2', 1.6),
    ('2018/11/MARS-20181110T000000Z-2kHz.wav', 4 * 3600 + 1056, 36, 'blue-whale-b', 1.6),
    # 2018-10-20 06:20 UTC 起：远处的合唱（没有离得很近的个体）
    ('2018/10/MARS-20181020T000000Z-2kHz.wav', 6 * 3600 + 1200, 420, 'ocean-chorus', 1.0),
]


def fetch(path: str, start: float, dur: float) -> np.ndarray:
    a = HEADER + int(start * FS) * BYTES
    b = a + int(dur * FS) * BYTES - 1
    req = urllib.request.Request(f'{BUCKET}/{path}', headers={'Range': f'bytes={a}-{b}'})
    raw = np.frombuffer(urllib.request.urlopen(req, timeout=60).read(), dtype=np.uint8)
    n = len(raw) // 3
    v = raw[: n * 3].reshape(n, 3).astype(np.int32)
    x = v[:, 0] | (v[:, 1] << 8) | (v[:, 2] << 16)
    x = np.where(x >= 1 << 23, x - (1 << 24), x).astype(np.float64)
    return x - x.mean()


def clean(x: np.ndarray, over: float) -> np.ndarray:
    sos = signal.butter(2, 8, btype='highpass', fs=FS, output='sos')
    x = signal.sosfiltfilt(sos, x)
    f, t, Z = signal.stft(x, FS, nperseg=1024, noverlap=768)
    mag = np.abs(Z)
    # 短促的宽带脉冲（船只的螺旋桨、水流冲击观测站）：在 130~400 赫兹（鲸鱼的叫声之上）检测，
    # 某一帧的能量远高于前后约 2 秒的中值时，整帧压低
    hi = (f >= 130) & (f <= 400)
    e = (mag[hi] ** 2).mean(axis=0)
    med = signal.medfilt(e, 31)
    click = np.clip(np.sqrt(4 * med / np.maximum(e, 1e-12)), 0.2, 1)
    click = np.convolve(click, np.ones(5) / 5, 'same')
    # 每个频率的噪声底：时间上的较低分位数（叫声只占一部分时间）
    floor = np.percentile(mag, 30, axis=1, keepdims=True)
    gain = np.clip(1 - over * floor / np.maximum(mag, 1e-9), 0.12, 1)
    # 增益在时间与频率上平滑，避免“音乐噪声”
    gain = signal.convolve2d(gain, np.ones((3, 9)) / 27, mode='same', boundary='symm')
    # 只保留 10~120 赫兹（柔和的滚降）
    band = np.clip((f - 6) / 6, 0, 1) * np.clip((150 - f) / 40, 0, 1)
    _, y = signal.istft(Z * gain * click[None, :] * band[:, None], FS, nperseg=1024, noverlap=768)
    return y[: len(x)]


def write(y: np.ndarray, name: str, out: str, loop: bool) -> None:
    rate = FS * SPEED
    n = len(y)
    # 淡入约 0.25 秒、淡出约 1 秒（按加速之后计）；y 仍是原始采样率，1 秒输出 = FS × SPEED 个样本
    fade = int(FS * SPEED * 0.25)
    if loop:
        # 首尾交叉淡化成可以无缝循环的一段
        k = int(FS * 30)
        head = y[:k]
        y = y[k:].copy()
        r = np.linspace(0, 1, k)
        y[-k:] = y[-k:] * np.cos(r * np.pi / 2) + head * np.sin(r * np.pi / 2)
    else:
        w = np.ones(n)
        w[:fade] = np.linspace(0, 1, fade)
        w[-fade * 4 :] = np.linspace(1, 0, fade * 4)
        y = y * w
    y = y / (np.percentile(np.abs(y), 99.9) + 1e-9) * 0.7
    y = np.clip(y, -0.98, 0.98)
    pcm = (y * 32767).astype('<i2').tobytes()
    with tempfile.NamedTemporaryFile(suffix='.raw', delete=False) as tmp:
        tmp.write(pcm)
    try:
        # 按 FS×SPEED 的采样率解释（整体加速），再重采样到 24 kHz 编码
        subprocess.run(
            ['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(rate), '-ac', '1', '-i', tmp.name,
             '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', os.path.join(out, name + '.mp3')],
            check=True,
        )
    finally:
        os.unlink(tmp.name)
    print(f'{name}.mp3  {len(y) / rate:.1f} s')


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'audio')
    os.makedirs(out, exist_ok=True)
    for path, start, dur, name, over in CLIPS:
        y = clean(fetch(path, start, dur), over)
        write(y, name, out, loop=name.startswith('ocean'))


if __name__ == '__main__':
    main()
