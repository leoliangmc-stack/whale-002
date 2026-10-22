// 叙事阶段与节奏配置。整个循环叙事被映射到 storyProgress ∈ [0,1)，
// 各模块只读取进度，从不各自监听滚动事件。

export interface StageDef {
  id: number;
  key: string;
  title: string;
  en: string;
  start: number;
  end: number;
}

export const STAGES: StageDef[] = [
  { id: 1, key: 'krill', title: '广阔海洋与磷虾群', en: 'Open Ocean', start: 0.0, end: 0.12 },
  { id: 2, key: 'breath', title: '返回海面与呼吸', en: 'A Breath of Air', start: 0.12, end: 0.22 },
  { id: 3, key: 'eye', title: '眼睛缓缓闭上', en: 'Eyes Close', start: 0.22, end: 0.3 },
  { id: 4, key: 'sink', title: '缓缓下沉', en: 'The Long Descent', start: 0.3, end: 0.48 },
  { id: 5, key: 'land', title: '抵达海底', en: 'Touching the Abyss', start: 0.48, end: 0.55 },
  { id: 6, key: 'decay', title: '身体逐渐分解', en: 'A Feast in the Dark', start: 0.55, end: 0.7 },
  { id: 7, key: 'bones', title: '鲸骨成为栖息地', en: 'An Island of Life', start: 0.7, end: 0.8 },
  { id: 8, key: 'krill2', title: '磷虾重新出现', en: 'Krill Return', start: 0.8, end: 0.87 },
  { id: 9, key: 'newwhale', title: '新鲸鱼从远处出现', en: 'A New Giant', start: 0.87, end: 0.96 },
  { id: 10, key: 'loop', title: '生命的循环', en: 'The Circle Closes', start: 0.96, end: 1.0 },
];

/**
 * 自动播放节奏与关键镜头保护。
 * seconds：自动播放时这一段持续的秒数；
 * key：关键镜头。快速滚动时会以更低的最高速度经过，保证不会被直接跳过；
 * screens：滚动经过这一段需要的屏幕高度（默认按进度宽度均分），用于让开场等镜头有足够的滚动距离停留。
 */
export interface Segment {
  from: number;
  to: number;
  seconds: number;
  key?: boolean;
  screens?: number;
}

/** 默认情况下，一整圈叙事对应的滚动距离（屏幕高度的倍数） */
export const SCREENS_PER_CYCLE = 34;

/**
 * 开场的五个镜头（阶段 1 的前半段，约 25 秒）：先建立鲸鱼的庞大与安宁，再引出磷虾群。
 * 镜头之间是连续的推、跟、升降与对焦转移，没有跳切。
 */
export const OPENING_SHOTS = [
  { key: 'vista', title: '超远景建立尺度', from: 0.0, to: 0.014 },
  { key: 'track', title: '侧面全景跟拍', from: 0.014, to: 0.03 },
  { key: 'below', title: '低角度仰拍', from: 0.03, to: 0.047 },
  { key: 'eye', title: '眼睛与皮肤细节', from: 0.047, to: 0.061 },
  { key: 'krill', title: '磷虾群揭示', from: 0.061, to: 0.075 },
] as const;

export const SEGMENTS: Segment[] = [
  { from: 0.0, to: 0.014, seconds: 5, key: true, screens: 1 }, // 超远景：鲸鱼从远处游入
  { from: 0.014, to: 0.03, seconds: 5, key: true, screens: 1 }, // 侧面全景跟拍
  { from: 0.03, to: 0.047, seconds: 5, key: true, screens: 1 }, // 低角度仰拍：身体从上方经过
  { from: 0.047, to: 0.061, seconds: 5, key: true, screens: 1 }, // 眼睛与皮肤细节
  { from: 0.061, to: 0.075, seconds: 5.5, key: true, screens: 1.1 }, // 磷虾群揭示，鲸鱼转向
  { from: 0.075, to: 0.11, seconds: 13, key: true }, // 滤食
  { from: 0.11, to: 0.125, seconds: 6 },
  { from: 0.125, to: 0.15, seconds: 8 },
  { from: 0.15, to: 0.16, seconds: 4 },
  { from: 0.16, to: 0.19, seconds: 11, key: true }, // 高空俯视与第一次呼吸
  { from: 0.19, to: 0.2, seconds: 4 },
  { from: 0.2, to: 0.22, seconds: 9, key: true }, // 中景喷气
  { from: 0.22, to: 0.245, seconds: 7 },
  { from: 0.245, to: 0.285, seconds: 12, key: true }, // 眼睛闭合
  { from: 0.285, to: 0.297, seconds: 4, key: true }, // 闭眼后的停留
  // 下沉是一段连续动作（见 systems/DescentMotion.ts），各段时长决定了动作的真实节奏
  { from: 0.297, to: 0.322, seconds: 13, key: true }, // A：尾鳍渐停、向前滑行（侧面中远景 → 仰视）
  { from: 0.322, to: 0.345, seconds: 12, key: true }, // B：头部先沉、身体缓缓倾斜（斜侧面跟随）
  { from: 0.345, to: 0.46, seconds: 27 }, // C → D：稳定下沉，镜头拉远进入深海
  { from: 0.46, to: 0.51, seconds: 14, key: true }, // 接近并接触海床
  { from: 0.51, to: 0.55, seconds: 8 },
  { from: 0.55, to: 0.7, seconds: 32, key: true }, // 身体变化
  { from: 0.7, to: 0.8, seconds: 26, key: true }, // 鲸骨生态
  { from: 0.8, to: 0.87, seconds: 16, key: true }, // 磷虾重新聚集
  { from: 0.87, to: 0.93, seconds: 12 },
  { from: 0.93, to: 0.96, seconds: 9, key: true }, // 新鲸鱼出现
  { from: 0.96, to: 0.98, seconds: 6, key: true }, // 循环衔接
  { from: 0.98, to: 1.0, seconds: 7, key: true }, // 与开场超远景的节奏一致，接缝处速度连续
];

export const CYCLE_SECONDS = SEGMENTS.reduce((s, g) => s + g.seconds, 0);

/** 自动播放时，从 p=0 到 p 经过的秒数（“故事时间”，与当前播放速度无关）。 */
export function secondsAt(p: number): number {
  let t = 0;
  for (const s of SEGMENTS) {
    if (p >= s.to) t += s.seconds;
    else {
      if (p > s.from) t += ((p - s.from) / (s.to - s.from)) * s.seconds;
      break;
    }
  }
  return t;
}

/** secondsAt 的反函数。 */
export function progressAtSeconds(sec: number): number {
  let t = 0;
  for (const s of SEGMENTS) {
    if (sec <= t + s.seconds) return s.from + ((sec - t) / s.seconds) * (s.to - s.from);
    t += s.seconds;
  }
  return 1;
}

/** 某一段的滚动长度（屏幕高度） */
export function segmentScreens(s: Segment): number {
  return s.screens ?? (s.to - s.from) * SCREENS_PER_CYCLE;
}

export function segmentAt(p: number): Segment {
  const x = p - Math.floor(p);
  for (const s of SEGMENTS) if (x >= s.from && x < s.to) return s;
  return SEGMENTS[SEGMENTS.length - 1];
}

export function stageAt(p: number): StageDef {
  const x = p - Math.floor(p);
  for (const s of STAGES) if (x >= s.start && x < s.end) return s;
  return STAGES[STAGES.length - 1];
}

/** 叙事字幕：简短、克制，不依赖声音即可理解。 */
export interface Caption {
  from: number;
  to: number;
  text: string;
  sub?: string;
}

export const CAPTIONS: Caption[] = [
  { from: 0.006, to: 0.026, text: '南方的夏季海洋，一头座头鲸缓缓游来。', sub: '它身长约 14 米，比一辆公交车还要长。' },
  { from: 0.063, to: 0.0745, text: '前方，出现了点点橙红色的身影。', sub: '磷虾越聚越多。' },
  { from: 0.079, to: 0.112, text: '座头鲸张开大嘴，喉腹褶像手风琴一样撑开。', sub: '它用鲸须把海水滤出，把磷虾留下——这叫滤食。' },
  { from: 0.126, to: 0.152, text: '鲸鱼是哺乳动物，需要回到海面呼吸。' },
  { from: 0.163, to: 0.19, text: '它浮出水面，水波一圈圈向远处扩散。' },
  { from: 0.203, to: 0.219, text: '“噗——”温暖的呼气遇到空气，化成一团水雾。' },
  { from: 0.226, to: 0.244, text: '这头座头鲸已经在海洋中游过了漫长的一生。' },
  { from: 0.25, to: 0.296, text: '它的眼睛，慢慢地闭上了。', sub: '海水依旧温柔地流动。' },
  { from: 0.331, to: 0.358, text: '它开始缓缓下沉，离开阳光。' },
  { from: 0.355, to: 0.39, text: '越往深处，光线越少，红色最先消失。', sub: '海水从明亮的蓝，变成深沉的蓝。' },
  { from: 0.4, to: 0.44, text: '一千米以下，阳光再也到达不了。', sub: '只有生物自己发出的点点微光。' },
  { from: 0.493, to: 0.545, text: '经过漫长的下沉，它轻轻落在了海床上。', sub: '一座“鲸落”就此形成。' },
  { from: 0.556, to: 0.6, text: '气味在海水中扩散，深海的清道夫们陆续赶来。', sub: '盲鳗、睡鲨、长尾鳕和成群的端足类。' },
  { from: 0.605, to: 0.65, text: '一头鲸鱼，能为它们提供好几年的食物。' },
  { from: 0.655, to: 0.698, text: '富含养分的沉积物里，多毛类和小型甲壳类迅速繁衍。' },
  { from: 0.705, to: 0.745, text: '鲸骨里的油脂，滋养着细菌和食骨蠕虫。' },
  { from: 0.75, to: 0.798, text: '鲸骨成为深海里的一座生命岛屿，', sub: '可以延续几十年。' },
  { from: 0.806, to: 0.84, text: '远处，出现了点点橙红色的身影。' },
  { from: 0.845, to: 0.885, text: '海洋里的营养随洋流循环，', sub: '滋养着浮游植物，也滋养着磷虾。' },
  { from: 0.9, to: 0.935, text: '磷虾群向着阳光的方向聚集……' },
  { from: 0.94, to: 0.975, text: '深蓝之中，一个巨大的身影正在靠近。' },
  { from: 0.978, to: 0.999, text: '一个生命的结束，成为无数生命的新起点。' },
];

/** 鲸落时间流逝提示（身体分解阶段）。 */
export const TIME_LABELS: Array<{ at: number; text: string }> = [
  { at: 0.5, text: '抵达海底' },
  { at: 0.553, text: '数天后' },
  { at: 0.575, text: '数周后' },
  { at: 0.605, text: '约 4 个月后' },
  { at: 0.635, text: '约 1 年后' },
  { at: 0.67, text: '约 2 年后' },
  { at: 0.705, text: '约 5 年后' },
  { at: 0.745, text: '约 15 年后' },
  { at: 0.78, text: '数十年后' },
];

/** 世界常量 */
export const WORLD = {
  /** 海床深度（米） */
  seabedY: 1800,
  /** 鲸鱼体长（米） */
  whaleLength: 14,
  /** 鲸落静止位置 */
  restX: 30,
  /** 开场构图锚点 */
  anchorX: 0,
  anchorY: 60,
};
