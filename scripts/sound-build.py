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
  - Ambie（freesound 393819，Kinoton，CC0）：水下的低沉流动；Blanket（freesound 217506，felix.blume，CC0）：风；
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
    'felixblume_wind': 'https://raw.githubusercontent.com/rafaelmardojai/blanket/775f2a767230a9681850d1b1e085be58656f1382/data/resources/sounds/wind.ogg',
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
    """parts = (信号, 起点秒, 增益 dB)；按最长者对齐"""
    ch = max((p[0].ndim for p in parts))
    n = max(sec(p[1]) + len(p[0]) for p in parts)
    out = np.zeros((n, 2)) if ch == 2 else np.zeros(n)
    for x, at, g in parts:
        if ch == 2 and x.ndim == 1:
            x = np.stack([x, x], axis=1)
        i = sec(at)
        out[i:i + len(x)] += x * 10 ** (g / 20)
    return out


def fit(x: np.ndarray, n: int) -> np.ndarray:
    if len(x) >= n:
        return x[:n]
    pad = np.zeros((n - len(x),) + x.shape[1:])
    return np.concatenate([x, pad])


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


def normalize(x: np.ndarray, kind: str) -> tuple[np.ndarray, dict]:
    l = lufs_i(x) if kind == 'loop' else lufs_s_max(x)
    y = x * 10 ** ((TARGET - l) / 20)
    if true_peak(y) > -1.0:
        y = limit(y, -1.3)
    return y, {'lufs': lufs_i(y) if kind == 'loop' else lufs_s_max(y), 'tp': true_peak(y)}


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
