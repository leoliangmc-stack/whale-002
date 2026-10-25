"""
测量离线混音（scripts/sound-mix.ts 的输出），写出 docs/sound/mix-report.md。

用法：
  npx vite-node scripts/sound-mix.ts -- --out <目录>
  python3 -I scripts/sound-report.py <目录> [--write]           # 打印 / 写入报告

指标（BS.1770）：积分响度、短时 / 瞬时响度最大值、真峰值（4 倍过采样）、削波样本数；循环接缝前后的电平台阶；
模拟手机外放（300 Hz 高通）后各段的响度；每个循环素材首尾相接处的跳变。叙事没有旁白，所以不再测旁白压低与重叠。
"""

import importlib.util
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
spec = importlib.util.spec_from_file_location('sound_build', os.path.join(HERE, 'sound-build.py'))
sb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sb)

SR = 48000
sb.FS = SR  # 以 48 kHz 测量（K 计权滤波按采样率设计）

STAGES = [
    (0.0, 0.075, '1a 开场五镜头'), (0.075, 0.125, '1b 滤食'), (0.125, 0.153, '2 上浮'), (0.153, 0.199, '2 出水 · 高空'),
    (0.199, 0.22, '2 水线喷气 · 入水'), (0.22, 0.297, '3 闭眼'), (0.297, 0.497, '4 下沉'), (0.497, 0.55, '5 着地'),
    (0.55, 0.7, '6 分解'), (0.7, 0.8, '7 鲸骨'), (0.8, 0.87, '8 磷虾'), (0.87, 0.96, '9 新鲸鱼'), (0.96, 1.0, '10 循环'),
]


def load(d, k):
    x, sr = sf.read(os.path.join(d, f'{k}.wav'), dtype='float64')
    assert sr == SR
    return x


def seconds_at(log, p):
    """用渲染日志中的帧（t, total）插值出累计进度对应的秒"""
    fr = log['frames']
    ts = np.array([f['t'] for f in fr])
    ps = np.array([f['total'] for f in fr])
    return float(np.interp(p, ps, ts))


def lufs(x):
    return sb.lufs_i(x) if len(x) > SR * 0.5 else -70.0


def st_max(x):
    return sb.lufs_s_max(x) if len(x) > SR * 0.5 else -70.0


def m_max(x):
    return sb.lufs_m_max(x) if len(x) > SR * 0.5 else -70.0


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def main():
    d = sys.argv[1]
    write = '--write' in sys.argv
    ln = json.load(open(os.path.join(d, 'log.json')))
    cyc = ln['cycleSeconds']
    n1 = int(cyc * SR)
    mix_n = load(d, 'mix')
    bed_n = load(d, 'bed')
    out = []
    w = out.append

    # ---- 总体
    tot_n = lufs(mix_n[:n1])
    tp_n = sb.true_peak(mix_n)
    clip_n = int(np.sum(np.abs(mix_n) >= 1.0))
    w('## 1. 总体响度与峰值（一整圈，界面音量 100%）\n')
    w('| 指标 | 实测 | 目标（cue sheet 4.1） |')
    w('|---|---|---|')
    w(f'| 整圈积分响度 | {tot_n:.1f} LUFS | −23 ± 2（没有旁白） |')
    w(f'| 真峰值（限幅器之后） | {tp_n:.2f} dBTP | ≤ −1 dBTP |')
    w(f'| 限幅器之前的样本峰值 | {20 * np.log10(ln["limiter"]["prePeak"] + 1e-12):.2f} dBFS | — |')
    w(f'| 限幅器最大增益衰减 | {ln["limiter"]["maxGr"]:.2f} dB | 只是保险，最好不动作 |')
    w(f'| 削波样本（|x| ≥ 1） | {clip_n} | 0 |')
    w('')
    summary = dict(tot_n=tot_n, tp_n=tp_n, clip_n=clip_n)

    # ---- 分段
    w('## 2. 各段电平（“手机”= 300 Hz 高通后，模拟手机扬声器放不出低频）\n')
    w('| 段落 | p | 积分 LUFS | 短时最大 LUFS-S | 瞬时最大 LUFS-M | 手机：积分 LUFS | 300 Hz 以上能量占比 | 环境床积分 LUFS |')
    w('|---|---|---|---|---|---|---|---|')
    hp_n = signal.sosfiltfilt(signal.butter(4, 300, 'highpass', fs=SR, output='sos'), mix_n, axis=0)
    seg_rows = []
    for a, b, name in STAGES:
        i0 = int(seconds_at(ln, a) * SR)
        i1 = int(seconds_at(ln, b) * SR)
        x = mix_n[i0:i1]
        h = hp_n[i0:i1]
        e_all = np.sum(x ** 2)
        e_hi = np.sum(h ** 2)
        row = (name, a, b, lufs(x), st_max(x), m_max(x), lufs(h), e_hi / (e_all + 1e-20), lufs(bed_n[i0:i1]))
        seg_rows.append(row)
        w(f'| {name} | {a:.3f}–{b:.3f} | {row[3]:.1f} | {row[4]:.1f} | {row[5]:.1f} | {row[6]:.1f} | {row[7] * 100:.0f}% | {row[8]:.1f} |')
    w('')

    # ---- 一次性音效
    w('## 3. 一次性音效与鲸鸣（在各自的母线上测量，重叠的声音会互相抬高）\n')
    w('| 时间 s | p | 素材 | 说明 | 目标 LUFS-S | 实测短时最大 | 差 | 实测瞬时最大 LUFS-M |')
    w('|---|---|---|---|---|---|---|---|')
    sfx_n, bio_n = load(d, 'sfx'), load(d, 'bio')
    manifest = json.load(open(os.path.join(ROOT, 'public', 'assets', 'manifest.json')))['audio']
    durs = {k: sf.info(os.path.join(ROOT, 'public', 'assets', e['file'])).duration for k, e in manifest.items()}
    devs = []
    hero_m = []
    for e in ln['events']:
        if e['p'] > 1.0:
            continue
        stem = bio_n if e['duck'] == 'whale' else sfx_n
        i0 = int(e['t'] * SR)
        i1 = min(len(stem), i0 + int(max(3.0, durs.get(e['id'], 4.0)) * SR))
        x = stem[i0:i1]
        if len(x) < SR * 0.5:
            continue
        st = st_max(x)
        mm = m_max(x)
        dv = st - e['db']
        if not e['label'].startswith('F01') and not e['label'].startswith('F18s') and not e['label'].startswith('F21'):
            devs.append(dv)
        if e['duck'] in ('hero', 'free', 'whale'):
            hero_m.append((e['id'], mm))
        w(f"| {e['t']:.1f} | {e['p']:.4f} | {e['id']} | {e['label']} | {e['db']:.1f} | {st:.1f} | {dv:+.1f} | {mm:.1f} |")
    w('')
    summary['dev_med'] = float(np.median(devs)) if devs else 0
    summary['dev_max'] = float(np.max(np.abs(devs))) if devs else 0
    summary['hero_mmax'] = max(m for _, m in hero_m) if hero_m else -70

    # ---- 接缝
    w('## 4. 循环接缝（p 0.98 → 下一圈 p 0.03）\n')
    ic = int(seconds_at(ln, 1.0) * SR)
    win = int(0.4 * SR)
    lm = [sb.lufs_i(mix_n[i:i + win]) for i in range(ic - 10 * SR, ic + 10 * SR, int(0.2 * SR))]
    lm = np.array(lm)
    jumps = np.abs(np.diff(lm))
    mid = len(lm) // 2
    w(f'- 接缝前后各 10 秒的瞬时响度（400 ms 窗、200 ms 步进）：接缝处相邻两窗相差 {jumps[mid - 1:mid + 1].max():.2f} dB，'
      f'整段最大相邻差 {jumps.max():.2f} dB，接缝前 5 秒均值 {lm[mid - 25:mid].mean():.1f}、接缝后 5 秒均值 {lm[mid:mid + 25].mean():.1f} LUFS。')
    seam_events = [e for e in ln['events'] if 0.985 <= (e['p'] % 1.0) or (e['p'] % 1.0) < 0.006]
    w(f'- p ∈ [0.985, 1) ∪ [0, 0.006) 内触发的一次性音效：{len(seam_events)} 个（规则：0 个）。')
    second = sorted({e['id'] for e in ln['events'] if e['p'] >= 1.0})
    w(f'- 第二圈开头照常触发的 cue：{", ".join(second) if second else "（渲染范围内没有）"}。')
    w('')
    summary.update(seam_jump=float(jumps[mid - 1:mid + 1].max()), seam_events=len(seam_events))

    # ---- 循环素材的首尾
    w('## 5. 循环素材的首尾相接（解码后的 MP3，按 manifest 的循环区间）\n')
    w('| 素材 | 循环长度 s | 接缝处的样本跳变 / 典型相邻差 | 接缝前后 50 ms 的电平差 dB |')
    w('|---|---|---|---|')
    worst = 0
    for k, e in sorted(manifest.items()):
        if 'loop' not in e:
            continue
        x, sr = sb.decode(os.path.join(ROOT, 'public', 'assets', e['file']))
        x = x.mean(axis=1)
        a, b = int(e['loop'][0] * sr), int(e['loop'][1] * sr)
        jump = abs(x[a] - x[b - 1])
        typ = np.median(np.abs(np.diff(x[a:b]))) + 1e-12
        s50 = int(0.05 * sr)
        dl = rms_db(x[b - s50:b]) - rms_db(x[a:a + s50])
        r = jump / typ
        worst = max(worst, r)
        w(f'| {k} | {(b - a) / sr:.1f} | {r:.1f} | {dl:+.1f} |')
    w('')
    summary['loop_worst'] = worst

    # ---- 活动音源
    peak_shots = max(f['shots'] for f in ln['frames'])
    w(f'## 6. 同时活动的一次性音源\n\n- 渲染中同时活动的一次性音源最多 {peak_shots} 个（加上循环床最多 9 个，规则 ≤ 16）。\n')
    summary['peak_shots'] = peak_shots

    text = '\n'.join(out)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if write:
        with open(os.path.join(d, 'tables.md'), 'w', encoding='utf-8') as f:
            f.write(text)
    else:
        print(text)


if __name__ == '__main__':
    main()
