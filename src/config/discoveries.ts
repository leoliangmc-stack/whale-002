/** 自由探索中的隐藏发现：自然融入环境，不使用箭头或任务标记。 */
export interface DiscoveryDef {
  id: string;
  title: string;
  /** 对应的科普条目 */
  info: string;
  /** 发现时的一句话 */
  line: string;
  /** 在探索记录中给出的含蓄提示 */
  hint: string;
}

export const DISCOVERIES: DiscoveryDef[] = [
  {
    id: 'hidden-anglerfish',
    title: '岩石后的“小灯笼”',
    info: 'anglerfish',
    line: '一条鮟鱇鱼躲在岩石后面，头顶的“小灯笼”在黑暗中微微发光。',
    hint: '换个角度看看前景的大石头。',
  },
  {
    id: 'hidden-glow',
    title: '黑暗中的微光',
    info: 'combJelly',
    line: '在远离鲸骨的黑暗水域里，有一团柔和的光正在缓缓漂动。',
    hint: '鲸骨上方的黑暗里，好像有什么在发光。',
  },
  {
    id: 'hidden-amphipod',
    title: '骨缝里的小住客',
    info: 'amphipod',
    line: '头骨的鼻孔里，藏着一只小小的端足类。',
    hint: '靠近看看鲸鱼头骨上的小孔。',
  },
  {
    id: 'hidden-texture',
    title: '骨头表面的秘密',
    info: 'osedax',
    line: '放大到微观：骨头布满细小的孔洞，食骨蠕虫的“根”正伸进骨头里吸取养分。',
    hint: '把镜头一直放大到微观。',
  },
  {
    id: 'hidden-pelvis',
    title: '退化的后腿骨',
    info: 'pelvis',
    line: '鲸鱼的祖先曾在陆地上行走——这块小小的骨盆就是证据。',
    hint: '脊椎下方，有一块不起眼的小骨头。',
  },
];
