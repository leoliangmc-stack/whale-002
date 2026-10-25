"""
测量离线混音（scripts/sound-mix.ts 的输出），写出 docs/sound/mix-report.md。

用法：
  npx vite-node scripts/sound-mix.ts -- --out <目录>            # 旁白开
  npx vite-node scripts/sound-mix.ts -- --out <目录> --no-vo    # 旁白关
  python3 -I scripts/sound-report.py <目录> [--write]           # 打印 / 写入报告

指标（BS.1770）：积分响度、短时 / 瞬时响度最大值、真峰值（4 倍过采样）、削波样本数；
旁白压低（同一时刻旁白开 / 关两次渲染中 BED 母线的电平差）；鲸鸣与人声的重叠；循环接缝前后的电平台阶；
模拟手机外放（300 Hz 高通）后各段的响度；每个循环素材首尾相接处的跳变。
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


def load(d, tag, k):
    x, sr = sf.read(os.path.join(d, f'{tag}-{k}.wav'), dtype='float64')
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
    lv = json.load(open(os.path.join(d, 'vo-log.json')))
    ln = json.load(open(os.path.join(d, 'novo-log.json')))
    cyc = lv['cycleSeconds']
    n1 = int(cyc * SR)
    mix_v, mix_n = load(d, 'vo', 'mix'), load(d, 'novo', 'mix')
    bed_v, bed_n = load(d, 'vo', 'bed'), load(d, 'novo', 'bed')
    vo = load(d, 'vo', 'vo')
    sfx_v, bio_v = load(d, 'vo', 'sfx'), load(d, 'vo', 'bio')
    out = []
    w = out.append

    # ---- 总体
    tot_v = lufs(mix_v[:n1])
    tot_n = lufs(mix_n[:n1])
    vo_l = lufs(vo[:n1][np.abs(vo[:n1]).max(axis=1) > 1e-4]) if np.any(np.abs(vo) > 1e-4) else -70
    tp_v = sb.true_peak(mix_v)
    tp_n = sb.true_peak(mix_n)
    clip_v = int(np.sum(np.abs(mix_v) >= 1.0))
    clip_n = int(np.sum(np.abs(mix_n) >= 1.0))
    w('## 1. 总体响度与峰值（一整圈，界面音量 100%）\n')
    w('| 指标 | 旁白开 | 旁白关 | 目标（cue sheet 4.1） |')
    w('|---|---|---|---|')
    w(f'| 整圈积分响度 | {tot_v:.1f} LUFS | {tot_n:.1f} LUFS | 旁白开 −19 ± 2；旁白关 −23 ± 2 |')
    w(f'| 真峰值（限幅器之后） | {tp_v:.2f} dBTP | {tp_n:.2f} dBTP | ≤ −1 dBTP |')
    w(f'| 限幅器之前的样本峰值 | {20 * np.log10(lv["limiter"]["prePeak"] + 1e-12):.2f} dBFS | {20 * np.log10(ln["limiter"]["prePeak"] + 1e-12):.2f} dBFS | — |')
    w(f'| 限幅器最大增益衰减 | {lv["limiter"]["maxGr"]:.2f} dB | {ln["limiter"]["maxGr"]:.2f} dB | 只是保险，最好不动作 |')
    w(f'| 削波样本（|x| ≥ 1） | {clip_v} | {clip_n} | 0 |')
    w(f'| 旁白人声段的积分响度 | {vo_l:.1f} LUFS | — | 旁白由旁白负责人交付（narration-tts.py 归一化到 −18） |')
    w(f'| 旁白素材 | {"public/assets/narration（真实录音）" if lv["voReal"] else "占位：按字数估算时长的语音频段噪声，−18 LUFS"} | — | — |')
    w('')
    summary = dict(tot_v=tot_v, tot_n=tot_n, tp_v=tp_v, tp_n=tp_n, clip_v=clip_v, clip_n=clip_n)

    # ---- 分段
    w('## 2. 各段电平（旁白关的渲染；“手机”= 300 Hz 高通后，模拟手机扬声器放不出低频）\n')
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
    w('## 3. 一次性音效与鲸鸣（旁白关的渲染；在各自的母线上测量，重叠的声音会互相抬高）\n')
    w('| 时间 s | p | 素材 | 说明 | 目标 LUFS-S | 实测短时最大 | 差 | 实测瞬时最大 LUFS-M |')
    w('|---|---|---|---|---|---|---|---|')
    sfx_n, bio_n = load(d, 'novo', 'sfx'), load(d, 'novo', 'bio')
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

    # ---- 旁白压低
    w('## 4. 旁白压低（同一时刻：旁白开的 BED 母线 − 旁白关的 BED 母线）\n')
    hop = int(0.1 * SR)
    nfr = min(len(bed_v), len(bed_n)) // hop
    vo_on = np.array([np.sqrt(np.mean(vo[i * hop:(i + 1) * hop] ** 2)) > 1e-4 for i in range(nfr)])
    diff = np.array([rms_db(bed_v[i * hop:(i + 1) * hop]) - rms_db(bed_n[i * hop:(i + 1) * hop]) for i in range(nfr)])
    valid = np.array([rms_db(bed_n[i * hop:(i + 1) * hop]) > -70 for i in range(nfr)])
    # 说话中（开始 0.3 s 之后）与安静（人声结束 2.5 s 之后、下一句开始 1 s 之前）
    on_idx = []
    off_idx = []
    for i in range(nfr):
        if not valid[i]:
            continue
        if vo_on[max(0, i - 3):i + 1].all():
            on_idx.append(i)
        elif not vo_on[max(0, i - 25):min(nfr, i + 10)].any():
            off_idx.append(i)
    d_on = float(np.median(diff[on_idx])) if on_idx else 0
    d_off = float(np.median(diff[off_idx])) if off_idx else 0
    # 起落时间：每一句开始处，压低到 −6 dB 用了多久（相对人声开始，负值表示提前）
    # 只看前面安静了至少 3 秒的句子（两句间隔小于 2 秒时按规则保持压低，不算）
    starts = [i for i in range(30, nfr) if vo_on[i] and not vo_on[i - 30:i].any()]
    lead = []
    for s in starts:
        k = next((j for j in range(max(0, s - 10), min(nfr, s + 20)) if diff[j] < -6 and valid[j]), None)
        if k is not None:
            lead.append((k - s) * 0.1)
    w(f'- 旁白说话时（开始 0.3 s 之后），BED 母线比旁白关时低 **{d_on:.1f} dB**（中位数，{len(on_idx) / 10:.0f} 秒）；目标 −7 dB（空气中的海浪 −9 dB）。')
    w(f'- 远离人声的时段（人声结束 2.5 s 后到下一句开始 1 s 前）差 **{d_off:+.1f} dB**（应为 0：不压低）。')
    if lead:
        w(f'- 安静了 3 秒以上之后的 {len(lead)} 句：压到 −6 dB 的时刻相对人声开始，中位数 {np.median(lead):+.2f} s（规则：提前 0.15 s 开始、0.25 s 内到位，约 +0.05 s；测量的分辨率 0.1 s）。')
    w('')
    summary.update(d_on=d_on, d_off=d_off)

    # ---- 鲸鸣与人声
    w('## 5. 鲸鸣与人声的重叠（旁白开的渲染）\n')
    w('| 鲸鸣 | 计划 p | 实际开始 p | 与人声重叠（秒） |')
    w('|---|---|---|---|')
    plan_p = {'V03': 0.0062, 'V01': 0.0485, 'V05': 0.2425, 'V02': 0.445, 'V04': 0.918}
    overlaps = []
    for e in lv['events']:
        if not e['id'].startswith('V') or e['p'] > 1.0:
            continue
        i0 = int(e['t'] * SR)
        i1 = min(len(bio_v), i0 + int(12 * SR))
        b = bio_v[i0:i1]
        v = vo[i0:i1]
        fr = len(b) // hop
        both = sum(1 for i in range(fr) if rms_db(b[i * hop:(i + 1) * hop]) > -45 and rms_db(v[i * hop:(i + 1) * hop]) > -45) * 0.1
        overlaps.append(both)
        w(f"| {e['id']} | {plan_p.get(e['id'], 0):.4f} | {e['p']:.4f} | {both:.1f} |")
    w('')
    summary['overlap_max'] = max(overlaps) if overlaps else 0

    # ---- 接缝
    w('## 6. 循环接缝（p 0.98 → 下一圈 p 0.03）\n')
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
    w('## 7. 循环素材的首尾相接（解码后的 MP3，按 manifest 的循环区间）\n')
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
    peak_shots = max(f['shots'] for f in lv['frames'])
    w(f'## 8. 同时活动的一次性音源\n\n- 渲染中同时活动的一次性音源最多 {peak_shots} 个（加上循环床最多 9 个，规则 ≤ 16）。\n')
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
