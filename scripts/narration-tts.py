"""
为「鲸落：深海之境」生成中文旁白：public/assets/narration/NN.mp3 与 index.json。

用法：
  python3 -I scripts/narration-tts.py --model <kokoro-multi-lang-v1_1 目录> [--asr <SenseVoice 目录>] [--paraformer <目录>]
  python3 -I scripts/narration-tts.py --model <...> --phones      # 只打印 TTS 前端的分词与注音，用来查多音字
依赖：sherpa-onnx、numpy、soundfile、带 libmp3lame 的 ffmpeg；ASR 回听另需 pypinyin。

模型（不放进仓库，从 https://github.com/k2-fsa/sherpa-onnx/releases 下载后解压）：
  TTS：tts-models/kokoro-multi-lang-v1_1.tar.bz2（Kokoro-82M v1.1-zh，权重 Apache-2.0）
  ASR（仅用于验证，不随网页发布）：asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2、
       asr-models/sherpa-onnx-paraformer-zh-2024-03-09.tar.bz2

流程：每条字幕的 text 与 sub 分段合成 → 各段裁掉首尾静音 → 段间停顿 PAUSE 秒 → 首尾各留 EDGE 秒；
语速按每条实测调整到 CPS_LO~CPS_HI 字/秒，并尽量不超过字幕显示时长（最多快到 CPS_FAST）；
→ ffmpeg ebur128 测积分响度，增益到 TARGET_LUFS，限幅保证真峰值 ≤ PEAK_DBTP → 单声道 MP3。
给了 --asr 时，识别成品 MP3，与规范化文本比较，打印每条的字错率（CER）与无调拼音错误率。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

VOICE = 'zf_094'  # Kokoro v1.1-zh 的中文女声（选择理由见 docs/narration.md）
SPEED = 1.1  # 基准语速（sherpa-onnx 的 speed，越大越快），之后按每条实测再调
CPS_LO, CPS_HI = 3.8, 4.5  # 目标语速（字/秒，按整段时长算）
CPS_FAST = 4.9  # 为了不超出显示时长，最多快到这里
PAUSE = 0.35  # text 与 sub 之间的停顿（秒）
EDGE = 0.1  # 首尾保留的静音（秒）
TARGET_LUFS = -18.0
PEAK_DBTP = -1.5
BITRATE = '64k'
TAKES = 4  # 有 ASR 时每条最多合成几次

# 每条字幕自动播放时的显示时长（秒，由主程序给出），旁白尽量不超过它
SHOW = [6.6, 4.5, 12.3, 8.5, 9.9, 7.2, 5.0, 14.2, 14.9, 14.0, 16.0, 12.4, 9.4, 9.6, 9.2, 10.4, 12.5, 7.8, 8.7, 7.5,
        10.5, 7.3]

# Kokoro v1.1-zh 的说话人顺序（与 sherpa-onnx 的 voices.bin 一致）：3 个英文女声，然后是中文女声 zf_*、男声 zm_*
ZF = [1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 32, 36, 38, 39, 40, 42, 43, 44, 46, 47, 48,
      49, 51, 59, 60, 67, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 83, 84, 85, 86, 87, 88, 90, 92, 93, 94, 99]


def kokoro_sid(voice):
    return 3 + ZF.index(int(voice.split('_')[1]))


# 朗读文本（与 src/config/stages.ts 的 CAPTIONS 一一对应）。每条是若干段，段间停顿 PAUSE 秒。
# 't' 是“规范化文本”：数字、符号改成读法，引号和破折号去掉（显示文字不变）；写进 index.json，也是 ASR 比对的参照。
# 段可以是字符串，或 {'t': 文本, 'say': 实际送进 TTS 的文本, 'gain': 分贝, 'pause': 段后停顿, 'fade_out': 秒}。
LINES = [
    ['南方的夏季海洋，一头蓝鲸缓缓游来。', '它身长约二十四米，相当于两辆公交车首尾相连。'],
    # 句首“磷虾”的 -n 被后面的 x 带成 -ng（两套 ASR 都听成“零虾/零下”）；同样用空格分开
    ['前方，出现了点点橙红色的身影。', {'t': '磷虾越聚越多。', 'say': '磷 虾越聚越多。'}],
    ['蓝鲸把嘴张到将近九十度，喉腹褶像手风琴一样撑开。', '它用鲸须把海水滤出，把磷虾留下，这叫滤食。'],
    ['鲸鱼是哺乳动物，需要回到海面呼吸。'],
    ['它浮出水面，水波一圈圈向远处扩散。'],
    # “噗——”：单独合成一个轻一点、短一点的“噗”（用感叹号，句号会多拖出一个尾音），后面停顿
    [{'t': '噗', 'say': '噗！', 'gain': -4.0, 'pause': 0.45, 'fade_out': 0.12},
     '温暖的呼气冲出喷气孔，化成一道近十米高的水雾柱。'],
    ['这头蓝鲸已经在海洋中游过了漫长的一生。'],
    ['它的眼睛，慢慢地闭上了。', '海水依旧温柔地流动。'],
    ['它开始缓缓下沉，离开阳光。'],
    ['越往深处，光线越少，红色最先消失。', '海水从明亮的蓝，变成深沉的蓝。'],
    ['一千米以下，阳光再也到达不了。', '只有生物自己发出的点点微光。'],
    ['经过漫长的下沉，它轻轻落在了海床上。', '一座鲸落就此形成。'],
    ['气味在海水中扩散，深海的清道夫们陆续赶来。', '盲鳗、睡鲨、长尾鳕和成群的端足类。'],
    ['一头鲸鱼，能为它们提供好几年的食物。'],
    ['富含养分的沉积物里，多毛类和小型甲壳类迅速繁衍。'],
    ['鲸骨里的油脂，滋养着细菌和食骨蠕虫。'],
    # 句首“鲸骨”连读时 -ng 被后面的 g 吞掉，两套 ASR 都听成“金古”；加一个空格（Kokoro 的词间停顿符）分开
    [{'t': '鲸骨成为深海里的一座生命岛屿，', 'say': '鲸 骨成为深海里的一座生命岛屿，'}, '可以延续几十年。'],
    ['远处，出现了点点橙红色的身影。'],
    ['海洋里的营养随洋流循环，', '滋养着浮游植物，也滋养着磷虾。'],
    ['磷虾群向着阳光的方向聚集。'],
    ['深蓝之中，一个巨大的身影正在靠近。'],
    ['一个生命的结束，成为无数生命的新起点。'],
]

# 补充词典：sherpa-onnx 的 Kokoro 中文前端按词典做最长匹配，词典里没有的词逐字注音，
# 因此不做三声连读和“一”的变调，多音字也取单字默认读音（如“长”默认 zhǎng）。
# 这里按“词: 声调”（或“词: (取读音的同音字, 声调)”）补上正确读法，生成一个附加词典，覆盖原词典。
USER_LEX = {
    # 三声 + 三声 → 前字读二声
    '缓缓': '2 3', '点点': '2 3', '海水': '2 3', '把嘴': '2 3', '哺乳': '2 3', '好几': '2 3',
    '岛屿': '2 3', '起点': '2 3', '骨里': '2 3', '海里': '2 3', '米以': '2 3',
    # “一”的变调
    '一样': '2 4', '一道': '2 4', '一座': '2 4', '一圈圈': '4 1 1', '一生': '4 1', '一千': '4 1',
    # 轻声
    '眼睛': '3 5',
    # 多音字：长尾鳕 cháng wěi xuě（且“尾鳕”三声连读）
    '长尾鳕': ('常尾鳕', '2 2 3'),
}


def segs_of(line):
    return [s if isinstance(s, dict) else {'t': s} for s in line]


def ref_text(line):
    """规范化文本。"""
    return ''.join(s['t'] for s in segs_of(line))


PUNCT = re.compile(r'[\s，。、；：？！“”‘’（）《》…—,.;:?!"\'()\-]')


def n_chars(line):
    return len(PUNCT.sub('', ref_text(line)))


# ---------- TTS ----------

def write_user_lexicon(model_dir, path):
    """按 USER_LEX 生成附加词典：取每个字在原词典里的声母韵母，换上指定声调。"""
    base = {}
    with open(f'{model_dir}/lexicon-zh.txt', encoding='utf-8') as f:
        for ln in f:
            w, *ph = ln.split()
            if len(w) == 1:
                base[w] = ph
    with open(path, 'w', encoding='utf-8') as f:
        for word, v in USER_LEX.items():
            chars, tones = (word, v) if isinstance(v, str) else v
            tones = tones.split()
            assert len(chars) == len(word) == len(tones), word
            ph = []
            for c, t in zip(chars, tones):
                p = base[c]
                assert p[-1] in '12345', (c, p)
                ph += p[:-1] + [t]
            f.write(f'{word} {" ".join(ph)}\n')


def load_tts(model_dir, debug=False, threads=4):
    import sherpa_onnx as so
    k = model_dir
    tmp = tempfile.TemporaryDirectory()
    user_lex = os.path.join(tmp.name, 'lexicon-user.txt')
    write_user_lexicon(k, user_lex)
    cfg = so.OfflineTtsConfig(
        model=so.OfflineTtsModelConfig(
            kokoro=so.OfflineTtsKokoroModelConfig(
                model=f'{k}/model.onnx', voices=f'{k}/voices.bin', tokens=f'{k}/tokens.txt',
                lexicon=f'{k}/lexicon-us-en.txt,{k}/lexicon-zh.txt,{user_lex}', data_dir=f'{k}/espeak-ng-data',
                dict_dir=f'{k}/dict', lang='zh'),
            num_threads=threads, debug=debug, provider='cpu'),
        rule_fsts=f'{k}/phone-zh.fst,{k}/date-zh.fst,{k}/number-zh.fst', max_num_sentences=1)
    tts = so.OfflineTts(cfg)  # 词典在这里读入，之后临时文件可以删掉
    tmp.cleanup()
    return tts


def synth(tts, text, sid, speed):
    a = tts.generate(text, sid=sid, speed=speed)
    return np.asarray(a.samples, dtype=np.float32), a.sample_rate


def trim(x, sr, floor_db=-42.0):
    """裁掉首尾静音：10 ms 帧 RMS 低于（最响帧 + floor_db）的部分。"""
    hop = int(sr * 0.01)
    n = len(x) // hop
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    on = np.where(db > db.max() + floor_db)[0]
    a = max(0, on[0] - 1) * hop
    b = min(len(x), (on[-1] + 2) * hop)
    return x[a:b]


def fade(x, sr, fade_in=0.008, fade_out=0.008):
    x = x.copy()
    for n, sl in ((int(sr * fade_in), slice(None)), (int(sr * fade_out), slice(None, None, -1))):
        n = min(n, len(x) // 2)
        if n > 0:
            x[sl][:n] *= np.linspace(0, 1, n, dtype=np.float32)
    return x


def render_line(tts, line, sid, speed):
    parts, sr = [], 24000
    segs = segs_of(line)
    for j, s in enumerate(segs):
        y, sr = synth(tts, s.get('say', s['t']), sid, speed)
        y = fade(trim(y, sr), sr, fade_out=s.get('fade_out', 0.008)) * (10 ** (s.get('gain', 0.0) / 20))
        parts.append(y)
        if j < len(segs) - 1:
            parts.append(np.zeros(int(sr * s.get('pause', PAUSE)), np.float32))
    edge = np.zeros(int(sr * EDGE), np.float32)
    return np.concatenate([edge] + parts + [edge]), sr


def render_fitted(tts, i, sid, speed0):
    """按实测调整语速：落在 CPS_LO~CPS_HI；若超出显示时长，最多加快到 CPS_FAST。返回 (音频, 采样率, 语速)。"""
    n, limit = n_chars(LINES[i]), SHOW[i] - 0.1
    speed, tried = speed0, {}
    for _ in range(5):
        x, sr = render_line(tts, LINES[i], sid, speed)
        d = len(x) / sr
        tried[speed] = (x, sr)
        want = min(max(n / d, CPS_LO + 0.05), CPS_HI - 0.05)
        if n / want > limit:
            want = max(want, min(CPS_FAST, n / limit))
        if abs(n / d - want) < 0.06 or (CPS_LO <= n / d <= CPS_HI and d <= limit):
            break
        nxt = round(min(max(speed * want / (n / d), 0.8), 1.4), 3)
        if nxt in tried:
            break
        speed = nxt
    return tried[speed] + (speed,)


# ---------- 响度与编码 ----------

def ebur128(path):
    """返回 (积分响度 LUFS, 真峰值 dBTP)。"""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    tail = r.stderr[r.stderr.rfind('Summary:'):]
    lufs = float(re.search(r'I:\s+(-?[\d.]+|-inf) LUFS', tail).group(1))
    tp = float(re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', tail).group(1))
    return lufs, tp


def encode(x, sr, out_mp3, tmp):
    """响度归一到 TARGET_LUFS、真峰值 ≤ PEAK_DBTP，编码为单声道 MP3；返回 (LUFS, dBTP)。"""
    wav = os.path.join(tmp, 'a.wav')
    sf.write(wav, x, sr, subtype='FLOAT')
    lufs, _ = ebur128(wav)
    gain = TARGET_LUFS - lufs
    limit = PEAK_DBTP - 0.6  # 给 MP3 编码留余量
    for _ in range(4):
        af = f'volume={gain:.2f}dB,alimiter=limit={10 ** (limit / 20):.4f}:attack=2:release=60:level=0'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-af', af, '-ac', '1',
                        '-ar', str(sr), '-c:a', 'libmp3lame', '-b:a', BITRATE, '-map_metadata', '-1', out_mp3],
                       check=True)
        lufs2, tp2 = ebur128(out_mp3)
        if tp2 <= PEAK_DBTP and abs(lufs2 - TARGET_LUFS) <= 0.3:
            break
        if tp2 > PEAK_DBTP:
            limit -= tp2 - PEAK_DBTP + 0.1
        gain += TARGET_LUFS - lufs2
    return lufs2, tp2


# ---------- 前端注音检查 ----------

_INI = dict(zip('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ',
                'b p m f d t n l g k h j q x zh ch sh r z c s'.split()))
_FIN = {'ㄚ': 'a', 'ㄛ': 'o', 'ㄜ': 'e', 'ㄝ': 'ie', 'ㄞ': 'ai', 'ㄟ': 'ei', 'ㄠ': 'ao', 'ㄡ': 'ou', 'ㄢ': 'an',
        'ㄣ': 'en', 'ㄤ': 'ang', 'ㄥ': 'eng', 'ㄦ': 'er', 'ㄧ': 'i', 'ㄨ': 'u', 'ㄩ': 'ü', 'ㄭ': 'i', '十': 'i',
        '压': 'ia', '言': 'ian', '阳': 'iang', '要': 'iao', '阴': 'in', '应': 'ing', '用': 'iong', '又': 'iu',
        '中': 'ong', '穵': 'ua', '外': 'uai', '万': 'uan', '王': 'uang', '为': 'ui', '文': 'un', '瓮': 'ueng',
        '我': 'uo', '月': 'üe', '元': 'üan', '云': 'ün'}


def bopo_to_pinyin(phones):
    """把 Kokoro 中文前端的注音符号（含 misaki 的合并韵母）粗略转成带调拼音（省略 y/w），便于人工核对。"""
    out, cur = [], ''
    for p in phones.split():
        if p in '12345':
            out.append((cur or '?') + p)
            cur = ''
        elif p in _INI:
            cur += _INI[p]
        else:
            cur += _FIN.get(p, p)
    if cur:
        out.append(cur)
    return ' '.join(out)


def dump_phones(model_dir, texts):
    """在子进程里开 debug 合成，从 sherpa-onnx 日志取出分词与注音。返回 [[(词, 拼音), ...], ...]。"""
    me = os.path.abspath(__file__)
    code = ('import sys, json, importlib.util as u\n'
            f's = u.spec_from_file_location("n", {me!r}); m = u.module_from_spec(s); s.loader.exec_module(m)\n'
            f't = m.load_tts({model_dir!r}, debug=True)\n'
            'for x in json.loads(sys.stdin.read()):\n'
            '    sys.stderr.write("@@BEGIN\\n"); sys.stderr.flush()\n'
            '    t.generate(x, sid=0, speed=1.0)\n')
    r = subprocess.run([sys.executable, '-I', '-c', code], input=json.dumps(texts, ensure_ascii=False),
                       capture_output=True, text=True)
    res = []
    for block in r.stderr.split('@@BEGIN\n')[1:]:
        words = [(m.group(1), bopo_to_pinyin(m.group(2)))
                 for m in re.finditer(r"Lexicon matched: '(.+?)' -> '(.+?)'", block)]
        words += [('?', m.group(0)) for m in re.finditer(r'OOV[^\n]*', block)]
        res.append(words)
    return res


# ---------- ASR 回听 ----------

def edit_distance(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[len(b)]


def load_asr(sense_voice=None, paraformer=None):
    import sherpa_onnx as so
    if sense_voice:
        return so.OfflineRecognizer.from_sense_voice(model=f'{sense_voice}/model.onnx', tokens=f'{sense_voice}/tokens.txt',
                                                     num_threads=4, language='zh', use_itn=False)
    return so.OfflineRecognizer.from_paraformer(paraformer=f'{paraformer}/model.int8.onnx',
                                                tokens=f'{paraformer}/tokens.txt', num_threads=4)


def recognize(rec, path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '16000',
                        '-f', 'f32le', '-'], capture_output=True, check=True)
    st = rec.create_stream()
    st.accept_waveform(16000, np.frombuffer(r.stdout, dtype=np.float32))
    rec.decode_stream(st)
    return st.result.text


# 听不出区别的写法差异：比对前统一（他/她/它，的/地/得）
SAME = str.maketrans({'他': '它', '她': '它', '地': '的', '得': '的'})


def score(ref, hyp):
    """返回 (字错率, 无调拼音错误率)。拼音错误率不计同音字，衡量的是“读得对不对”。"""
    from pypinyin import lazy_pinyin
    r, h = PUNCT.sub('', ref).translate(SAME), PUNCT.sub('', hyp).translate(SAME)
    cer = edit_distance(r, h) / max(1, len(r))
    pr, ph = lazy_pinyin(r), lazy_pinyin(h)
    return cer, edit_distance(pr, ph) / max(1, len(pr))


# ---------- 主流程 ----------

def read_captions(root):
    """从 src/config/stages.ts 读出 CAPTIONS 的显示文字（只用来核对条数与打印对照）。"""
    src = open(os.path.join(root, 'src/config/stages.ts'), encoding='utf-8').read()
    body = src[src.index('export const CAPTIONS'):]
    body = body[:body.index('];')]
    return [(m.group(1), m.group(2) or '')
            for m in re.finditer(r"text:\s*'([^']*)'(?:,\s*sub:\s*'([^']*)')?", body)]


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='kokoro-multi-lang-v1_1 解压目录')
    ap.add_argument('--asr', help='SenseVoice 解压目录（可选，回听验证）')
    ap.add_argument('--paraformer', help='Paraformer 中文解压目录（可选，第二套 ASR 交叉验证）')
    ap.add_argument('--out', default=os.path.join(root, 'public/assets/narration'))
    ap.add_argument('--voice', default=VOICE)
    ap.add_argument('--speed', type=float, default=SPEED)
    ap.add_argument('--only', help='只生成这些下标，例如 0,5,12')
    ap.add_argument('--report', help='把每条的时长、语速、响度、识别结果写成 JSON')
    ap.add_argument('--phones', action='store_true', help='只打印前端注音')
    a = ap.parse_args()

    caps = read_captions(root)
    assert len(caps) == len(LINES) == len(SHOW), f'CAPTIONS {len(caps)} 条，LINES {len(LINES)} 条，SHOW {len(SHOW)} 条'

    if a.phones:
        segs = [(i, s.get('say', s['t'])) for i, l in enumerate(LINES) for s in segs_of(l)]
        for (i, t), words in zip(segs, dump_phones(a.model, [t for _, t in segs])):
            print(f'{i:02d} {t}\n   ' + ' | '.join(f'{w} {p}' for w, p in words))
        return

    os.makedirs(a.out, exist_ok=True)
    only = set(int(x) for x in a.only.split(',')) if a.only else None
    tts = load_tts(a.model)
    sid = kokoro_sid(a.voice)
    recs = [(k, load_asr(**{k: d})) for k, d in (('sense_voice', a.asr), ('paraformer', a.paraformer)) if d]
    index_path = os.path.join(a.out, 'index.json')
    index = {}
    if only and os.path.exists(index_path):
        index = {e['i']: e for e in json.load(open(index_path, encoding='utf-8'))}
    report = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, line in enumerate(LINES):
            if only is not None and i not in only:
                continue
            x, sr, speed = render_fitted(tts, i, sid, a.speed)
            name = f'{i:02d}.mp3'
            path = os.path.join(a.out, name)
            # Kokoro 的声码器带随机噪声，每次合成略有不同；有 ASR 时最多合成 TAKES 次，留识别最准的一次
            best = None
            for take in range(TAKES if recs else 1):
                if take:
                    x, sr = render_line(tts, line, sid, speed)
                mp3 = os.path.join(tmp, f'take{take}.mp3')
                lufs, tp = encode(x, sr, mp3, tmp)
                asr = {}
                for k, rec in recs:
                    hyp = recognize(rec, mp3)
                    cer, per = score(ref_text(line), hyp)
                    asr[k] = {'hyp': hyp, 'cer': round(cer, 4), 'per': round(per, 4)}
                # 先看第一套 ASR（SenseVoice）的拼音错误率，再看第二套，最后看字错率
                key = tuple(v['per'] for v in asr.values()) + (sum(v['cer'] for v in asr.values()),)
                if best is None or key < best[0]:
                    best = (key, take, len(x) / sr, lufs, tp, asr)
                    os.replace(mp3, path)
                if not any(key[:-1]):
                    break
            _, take, dur, lufs, tp, asr = best
            dur = round(dur, 2)
            index[i] = {'i': i, 'file': name, 'duration': dur, 'text': ref_text(line)}
            row = {'i': i, 'duration': dur, 'show': SHOW[i], 'over': round(max(0, dur - SHOW[i]), 2), 'speed': speed,
                   'cps': round(n_chars(line) / dur, 2), 'lufs': lufs, 'dbtp': tp, 'kb': os.path.getsize(path) / 1024,
                   'take': take + 1, **asr}
            report.append(row)
            msg = (f'{name} {dur:5.2f}s/{SHOW[i]:4.1f}  语速 {row["cps"]:.2f} 字/秒 (speed {speed})  '
                   f'{lufs:6.1f} LUFS {tp:5.1f} dBTP' + (f'  第 {take + 1} 次合成' if recs else ''))
            for k, v in asr.items():
                msg += f'\n      {k:11s} CER {v["cer"]:5.1%}  拼音 {v["per"]:5.1%}  {v["hyp"]}'
            print(msg, flush=True)
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join(json.dumps(index[k], ensure_ascii=False) for k in sorted(index)) + '\n]\n')
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
