/**
 * 功能开关。
 *
 * NARRATION：女声旁白（朗读字幕，systems/Narration.ts、public/assets/narration/）。所有者要求先隐藏、
 * 以后可能加回来，所以代码、录音与生成脚本（scripts/narration-tts.py）都保留。为 false 时：
 * 控制栏、开场与设置里都没有旁白开关，N 键不起作用，旁白录音不下载、不播放（以前保存的“旁白：开”也不生效）。
 * 改成 true 就全部恢复。
 */
export const NARRATION = false;
