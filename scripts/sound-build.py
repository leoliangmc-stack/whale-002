"""
生成 public/assets/audio/ 中的全部声音素材，并更新 public/assets/manifest.json 的 audio 部分。

用法：python3 -I scripts/sound-build.py [--cache 目录] [--only A01,F11,...] [--check]
  需要 numpy、scipy、soundfile 与带 libmp3lame 的 ffmpeg。原始录音按固定的提交 / 对象地址下载到 --cache
  （默认 ~/.cache/whale-fall-sound，不进仓库），之后可以离线重跑。--check 只打印每个素材的测量值。

依据：docs/sound/cue-sheet.md（声音导演的剪辑表）与 docs/sound/sources.md（素材来源与许可）。
每一个叙事声音都来自真实录音（水听器、实地录音），只做滤波、变速（变调）、拼接、包络、相位声码器移调
与离线的短混响；没有任何振荡器或程序噪声生成的声音。

来源（许可见 sources.md 与 README「声音」）：
  - MBARI Pacific Sound（蒙特雷湾 MARS 观测站，891 m）2 kHz / 16 kHz，CC BY 4.0：蓝鲸叫声、远处的合唱、深海床；
  - NOAA / 美国海军 SanctSound 精选片段（美国政府作品）：水下的风浪、开阔海域、雨、潜水员呼出的气泡、
    枪虾、鱼类敲击、抹香鲸咔哒；
  - ESC-50 中单独标为 CC0 / CC BY 的 freesound 片段：空气中的海浪、海蚀洞的涌浪、溅水、倒水、呼吸、湿雪脚步；
  - Ambie（freesound 393819，Kinoton，CC0）：水下的低沉流动；
  - Moodist 的鸥群录音（仓库声明 Pixabay / CC0，未逐个文件核实）。

所有文件统一归一化到 −18 LUFS（循环床按积分响度，一次性素材按短时响度最大值），真峰值 ≤ −1 dBTP；
循环素材前后各多留 0.2 秒（循环体的首尾），manifest 里写明循环区间。
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
MANIFEST = os.path.join(ROOT, 'public', 'assets', 'manifest.json')
FS = 44100
TARGET = -18.0
PAD = 0.2

# ------------------------------------------------------------------ 来源（固定到提交或对象）

ESC = 'https://raw.githubusercontent.com/karolpiczak/ESC-50/33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6/audio/'
SS = 'https://storage.googleapis.com/noaa-passive-bioacoustic/sanctsound/products/sound_clips/'
SOURCES = {
    # ESC-50（单个片段的许可见该仓库 LICENSE）
    'esc_waves_atmo_a': ESC + '5-208810-A-11.wav',  # monotraum, CC0
    'esc_waves_atmo_b': ESC + '5-208810-B-11.wav',  # monotraum, CC0
    'esc_red_sea': ESC + '2-133863-A-11.wav',  # vhlam, CC0
    'esc_waves_in_sea': ESC + '2-125966-A-11.wav',  # Ryding, CC0
    'esc_gentle_sea': ESC + '1-43760-A-11.wav',  # digifishmusic, CC BY
    'esc_close_a': ESC + '4-167063-A-11.wav',  # slag777, CC BY
    'esc_close_b': ESC + '4-167063-B-11.wav',
    'esc_close_c': ESC + '4-167063-C-11.wav',
    'esc_pier_a': ESC + '1-39901-A-11.wav',  # aesqe, CC BY
    'esc_pier_b': ESC + '1-39901-B-11.wav',
    'esc_seacave_a': ESC + '5-200461-A-11.wav',  # ikbenraar, CC BY
    'esc_seacave_b': ESC + '5-200461-B-11.wav',
    'esc_sea_room': ESC + '2-137162-A-11.wav',  # Akoustikos, CC BY
    'esc_seawall': ESC + '5-213077-A-11.wav',  # crosbychris, CC BY
    'esc_baltic_a': ESC + '5-219379-A-11.wav',  # miastodzwiekow, CC BY
    'esc_breakwater_a': ESC + '2-132157-A-11.wav',  # bulbastre, CC BY
    'esc_breath_sci': ESC + '2-54961-A-23.wav',  # cidchili, CC0
    'esc_breath_deep': ESC + '1-18631-A-23.wav',  # Walter_Odington, CC0
    'esc_breath_c': ESC + '1-30709-C-23.wav',  # UncleSigmund, CC0
    'esc_gulp': ESC + '3-133977-A-29.wav',  # Alvinwhatup2, CC0
    'esc_pour_a': ESC + '4-172377-A-17.wav',  # runirasmussen, CC0
    'esc_pour_b': ESC + '3-142349-A-17.wav',  # BranRainey, CC0
    'esc_splash_1': ESC + '3-164594-A-15.wav',  # Adam_N, CC0
    'esc_splash_2': ESC + '3-164593-A-15.wav',  # Adam_N, CC0
    'esc_splashing': ESC + '5-241846-A-15.wav',  # rafael45, CC0
    'esc_stones_bath': ESC + '4-174797-A-15.wav',  # toiletrolltube, CC0
    'esc_wet_snow': ESC + '5-263501-A-25.wav',  # lwdickens, CC0
    'esc_snow_crunchy': ESC + '5-263490-A-25.wav',  # lwdickens, CC0
    'esc_crunchy_ice': ESC + '5-263491-A-25.wav',  # lwdickens, CC0
    'esc_wet_steps': ESC + '1-51147-A-25.wav',  # RutgerMuller, CC0
    # NOAA / U.S. Navy SanctSound 精选片段
    'ss_openocean': SS + 'oc03/sanctsound_oc03_02_sound_clips/data/SanctSound_OC03_02_soundscape_20191220T211558Z.wav',
    'ss_swell': SS + 'mb02/sanctsound_mb02_04_sound_clips/data/SanctSound_MB02_04_wind_20200101T225838Z_36dBgain.wav',
    'ss_windwaves': SS + 'hi04/sanctsound_hi04_03_sound_clips/data/SanctSound_HI04_03_windwaves_20201220T115634Z_36dBgain.wav',
    'ss_rain': SS + 'hi03/sanctsound_hi03_02_sound_clips/data/SanctSound_HI03_02_rain_20191206T115841Z.wav',
    'ss_bubbles_a': SS + 'fk01/sanctsound_fk01_06_sound_clips/data/SanctSound_FK01_06_scubadivers_20201207T184714Z.wav',
    'ss_bubbles_b': SS + 'gr01/sanctsound_gr01_01_sound_clips/data/SanctSound_GR01_01_scubadivers_20181213T201740Z.wav',
    'ss_shrimp': SS + 'ci01/sanctsound_ci01_05_sound_clips/data/SanctSound_CI01_05_snappingshrimp_20200803T192243Z.wav',
    'ss_shrimp_snaps': SS + 'ci01/sanctsound_ci01_01_sound_clips/data/SanctSound_CI01_01_snappingshrimp_20181101T080448Z.wav',
    'ss_knocks': SS + 'ci02/sanctsound_ci02_04_sound_clips/data/SanctSound_CI02_04_unknownfishknocks_20200218T115852Z.wav',
    'ss_sperm': SS + 'hi03/sanctsound_hi03_02_sound_clips/data/SanctSound_HI03_02_spermwhale_20191216T115715Z.wav',
    'ss_sperm2': SS + 'hi03/sanctsound_hi03_02_sound_clips/data/SanctSound_HI03_02_spermwhale2_20191216T115715Z.wav',
    # 其他开源项目里许可写明的录音
    'kinoton_underwater': 'https://raw.githubusercontent.com/jenius-apps/ambie/eb29bd9946b414f7b7988d43ea5e77c537e9ab7d/src/AmbientSounds.Uwp/Assets/Sounds/underwater.wav',
    'moodist_gulls': 'https://raw.githubusercontent.com/remvze/moodist/11c0be2200116a3635880d600fd6953899cc51a3/public/sounds/animals/seagulls.mp3',
}

# MBARI Pacific Sound：(桶, 日期文件, 当天的起始秒, 时长秒)
MBARI = {
    # 2 kHz：一头离观测站很近的蓝鲸（与 scripts/whale-audio.py 以前截取的同一段）
    'mb_ab': ('2khz', '2018/11/MARS-20181110T000000Z-2kHz.wav', 4 * 3600 + 836, 40),
    'mb_ab2': ('2khz', '2018/11/MARS-20181110T000000Z-2kHz.wav', 4 * 3600 + 928, 66),
    'mb_b': ('2khz', '2018/11/MARS-20181110T000000Z-2kHz.wav', 4 * 3600 + 1056, 36),
    # 2 kHz：远处许多蓝鲸与长须鲸的合唱
    'mb_chorus': ('2khz', '2018/10/MARS-20181020T000000Z-2kHz.wav', 6 * 3600 + 1200, 420),
    # 16 kHz：深夜里一段没有船、没有鲸歌的深海环境（2016-12-21 00:25 UTC 起）
    'mb_deep': ('16khz', '2016/12/MARS-20161221T000000Z-16kHz.wav', 25 * 60 + 40, 40),
}


def cache_dir(args) -> str:
    d = args.cache or os.path.join(os.path.expanduser('~'), '.cache', 'whale-fall-sound')
    os.makedirs(d, exist_ok=True)
    return d


def fetch(url: str, path: str, rng: tuple[int, int] | None = None) -> None:
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    req = urllib.request.Request(url, headers={'Range': f'bytes={rng[0]}-{rng[1]}'} if rng else {})
    data = urllib.request.urlopen(req, timeout=120).read()
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)


def decode(path: str) -> tuple[np.ndarray, int]:
    """任意格式 → (采样 × 声道) float64"""
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-vn', '-c:a', 'pcm_f32le', tmp], check=True)
        x, fs = sf.read(tmp, dtype='float64', always_2d=True)
    finally:
        os.unlink(tmp)
    return x, fs


class Library:
    def __init__(self, cache: str):
        self.cache = cache
        self.mem: dict[str, np.ndarray] = {}

    def get(self, key: str, stereo: bool = False) -> np.ndarray:
        """以 FS 采样率返回单声道（或立体声）数据"""
        k = key + (':st' if stereo else '')
        if k in self.mem:
            return self.mem[k]
        if key in MBARI:
            x, fs = self.mbari(key), None
        else:
            url = SOURCES[key]
            path = os.path.join(self.cache, key + os.path.splitext(url)[1])
            fetch(url, path)
            x, fs = decode(path)
            x = x - x.mean(axis=0)
            if not stereo:
                x = x.mean(axis=1)
            x = resample(x, fs, FS)
        self.mem[k] = x
        return x

    def mbari(self, key: str) -> np.ndarray:
        """MBARI 的原始数据（原始采样率，24 位 → float，未改变增益）"""
        bucket, path, start, dur = MBARI[key]
        rate = 2000 if bucket == '2khz' else 16000
        a = 332 + int(start * rate) * 3
        b = a + int(dur * rate) * 3 - 1
        local = os.path.join(self.cache, f'{key}.raw')
        fetch(f'https://pacific-sound-{bucket}.s3.amazonaws.com/{path}', local, (a, b))
        raw = np.frombuffer(open(local, 'rb').read(), dtype=np.uint8)
        n = len(raw) // 3
        v = raw[: n * 3].reshape(n, 3).astype(np.int32)
        x = v[:, 0] | (v[:, 1] << 8) | (v[:, 2] << 16)
        x = np.where(x >= 1 << 23, x - (1 << 24), x).astype(np.float64) / (1 << 23)
        return x - x.mean()


# ------------------------------------------------------------------ 处理工具

def resample(x: np.ndarray, fs_in: float, fs_out: float) -> np.ndarray:
    if abs(fs_in - fs_out) < 1e-6:
        return x.copy()
    fr = Fraction(fs_out / fs_in).limit_denominator(2000)
    return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0)


def varispeed(x: np.ndarray, semitones: float) -> np.ndarray:
    """像磁带一样变速：降 12 个半音 = 慢一倍（音高与节奏一起变）"""
    return resample(x, 1.0, 2 ** (-semitones / 12))


def sec(t: float) -> int:
    return int(round(t * FS))


def cut(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return x[sec(a):sec(b)].copy()


def filt(x: np.ndarray, kind: str, fc, order: int = 4) -> np.ndarray:
    sos = signal.butter(order, fc, btype=kind, fs=FS, output='sos')
    return signal.sosfiltfilt(sos, x, axis=0)


def lpf(x, fc, order=4):
    return filt(x, 'lowpass', fc, order)


def hpf(x, fc, order=4):
    return filt(x, 'highpass', fc, order)


def bpf(x, lo, hi, order=4):
    return filt(x, 'bandpass', [lo, hi], order)


def env(n: int, pts: list[tuple[float, float]], db: bool = False) -> np.ndarray:
    """分段线性包络：pts = [(秒, 值)]，db=True 时值为分贝"""
    t = np.arange(n) / FS
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    e = np.interp(t, xs, ys)
    return 10 ** (e / 20) if db else e


def apply(x: np.ndarray, e: np.ndarray) -> np.ndarray:
    return x * (e[:, None] if x.ndim == 2 else e)


def fades(x: np.ndarray, fin: float = 0.01, fout: float = 0.02) -> np.ndarray:
    n = len(x)
    e = np.ones(n)
    a = max(1, sec(fin))
    b = max(1, sec(fout))
    e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    e[-b:] = np.cos(np.linspace(0, np.pi / 2, b)) ** 2
    return apply(x, e)


def mix(*parts: tuple[np.ndarray, float, float]) -> np.ndarray:
    """parts = (信号, 起点秒, 增益 dB)；按最长者对齐。每一段的首尾都加很短的淡化，避免拼接处的咔嗒"""
    ch = max((p[0].ndim for p in parts))
    n = max(sec(p[1]) + len(p[0]) for p in parts)
    out = np.zeros((n, 2)) if ch == 2 else np.zeros(n)
    for x, at, g in parts:
        if ch == 2 and x.ndim == 1:
            x = np.stack([x, x], axis=1)
        if len(x) > sec(0.06):
            x = fades(x, 0.004, 0.03)
        i = sec(at)
        out[i:i + len(x)] += x * 10 ** (g / 20)
    return out


def fit(x: np.ndarray, n: int) -> np.ndarray:
    if len(x) >= n:
        return x[:n]
    pad = np.zeros((n - len(x),) + x.shape[1:])
    return np.concatenate([x, pad])


def presence(x: np.ndarray, lo: float, hi: float, db: float) -> np.ndarray:
    """在 lo–hi 赫兹叠加一点同一段录音（相当于一个宽的峰值提升），让手机扬声器也能听见低沉的声音"""
    return x + bpf(x, lo, hi, 2) * (10 ** (db / 20) - 1)


def declick(x: np.ndarray, thresh_db: float = 9.0) -> np.ndarray:
    """压低床里零星的瞬态（咔哒、敲击）：5 ms 帧的能量高出 1 秒中值太多时把那一帧拉回中值"""
    mono = x if x.ndim == 1 else x.mean(axis=1)
    hop = sec(0.005)
    nf = len(mono) // hop
    e = np.array([np.mean(mono[i * hop:(i + 1) * hop] ** 2) for i in range(nf)]) + 1e-20
    med = signal.medfilt(e, 201)
    over = 10 * np.log10(e / med)
    g = np.where(over > thresh_db, 10 ** (-(over - thresh_db) / 20), 1.0)
    g = np.convolve(g, np.ones(5) / 5, 'same')
    gg = np.repeat(g, hop)
    gg = np.concatenate([gg, np.ones(len(mono) - len(gg))])
    return apply(x, np.minimum(gg, 1.0))


def make_loop(x: np.ndarray, body: float, xf: float = 3.0) -> np.ndarray:
    """取 body + xf 秒，把尾部 xf 秒等功率交叉淡化进开头，得到可以无缝循环的 body 秒"""
    n = sec(body)
    k = sec(xf)
    seg = x[:n + k].copy()
    r = np.linspace(0, 1, k)
    fi = np.sin(r * np.pi / 2)
    fo = np.cos(r * np.pi / 2)
    head = seg[:k]
    tail = seg[n:n + k]
    out = seg[:n].copy()
    out[:k] = apply(head, fi) + apply(tail, fo)
    return out


def pad_loop(x: np.ndarray) -> np.ndarray:
    """循环体前后各接上 0.2 秒（循环体自己的尾与首），MP3 的编码延迟不会打断循环"""
    p = sec(PAD)
    return np.concatenate([x[-p:], x, x[:p]])


def reverb_tail(x: np.ndarray, rt: float, lp: float, wet_db: float, seed: int = 1) -> np.ndarray:
    """离线的暗混响尾巴：指数衰减的低通噪声作为冲激响应（只用于离线处理真实录音，不是一个声音）"""
    rng = np.random.default_rng(seed)
    n = sec(rt * 1.2)
    ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / sec(rt))
    ir = lpf(ir, lp, 2)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
    if x.ndim == 2:
        wet = np.stack([signal.fftconvolve(x[:, c], ir) for c in range(2)], axis=1)
    else:
        wet = signal.fftconvolve(x, ir)
    dry = np.concatenate([x, np.zeros((len(wet) - len(x),) + x.shape[1:])])
    return dry + wet * 10 ** (wet_db / 20)


def echoes(x: np.ndarray, taps: list[tuple[float, float, float]]) -> np.ndarray:
    """拖尾回声：taps = (延迟秒, 增益 dB, 回声的低通 Hz)，模拟深海声道的多路径"""
    parts = [(x, 0.0, 0.0)] + [(lpf(x, lp, 2), d, g) for d, g, lp in taps]
    return mix(*parts)


# ------------------------------------------------------------------ 相位声码器（保持时长的移调）

def pv_stretch(x: np.ndarray, rate: float, n_fft: int = 1024, hop_s: int = 256) -> np.ndarray:
    """时间伸展 rate 倍（>1 变长），带相位锁定（identity phase locking），减少“水声”伪影"""
    hop_a = int(round(hop_s / rate))
    win = np.hanning(n_fft)
    pad = np.concatenate([np.zeros(n_fft), x, np.zeros(n_fft)])
    frames = 1 + (len(pad) - n_fft) // hop_a
    X = np.stack([np.fft.rfft(pad[i * hop_a:i * hop_a + n_fft] * win) for i in range(frames)])
    mag = np.abs(X)
    ph = np.angle(X)
    k = np.arange(n_fft // 2 + 1)
    omega = 2 * np.pi * k * hop_a / n_fft
    out_ph = ph[0].copy()
    y = np.zeros(frames * hop_s + n_fft)
    wsum = np.zeros_like(y)
    for i in range(frames):
        if i > 0:
            d = ph[i] - ph[i - 1] - omega
            d = d - 2 * np.pi * np.round(d / (2 * np.pi))
            inst = (omega + d) / hop_a
            # 相位锁定：每个谱峰附近的频点跟随峰值的相位推进
            m = mag[i]
            peaks = signal.argrelmax(m, order=2)[0]
            adv = out_ph + inst * hop_s
            if len(peaks):
                owner = peaks[np.clip(np.searchsorted((peaks[1:] + peaks[:-1]) / 2, k), 0, len(peaks) - 1)]
                out_ph = adv[owner] + (ph[i] - ph[i][owner])
            else:
                out_ph = adv
        frame = np.fft.irfft(mag[i] * np.exp(1j * out_ph)) * win
        y[i * hop_s:i * hop_s + n_fft] += frame
        wsum[i * hop_s:i * hop_s + n_fft] += win ** 2
    y = y / np.maximum(wsum, 1e-3)
    start = int(round(n_fft * rate))
    return y[start:start + int(round(len(x) * rate))]


def octave_up(x: np.ndarray, fs: float) -> np.ndarray:
    """升高 12 个半音、时长不变：先伸展一倍，再按两倍速播放"""
    s = pv_stretch(x, 2.0)
    return resample(s, 2 * fs, fs)[:len(x)]


# ------------------------------------------------------------------ 响度（ITU-R BS.1770）

def _biquad(fc, q, gain_db, kind):
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / FS
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    if kind == 'shelf':
        b = [a * ((a + 1) + (a - 1) * c + 2 * np.sqrt(a) * al), -2 * a * ((a - 1) + (a + 1) * c),
             a * ((a + 1) + (a - 1) * c - 2 * np.sqrt(a) * al)]
        aa = [(a + 1) - (a - 1) * c + 2 * np.sqrt(a) * al, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - 2 * np.sqrt(a) * al]
    else:
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        aa = [1 + al, -2 * c, 1 - al]
    return np.array(b) / aa[0], np.array(aa) / aa[0]


def kweight(x: np.ndarray) -> np.ndarray:
    b1, a1 = _biquad(1681.97, 0.7072, 3.99984, 'shelf')
    b2, a2 = _biquad(38.135, 0.5003, 0, 'hp')
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def _power(x: np.ndarray, win: float, hop: float) -> np.ndarray:
    y = kweight(x)
    if y.ndim == 1:
        y = y[:, None]
    p = (y ** 2).sum(axis=1)
    n = sec(win)
    h = sec(hop)
    if len(p) < n:
        return np.array([p.mean()])
    c = np.concatenate([[0], np.cumsum(p)])
    idx = np.arange(0, len(p) - n + 1, h)
    return (c[idx + n] - c[idx]) / n


def lufs_i(x: np.ndarray) -> float:
    z = _power(x, 0.4, 0.1)
    l = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[l > -70]
    if not len(z):
        return -70.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    l = -0.691 + 10 * np.log10(z + 1e-20)
    return float(-0.691 + 10 * np.log10(z[l > rel].mean()))


def lufs_s_max(x: np.ndarray) -> float:
    """短时响度（3 秒窗）的最大值；不足 3 秒的素材补零到 3 秒（与混音里测到的一致）"""
    if len(x) < sec(3.0):
        x = np.concatenate([x, np.zeros((sec(3.0) - len(x),) + x.shape[1:])])
    return float(np.max(-0.691 + 10 * np.log10(_power(x, 3.0, 0.1) + 1e-20)))


def lufs_m_max(x: np.ndarray) -> float:
    return float(np.max(-0.691 + 10 * np.log10(_power(x, 0.4, 0.1) + 1e-20)))


def true_peak(x: np.ndarray) -> float:
    y = signal.resample_poly(x, 4, 1, axis=0)
    return float(20 * np.log10(np.max(np.abs(y)) + 1e-12))


def above(x: np.ndarray, f0: float = 300) -> float:
    """f0 以上的能量占比（单声道）"""
    m = x if x.ndim == 1 else x.mean(axis=1)
    f, p = signal.welch(m, FS, nperseg=4096)
    return float(p[f >= f0].sum() / (p.sum() + 1e-30))


def limit(x: np.ndarray, ceiling_db: float = -1.2) -> np.ndarray:
    """前瞻限幅：按 4 倍过采样的峰值计算增益，起音 2 ms（前瞻）、释放 60 ms"""
    from scipy.ndimage import minimum_filter1d

    c = 10 ** (ceiling_db / 20)
    n = len(x)
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0))
    if up.ndim == 2:
        up = up.max(axis=1)
    up = fit(up, 4 * n)
    m = up.reshape(n, 4).max(axis=1)
    g = np.minimum(1.0, c / np.maximum(m, 1e-12))
    # 前瞻：增益在峰值之前 2 ms 就降下来；之后按 60 ms 释放
    gmin = minimum_filter1d(g, size=2 * sec(0.002) + 1)
    rel = np.exp(-1 / sec(0.06))
    out = np.empty_like(gmin)
    v = 1.0
    for i in range(len(gmin)):
        v = gmin[i] if gmin[i] < v else gmin[i] + (v - gmin[i]) * rel
        out[i] = v
    return apply(x, out)


def normalize(x: np.ndarray, kind: str, target: float | None = None, margin: float = 0.0) -> tuple[np.ndarray, dict]:
    """循环床：积分响度 −18 LUFS；一次性素材：短时响度最大值 −18 LUFS。
    真峰值 ≤ −1 dBTP；若运行时要把它放到比 −18 更响的目标电平（target，LUFS-S），预留出相应的余量。
    短促的瞬态素材在限幅之后会变轻，最多迭代几次逼近 −18（不足的部分由 manifest 里记录的实测响度在运行时补偿）。"""
    # 先粗调到均方根 −30 dBFS：水听器的原始电平可能低到 −77 dBFS，低于 BS.1770 的 −70 LUFS 绝对门限
    x = x / (np.sqrt(np.mean(x ** 2)) + 1e-12) * 10 ** (-30 / 20)
    ceiling = (-1.6 if target is None else min(-1.6, -1.9 - (target - TARGET))) - margin
    measure_ = lufs_i if kind == 'loop' else lufs_s_max
    passes = 1 if len(x) < FS else 4
    y = x
    for _ in range(passes):
        l = measure_(y)
        y = y * 10 ** ((TARGET - l) / 20)
        if true_peak(y) <= ceiling + 0.05:
            break
        y = limit(y, ceiling)
    return y, {'lufs': measure_(y), 'tp': true_peak(y)}


def encode(x: np.ndarray, path: str, kbps: int, rate: int) -> None:
    ch = 1 if x.ndim == 1 else 2
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        sf.write(tmp, x.astype(np.float32), FS, subtype='FLOAT')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-ac', str(ch), '-ar', str(rate), '-c:a', 'libmp3lame',
                        '-b:a', f'{kbps}k', '-write_xing', '1', path], check=True)
    finally:
        os.unlink(tmp)


# ------------------------------------------------------------------ 蓝鲸（MBARI，1.3）

SPEED = 6  # 与 NOAA、MBARI 公开展示时一样整体加速 6 倍（音高与节奏一起提高）


def whale_clean(x: np.ndarray, over: float, top: float = 160.0) -> np.ndarray:
    """2 kHz 原始数据：压低短促的宽带脉冲、按每个频率的噪声底温和地谱减、只保留约 10~top 赫兹"""
    fs = 2000
    x = signal.sosfiltfilt(signal.butter(2, 8, btype='highpass', fs=fs, output='sos'), x)
    f, t, Z = signal.stft(x, fs, nperseg=1024, noverlap=768)
    mag = np.abs(Z)
    hi = (f >= 170) & (f <= 400)
    e = (mag[hi] ** 2).mean(axis=0)
    med = signal.medfilt(e, 31)
    click = np.clip(np.sqrt(4 * med / np.maximum(e, 1e-12)), 0.2, 1)
    click = np.convolve(click, np.ones(5) / 5, 'same')
    floor = np.percentile(mag, 30, axis=1, keepdims=True)
    gain = np.clip(1 - over * floor / np.maximum(mag, 1e-9), 0.12, 1)
    gain = signal.convolve2d(gain, np.ones((3, 9)) / 27, mode='same', boundary='symm')
    band = np.clip((f - 6) / 6, 0, 1) * np.clip((top + 40 - f) / 40, 0, 1)
    _, y = signal.istft(Z * gain * click[None, :] * band[:, None], fs, nperseg=1024, noverlap=768)
    return y[: len(x)]


def whale_layers(y2k: np.ndarray, octave_floor_db: float = -8.0, share: float = 0.36) -> tuple[np.ndarray, float]:
    """加速 6 倍后的原声 + 保持时长升高一个八度、带通 350–1600 Hz 的同一段录音。
    八度层至少比原声低 8 dB（按均方根）；为了让 300 Hz 以上的能量占比达到 share，可以再高一些。"""
    fs6 = 2000 * SPEED
    base = resample(y2k, fs6, FS)
    octv = resample(octave_up(y2k, fs6), fs6, FS)
    octv = bpf(fit(octv, len(base)), 350, 1600)
    rb = np.sqrt(np.mean(base ** 2))
    ro = np.sqrt(np.mean(octv ** 2)) + 1e-12
    best = octave_floor_db
    for g in np.arange(octave_floor_db, 0.01, 0.5):
        best = g
        if above(base + octv * rb / ro * 10 ** (g / 20)) >= share:
            break
    return base + octv * rb / ro * 10 ** (best / 20), best


def whale(lib: Library, key: str, over: float, lp: float, share: float = 0.38, fin: float = 0.25, fout: float = 1.0) -> tuple[np.ndarray, float]:
    y, g = whale_layers(whale_clean(lib.mbari(key), over), share=share)
    y = lpf(y, lp)
    return fades(y, fin, fout), g


# ------------------------------------------------------------------ 配方：每个素材的剪辑与处理

R: dict[str, dict] = {}


def recipe(key: str, name: str, batch: int, kind: str = 'shot', rate: int = 44100, kbps: int = 64, target: float | None = None):
    """target：运行时的最响目标电平（LUFS-S，见 cue sheet 4.2），只用于预留真峰值余量"""
    def deco(fn):
        R[key] = dict(name=name, batch=batch, kind=kind, rate=rate, kbps=kbps, fn=fn, target=target)
        return fn
    return deco


# ---- 循环床（A）

@recipe('A01', 'uw-open', 0, 'loop', 44100, 56)
def a01(L: Library):
    # NOAA SanctSound OC03_02（奥林匹克海岸，开阔海域）：平稳的风浪嘶声与缓慢起伏，没有船、鱼叫、咔哒
    x = cut(L.get('ss_openocean'), 16, 50)
    x = lpf(hpf(declick(x), 30, 2), 6000)
    return make_loop(x, 30, 3)


@recipe('A02', 'uw-surface', 0, 'loop', 32000, 48)
def a02(L: Library):
    # SanctSound MB02_04（蒙特雷湾，风大的一天）：从水下听到头顶的浪，约每 3.5 s 一次低沉的涌动
    x = L.get('ss_swell')
    x = lpf(hpf(declick(x), 25, 2), 1500)
    x = presence(x, 250, 900, 9)
    return make_loop(x, 15, 3)


@recipe('A03', 'deep', 3, 'loop', 32000, 48)
def a03(L: Library):
    # MBARI MARS（891 m）2016-12-21 00:25:40 UTC 起：深夜、无船、无鲸歌的深海环境
    x = resample(L.mbari('mb_deep'), 16000, FS)
    x = lpf(hpf(declick(x, 8), 20, 2), 1600)
    return make_loop(x, 30, 3)


def chain(parts: list[np.ndarray], xf: float) -> np.ndarray:
    """首尾交叉淡化地拼接几段录音"""
    k = sec(xf)
    out = parts[0].copy()
    r = np.linspace(0, 1, k)
    for p in parts[1:]:
        head = p[:k]
        out[-k:] = out[-k:] * np.cos(r * np.pi / 2) + head * np.sin(r * np.pi / 2)
        out = np.concatenate([out, p[k:]])
    return out


@recipe('A04', 'air-sea', 2, 'loop', 44100, 96)
def a04(L: Library):
    # 高空看到的大洋海面：ESC-50 中没有岸边拍打的海浪片段交叉拼接，左右声道用不同的顺序（互不相关，折叠成单声道不会抵消）
    a, b, c, d, e = (L.get(k) for k in ('esc_waves_atmo_a', 'esc_red_sea', 'esc_waves_in_sea', 'esc_gentle_sea', 'esc_waves_atmo_b'))
    left = chain([a, b, c, d, e, a], 1.0)
    right = chain([e, d, a, b, c, e], 1.0)
    x = np.stack([left, right[:len(left)]], axis=1)
    x = lpf(hpf(x, 120), 9000)
    return make_loop(x, 22, 3)


@recipe('A05', 'waterline', 2, 'loop', 44100, 96)
def a05(L: Library):
    # 水线：近处的浪拍打（slag777）与海水穿过栈桥孔的咕嘟（aesqe），左右声道错开
    ca, cb, cc, pa, pb = (L.get(k) for k in ('esc_close_a', 'esc_close_b', 'esc_close_c', 'esc_pier_a', 'esc_pier_b'))
    left = chain([ca, pa, cc, pb], 1.0)
    right = chain([cb, pb, ca, pa], 1.0)
    x = np.stack([left, right[:len(left)]], axis=1)
    x = lpf(hpf(x, 80), 12000)
    return make_loop(x, 14, 3)


@recipe('A07', 'chorus', 0, 'loop', 32000, 56)
def a07(L: Library):
    # 远处许多蓝鲸与长须鲸的合唱（MBARI 2018-10-20 06:20 UTC 起），加速 6 倍；八度层电平更低
    y = whale_clean(L.mbari('mb_chorus'), 1.0)
    fs6 = 2000 * SPEED
    base = resample(y, fs6, FS)
    octv = bpf(fit(resample(octave_up(y, fs6), fs6, FS), len(base)), 350, 1600)
    x = base + octv * np.sqrt(np.mean(base ** 2)) / (np.sqrt(np.mean(octv ** 2)) + 1e-12) * 10 ** (-6 / 20)
    x = lpf(x, 1800)
    # 选包络最平稳的 33 秒
    win = sec(33)
    hop = sec(1)
    best, bi = 1e9, 0
    for i in range(0, len(x) - win, hop):
        seg = x[i:i + win]
        r = np.array([np.sqrt(np.mean(seg[j:j + hop] ** 2)) for j in range(0, win - hop, hop)])
        v = np.std(20 * np.log10(r + 1e-12))
        if v < best:
            best, bi = v, i
    return make_loop(x[bi:], 30, 3)


@recipe('A08', 'flow', 0, 'loop', 32000, 48)
def a08(L: Library):
    # 水下的低沉流动（Kinoton “Underwater Ambience”，CC0）：巨大的身体推开、带走海水，游动 / 下沉 / 上升三用
    x = L.get('kinoton_underwater')
    x = lpf(hpf(x, 25, 2), 800)
    x = presence(x, 250, 800, 9)
    return make_loop(x, 20, 3)


@recipe('A09', 'krill', 0, 'loop', 32000, 48)
def a09(L: Library):
    # 磷虾群的细密窸窣：SanctSound HI03_02 水下听到的雨（非常平稳），高通 600 Hz、低通 6 kHz
    x = cut(L.get('ss_rain'), 20, 36)
    x = lpf(hpf(declick(x), 600), 6000)
    return make_loop(x, 12, 3)


@recipe('A10', 'scavengers', 4, 'loop', 32000, 48)
def a10(L: Library):
    # 食腐活动：SanctSound CI01_05 枪虾群，扩展器稀疏化（只留约三成的“啪”）、放慢一点（降 5 个半音）、低通 3 kHz
    x = L.get('ss_shrimp')
    hb = hpf(x, 2000)
    e = np.sqrt(np.convolve(hb ** 2, np.ones(sec(0.004)) / sec(0.004), 'same'))
    thr = np.percentile(e, 93)
    g = np.clip(e / thr, 0, 1) ** 2.5
    g = np.maximum(g, 0.08)
    g = np.convolve(g, np.ones(sec(0.002)) / sec(0.002), 'same')
    x = varispeed(x * g, -5)
    x = lpf(hpf(x, 150), 3000)
    return make_loop(x, 12, 3)


# ---- 一次性音效（F）

def surge(L: Library, a: float, dur: float, lp: float = 600) -> np.ndarray:
    """SanctSound MB02_04 中一次从水下听到的低沉浪涌（真实的一整团水体移动）"""
    return lpf(hpf(cut(L.get('ss_swell'), a, a + dur), 25, 2), lp)


def push(L: Library, a: float, cave_at: float, seed_db: float = -4) -> np.ndarray:
    """尾叶推水：浪涌（低频）+ 降 12 个半音的海蚀洞涌浪（保留 200–450 Hz 让手机听得见）"""
    s = surge(L, a, 2.8, 500)
    c = varispeed(L.get('esc_seacave_a'), -12)
    c = bpf(cut(c, cave_at, cave_at + 3.0), 120, 450)
    x = mix((s, 0, 0), (c, 0, seed_db))
    x = fit(x, sec(3.0))
    x = presence(x, 200, 500, 6)
    e = env(len(x), [(0, 0), (0.25, 1), (0.6, 0.9), (3.0, 0)]) ** 1.5
    return fades(apply(x, e), 0.005, 0.05)


@recipe('F01a', 'stroke-a', 0)
def f01a(L):
    return push(L, 1.0, 1.0)


@recipe('F01b', 'stroke-b', 0)
def f01b(L):
    return push(L, 4.7, 3.5)


@recipe('F01c', 'stroke-c', 0)
def f01c(L):
    return push(L, 11.4, 6.0)


@recipe('F02', 'glide', 1)
def f02(L):
    # 巨体从头顶滑过：降 12 个半音的“屋里的海”（Akoustikos）+ Kinoton 水下流动，慢起慢落
    a = lpf(hpf(varispeed(L.get('esc_sea_room'), -12), 40), 500)
    b = lpf(L.get('kinoton_underwater'), 400)
    x = presence(mix((cut(a, 0.5, 7.5), 0, 0), (cut(b, 3, 10), 0, -3)), 220, 600, 6)
    e = env(len(x), [(0, 0), (2.5, 0.85), (3.5, 1), (4.0, 1), (7.0, 0)]) ** 1.3
    return fades(apply(x, e), 0.05, 0.1)


@recipe('F03', 'engulf', 1)
def f03(L):
    # 吞水：加速涌入（海蚀洞涌浪降 9 个半音）→ 喉囊兜住的低沉膨胀（浪涌 + 降 24 个半音的吞咽）→ 平息
    ca = varispeed(L.get('esc_seacave_a'), -9)
    cb = varispeed(L.get('esc_seacave_b'), -9)
    rm = varispeed(L.get('esc_sea_room'), -7)
    rush = mix((cut(ca, 0, 5.6), 0, 0), (cut(rm, 0, 5.6), 0, -3))
    rush = lpf(hpf(rush, 50), 1000)
    rush = apply(rush, env(len(rush), [(0, 0), (1.5, 0.25), (2.5, 1), (4.2, 1), (5.6, 0)]) ** 1.8)
    fill = lpf(hpf(cut(cb, 1.0, 6.0), 40), 700)
    fill = apply(fill, env(len(fill), [(0, 0), (0.6, 1), (1.6, 0.9), (5.0, 0)]))
    swell = surge(L, 4.7, 4.0, 300)
    gulp = lpf(varispeed(cut(L.get('esc_gulp'), 0.4, 1.4), -24), 300)
    x = mix((rush, 0, 0), (fill, 2.6, -2), (swell, 2.4, 0), (gulp, 3.4, -12))
    x = fit(x, sec(7.0))
    return fades(apply(x, env(len(x), [(0, 1), (4.2, 1), (7.0, 0)]) ** 1.2), 0.02, 0.2)


@recipe('F04', 'filter', 1)
def f04(L):
    # 滤水：海水穿过栈桥孔（aesqe）低通 2 kHz + 降 7 个半音的倒水（runirasmussen、BranRainey）+ 潜水员呼出的气泡
    p = lpf(hpf(np.concatenate([L.get('esc_pier_a'), L.get('esc_pier_b')]), 80), 2000)
    w1 = lpf(varispeed(L.get('esc_pour_a'), -7), 1500)
    w2 = lpf(varispeed(L.get('esc_pour_b'), -7), 1500)
    bub = lpf(cut(L.get('ss_bubbles_a'), 0.6, 2.8), 2500)
    x = mix((cut(p, 0, 7), 0, 0), (cut(w1, 1.0, 6.5), 0.4, -4), (cut(w2, 0.5, 6.0), 1.5, -6), (bub, 2.0, -6))
    x = fit(x, sec(7.0))
    return fades(apply(x, env(len(x), [(0, 0), (0.3, 1), (2.8, 0.9), (7.0, 0)])), 0.02, 0.2)


@recipe('F05a', 'bubbles-a', 1)
def f05a(L):
    # 气泡（成团）：SanctSound FK01_06 潜水员呼出的气泡（不含调节器的吸气声）
    x = lpf(cut(L.get('ss_bubbles_a'), 0.6, 2.8), 3000)
    x = np.concatenate([x, np.zeros(sec(0.6))])
    return fades(apply(x, env(len(x), [(0, 1), (1.6, 1), (2.8, 0)])), 0.01, 0.1)


@recipe('F05b', 'bubbles-b', 1)
def f05b(L):
    # 零星的小气泡：SanctSound GR01_01 的另一位潜水员，更轻
    x = lpf(cut(L.get('ss_bubbles_b'), 0.8, 2.6), 3000)
    return fades(apply(x, env(len(x), [(0, 0.6), (0.4, 1), (1.8, 0)])), 0.01, 0.1)


@recipe('F06', 'emerge', 2)
def f06(L):
    # 镜头出水：0–0.6 s 闷的上升涌动 → 0.6 s 处“哗”地破水（Adam_N Water splash 1、rafael45 Splashing Water）→ 水淌下（aesqe）
    up = surge(L, 11.4, 0.9, 450)
    up = apply(up, env(len(up), [(0, 0), (0.55, 1), (0.9, 0)]))
    s1 = cut(L.get('esc_splash_1'), 0.40, 2.9)  # 主击在源文件的 0.53 s（切掉之前的一下小水花）
    s2 = cut(L.get('esc_splashing'), 3.2, 5.0)  # 主击在 3.39 s
    drip = lpf(hpf(cut(L.get('esc_pier_a'), 0.5, 3.2), 300), 6000)
    drip = apply(drip, env(len(drip), [(0, 0), (0.4, 1), (2.7, 0)]))
    x = mix((up, 0, 0), (s1, 0.6 - 0.13, 0), (s2, 0.6 - 0.19, -5), (drip, 0.9, -12))
    x = fit(x, sec(3.0))
    return fades(x, 0.01, 0.2)


def gull(L: Library, a: float, b: float, far: bool = False) -> np.ndarray:
    x = hpf(cut(L.get('moodist_gulls'), a, b), 450)
    if far:
        x = reverb_tail(lpf(x, 2500), 0.9, 2500, -12, seed=3)
    return fades(x, 0.015, 0.08)


@recipe('F09a', 'gull-a', 2)
def f09a(L):
    return gull(L, 34.08, 34.80)


@recipe('F09b', 'gull-b', 2)
def f09b(L):
    return gull(L, 12.12, 13.30)


@recipe('F09c', 'gull-c', 2)
def f09c(L):
    return gull(L, 13.62, 14.40)


@recipe('F09d', 'gull-d', 2)
def f09d(L):
    return gull(L, 8.36, 9.02, far=True)


def blow(L: Library) -> np.ndarray:
    """喷气（处理过的替代录音，没有真实的鲸鱼喷气）：
    海蚀洞涌浪（ikbenraar）作主体：80 ms 爆发、0.6 s 核心、约 2 s 水雾嘶声；
    降 7 个半音的一口短促呼气（Walter_Odington）作“噗”；降 12 个半音的长呼吸（cidchili）低通 1.2 kHz 作胸腔；
    高通 3 kHz 的海浪（monotraum）作飘落的水雾，左右声道用两段不同的录音。"""
    ca = cut(L.get('esc_seacave_a'), 2.95, 5.0)
    cb = cut(L.get('esc_seacave_b'), 0.0, 2.6)
    core = chain([ca, cb], 0.4)
    core = hpf(core, 90)
    core = fit(core, sec(4.0))
    core = apply(core, env(len(core), [(0, 0), (0.08, 1), (0.68, 0.95), (1.2, 0.55), (2.7, 0.12), (4.0, 0)]))
    huff = lpf(varispeed(cut(L.get('esc_breath_deep'), 0.95, 1.75), -7), 900)
    huff = apply(huff, env(len(huff), [(0, 0), (0.05, 1), (0.6, 0.6), (len(huff) / FS, 0)]))
    chest = lpf(varispeed(cut(L.get('esc_breath_sci'), 0.55, 2.2), -12), 1200)
    chest = apply(chest, env(len(chest), [(0, 0), (0.08, 1), (0.7, 0.8), (len(chest) / FS, 0)]))
    hl = hpf(L.get('esc_waves_atmo_a'), 3000)[:sec(4)]
    hr = hpf(L.get('esc_waves_atmo_b'), 3000)[:sec(4)]
    mist = np.stack([hl, hr], axis=1)
    mist = apply(mist, env(len(mist), [(0, 0), (0.25, 0.6), (0.9, 1), (2.6, 0.5), (4.0, 0)]))
    x = mix((core, 0, 0), (huff, 0, -3), (chest, 0.02, -8), (mist, 0, -9))
    return fades(fit(x, sec(4.0)), 0.003, 0.2)


@recipe('F11', 'blow', 2, 'shot', 44100, 96, target=-18)
def f11(L):
    return blow(L)


@recipe('F10', 'blow-far', 2)
def f10(L):
    # 200 米外的喷气：F11 低通 3 kHz、更短、加一点距离的尾巴
    x = blow(L).mean(axis=1)
    x = lpf(x, 3000)[:sec(2.6)]
    x = apply(x, env(len(x), [(0, 1), (1.2, 0.6), (2.6, 0)]))
    return fades(reverb_tail(x, 1.0, 2500, -14, seed=5), 0.005, 0.2)


@recipe('F12', 'inhale', 2)
def f12(L):
    # 吸气（处理过的替代录音）：降 10 个半音的呼吸（UncleSigmund）慢慢涌起，加一点海蚀洞的空腔共鸣，
    # 最后是喷气孔合上的轻闷声（降 12 个半音的石头落水，toiletrolltube）
    br = lpf(varispeed(cut(L.get('esc_breath_c'), 0.7, 1.7), -10), 1500)
    br = apply(br, env(len(br), [(0, 0), (0.55, 1), (len(br) / FS, 0)]))
    cav = lpf(hpf(cut(L.get('esc_seacave_b'), 2.6, 3.8), 150), 1500)
    cav = apply(cav, env(len(cav), [(0, 0), (0.6, 1), (1.2, 0)]))
    plop = lpf(varispeed(cut(L.get('esc_stones_bath'), 0.95, 1.35), -12), 350)
    x = mix((br, 0, 0), (cav, 0, -10), (plop, 1.12, -9))
    return fades(fit(x, sec(1.6)), 0.02, 0.1)


@recipe('F13', 'spray', 2)
def f13(L):
    # 浪花水雾涌过镜头：bulbastre 的浪击防波堤中一个完整的拍碎（峰值约在 1.4 s）；声像在运行时从左扫到右
    x = hpf(cut(L.get('esc_breakwater_a'), 1.6, 5.0), 150)
    x = np.concatenate([x, np.zeros(sec(0.1))])
    return fades(apply(x, env(len(x), [(0, 0.3), (1.0, 0.8), (1.4, 1), (2.4, 0.6), (3.5, 0)])), 0.05, 0.2)


@recipe('F14', 'plunge', 2)
def f14(L):
    # 镜头入水：空气中的“哗啦”（Adam_N Water splash 2）在 0.2–0.35 s 内从全频带变成 900 Hz 低通的闷声，随后是上升的小气泡
    s = cut(L.get('esc_splash_2'), 0.0, 2.5)
    k = env(len(s), [(0, 1), (0.2, 1), (0.35, 0), (2.5, 0)])
    s = apply(s, k) + apply(lpf(s, 900), 1 - k)
    bub = fades(lpf(cut(L.get('ss_bubbles_b'), 0.8, 2.6), 2500), 0.05, 0.6)
    x = mix((s, 0, 0), (bub, 0.35, -3))
    x = fit(x, sec(2.5))
    return fades(apply(x, env(len(x), [(0, 1), (1.6, 0.8), (2.5, 0)])), 0.003, 0.15)


def landing(L: Library, seawall_at: float, plop_at: float, dur: float, mud_db: float, body_lp: float = 250) -> np.ndarray:
    """着地（处理过的替代录音）：降 12 个半音的石头落水作起音（60–80 ms），降 24 个半音的浪击海堤（crosbychris）作身体，
    降 12 个半音的湿雪脚步（lwdickens）低通 900 Hz 作软泥被压实"""
    body = lpf(hpf(varispeed(L.get('esc_seawall'), -24), 20, 2), body_lp)
    body = cut(body, seawall_at, seawall_at + dur)
    body = apply(body, env(len(body), [(0, 0), (0.07, 1), (0.5, 0.75), (dur, 0)]) ** 1.4)
    plop = lpf(varispeed(cut(L.get('esc_stones_bath'), plop_at - 0.04, plop_at + 0.5), -12), 450)
    mud = lpf(hpf(varispeed(cut(L.get('esc_wet_snow'), 1.8, 3.4), -12), 120), 900)
    mud = apply(mud, env(len(mud), [(0, 0), (0.12, 1), (1.6, 0.4), (len(mud) / FS, 0)]))
    x = mix((body, 0, 0), (plop, 0, -2), (mud, 0.12, mud_db))
    x = presence(x, 200, 600, 12)
    x = reverb_tail(x, 1.2, 600, -14, seed=7)
    return fades(fit(x, sec(dur)), 0.003, 0.25)


@recipe('F15a', 'land-main', 3)
def f15a(L):
    return landing(L, 2.0, 1.02, 3.5, 6)


@recipe('F15b', 'land-head', 3)
def f15b(L):
    return landing(L, 7.0, 3.69, 2.5, -2, 300)


@recipe('F15c', 'land-tail', 3)
def f15c(L):
    return landing(L, 12.0, 3.69, 2.0, -4, 350)


@recipe('F16', 'sediment', 3, 'shot', 32000, 48)
def f16(L):
    # 沉积物：Kinoton 水下流动低通 1.2 kHz（涌起、扩散）+ SanctSound 水下雨声低通 1 kHz（细颗粒落下）+ 一次低沉的浪涌
    a = lpf(cut(np.concatenate([L.get('kinoton_underwater')] * 2), 2, 16), 1200)
    a = apply(a, env(len(a), [(0, 0), (2, 1), (7, 0.9), (14, 0)]))
    b = lpf(hpf(cut(L.get('ss_rain'), 60, 72), 200), 1000)
    b = apply(b, env(len(b), [(0, 0), (4, 1), (9, 0.6), (11, 0)]))
    c = surge(L, 4.7, 3.0, 300)
    x = presence(mix((a, 0, 0), (b, 3, 4), (c, 0, -3)), 220, 800, 9)
    return fades(fit(x, sec(14)), 0.05, 0.5)


def bite(L: Library, at: float, crunch_at: float) -> np.ndarray:
    """睡鲨咬合：SanctSound CI02_04 中真实的水下鱼类敲击（低通 1.5 kHz）+ 放慢一倍的湿雪咯吱声（lwdickens），短暗混响"""
    k = lpf(cut(L.get('ss_knocks'), at - 0.03, at + 0.35), 1500)
    c = lpf(varispeed(cut(L.get('esc_snow_crunchy'), crunch_at - 0.05, crunch_at + 0.3), -12), 1500)
    x = mix((k, 0, 0), (c, 0.02, -8))
    x = reverb_tail(x, 0.6, 1000, -12, seed=11)
    return fades(fit(x, sec(0.8)), 0.003, 0.15)


@recipe('F17a', 'bite-a', 4)
def f17a(L):
    return bite(L, 1.07, 3.97)


@recipe('F17b', 'bite-b', 4)
def f17b(L):
    return bite(L, 3.20, 3.97)


def shake(L: Library, a: float, pour_at: float) -> np.ndarray:
    """甩头：一下被搅动的水（短浪涌低通 400 Hz + 降 5 个半音的倒水）"""
    s = surge(L, a, 1.3, 400)
    w = lpf(varispeed(cut(L.get('esc_pour_a'), pour_at, pour_at + 1.0), -5), 1000)
    x = presence(mix((s, 0, 0), (w, 0.05, 2)), 220, 700, 9)
    x = fit(x, sec(1.3))
    return fades(apply(x, env(len(x), [(0, 0), (0.12, 1), (1.3, 0)])), 0.005, 0.1)


@recipe('F18a', 'shake-a', 4)
def f18a(L):
    return shake(L, 5.3, 2.1)


@recipe('F18b', 'shake-b', 4)
def f18b(L):
    return shake(L, 12.0, 0.5)


def tear(L: Library, at: float) -> np.ndarray:
    """撕下：放慢一倍的湿雪脚步（纤维撕裂的闷声，lwdickens）低通 1.2 kHz + 一小团水流，短暗混响"""
    t = lpf(hpf(varispeed(cut(L.get('esc_wet_snow'), at - 0.1, at + 0.65), -12), 100), 1200)
    s = surge(L, 8.4, 1.2, 400)
    s = apply(s, env(len(s), [(0, 0), (0.3, 1), (1.2, 0)]))
    x = mix((t, 0, 0), (s, 0.1, -6))
    x = reverb_tail(x, 0.6, 1000, -12, seed=13)
    return fades(fit(x, sec(1.6)), 0.005, 0.15)


@recipe('F18c', 'tear-a', 4)
def f18c(L):
    return tear(L, 1.97)


@recipe('F18d', 'tear-b', 4)
def f18d(L):
    return tear(L, 3.25)


@recipe('F19', 'hagfish', 4, 'shot', 32000, 48)
def f19(L):
    # 盲鳗钻进伤口：降 7 个半音的湿脚步（RutgerMuller）低通 1 kHz，湿、软、很轻
    x = lpf(hpf(varispeed(cut(L.get('esc_wet_steps'), 1.0, 2.4), -7), 100), 1000)
    return fades(apply(fit(x, sec(2.0)), env(sec(2.0), [(0, 0), (0.2, 1), (1.4, 0.7), (2.0, 0)])), 0.01, 0.1)


def tick(L: Library, ats: list[float], dur: float) -> np.ndarray:
    """骨上的“嗒”：SanctSound CI01_01 中单个较弱的枪虾“啪”，低通 3 kHz"""
    parts = [(lpf(cut(L.get('ss_shrimp_snaps'), a - 0.01, a + 0.1), 3000), i * 0.13, 0) for i, a in enumerate(ats)]
    return fades(fit(mix(*parts), sec(dur)), 0.002, 0.03)


def scrape(L: Library, at: float) -> np.ndarray:
    """螺的齿舌刮过骨面：lwdickens 的冰面咯吱声切 0.3 s，低通 3 kHz"""
    x = lpf(hpf(cut(L.get('esc_crunchy_ice'), at - 0.05, at + 0.3), 300), 3000)
    return fades(x, 0.01, 0.08)


@recipe('F21a', 'bone-tick-a', 4)
def f21a(L):
    return tick(L, [1.12], 0.2)


@recipe('F21b', 'bone-tick-b', 4)
def f21b(L):
    return tick(L, [2.21, 4.45], 0.35)


@recipe('F21c', 'bone-scrape-a', 4)
def f21c(L):
    return scrape(L, 3.92)


@recipe('F21d', 'bone-scrape-b', 4)
def f21d(L):
    return scrape(L, 2.30)


@recipe('F23', 'sperm-whale', 3, 'shot', 32000, 48)
def f23(L):
    # 远处抹香鲸的回声定位咔哒（SanctSound HI03_02），低通 4 kHz，加远距离的尾巴
    x = chain([L.get('ss_sperm'), L.get('ss_sperm2')], 0.3)[:sec(6.0)]
    x = lpf(hpf(x, 300), 4000)
    x = reverb_tail(x, 1.5, 2000, -10, seed=17)
    return fades(fit(x, sec(6.5)), 0.05, 0.4)


# ---- 鲸鸣（V）

@recipe('V01', 'call-ab-near', 1)
def v01(L):
    y, g = whale(L, 'mb_ab', 1.6, 2500, share=0.40)
    R['V01']['octave_db'] = g
    return y


@recipe('V02', 'call-ab-deep', 3)
def v02(L):
    y, g = whale(L, 'mb_ab2', 1.6, 800, share=0.46)
    R['V02']['octave_db'] = g
    y = echoes(np.concatenate([y, np.zeros(sec(5))]), [(0.9, -9, 700), (2.1, -15, 600)])
    return fades(fit(y, len(y) - sec(2.0)), 0.01, 1.0)


@recipe('V03', 'call-b-far', 3)
def v03(L):
    y, g = whale(L, 'mb_b', 1.6, 1200)
    R['V03']['octave_db'] = g
    return fades(reverb_tail(y, 3.0, 900, -10, seed=19), 0.01, 0.8)


@recipe('V04', 'call-b-mid', 4)
def v04(L):
    y, g = whale(L, 'mb_b', 1.6, 1500, share=0.40)
    R['V04']['octave_db'] = g
    return fades(reverb_tail(y, 2.0, 1200, -13, seed=23), 0.01, 0.6)


# ------------------------------------------------------------------ 主程序

def measure(path: str, kind: str) -> dict:
    x, fs = decode(path)
    y = resample(x, fs, FS)
    return {
        'dur': round(len(x) / fs, 3),
        'lufs': round(lufs_i(y) if kind == 'loop' else lufs_s_max(y), 2),
        'tp': round(true_peak(y), 2),
        'above300': round(above(y), 3),
        'kb': round(os.path.getsize(path) / 1024, 1),
    }


def write_manifest(manifest: dict) -> None:
    """每个声音素材一行，便于审阅"""
    lines = ['{']
    other = {k: v for k, v in manifest.items() if k != 'audio'}
    for k, v in other.items():
        lines.append(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},')
    lines.append('  "audio": {')
    items = list(manifest['audio'].items())
    for i, (k, v) in enumerate(items):
        lines.append(f'    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' + (',' if i < len(items) - 1 else ''))
    lines.append('  }')
    lines.append('}')
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache')
    ap.add_argument('--only')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    L = Library(cache_dir(args))
    os.makedirs(args.out, exist_ok=True)
    keys = args.only.split(',') if args.only else list(R)
    with open(MANIFEST, encoding='utf-8') as f:
        manifest = json.load(f)
    audio = manifest.get('audio') or {}
    if not args.only:
        audio = {}
        for fn in os.listdir(args.out):
            if fn.endswith('.mp3'):
                os.unlink(os.path.join(args.out, fn))
    for key in keys:
        r = R[key]
        raw = r['fn'](L)
        fn = f"{key}_{r['name']}.mp3"
        path = os.path.join(args.out, fn)
        margin = 0.0
        # MP3 编码会让峰值略微冒头：解码回来测真峰值，超过 −1 dBTP 就留出更多余量重做
        for _ in range(4):
            x, _ = normalize(raw, r['kind'], r['target'], margin)
            body = len(x) / FS
            if r['kind'] == 'loop':
                x = pad_loop(x)
            encode(x, path, r['kbps'], r['rate'])
            m = measure(path, 'shot' if r['kind'] != 'loop' else 'loop')
            if m['tp'] <= -1.0:
                break
            margin += m['tp'] + 1.0 + 0.3
        entry = {'file': 'audio/' + fn, 'batch': r['batch'], 'lufs': m['lufs']}
        if r['kind'] == 'loop':
            entry['loop'] = [PAD, round(PAD + body, 4)]
        audio[key] = entry
        extra = f"  octave {r['octave_db']:+.1f} dB" if 'octave_db' in r else ''
        print(f"{key:5s} {fn:28s} {m['dur']:6.2f} s  {m['kb']:6.1f} KB  {m['lufs']:6.2f} LUFS  TP {m['tp']:6.2f}  >300Hz {m['above300']:.2f}{extra}", flush=True)
    manifest['audio'] = dict(sorted(audio.items()))
    write_manifest(manifest)
    total = sum(os.path.getsize(os.path.join(args.out, fn)) for fn in os.listdir(args.out) if fn.endswith('.mp3'))
    print(f'total {total / 1024:.0f} KB')


if __name__ == '__main__':
    sys.exit(main())
