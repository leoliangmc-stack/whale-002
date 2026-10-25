# 鲸落：深海之境 · 声音素材来源与评估

> 音效剪辑师，2026-10-24。第一阶段（第 0–8 节）找到并评估许可清晰的**真实录音**；第二阶段按 `cue-sheet.md` 剪辑、处理并接入代码，**最终采用的素材见下面的“第二阶段”一节**（以它为准）。
> 第一阶段的素材编号用 `S`（海面 / 空中）、`U`（水下）、`E`（cue sheet 点名的 ESC-50 片段核对）；第二阶段直接用 cue sheet 的 A / F / V 编号。

## 第二阶段：最终采用的素材（`public/assets/audio/`，48 个 MP3，共 2588 KB）

全部由 `python3 -I scripts/sound-build.py` 从下表的固定地址下载、处理并归一化（循环床 −18 LUFS 积分、一次性素材 −18 LUFS-S 最大值、真峰值 ≤ −1 dBTP；实测响度写进 manifest，运行时据此换算增益）。第 2 节有每个来源的许可依据。取舍（声音导演与主导开发者确认）：

- **不用 CC BY-SA / NC**：0 A.D. 的素材（CC BY-SA 3.0）一个都没用；A06 高空风（可选）省略（A04 自带微风）。
- **不用“海豹弹”的脉冲**（U08a、U08b、U08c 都不用）：着地 F15 改用降调的石头落水 + 浪击海堤 + 湿雪脚步。
- **喷气与吸气是处理过的替代录音**（F10、F11、F12）：没有找到许可合适的真实鲸鱼喷气，按 cue sheet 的 C 方案用海蚀洞涌浪 + 降调的人的呼吸模拟，README 中如实写明。
- **海鸥只有 Moodist 一个来源**：许可写作“仓库声明 Pixabay Content License / CC0，未逐个文件核实”，README 提示所有者商用前核实或替换。
- **鲸鸣（V01–V05）**：第一版用 MBARI 的蓝鲸录音（6 倍速 + 八度层），所有者在手机上听不见。之后所有者试听了 6 段免费素材（NOAA 与国家公园管理局的座头鲸、MBARI 的座头鲸歌、Moodist 的鲸鸣音效、放慢加混响的版本），**选定了 Moodist 的 `animals/whale.mp3`**。它在第一阶段因为“像设计过的声音、物种与来源不明”被淘汰（第 6 节），现在是所有者知情后的选择。许可风险与海鸥相同（中）。

| 编号 | 内容 | 来源与原作者 | 许可 | 处理 | 批次 |
|---|---|---|---|---|---|
| A01 | 开阔水下（30 s 循环） | SanctSound OC03_02 soundscape 16–50 s | 美国政府作品 | 去瞬态、30 Hz–6 kHz、3 s 交叉淡化成循环 | 0 |
| A02 | 从水下听到的头顶海浪（15 s） | SanctSound MB02_04 wind（36 dB 增益版） | 美国政府作品 | 低通 1.5 kHz，250–900 Hz 抬 9 dB（手机能听见） | 0 |
| A03 | 深海（30 s） | MBARI 16 kHz，2016-12-21 00:25:40 UTC 起 40 s | CC BY 4.0 | 低通 1.6 kHz | 3 |
| A04 | 高空的大洋海面（22 s，立体声） | ESC-50：monotraum 208810 A/B（CC0）、vhlam 133863（CC0）、Ryding 125966（CC0）、digifishmusic 43760（CC BY） | CC0 / CC BY | 6 段交叉拼接，左右声道不同顺序，120 Hz–9 kHz | 2 |
| A05 | 水线拍打（14 s，立体声） | ESC-50：slag777 167063 A/B/C、aesqe 39901 A/B | CC BY | 交叉拼接，左右错开 | 2 |
| A07 | 远处的鲸群合唱（30 s） | MBARI 2 kHz，2018-10-20 06:20 UTC 起 7 分钟中最平稳的 33 s | CC BY 4.0 | 6 倍速 + 八度层（−6 dB），低通 1.8 kHz | 0 |
| A08 | 身体旁流过的水流（20 s） | Kinoton “Underwater Ambience”（freesound 393819，经 Ambie） | CC0 | 低通 800 Hz，250–800 Hz 抬 9 dB | 0 |
| A09 | 磷虾群的窸窣（12 s） | SanctSound HI03_02 rain 20–36 s | 美国政府作品 | 600 Hz–6 kHz | 0 |
| A10 | 食腐活动（12 s） | SanctSound CI01_05 snappingshrimp | 美国政府作品 | 扩展器稀疏化（约三成）、降 5 个半音、低通 3 kHz | 4 |
| F01a–c | 尾叶推水 ×3 | SanctSound MB02_04 中的三次浪涌 + ESC-50 ikbenraar 200461（CC BY）降 12 个半音 | 美国政府作品 / CC BY | 带通 120–450 Hz，起音 0.25 s，衰减到 3 s | 0 |
| F02 | 巨体滑过 | ESC-50 Akoustikos 137162（CC BY）降 12 个半音 + Kinoton（CC0） | CC BY / CC0 | 低通 500 Hz，2.5 s 渐强、3 s 渐弱 | 1 |
| F03 | 吞水 | ikbenraar 200461 A/B、Akoustikos 137162（CC BY）降 7–9 个半音；SanctSound 浪涌；Alvinwhatup2 133977（CC0）降 24 个半音 | CC BY / CC0 / 政府 | 低通 1 kHz，0–2.5 s 加速涌入、2.5–4.2 s 峰值、之后平息 | 1 |
| F04 | 滤水 | aesqe 39901（CC BY）、runirasmussen 172377 / BranRainey 142349（CC0）降 7 个半音、SanctSound 气泡 | CC BY / CC0 / 政府 | 低通 2 kHz / 1.5 kHz | 1 |
| F05a/b | 气泡（成团 / 零星） | SanctSound FK01_06、GR01_01 潜水员呼出的气泡（不含调节器的吸气声）+ ESC-50 倒水的咕嘟：BranRainey 142349、runirasmussen 172377、vibe_crc 51433 | 美国政府作品 / CC0 | 气泡主体 70 Hz–3 kHz；咕嘟降 3–4 个半音、带通 300–2500 Hz；300 Hz 以上 45% / 49%（第三阶段重剪） | 1 |
| F06 | 镜头出水 | SanctSound 浪涌 + Adam_N 164594、rafael45 241846（CC0）+ aesqe 39901（CC BY） | 政府 / CC0 / CC BY | 0.6 s 处破水 | 2 |
| F09a–d | 海鸥 ×4（单声、两声、单声、远） | Moodist `animals/seagulls.mp3`（8.4–14.4 s、34.1–34.8 s 的单只长鸣） | 仓库声明 Pixabay / CC0，**未逐文件核实** | 高通 450 Hz；d 低通 2.5 kHz 加距离尾巴 | 2 |
| F10 | 远处的喷气 | 由 F11 派生 | 同 F11 | 低通 3 kHz、更短、加尾巴 | 2 |
| F11 | **喷气（处理过的替代录音）** | ikbenraar 200461 A/B（CC BY）作主体；Walter_Odington 18631（CC0）降 7 个半音作“噗”；cidchili 54961（CC0）降 12 个半音作胸腔；monotraum 208810 A/B（CC0）高通作水雾 | CC BY / CC0 | 80 ms 爆发、0.6 s 核心、约 2 s 水雾；立体声的只有水雾（单声道兼容） | 2 |
| F12 | **吸气（处理过的替代录音）** | UncleSigmund 30709-C（CC0）降 10 个半音；ikbenraar 200461-B（CC BY）；toiletrolltube 174797（CC0）降 12 个半音作喷气孔合上 | CC0 / CC BY | 低通 1.5 kHz | 2 |
| F13 | 浪花扫过镜头 | bulbastre 132157-A（CC BY） | CC BY | 运行时声像从左扫到右 | 2 |
| F14 | 镜头入水 | Adam_N 164593（CC0）+ SanctSound GR01_01 气泡 | CC0 / 政府 | 0.2–0.35 s 内从全频带变成 900 Hz 低通 | 2 |
| F15a/b/c | 着地主击 / 头部 / 尾部 | toiletrolltube 174797（CC0）降 12 个半音；crosbychris 213077（CC BY）降 24 个半音；lwdickens 263501（CC0）降 12 个半音 | CC0 / CC BY | 起音 70 ms，200–600 Hz 抬 12 dB（软泥让手机听得见），暗混响 | 3 |
| F16 | 沉积物 | Kinoton（CC0）+ SanctSound HI03_02 水下雨声 + 浪涌 | CC0 / 政府 | 流动低通 1.2 kHz 作涌起；雨声带通 300–1500 Hz 作翻涌落下的沙沙声；300 Hz 以上 38%（第三阶段重剪） | 3 |
| F17a/b | 咬合 | SanctSound CI02_04 鱼类敲击 + lwdickens 263490（CC0）放慢一倍 | 政府 / CC0 | 低通 1.5 kHz，300–1500 Hz 抬 8 dB，短暗混响；300 Hz 以上 58% / 50% | 4 |
| F18a/b | 甩头（被搅动的水） | SanctSound 浪涌 + runirasmussen 172377（CC0）降 5 个半音 + ikbenraar 200461（CC BY）降 7 个半音 | 政府 / CC0 / CC BY | 浪涌低通 400 Hz 保留分量，海蚀洞涌浪带通 300–1500 Hz；300 Hz 以上 32% / 37% | 4 |
| F18c/d | 撕下 | lwdickens 263501（CC0）放慢一倍 + SanctSound 浪涌 | CC0 / 政府 | 低通 1.5 kHz，300–1500 Hz 抬 8 dB，短暗混响；300 Hz 以上 67% / 30% | 4 |
| F19 | 盲鳗 | RutgerMuller 51147（CC0）降 7 个半音 | CC0 | 低通 1 kHz | 4 |
| F21a–d | 骨上的“嗒”×2、刮擦 ×2 | SanctSound CI01_01 单个枪虾“啪”；lwdickens 263491（CC0） | 政府 / CC0 | 低通 3 kHz | 4 |
| F23 | 抹香鲸咔哒 | SanctSound HI03_02 spermwhale + spermwhale2 | 美国政府作品 | 300 Hz–4 kHz，远距离尾巴 | 3 |
| V01 | 鲸鸣（近） | Moodist `animals/whale.mp3`（提交 `11c0be2`）10.4–19.6 s | 仓库声明 Pixabay / CC0，**未逐文件核实** | 带通 120 Hz–8 kHz，3 s 淡出；300 Hz 以上 98% | 1 |
| V02 | 鲸鸣（深海、极远） | 同上 10.4–19.6 s | 同上 | 低通 900 Hz，+0.9 s / −9 dB、+2.1 s / −15 dB 回声；97% | 3 |
| V03 | 鲸鸣（入场时远处传来；自由探索里远方的鲸鸣） | 同上 0–9.2 s | 同上 | 0.4 s 淡入（这一声的开头在文件末尾），2.5 s 混响尾巴（−14 dB）；98% | 0 |
| V04 | 鲸鸣（新鲸鱼，中远） | 同上 0–9.2 s | 同上 | 2 s 混响尾巴（−13 dB）；97% | 4 |
| V05 | 最后的一声（闭眼之前） | 同上 20.95–29.4 s | 同上 | 放慢 7%，长鸣之后约 4 s 渐弱到 −30 dB，1.4 s 短余韵；97% | 0 |

**八度层的电平**（现在只用于 A07 远处的鲸群合唱；第一版的 V01–V04 也用过）：cue sheet 要求“比原声低 8 dB”且“300 Hz 以上能量 ≥ 35%”，两者在这些录音上不能同时满足（−8 dB 时只有约 15–20%）。按验收条件取：八度层比原声低 0.5–2 dB（按均方根），见上表。手机外放能听见这条旋律线的上方泛音，耳机里仍以低沉的原声为主。

**批次**（manifest 的 `batch`，按需加载、离开段落后释放）：0 常驻（A01、A02、A07、A08、A09、F01），1 开场（p < 0.125 与 ≥ 0.94），2 海面（0.06–0.226），3 深海（0.226–0.93），4 海床（0.35–0.945）；自由探索加载 3、4。按 48 kHz 解码估算，同时常驻的 PCM 约 45–48 MB。

**需要所有者在外网补的素材**（本环境打不开 freesound、nps.gov、xeno-canto 等）：真实的鲸鱼喷气与吸气（换掉 F10–F12）、许可逐个可查的单只海鸥长鸣（换掉 F09）、南极蓝鲸的 Z 叫声。换的时候把文件加进 `sound-build.py` 的来源表、改对应的配方并重跑即可，代码不用改。

---

## 第一阶段：候选素材的评估

## 0. 结论速览

| 类别 | 最佳候选 | 许可 | 结论 |
|---|---|---|---|
| 水下环境床（开阔海域） | U03 SanctSound OC03_02 soundscape（60 s，平稳） + U02 HI04_03 windwaves | 美国政府作品（推定为公共领域） | 可用 |
| 从水下听到的头顶海面涌动 | U01 SanctSound MB02_04 wind（18 s，约每 3.5 s 一次低频涌动） | 同上 | 可用 |
| 深海环境床 | U05 MBARI MARS 891 m，2016-12-21 00:25:00 起 170 s（非常平稳） | CC BY 4.0 | 可用 |
| 身体旁流过的低沉水流 | U06 Kinoton “Underwater Ambience”（23.5 s，20–300 Hz 的起伏轰鸣） | CC0 | 可用 |
| 气泡 | U07a/b SanctSound 潜水员呼出的气泡（真实的水下气泡） | 公共领域（推定） | 可用（片段短） |
| 着地闷响 | U08a SanctSound MB01_05 的单个水下脉冲（低通后是“嗡”的一声闷响） | 公共领域（推定） | 可用；有语义上的顾虑，见 U08 |
| 磷虾的细密窸窣 | U09b SanctSound HI03_02 rain（水下听到的雨，328 s，非常平稳） | 公共领域（推定） | 可用 |
| 食腐动物细碎声、骨上“嗒嗒” | U10f SanctSound CI01_05 枪虾（60 s），U10a 单个“啪” | 公共领域（推定） | 可用 |
| 鲸鸣：蓝鲸 | U12a SanctSound MB01_04 B 叫声 8 倍速（3 声，干净）；项目现有的 MBARI 录音 | 公共领域（推定）/ CC BY 4.0 | 可用 |
| 鲸鸣：座头鲸 | U11a SanctSound HI01_01 座头鲸歌（近、极干净） | 公共领域（推定） | 可用，但**物种不对**（导演 1.3：默认不用） |
| 空中的海浪 | E 组 ESC-50 CC0 片段（5-208810-A/B、2-133863-A、2-125966-A，每段 5 s）；长床 S02 Luftrum（CC BY）、S01 jordir（CC0） | CC0 / CC BY | 可用；S01、S02 都有岸边浪的节奏，A04 要的“无岸”只能靠 5 s 片段拼 |
| 海风 | S05 felix.blume（CC0，14.7 s）；E 组 klangfabrik（CC0） | CC0 | 可用 |
| 溅水、出水 / 入水 | ESC-50 CC0：rafael45 Splashing Water、Adam_N Water splash 1/2、toiletrolltube 石头落水 | CC0 | 可用（都是小尺度，需要降调） |
| **海鸥** | **只有 S08 moodist seagulls**（43.5 s，确实是鸥群叫声） | 仓库层面声明“Pixabay 或 CC0”，**没有逐个文件的来源** | 有风险；cue sheet 指定的 `2-102852-A-11` **里听不到可用的鸥叫**（见 E 组） |
| **鲸鱼喷气 / 吸气** | **没有找到真实录音** | — | 只能按 cue sheet 的 C 方案处理（ESC-50 海蚀洞 + CC0 呼吸），或由所有者在外网下载 |
| 水下撕咬 / 啃食、沉积物 | 没有真实录音 | — | 替代方案见第 5 节 |

**总体许可风险：低。** 首选素材都来自美国政府作品（NOAA / 美国海军 SanctSound、NPS）、CC BY 4.0（MBARI）或单个片段标注为 CC0 的录音；需要署名的 CC BY 条目都记下了作者。唯一中等风险的是 moodist（海鸥只能从它那里取得，没有逐个文件的来源）。0 A.D. 的素材是 CC BY-SA 3.0，只作后备；全部候选里没有 NC 或 Sampling+ 素材。

---

## 1. 方法：没法用耳朵听，怎么判断

- 每个候选都用 `ffmpeg ebur128` 测积分响度（LUFS）、响度范围（LRA）、真峰值（dBTP），并统计削波比例（|x| ≥ 0.999 的样本占比）。用 numpy / scipy 计算：
  - 频谱质心、85% 滚降、100 Hz–8 kHz 的**谱平坦度**（越接近 1 越像白噪声；海浪、雨约 0.15–0.5，单一音调接近 0）；
  - 六个频带（<60 / 60–250 / 250–1k / 1–4k / 4–10k / >10k Hz）的能量占比；
  - **有调性帧比例**（倒谱峰，基频 80–1000 Hz）：人声、鸟叫、音乐、鲸歌会明显偏高；
  - **语音调制指数**（300–3400 Hz 包络在 3–8 Hz、即音节速率上的调制能量占比）：语音一般 > 0.35；
  - **节拍性**（起音包络在 0.3–1.2 s 滞后上的自相关）：音乐、机器、规律的拍打会偏高；
  - **稳态窄带线**（1 kHz 以下平均谱高出局部中值的最大 dB 值）：发动机、船、电源哼声；
  - 瞬态事件表（比 2 s 滑动中值高出 10 dB 以上的帧）和每秒 RMS 包络，用来找可用区间和干净的循环段。
- 每个文件还画了线性频谱图、0–1 kHz 低频放大图与包络图，逐张目视检查（鸥叫的谐波形状、人声的共振峰、船的线谱、拼接痕迹、明显是合成或设计过的声音等）。可疑的地方再做时间放大和高通处理后复查。
- 判断都写在下面各条的“质量评估”里。客观指标不能代替试听，第二阶段接入前仍应请人试听一遍（尤其是 S08 海鸥、S09 呼吸和所有降调后的结果）。

## 2. 来源与许可依据

| 代号 | 来源（固定到具体提交或对象） | 许可依据（原文出处） | 风险 |
|---|---|---|---|
| NOAA-SS | NOAA 国家海洋保护区办公室与美国海军的 **SanctSound** 精选片段：`https://storage.googleapis.com/noaa-passive-bioacoustic/sanctsound/products/sound_clips/<站点>/<部署>_sound_clips/data/<文件>` | 桶根目录 `README.pdf` 与 `sanctsound/README.pdf` 只给出引用格式，**没有单独的许可文件**；元数据 JSON 里也没有许可字段。依据：项目由两个联邦机构（NOAA ONMS、美国海军）开展，按 17 U.S.C. §105 美国政府作品在美国不受版权保护——这是**推断**；元数据里列出的分析人员也有承包商（如 Lynker, LLC）。引用：*NOAA Office of National Marine Sanctuaries and U.S. Navy. SanctSound Raw Passive Acoustic Data. NOAA NCEI. https://doi.org/10.25921/saca-sp25* | 低（照引用格式署名） |
| MBARI | MBARI Pacific Sound 16 kHz：`https://pacific-sound-16khz.s3.amazonaws.com/YYYY/MM/MARS-YYYYMMDDT000000Z-16kHz.wav`（按字节范围读取） | AWS 开放数据目录 `https://raw.githubusercontent.com/awslabs/open-data-registry/main/datasets/pacific-sound.yaml`：`License: CC-BY 4.0`，ManagedBy MBARI | 低（必须署名 *Audio: MBARI Pacific Sound, CC BY 4.0*） |
| NPS | librosa/data `audio/glacier-bay-humpback.hq.ogg`，提交 `38f4b06556fa0ff1acda5e677d8ba05d1bc0fff0` | 同目录 `glacier-bay-humpback.toml`：`license = "CC-PDM-1.0"`，`attribution = "Recorded by NPS - Chris Gabriele"`；`.txt`：“Public domain, https://www.nps.gov/aboutus/disclaimer.htm”，原始页面 `https://www.nps.gov/glba/learn/nature/soundclips.htm` | 低 |
| ESC-50 | `karolpiczak/ESC-50`，提交 `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6`，文件 `audio/<名>.wav` | 同提交的 `LICENSE`：逐个片段列出 freesound 原作者、编号和许可（`[CC0]` / `[CC-BY]` / `[CC-BY-NC]` / `[CC-Sampling+]`）；数据集整体是 CC BY-NC 3.0，ESC-10 子集是 CC BY 3.0。**只用单个片段标为 CC0 或 CC-BY 的。** 本环境打不开 freesound，没法再核对原页面；商用前最好由所有者从 freesound 下载原文件再确认一次（cue sheet S5 已有同样的建议） | 低（CC0）/ 低（CC BY，需署名） |
| Blanket | `rafaelmardojai/blanket`，提交 `775f2a767230a9681850d1b1e085be58656f1382`，`data/resources/sounds/*.ogg` | 同提交的 `SOUNDS_LICENSING.md`：Waves = Luftrum，freesound 48412，CC BY；Wind = felix.blume，freesound 217506，CC0；Boat = Falcet，freesound 439365，CC0（编辑：Porrumentzio） | 低 |
| Ambie | `jenius-apps/ambie`，提交 `eb29bd9946b414f7b7988d43ea5e77c537e9ab7d`，`src/AmbientSounds.Uwp/Assets/Sounds/*.wav` | 同提交的 `src/AmbientSounds.Uwp/Assets/Data.json` 的 `Attribution` 字段：beach = “Sea Barcelona Beach Traffic Voices.wav by jordir — freesound 360578 — CC0”；underwater = “Underwater Ambience by Kinoton — freesound 393819 — CC0”；wind = “wind-noise.wav by jorge0000 — freesound 361053 — CC0” | 低 |
| moodist | `remvze/moodist`，提交 `11c0be2200116a3635880d600fd6953899cc51a3`，`public/sounds/**` | 只有 `README.md` 的 “Third-Party Assets”：“Some sounds used in this project are sourced from third-party providers and are subject to different licenses: Pixabay Content License / CC0”（2024-04-29 提交 `dcef777` 加入）。**没有逐个文件的来源**，翻遍提交历史也没有 credits 文件；无法确定某个文件是 Pixabay 还是 CC0，也查不到原作者。Pixabay Content License 允许商用，但禁止把内容“单独”再分发 | **中** |
| 0 A.D. | `0ad/0ad`，提交 `61a3b9507d974084e6badb88a0826bd89a6d5b8b`，`binaries/data/mods/public/audio/ambient/**` | 同目录 `audio/LICENSE.txt`：Copyright Wildfire Games，**CC BY-SA 3.0** | 中（相同方式共享）；只作后备 |

## 3. 候选素材表（已截取到 pool）

文件在 `/tmp/claude-0/-home-user/19f5ec5e-fb58-5a45-9280-fa2492e20931/scratchpad/sfx/pool/`（24 位 WAV，保持源采样率，只加了 10 ms 淡入淡出；除注明外**没有改动增益**）。响度是截取后的积分值。“时间范围”指**源文件**中的秒数。

### 3.1 海面 / 空中

| 编号 | 对应 cue | 内容 | 来源 URL | 作者 | 许可 | 时长 | 质量评估（客观依据） | 可用片段 |
|---|---|---|---|---|---|---|---|---|
| S01 | A04 后备、A05 | 柔和的涌浪拍岸，周期约 5–6 s，浪头圆润 | Ambie `beach.wav`（见第 2 节）← freesound 360578 | jordir | CC0 | 50.1 s，48 kHz 立体声 | −33.3 LUFS，LRA 7.5，无削波。原标题带 “Traffic Voices”：有调性帧 0.0、语音调制 0.05，**检测不到人声**；100–200 Hz 有一条稳定的低频带（推测是远处车流），截取时已高通 150 Hz。有明显的岸边浪节奏，不完全符合 A04 的“无岸” | 0–50.1 s（已高通 150 Hz） |
| S02 | A04 / A05 后备、F13 | 较强的碎浪，约每 5 s 一个浪头 | Blanket `waves.ogg` ← freesound 48412 | Luftrum | CC BY | 118.0 s，44.1 kHz 立体声 | −25.8 LUFS，LRA 9.7，平坦度 0.24，无削波，无人声。260–280 Hz 有一条很弱的稳态线（远处发动机？），听到的话需要陷波。单个浪头清晰：57.8、40.6、34.7 s 最强 | 全段；单个浪头取 34–38 s、40–44 s、57–61 s |
| S03a | A04 首选 | 成片的海浪“沙——”，没有单个浪头 | ESC-50 `5-208810-A-11.wav` ← freesound 208810 “sea waves atmo” | monotraum | CC0 | 5.0 s | −17.0 LUFS，LRA 0.8，平坦度 0.23，无瞬态事件、无人声。最接近“高空看到的大片海面” | 全段（`-B` 同源，也是 CC0） |
| S03b | A04 首选 | 低沉的海面涌动 | ESC-50 `2-133863-A-11.wav` ← freesound 133863 “EXT RED SEA” | vhlam | CC0 | 5.0 s | −20.5 LUFS，LRA 0.9，3.07 s 有一个轻微的浪涌 | 全段 |
| S03c | A04 | 平滩上的柔和海浪 | ESC-50 `1-43760-A-11.wav` ← freesound 43760 | digifishmusic | CC BY | 5.0 s | −20.4 LUFS，平稳，无事件 | 全段 |
| S04 | 后备 | 岸边海浪，周期约 5–6 s | moodist `public/sounds/nature/waves.mp3` | 不明 | Pixabay 或 CC0（仓库层面声明） | 98.7 s | −31.9 LUFS，LRA 8.3，与 S02 很像，频谱上同样有一条 ~210 Hz 的弱线 | 不推荐（有 S01、S02 可替代） |
| S05 | A06 | 自然的阵风，低频为主 | Blanket `wind.ogg` ← freesound 217506 | felix.blume | CC0 | 14.7 s | −27.5 LUFS，LRA 7.0，能量集中在 60–250 Hz（77%）。2–9 s 在约 8.3 kHz 有细小的啁啾（虫或电器），截取时已低通 6 kHz | 0–14.7 s（已低通 6 kHz） |
| S06a/b | A06 | 呼啸的风 / 冬天的风 | ESC-50 `5-117773-A-16.wav` “roaring wind”、`3-117504-A-16.wav` “winter wind 01a” | klangfabrik | CC0 | 各 5 s | 平稳（LRA 0.1–0.3），无事件；`3-117504` 在 470 Hz 有 11 dB 的窄带（风啸的音调） | 全段 |
| S07 | 后备 | 阵风，起伏自然 | moodist `nature/wind.mp3` | 不明 | 仓库层面声明 | 73.4 s | −27.3 LUFS，LRA 9.3，无窄带、无人声，素材本身质量好 | 全段（许可原因不推荐） |
| S08 | **F09 海鸥（唯一可用的来源）** | 鸥群：多只大型鸥连续的“kyow”叫声 | moodist `public/sounds/animals/seagulls.mp3` | 不明 | Pixabay 或 CC0（仓库层面声明，**无逐个文件的来源**） | 43.5 s，44.1 kHz 单声道 | −30.6 LUFS，无削波。放大频谱图可见典型的鸥叫：基频约 1 kHz、带下滑的谐波串（有调性帧 0.34）；没有人声的共振峰。底下有 300 Hz 以下的浪 / 风底噪，另有 86 Hz 的弱线，用前高通 400 Hz。是**鸥群**（导演要的是零星几声），单声需要从叫声稀疏处切 | 单声候选：9.3、12.5、35.0、36.5、39.2 s 前后（最突出的事件）；2–17 s 是密集的连叫，20–43 s 是较大声的长鸣 |
| S09a | F11 / F12 的“胸腔”层 | 一口长而有力的呼吸（约 2.6 s） | ESC-50 `2-54961-A-23.wav` ← freesound 54961 “Breath Human Sci” | cidchili | CC0 | 3.1 s（源 0.3–3.4 s） | −16.2 LUFS，能量在 300 Hz–2 kHz，有调性帧 0.05（基本是气流，不是嗓音），有一些水平条纹，降调后需要确认不像人声 | 0.3–3.4 s |
| S09b | F11 的“噗”起音 | 短促、低沉的几口呼气（100–300 Hz 很足） | ESC-50 `1-18631-A-23.wav` ← freesound 18631 “female deep breathing” | Walter_Odington | CC0 | 4.0 s（源 0.9–4.9 s） | 起音陡，4 次呼气在源文件的 1.1、2.3、3.4、4.5 s 前后 | 每口约 0.6 s |
| S09c | 后备 | 一阵风的“呼——” | 0 A.D. `weather/windgust_11.ogg` | Wildfire Games | CC BY-SA 3.0 | 4.9 s | 包络平滑，像是处理过的风 | 不推荐（相同方式共享） |
| S10a–d | F14 入水、F06 出水 | 水花 | ESC-50 `3-164593-A-15.wav`（Water splash 2）、`3-164594-A-15.wav`（Water splash 1）、`3-164592-A-15.wav`、`3-164595-A-15.wav` | Adam_N | CC0 | 各 5 s | 主击：164594 在 0.53 s（高出背景 38.6 dB）；164593 在 0.14–1.0 s 连续几下；164595 在 1.58 s。都是小尺度的水花，需要降调 | 主击前后 1.5 s |
| S10e | F06 出水 | 明亮的大溅水 | ESC-50 `5-241846-A-15.wav` “Splashing Water” | rafael45 | CC0 | 5 s | 3.39 s 一次很强的溅水（高出 46 dB），质心 6 kHz，很亮；真峰值 +0.6 dBTP，用前降 2 dB | 3.2–4.6 s |
| S10f | F07 / F14 | 十次小水花 | ESC-50 `1-50623-A-15.wav` | vibe_crc | CC0 | 5 s | 1.23、3.78 s 两次较强 | 按事件切 |
| S10g | F14、F15 后备 | 石头掉进浴缸：低沉的“咚”加水声 | ESC-50 `4-174797-A-15.wav` “stones drop bath” | toiletrolltube | CC0 | 5 s | 1.02 s、3.69 s 两下，60–250 Hz 占 56% | 0.9–1.8 s、3.6–4.5 s |
| S11a | 后备 | 大浪拍岸 | 0 A.D. `water/wavecrash_21.ogg` | Wildfire Games | CC BY-SA 3.0 | 24.3 s | LRA 22，低频很足 | 不推荐（相同方式共享） |
| S11b/c | F03 吞水（降调） | 冲水的涌流 | ESC-50 `1-28005-A-18.wav`、`1-51170-A-18.wav` | Konamiuss / RutgerMuller | CC0 | 各 5 s | 连续的涌流，后者更亮（质心 3 kHz）；降 12 个半音以上就听不出马桶，但要试听确认 | 全段 |
| S11d | F04 | 倒水 | ESC-50 `4-168868-A-17.wav` | DSPena | CC0 | 5 s | 一串咕嘟（7 个事件） | 全段 |
| S12 | F17 / F18 后备 | 猪进食的咀嚼声 | ESC-50 `3-253081-A-2.wav` | YleArkisto | CC BY | 5 s | 1.04、1.53、2.95、4.67 s 有湿的咀嚼；中间夹着哼叫（有调性帧 0.05），只能切咀嚼的瞬间、低通 1 kHz | 1.4–1.7 s、2.8–3.1 s |

### 3.2 水下

| 编号 | 对应 cue | 内容 | 来源 URL（前缀 `https://storage.googleapis.com/noaa-passive-bioacoustic/sanctsound/products/sound_clips/`，MBARI 与 CC0 除外） | 作者 | 许可 | 时长 | 质量评估（客观依据） | 可用片段 |
|---|---|---|---|---|---|---|---|---|
| U01 | **A02**、F01 单次推水、A08 | 从水下听到头顶的浪：约每 3.5 s 一次低沉的涌动 | `mb02/sanctsound_mb02_04_sound_clips/data/SanctSound_MB02_04_wind_20200101T225838Z_36dBgain.wav` | NOAA ONMS / 美国海军 | 公共领域（推定） | 18.0 s，48 kHz | −31.8 LUFS，LRA 2.9；能量 95% 在 250 Hz 以下；没有船的线谱（最大窄带 4.7 dB），没有生物声。文件名里的 36 dB 是 NOAA 自己加的增益 | 全段做循环；单次涌动：1.2–3.4、4.9–6.9、8.0–10.0、11.6–13.8、14.9–16.9 s |
| U02 | A01 | 水下的风浪噪声，平稳的嘶声加低频 | `hi04/sanctsound_hi04_03_sound_clips/data/SanctSound_HI04_03_windwaves_20201220T115634Z_36dBgain.wav` | 同上 | 公共领域（推定） | 18.0 s | −30.5 LUFS，LRA 1.0，平坦度 0.33。1.2–1.6 s 在 600–900 Hz 有一声很弱的上扬（像远处的座头鲸），循环时避开 | 2–18 s |
| U03 | **A01 首选** | 开阔海域水下环境：平稳的宽带嘶声，偶有轻微起伏 | `oc03/sanctsound_oc03_02_sound_clips/data/SanctSound_OC03_02_soundscape_20191220T211558Z.wav` | 同上 | 公共领域（推定） | 60.0 s | −34.0 LUFS，LRA 2.4，质心 1.3 kHz；每秒 RMS 在 −36～−33 dB 之间，只有 13–15 s 有一次 +5 dB 的低频涌动；无线谱（最大 3.6 dB）、无鱼叫、无咔哒 | 16–60 s 最平稳 |
| U04 | A01 后备 | 开阔海域环境（原有海豚哨声） | `ci05/sanctsound_ci05_04_sound_clips/data/SanctSound_CI05_04_soundscape_20200207T153747Z.wav` | 同上 | 公共领域（推定） | 60.0 s | 原文件 6–12 kHz 有海豚哨声，截取时已低通 5 kHz；低频有一条 60–80 Hz 的带（40–55 s 增强，可能是远处的船），用前高通 100 Hz | 0–40 s |
| U05 | **A03 首选** | 深海环境（蒙特雷湾 MARS 观测站，水深 891 m） | `https://pacific-sound-16khz.s3.amazonaws.com/2016/12/MARS-20161221T000000Z-16kHz.wav`，UTC 00:25:00–00:27:50 | MBARI | CC BY 4.0 | 170 s，16 kHz | 原始电平约 −77 dBFS，截取时**加了 +40 dB**（−46.8 LUFS）。每秒 RMS 在 ±0.8 dB 以内，LRA 1.0，没有瞬态事件。1 kHz 以上几乎是平的，可能有水听器的自噪声，按导演要求低通 1.6 kHz。100 Hz 以下有很弱的线谱（远处的船或长须鲸），听感上应是深海的“底” | 全段 |
| U06 | **A08 首选**、F02 | 水下低沉的流动轰鸣，起伏缓慢，没有节拍 | Ambie `underwater.wav` ← freesound 393819 | Kinoton | CC0 | 23.5 s，48 kHz 立体声 | −25.1 LUFS，LRA 4.2；95% 能量在 250 Hz 以下；没有事件、没有窄带。立体声，第二阶段折叠成单声道后要检查相位 | 全段 |
| U07a | **F05 气泡**、F04 | 潜水员呼出的一团气泡（真实的水下气泡） | `fk01/sanctsound_fk01_06_sound_clips/data/SanctSound_FK01_06_scubadivers_20201207T184714Z.wav` | NOAA | 公共领域（推定） | 2.2 s（源 0.6–2.8 s） | 气泡的“咕噜”在 0–1 kHz。源文件 2.8–3.8 s 是调节器吸气的嘶声（4–12 kHz 带音调），**是人造声，已排除**，并低通 3 kHz | 0.6–2.8 s |
| U07b | F05 第二个变体 | 同上，另一位潜水员 | `gr01/sanctsound_gr01_01_sound_clips/data/SanctSound_GR01_01_scubadivers_20181213T201740Z.wav` | NOAA | 公共领域（推定） | 1.8 s（源 0.8–2.6 s） | 同上；背景里有枪虾的咔哒 | 0.8–2.6 s |
| U07c | 后备 | 一串冒泡 | moodist `things/bubbles.mp3` | 不明 | 仓库层面声明 | 6.4 s | 有调性帧 0.43（气泡的共振音），像在水面上录的 | 不推荐 |
| U08a | F15 着地（可选的真实水下脉冲） | 单个水下脉冲，约 1 s 衰减；低通后是很重的“嗡” | `mb01/sanctsound_mb01_05_sound_clips/data/SanctSound_MB01_05_sealbomb_20200430T171154Z.wav` | NOAA | 公共领域（推定） | 3.0 s（源 1.4–4.4 s） | 起音干净（源 1.6 s，事件前背景安静），衰减平滑。**注意**：这是渔民驱赶海狮用的“海豹弹”（小型爆炸物）。导演在 S3 一行说避开 sealbomb 片段，用不用请导演定；声学上是很好的“沉重闷响”原料 | 源 1.4–4.4 s |
| U08b | F15 / F22 后备 | 单个爆炸脉冲 | `fk03/sanctsound_fk03_01_sound_clips/data/SanctSound_FK03_01_explosion_20190131T220530Z.wav` | NOAA | 公共领域（推定） | 2.6 s | 脉冲高出背景 41 dB；背景有枪虾咔哒，需要低通 | 源 1.1–3.7 s |
| U08c | 后备 | 两个脉冲 | `mb02/sanctsound_mb02_04_sound_clips/data/SanctSound_MB02_04_sealbombs_20200518T232100Z.wav` | NOAA | 公共领域（推定） | 5.0 s | 0.64 s、4.5 s 两下 | — |
| U09a | F16 / F18 后备 | 飓风时的水下湍流 | `gr03/sanctsound_gr03_02_sound_clips/data/SanctSound_GR03_02_hurricane_20190904T221437Z.wav` | NOAA | 公共领域（推定） | 5.0 s | 宽带，60 Hz 以下很强 | 全段 |
| U09b | **A09 首选**、F16 的“细颗粒” | 水下听到的雨：密、细、平稳的沙沙声 | `hi03/sanctsound_hi03_02_sound_clips/data/SanctSound_HI03_02_rain_20191206T115841Z.wav` | NOAA | 公共领域（推定） | 截 60 s（源 328.6 s） | −29.3 LUFS，LRA 1.2，质心 9 kHz，每秒 RMS 变化 < 1.5 dB，没有事件，非常适合循环 | 源全段都可用 |
| U10a | F21 单个“嗒”、F20 | 枪虾的“啪” | `ci01/sanctsound_ci01_01_sound_clips/data/SanctSound_CI01_01_snappingshrimp_20181101T080448Z.wav` | NOAA | 公共领域（推定） | 6.1 s，32 kHz | 单个“啪”在 1.12、2.21、4.45 s（高出 21–26 dB） | 按事件切 |
| U10f | **A10 首选** | 枪虾群的连续噼啪 | `ci01/sanctsound_ci01_05_sound_clips/data/SanctSound_CI01_05_snappingshrimp_20200803T192243Z.wav` | NOAA | 公共领域（推定） | 60.0 s | −50.2 LUFS（很轻），LRA 3.3，85% 能量在 4 kHz 以上，按导演要求稀疏化、低通 3 kHz 后电平会更低，需要补增益 | 全段 |
| U10b | F17 咬合 | 不明鱼类的敲击 | `ci02/sanctsound_ci02_04_sound_clips/data/SanctSound_CI02_04_unknownfishknocks_20200218T115852Z.wav` | NOAA | 公共领域（推定） | 6.2 s | 敲击在 0.26、1.07、3.20、5.76 s；是宽带的咔哒（质心 8 kHz），低通 1.5 kHz 后才像“笃” | 按事件切 |
| U10g | （不建议用于 F17） | 蟾鱼叫声 | `gr01/sanctsound_gr01_01_sound_clips/data/SanctSound_GR01_01_toadfish_20190327T080530Z.wav` | NOAA | 公共领域（推定） | 5.0 s | 是约 300 Hz 的持续“嘟”（汽笛式鸣叫，305 Hz 窄带高 12.7 dB），**不是敲击**，不适合 F17 | — |
| U10c/d | 深海生物声后备 | 鱼群合唱；平鲉的鼓声 | `fk02/.../SanctSound_FK02_01_fishchorus_20190416T004332Z.wav`；`mb01/.../SanctSound_MB01_05_bocaccio_20200508T042435Z.wav`（4 kHz 采样） | NOAA | 公共领域（推定） | 5.0 s；9.2 s | 有节律、有调性（平鲉 0.65 的节拍性） | 可选 |
| U10e | **F23** | 抹香鲸回声定位咔哒，约每 0.95 s 一下 | `hi03/sanctsound_hi03_02_sound_clips/data/SanctSound_HI03_02_spermwhale_20191216T115715Z.wav`（另有 `spermwhale2`、`spermwhale3`） | NOAA | 公共领域（推定） | 5.2 s | 咔哒在 3–12 kHz，只比背景高约 10 dB；6 下规律的咔哒 | 全段 |

### 3.3 鲸鸣

| 编号 | 对应 cue | 物种 / 内容 | 来源 URL | 作者 | 许可 | 时长 | 质量评估 | 可用片段 |
|---|---|---|---|---|---|---|---|---|
| U12a | **V04 的“不同声音”选项** | **蓝鲸**（东北太平洋）B 叫声 ×3，NOAA 已加速 8 倍 | `mb01/sanctsound_mb01_04_sound_clips/data/SanctSound_MB01_04_bluewhaleBcall_20200118T042613Z_8xSpeed.wav`（原速版本 130 s 同目录） | NOAA | 公共领域（推定） | 13.0 s | 干净，谐波在约 300 Hz 与 450 Hz，150 Hz 以下已被 NOAA 滤掉；−42 LUFS，需要补增益。**注意加速倍数是 8 倍，现有 MBARI 素材是 6 倍**，混用时音高差约 5 个半音 | 0–2.2、5.3–7.6、10.7–13.0 s 各一声 |
| U12b | 后备 | 蓝鲸 A 叫声，8 倍速 | `mb01/.../SanctSound_MB01_04_bluewhaleAcall_20200124T031012Z_8xSpeed.wav` | NOAA | 公共领域（推定） | 5.1 s | 稳定的脉冲状 A 叫声 | 全段 |
| U12c | 后备 | 蓝鲸叫声，6 倍速（与项目现有素材同一倍数） | `oc02/.../SanctSound_OC02_02_bluewhale_20191028T005013Z_45dBgain_6xSpeed.wav` | NOAA | 公共领域（推定） | 10.0 s | 两段长音在 2.3–4.6 s、4.9–6.1 s，200–300 Hz；有低频背景 | 2.0–6.5 s |
| U12d/e | 深海远方的低频（可选） | 蓝鲸 + 长须鲸（10 倍速）；长须鲸 20 Hz 脉冲（8 倍速） | `sb02/.../SanctSound_SB02_06_blueandfinwhales_20191025T050452Z_10xSpeed.wav`；`mb01/.../SanctSound_MB01_05_finwhale_20200417T214135Z_53dBgain_8xSpeed.wav` | NOAA | 公共领域（推定） | 7.5 s；12.5 s | 长须鲸脉冲在 0.7、6.2、11.4 s | 可选 |
| U11a | 只在需要“别的鲸”时用 | **座头鲸**歌（夏威夷），很近、极干净 | `hi01/sanctsound_hi01_01_sound_clips/data/SanctSound_HI01_01_humpbackwhalesong_20190216T045823Z.wav` | NOAA | 公共领域（推定） | 60.9 s，44.1 kHz | −25.6 LUFS，单元之间安静处比歌声低约 40 dB，谐波到 10 kHz，是这次找到的最干净的鲸歌。物种不对（导演 1.3） | 全段 |
| U11b | 同上 | 座头鲸歌，上扬的单元 | `hi03/.../SanctSound_HI03_01_humpbackwhalesong_20190130T144409Z.wav` | NOAA | 公共领域（推定） | 59.7 s | 背景有枪虾细咔哒 | 全段 |
| U11c | 同上 | 座头鲸歌（阿拉斯加冰川湾） | librosa/data `audio/glacier-bay-humpback.hq.ogg` | NPS – Chris Gabriele | 公共领域标记 CC-PDM-1.0 | 64.8 s | 真峰值 −2.3 dBTP，单元清楚 | 全段 |
| U11d/e | 同上（远、深） | 座头鲸歌，在 891 m 深处听到的远方歌声 | `https://pacific-sound-16khz.s3.amazonaws.com/2017/11/MARS-20171107T000000Z-16kHz.wav`（UTC 23:21:00 起 120 s）；`.../2016/12/MARS-20161221T000000Z-16kHz.wav`（UTC 00:28:20 起 120 s）。时间点取自 MBARI 官方示例 `mbari-org/pacific-sound-notebooks` | MBARI | CC BY 4.0 | 各 120 s | 都加了 +40 dB；歌声单元清楚，但有很多宽带咔哒（可能是齿鲸的回声定位），需要去瞬态 | 全段 |

## 4. cue sheet 点名的 ESC-50 片段：许可与内容核对（E 组）

许可均从 ESC-50 `LICENSE` 逐条查到（第 2 节），所有片段 5 s、44.1 kHz 单声道，原始文件在 `.../scratchpad/sfx/raw/esc50-dl/`。

| 片段 | cue | freesound 原标题 / 作者 / 编号 | 许可 | 核对结果 |
|---|---|---|---|---|
| `2-102852-A-11` | F09 海鸥 | 20100803.surf.seagulls / dobroide / 102852 | CC BY | **问题**：全段是平稳的浪声（有调性帧 0.0）。高通 900 Hz 后放大看，只有 2.6–3.6 s 在约 4 kHz 处有几条比浪声低约 30 dB 的细弧线，可能是很远的鸥，**切不出可用的叫声**。F09 只能用 S08，或由所有者在外网下载 |
| `1-137296-A-16` | A06 风 | **Rain And Wind On Glass** / Benboncan / 137296 | CC BY | 内容是雨和风打在玻璃上，**不适合 A06**；用 S05、S06 |
| `5-208810-A/B-11` | A01 后备、A04 | sea waves atmo / monotraum | CC0 | 好，平稳，见 S03a |
| `2-133863-A-11` | A04 | EXT RED SEA / vhlam | CC0 | 好，见 S03b |
| `2-125966-A-11` | A04 | Waves in sea / Ryding | CC0 | 1.7 s、3.16 s 有浪涌（高出 12–15 dB），拼接时注意 |
| `1-43760-A-11` | A04 | Gentle Sea On Flat Beach / digifishmusic | CC BY | 平稳 |
| `5-219379-A/B/C-11` | A02 后备、A04、F02 | the night Baltic / miastodzwiekow | CC BY | `-A` 在 0.45 s 与 2.2 s 有陡的跳变（剪辑点或浪头），整段用前需要处理 |
| `5-200461-A/B-11` | A08、F01、F03、F11 | Sea gushes into seacave close / ikbenraar | CC BY | 宽带的涌动，`-A` 在 3.16 s 有一次明显的涌入，适合 F11 的起音 |
| `2-137162-A-11` | A02、A08、F03 | Sea inside a room / Akoustikos | CC BY | 平稳，LRA 4.5 |
| `5-213077-A-11` | F01、F13、F15 | waves breaking over sea wall at crosby / crosbychris | CC BY | 60–250 Hz 占 86%，是持续的低沉拍击，适合降调做身体 |
| `4-167063-A/B/C-11` | A05 | Close sea waves / slag777 | CC BY | 平稳的近处浪，无事件 |
| `1-39901-A/B-11` | A05、F04、F06 | sea water passing through pier hole / aesqe | CC BY | 250 Hz–1 kHz 占 75%，有“咕嘟”的穿孔水流 |
| `2-124662-A-11` | A05 | Water sea shore / Slapbass | CC BY | 平稳 |
| `2-132157-A/B-11` | F13 | beach sea ocean waves crush breakwater 2 / bulbastre | CC BY | `-A` 在 2.97–3.27 s 有一次拍碎 |
| `1-30709-A/B/C-23` | F11、F12 | breath.wav / UncleSigmund | CC0 | `-A`、`-B` 的有调性帧偏高（0.31、0.25），可能带一点嗓音，**优先用 `-C`（0.12）**或 S09a/S09b |
| `2-54961-A-23` | F11、F12 | Breath Human Sci / cidchili | CC0 | 见 S09a |
| `3-133977-A-29`、`4-210593-A-29` | F03 | Gulp.mp3 / Alvinwhatup2；Different Gulps / Mafon2 | CC0 | 单次吞咽在 0.58 s；后者在 0.72、1.16、2.69、4.53 s |
| `4-172377-A-17`、`3-142349-A-17`、`1-51433-A-17`、`3-145719-A-17` | F04、F05 | Pouring Water / runirasmussen；Pouring sounds / BranRainey；pouring_water_4 / vibe_crc；pouring water into a cup / Zabuhailo | CC0 | 都有清楚的咕嘟事件；`3-145719` 有调性帧 0.41（杯子的共鸣），降调后要确认 |
| `3-164593-A-15`、`3-164594-A-15`、`5-241846-A-15` | F06、F14 | 见 S10 | CC0 | 见 S10 |
| `2-139748-A/B-15` | F07 | water dripping 1 / hybu | CC0 | 规律的滴水（约每 0.45 s 一滴），很轻（−41 LUFS），在 600 Hz 有 20 dB 的共鸣线 |
| `2-81731-A-10` | A09 后备、F16 | Silencyo_RAIN_NIGHT_Village_Drips_Courtyard / silencyo | CC0 | 雨加滴水，8 个较强的事件；A09 用 U09b 更平稳 |
| `5-263490-A-25`、`5-263491-A-25`、`5-263501-A-25` | F15、F17、F18、F21 | footsteps snow wet crunchy / crunchy ice / wet snow，作者 lwdickens | CC0 | 湿雪脚步，事件清楚（`263501` 在 1.16–4.41 s 有 8 步） |
| `1-51147-A-25` | F19 | Wet Footsteps in Small Shower Cabin / RutgerMuller | CC0 | 湿的脚步，事件密集，质心 2.6 kHz |

## 5. 找不到的类别与替代建议

1. **真实的鲸鱼喷气 / 吸气（F10–F12）**：本环境能访问的来源里都没有。GitHub 上的开源环境声应用（moodist、Blanket、Ambie、Noice）和游戏（0 A.D.、Veloren、Widelands、Unknown Horizons、SuperTux、SuperTuxKart、OpenSFX 等）都没有；SanctSound 与 MBARI 是水听器，听不到水面上的呼吸。
   - 替代：按 cue sheet 的 C 方案，以 ESC-50 `5-200461-A`（海蚀洞涌水，CC BY）为主体；“噗”的起音用 S09b 的单口呼气，“胸腔”用 S09a 降 12 个半音；水雾嘶声用 S03a 高通 3 kHz。
   - 外网（由所有者下载）：NPS 冰川湾的声音页面 `https://www.nps.gov/glba/learn/nature/soundclips.htm`（librosa 的座头鲸歌就来自这一页，公共领域）可能有水面上的座头鲸呼吸声，本环境打不开，未核实；freesound 用 CC0 筛选搜 “whale blow / whale breath”。
2. **许可可追溯的海鸥（F09）**：只有 S08（moodist，仓库层面的“Pixabay 或 CC0”声明，没有逐个文件的来源）。ESC-50 唯一带鸥的片段里听不到可用的叫声（见第 4 节），ESC-50 也没有海鸥类别。
   - 建议：先用 S08 做出效果（高通 400 Hz，从稀疏处切单声），同时请所有者在外网换成 freesound CC0 的单只大型鸥长鸣，或 xeno-canto 上 CC BY / CC BY-SA 的录音（不要 NC）；换掉以后 S08 就可以删除。
3. **水下撕咬、撕扯（F17、F18）**：没有真实的水下摄食录音。替代：U10b 鱼类敲击低通 1.5 kHz 作“笃”，ESC-50 湿雪脚步放慢作“咬进去”或撕裂（cue sheet 方案）；S12 猪进食的咀嚼声（CC BY）切单个瞬间、低通 1 kHz 作后备。U10g 蟾鱼是音调，不是敲击，不要用。
4. **沉积物翻涌（F16）**：没有真实录音。替代：U06 / U05 低通 1.2 kHz 作涌起，U09b 或 ESC-50 `2-81731-A` 低通 1 kHz 作细颗粒落下；U09a 的湍流可以加在最开头。
5. **巨大身体在水中推水（F01、F02）**：没有真实的“鲸鱼拍尾”录音。新增的真实水下素材：U01 中单次的低频涌动（第 3.2 节列了 5 个区间）本身就是一整团水体移动的声音，降 5–12 个半音、低通 450 Hz 后可以与 cue sheet 的 ESC-50 方案叠在一起或替代它；U06 适合做 A08 的流。
6. **着地闷响（F15）**：cue sheet 的 C 方案可行；U08a 是真实的水下低频脉冲，起音和衰减都很像“沉重的东西落下”，但来源是海豹弹，请导演决定。
7. **南极蓝鲸 Z 叫声**：仍然没有（与 README 一致）。SanctSound 只有东北太平洋 / 北大西洋种群。

## 6. 淘汰的候选及原因

| 候选 | 原因 |
|---|---|
| moodist `animals/whale.mp3` | 频谱上是约 470 Hz 的稳定谐波串，三次起音（0、11、21.7 s）形状几乎一样，几乎没有噪声底：像设计过或合成的“鲸声”，物种与来源都不明。**后来所有者试听后选定它作为全部鲸鸣（见第二阶段）** |
| moodist `transport/submarine.mp3` | 820 Hz 的强稳态线（高 26 dB），是设计过的音效 |
| Ambie `wind.wav`（jorge0000，CC0） | 能量被限制在 300–3500 Hz 的一条带里，没有阵风结构（LRA 2.2），像滤过的噪声；不如 S05 |
| Blanket `boat.ogg`（Falcet，CC0） | 有木头吱嘎声，另有一条约 4.3 kHz 的稳态啸叫 |
| Noice（`ashutoshgngwr/noice`，1.3.3 版） | 署名表（`docs/_data/authors/sounds.yaml`）只写来源，不写许可；部分来自 BBC Sound Effects（RemArc，仅限非商业），海鸥 / 海边也在其中，整体不用 |
| Veloren（GitLab） | `assets/credits.ron`：没写许可的默认 GPLv3；水花写明“派生自 Bluezone – Splash”（商业音效库），不用 |
| 0 A.D. `amb_port_*` | 2–3 s、5.5–6.5 s 有人声的谐波串，而且是 CC BY-SA |
| ESC-50 `1-137296-A-16` | 雨打玻璃，不是干净的风（见第 4 节） |
| SanctSound `CI02_03_wind`、`OC02_03_wind` | 都有持续的低频窄带：CI02_03 的 2 倍速版本在 50–80 Hz（原速约 25–40 Hz），OC02_03 在 31 Hz（高 12 dB），像船或设备噪声；OC02_03 只有 4 kHz 采样 |
| SanctSound `PM05_01_windwaves` | 85% 能量在 4 kHz 以上，主要是枪虾，不是风浪 |
| SanctSound `FK02_03` / `SB03_13` / `GR03_04 windwaves`（cue sheet A01 首选） | 都只有 5 s，做 30 s 循环要重复 6 次；GR03_04 有 93% 能量在 60 Hz 以下。A01 改用 60 s 的 U03 更合适 |

## 7. 署名草稿（第二阶段写进 README）

- NOAA Office of National Marine Sanctuaries and U.S. Navy. SanctSound Raw Passive Acoustic Data / Sound Clips. NOAA NCEI, https://doi.org/10.25921/saca-sp25（U01–U04、U07a/b、U08、U09、U10、U11a/b、U12）
- Audio: MBARI Pacific Sound, CC BY 4.0（U05、U11d/e，以及现有的蓝鲸录音）
- Glacier Bay humpback song: NPS – Chris Gabriele, public domain（U11c，如用）
- CC0（不强制署名，建议列出）：felix.blume (freesound 217506)、jordir (360578)、Kinoton (393819)、monotraum (208810)、vhlam (133863)、Ryding (125966)、klangfabrik (117773、117504)、cidchili (54961)、Walter_Odington (18631)、UncleSigmund (30709)、Adam_N (164592–164595)、rafael45 (241846)、vibe_crc (50623、51433)、toiletrolltube (174797)、Konamiuss (28005)、RutgerMuller (51170、51147)、DSPena (168868)、runirasmussen (172377)、BranRainey (142349)、Zabuhailo (145719)、Alvinwhatup2 (133977)、Mafon2 (210593)、hybu (139748)、silencyo (81731)、lwdickens (263490、263491、263501)
- CC BY（必须署名，按用到的列）：Luftrum (48412)、digifishmusic (43760)、ikbenraar (200461)、Akoustikos (137162)、crosbychris (213077)、miastodzwiekow (219379)、slag777 (167063)、aesqe (39901)、Slapbass (124662)、bulbastre (132157)、YleArkisto (253081)；ESC-50 的片段同时注明 “via ESC-50 (K. J. Piczak)”
- moodist（S08 海鸥，如用）：“from Moodist (github.com/remvze/moodist), Pixabay Content License or CC0 per the project's README”——换成外网的海鸥后删除

## 8. 文件位置与复现

- 原始下载（不提交）：`/tmp/claude-0/-home-user/19f5ec5e-fb58-5a45-9280-fa2492e20931/scratchpad/sfx/raw/`，每个来源一个子目录（`noaa-sanctsound/clips`、`mbari-16k`、`esc50-dl`、`blanket-dl`、`ambie-dl`、`moodist-dl`、`0ad-dl`、`librosa-data` 等）。
- 截取好的候选：`/tmp/claude-0/-home-user/19f5ec5e-fb58-5a45-9280-fa2492e20931/scratchpad/sfx/pool/`（57 个文件）。
- 脚本：`/tmp/claude-0/-home-user/19f5ec5e-fb58-5a45-9280-fa2492e20931/scratchpad/sfx/tools/`：`analyze.py`（指标与频谱图）、`cut_pool.py`（从 raw 截取到 pool，所有区间与滤波都写在里面）、`mbari_fetch.py`（按字节范围下载 MBARI 16 kHz）、`gls.py`（列出 NOAA 桶）、`zoom.py`、`stack.py`。频谱图在同级的 `work/spec/`。
- 这个暂存目录只属于本次会话。第二阶段按 cue sheet 3.3 把需要的下载与处理写成 `scripts/` 下可重跑的脚本，来源 URL 以本文件为准。
