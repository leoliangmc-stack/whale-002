"""
为「鲸落：深海之境」生成中文旁白：public/assets/narration/NN.mp3 与 index.json。

用法：
  python3 -I scripts/narration-tts.py --model <kokoro-multi-lang-v1_1 目录> [--asr <sense-voice 目录>] [--out 目录]
  python3 -I scripts/narration-tts.py --model <...> --phones      # 只打印 TTS 前端的分词与注音，用来查多音字
依赖：sherpa-onnx、numpy、soundfile、带 libmp3lame 的 ffmpeg；ASR 回听另需 pypinyin。

模型（不放进仓库，从 sherpa-onnx 的 GitHub releases 下载后解压）：
  TTS：tts-models/kokoro-multi-lang-v1_1.tar.bz2（Kokoro-82M v1.1-zh，权重 Apache-2.0）
  ASR：asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2（仅用于验证，不随网页发布）

流程：每条字幕的 text 与 sub 分段合成 → 各段裁掉首尾静音 → 段间留 PAUSE 秒 → 首尾各留 EDGE 秒
→ 用 ffmpeg ebur128 测积分响度，增益到 TARGET_LUFS，必要时限幅保证真峰值 ≤ PEAK_DBTP → 单声道 MP3。
给了 --asr 时，用 SenseVoice 识别成品 MP3，与规范化文本比较，打印每条的字错率（CER）与无调拼音错误率。
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

VOICE = 'zf_xxx'  # Kokoro v1.1-zh 的中文女声（选择理由见 docs/narration.md）
SPEED = 1.0  # 默认语速（sherpa-onnx 的 speed，越大越快）
PAUSE = 0.35  # text 与 sub 之间的停顿（秒）
EDGE = 0.1  # 首尾保留的静音（秒）
TARGET_LUFS = -18.0
PEAK_DBTP = -1.5
BITRATE = '64k'

# Kokoro v1.1-zh 的说话人顺序（与 sherpa-onnx 的 voices.bin 一致）：3 个英文女声，然后是中文女声 zf_*、男声 zm_*
ZF = [1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 32, 36, 38, 39, 40, 42, 43, 44, 46, 47, 48,
      49, 51, 59, 60, 67, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 83, 84, 85, 86, 87, 88, 90, 92, 93, 94, 99]


def kokoro_sid(voice):
    return 3 + ZF.index(int(voice.split('_')[1]))


# 朗读文本（与 src/config/stages.ts 的 CAPTIONS 一一对应）。每条是若干段，段间停顿 PAUSE 秒。
# 这里写的是“规范化文本”：数字、符号改成读法，引号和破折号去掉；显示文字不变。
# 段可以是字符串，或 {'t': 文本, 'gain': 分贝, 'pause': 段后停顿, 'speed': 语速}。
LINES = [
    {'segs': ['南方的夏季海洋，一头蓝鲸缓缓游来。', '它身长约二十四米，相当于两辆公交车首尾相连。']},
    {'segs': ['前方，出现了点点橙红色的身影。', '磷虾越聚越多。']},
    {'segs': ['蓝鲸把嘴张到将近九十度，喉腹褶像手风琴一样撑开。', '它用鲸须把海水滤出，把磷虾留下，这叫滤食。']},
    {'segs': ['鲸鱼是哺乳动物，需要回到海面呼吸。']},
    {'segs': ['它浮出水面，水波一圈圈向远处扩散。']},
    # “噗——”：单独合成一个轻一点的“噗”，后面停顿
    {'segs': [{'t': '噗。', 'gain': -4.0, 'pause': 0.45}, '温暖的呼气冲出喷气孔，化成一道近十米高的水雾柱。']},
    {'segs': ['这头蓝鲸已经在海洋中游过了漫长的一生。']},
    {'segs': ['它的眼睛，慢慢地闭上了。', '海水依旧温柔地流动。']},
    {'segs': ['它开始缓缓下沉，离开阳光。']},
    {'segs': ['越往深处，光线越少，红色最先消失。', '海水从明亮的蓝，变成深沉的蓝。']},
    {'segs': ['一千米以下，阳光再也到达不了。', '只有生物自己发出的点点微光。']},
    {'segs': ['经过漫长的下沉，它轻轻落在了海床上。', '一座鲸落就此形成。']},
    {'segs': ['气味在海水中扩散，深海的清道夫们陆续赶来。', '盲鳗、睡鲨、长尾鳕和成群的端足类。']},
    {'segs': ['一头鲸鱼，能为它们提供好几年的食物。']},
    {'segs': ['富含养分的沉积物里，多毛类和小型甲壳类迅速繁衍。']},
    {'segs': ['鲸骨里的油脂，滋养着细菌和食骨蠕虫。']},
    {'segs': ['鲸骨成为深海里的一座生命岛屿，', '可以延续几十年。']},
    {'segs': ['远处，出现了点点橙红色的身影。']},
    {'segs': ['海洋里的营养随洋流循环，', '滋养着浮游植物，也滋养着磷虾。']},
    {'segs': ['磷虾群向着阳光的方向聚集。']},
    {'segs': ['深蓝之中，一个巨大的身影正在靠近。']},
    {'segs': ['一个生命的结束，成为无数生命的新起点。']},
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


def seg_of(s):
    return s if isinstance(s, dict) else {'t': s}


def ref_text(line):
    """规范化文本（写进 index.json，也是 ASR 比对的参照）。"""
    return ''.join(seg_of(s)['t'] for s in line['segs'])


def tts_text(t):
    return t


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


def fade(x, sr, ms=8):
    n = min(len(x) // 2, int(sr * ms / 1000))
    if n > 0:
        w = np.linspace(0, 1, n, dtype=np.float32)
        x = x.copy()
        x[:n] *= w
        x[-n:] *= w[::-1]
    return x


def render_line(tts, line, sid, speed):
    parts, sr = [], 24000
    segs = [seg_of(s) for s in line['segs']]
    for j, s in enumerate(segs):
        y, sr = synth(tts, tts_text(s['t']), sid, s.get('speed', line.get('speed', speed)))
        y = fade(trim(y, sr), sr) * (10 ** (s.get('gain', 0.0) / 20))
        parts.append(y)
        if j < len(segs) - 1:
            parts.append(np.zeros(int(sr * s.get('pause', PAUSE)), np.float32))
    edge = np.zeros(int(sr * EDGE), np.float32)
    return np.concatenate([edge] + parts + [edge]), sr


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
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-af', af,
                        '-ac', '1', '-ar', str(sr), '-c:a', 'libmp3lame', '-b:a', BITRATE, out_mp3], check=True)
        lufs2, tp2 = ebur128(out_mp3)
        if tp2 <= PEAK_DBTP and abs(lufs2 - TARGET_LUFS) <= 0.3:
            break
        if tp2 > PEAK_DBTP:
            limit -= tp2 - PEAK_DBTP + 0.1
        gain += TARGET_LUFS - lufs2
    return lufs2, tp2


def mp3_duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


# ---------- 前端注音检查 ----------

_INI = dict(zip('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ',
                'b p m f d t n l g k h j q x zh ch sh r z c s'.split()))
_FIN = {'ㄚ': 'a', 'ㄛ': 'o', 'ㄜ': 'e', 'ㄝ': 'ie', 'ㄞ': 'ai', 'ㄟ': 'ei', 'ㄠ': 'ao', 'ㄡ': 'ou', 'ㄢ': 'an',
        'ㄣ': 'en', 'ㄤ': 'ang', 'ㄥ': 'eng', 'ㄦ': 'er', 'ㄧ': 'i', 'ㄨ': 'u', 'ㄩ': 'ü', 'ㄭ': 'i', '十': 'i',
        '压': 'ia', '言': 'ian', '阳': 'iang', '要': 'iao', '阴': 'in', '应': 'ing', '用': 'iong', '又': 'iu',
        '中': 'ong', '穵': 'ua', '外': 'uai', '万': 'uan', '王': 'uang', '为': 'ui', '文': 'un', '瓮': 'ueng',
        '我': 'uo', '月': 'üe', '元': 'üan', '云': 'ün'}


def bopo_to_pinyin(phones):
    """把 Kokoro 中文前端的注音符号（含 misaki 的合并韵母）粗略转成带调拼音，便于人工核对。"""
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
    code = ('import sys, json\n'
            f'sys.path.insert(0, {os.path.dirname(os.path.abspath(__file__))!r})\n'
            'import importlib.util as u\n'
            f's = u.spec_from_file_location("n", {os.path.abspath(__file__)!r}); m = u.module_from_spec(s); s.loader.exec_module(m)\n'
            f't = m.load_tts({model_dir!r}, debug=True, threads=4)\n'
            'for x in json.loads(sys.stdin.read()):\n'
            '    print("@@BEGIN", flush=True); sys.stderr.write("@@BEGIN\\n"); sys.stderr.flush()\n'
            '    t.generate(x, sid=3, speed=1.0)\n')
    r = subprocess.run([sys.executable, '-I', '-c', code], input=json.dumps(texts, ensure_ascii=False),
                       capture_output=True, text=True)
    res = []
    for block in r.stderr.split('@@BEGIN\n')[1:]:
        words = []
        for m in re.finditer(r"Lexicon matched: '(.+?)' -> '(.+?)'", block):
            words.append((m.group(1), bopo_to_pinyin(m.group(2))))
        for m in re.finditer(r"(?:not found|OOV|Ignore)[^\n]*", block):
            words.append(('?', m.group(0)))
        res.append(words)
    return res


# ---------- ASR 回听 ----------

PUNCT = re.compile(r'[\s，。、；：？！“”‘’（）《》…—,.;:?!"\'()\-]')


def edit_distance(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[len(b)]


def load_asr(asr_dir):
    import sherpa_onnx as so
    return so.OfflineRecognizer.from_sense_voice(model=f'{asr_dir}/model.onnx', tokens=f'{asr_dir}/tokens.txt',
                                                 num_threads=4, language='zh', use_itn=False)


def recognize(rec, path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '16000',
                        '-f', 'f32le', '-'], capture_output=True, check=True)
    x = np.frombuffer(r.stdout, dtype=np.float32)
    st = rec.create_stream()
    st.accept_waveform(16000, x)
    rec.decode_stream(st)
    return st.result.text


def score(ref, hyp):
    """返回 (字错率, 无调拼音错误率)。"""
    from pypinyin import lazy_pinyin
    r, h = PUNCT.sub('', ref), PUNCT.sub('', hyp)
    cer = edit_distance(r, h) / max(1, len(r))
    pr, ph = lazy_pinyin(r), lazy_pinyin(h)
    per = edit_distance(pr, ph) / max(1, len(pr))
    return cer, per


# ---------- 主流程 ----------

def read_captions(root):
    """从 src/config/stages.ts 读出 CAPTIONS 的显示文字（只用来核对条数与打印对照）。"""
    src = open(os.path.join(root, 'src/config/stages.ts'), encoding='utf-8').read()
    body = src[src.index('export const CAPTIONS'):]
    body = body[:body.index('];')]
    caps = []
    for m in re.finditer(r"\{\s*from:\s*([\d.]+).*?text:\s*'([^']*)'(?:,\s*sub:\s*'([^']*)')?", body):
        caps.append((float(m.group(1)), m.group(2), m.group(3) or ''))
    return caps


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='kokoro-multi-lang-v1_1 解压目录')
    ap.add_argument('--asr', help='sherpa-onnx SenseVoice 解压目录（可选，用于回听验证）')
    ap.add_argument('--out', default=os.path.join(root, 'public/assets/narration'))
    ap.add_argument('--voice', default=VOICE)
    ap.add_argument('--speed', type=float, default=SPEED)
    ap.add_argument('--only', help='只生成这些下标，例如 0,5,12')
    ap.add_argument('--phones', action='store_true', help='只打印前端注音')
    a = ap.parse_args()

    caps = read_captions(root)
    assert len(caps) == len(LINES), f'CAPTIONS 有 {len(caps)} 条，LINES 有 {len(LINES)} 条'

    if a.phones:
        segs = [(i, tts_text(seg_of(s)['t'])) for i, l in enumerate(LINES) for s in l['segs']]
        for (i, t), words in zip(segs, dump_phones(a.model, [t for _, t in segs])):
            print(f'{i:02d} {t}\n   ' + ' | '.join(f'{w} {p}' for w, p in words))
        return

    os.makedirs(a.out, exist_ok=True)
    only = set(int(x) for x in a.only.split(',')) if a.only else None
    tts = load_tts(a.model)
    sid = kokoro_sid(a.voice)
    rec = load_asr(a.asr) if a.asr else None
    index_path = os.path.join(a.out, 'index.json')
    index = {e['i']: e for e in json.load(open(index_path, encoding='utf-8'))} if only and os.path.exists(index_path) else {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, line in enumerate(LINES):
            if only is not None and i not in only:
                continue
            x, sr = render_line(tts, line, sid, a.speed)
            name = f'{i:02d}.mp3'
            path = os.path.join(a.out, name)
            lufs, tp = encode(x, sr, path, tmp)
            dur = round(len(x) / sr, 2)
            index[i] = {'i': i, 'file': name, 'duration': dur, 'text': ref_text(line)}
            msg = f'{name} {dur:5.2f}s  {lufs:6.1f} LUFS {tp:5.1f} dBTP'
            if rec:
                hyp = recognize(rec, path)
                cer, per = score(ref_text(line), hyp)
                msg += f'  CER {cer:5.1%}  拼音 {per:5.1%}  {hyp}'
            print(msg, flush=True)
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump([index[k] for k in sorted(index)], f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
