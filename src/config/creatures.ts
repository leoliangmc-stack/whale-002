// 自由探索中的科普介绍卡片。语言简洁，适合儿童与普通观众。
// 注意：鲸落生态的演替受深度、尸体大小、水温与时间等影响，各种生物并不按固定顺序出现。

export interface CreatureInfo {
  name: string;
  latin?: string;
  desc: string;
  fact?: string;
  group: 'bone' | 'creature' | 'environment';
}

export const CREATURE_INFO: Record<string, CreatureInfo> = {
  blueWhale: {
    name: '蓝鲸',
    latin: 'Balaenoptera musculus',
    desc: '蓝鲸是地球上有史以来最大的动物，体长可达 24～30 米。它是一种须鲸，没有牙齿，而是用嘴里一排排鲸须把海水滤掉，留下磷虾。',
    fact: '蓝鲸张一次嘴，吞进的海水和磷虾比它自己的身体还重。',
    group: 'creature',
  },
  krill: {
    name: '磷虾',
    latin: 'Euphausiacea',
    desc: '磷虾是只有几厘米长的小型甲壳动物，常常成千上万地聚在一起。它们吃浮游植物，又被鲸鱼、企鹅和鱼类吃掉。',
    fact: '一头大型须鲸一天可以吃下好几吨磷虾。',
    group: 'creature',
  },
  skull: {
    name: '鲸鱼头骨',
    desc: '蓝鲸的头骨又宽又平，前面长长的部分是上颌，里面曾经挂满了黑色的鲸须。头骨上方的小孔，是通向喷气孔的鼻孔。',
    fact: '鲸鱼的鼻孔在漫长的进化中“搬”到了头顶，方便它们一浮出水面就呼吸。',
    group: 'bone',
  },
  mandible: {
    name: '下颌骨',
    desc: '这对弯弯的长骨头是鲸鱼的下巴。滤食时，下颌能张开到将近 90°，喉部像气球一样鼓起，一口就能吞进大量海水。',
    fact: '蓝鲸的下颌骨长达 6 米多，是动物界最大的单块骨骼。',
    group: 'bone',
  },
  vertebra: {
    name: '脊椎骨',
    desc: '从脖子到尾巴，蓝鲸有六十多块脊椎骨。越靠近尾部，椎骨越小，它们支撑着有力的尾巴上下摆动。',
    fact: '鲸骨里含有大量油脂，可以在海底慢慢“喂养”生物几十年。',
    group: 'bone',
  },
  rib: {
    name: '肋骨',
    desc: '一根根弯曲的肋骨曾经保护着鲸鱼的心脏和肺。如今，它们像一座拱形的小屋，为许多小动物提供了藏身之处。',
    group: 'bone',
  },
  flipper: {
    name: '胸鳍骨骼',
    desc: '仔细看，鲸鱼胸鳍里的骨头和我们的手臂很像：有上臂骨、前臂骨，还有一节一节的“手指骨”。',
    fact: '这说明鲸鱼的祖先曾经生活在陆地上。',
    group: 'bone',
  },
  pelvis: {
    name: '退化的骨盆',
    desc: '在鲸鱼腹部深处，有一小段不和脊椎相连的骨头，这是退化的骨盆。它是鲸鱼祖先曾经长着后腿的线索。',
    group: 'bone',
  },
  osedax: {
    name: '食骨蠕虫',
    latin: 'Osedax',
    desc: '这些红色羽毛一样的小虫没有嘴巴，也没有肠子。它们把“根”伸进骨头里，靠体内的共生细菌分解骨中的油脂获得营养。',
    fact: '食骨蠕虫是科学家在 2002 年才在鲸落上发现的。',
    group: 'creature',
  },
  mat: {
    name: '细菌席',
    desc: '骨头里的油脂分解时会产生硫化物。一些细菌能利用这些化学物质获得能量，在骨头表面长成白色或黄色的“地毯”。',
    fact: '这种不依靠阳光、而是依靠化学能的生活方式叫“化能合成”。',
    group: 'creature',
  },
  squatLobster: {
    name: '铠甲虾',
    latin: 'Munidopsis',
    desc: '铠甲虾总是伸着两条细长的螯，守在骨头或岩石旁。它们会捡食细菌、碎屑，也会捕捉小动物。',
    group: 'creature',
  },
  amphipod: {
    name: '端足类',
    latin: 'Amphipoda',
    desc: '端足类是一类小小的甲壳动物，身体侧扁弯曲。它们嗅觉灵敏，常常成群赶来，是鲸落上数量最多的“清道夫”之一。',
    group: 'creature',
  },
  crab: {
    name: '深海蟹',
    desc: '深海蟹长着细长的腿，在海底横着慢慢走。它们会被鲸落的气味吸引过来，寻找食物。',
    group: 'creature',
  },
  hagfish: {
    name: '盲鳗',
    latin: 'Myxini',
    desc: '盲鳗的眼睛几乎看不见东西，靠嘴边的触须闻气味找食物。它们会把头钻进尸体里取食，是重要的深海清道夫。',
    fact: '受到惊吓时，盲鳗能在几秒钟内分泌出一大团黏液，让捕食者无从下口。',
    group: 'creature',
  },
  sleeperShark: {
    name: '太平洋睡鲨',
    latin: 'Somniosus pacificus',
    desc: '睡鲨个子很大，却游得非常慢，所以有了“睡鲨”这个名字。它们生活在寒冷的深水中，会被鲸落吸引而来。',
    group: 'creature',
  },
  grenadier: {
    name: '长尾鳕',
    latin: 'Macrouridae',
    desc: '长尾鳕又叫鼠尾鱼，大头大眼，尾巴又细又长。它们常常头朝下悬停在海底上方，寻找食物。',
    group: 'creature',
  },
  seaPig: {
    name: '海猪',
    latin: 'Scotoplanes',
    desc: '海猪其实是一种海参。它用一对对管足在泥面上慢慢“走路”，吃沉积物中的有机碎屑。',
    fact: '海猪常常成群出现，有时会朝着同一个方向前进。',
    group: 'creature',
  },
  polychaete: {
    name: '多毛类',
    latin: 'Polychaeta',
    desc: '这些小虫住在沉积物的管道里。鲸落周围的泥土富含养分，多毛类会大量繁殖，有时一平方米里就有成千上万条。',
    group: 'creature',
  },
  brittleStar: {
    name: '蛇尾',
    latin: 'Ophiuroidea',
    desc: '蛇尾是海星的亲戚，有一个小小的圆盘和五条细长灵活的腕。它们用腕在泥面上移动、收集食物。',
    group: 'creature',
  },
  clam: {
    name: '深海贻贝与蛤',
    desc: '在硫化物丰富的地方，一些贻贝和蛤会出现。它们的鳃里住着共生细菌，细菌利用化学能制造养分，再分享给宿主。',
    group: 'creature',
  },
  snail: {
    name: '深海螺',
    desc: '小小的螺在骨头和泥面上慢慢爬行，用齿舌刮食细菌和碎屑。',
    group: 'creature',
  },
  rock: {
    name: '岩石与海底地形',
    desc: '深海海底大部分是柔软的沉积物，偶尔有岩石露出。岩石表面可以让海绵、海葵等需要附着的动物安家。',
    group: 'environment',
  },
  marineSnow: {
    name: '海洋雪',
    desc: '这些缓缓飘落的白色颗粒叫“海洋雪”，由浮游生物残骸、粪粒和碎屑组成。它们把上层海洋的养分带到深海。',
    fact: '一片海洋雪落到几千米深的海底，可能要花上好几个星期。',
    group: 'environment',
  },
  atolla: {
    name: '冠水母',
    latin: 'Atolla wyvillei',
    desc: '冠水母是生活在深海的红色水母。红色在深海里几乎看不见，能帮它隐藏自己。',
    fact: '受到威胁时，它的伞缘会亮起一圈旋转的蓝光，像在喊“快来帮忙”，被称为“防盗警报”。',
    group: 'creature',
  },
  combJelly: {
    name: '栉水母',
    latin: 'Ctenophora',
    desc: '栉水母不是真正的水母。它身上有八排像梳子一样的“栉板”，摆动时会把光折射成彩虹般的颜色。',
    group: 'creature',
  },
  glowJelly: {
    name: '发光的栉水母',
    latin: 'Ctenophora',
    desc: '在没有阳光的深海里，许多生物会自己发光。这只栉水母发出柔和的蓝绿色冷光，只有离得够近才能看清。',
    fact: '深海中大约四分之三的动物都具有发光能力。',
    group: 'creature',
  },
  dumbo: {
    name: '小飞象章鱼',
    latin: 'Grimpoteuthis',
    desc: '它头上有一对像大耳朵一样的鳍，扇动起来就像小飞象。它们生活在数千米深的海底附近，是最深居的章鱼之一。',
    group: 'creature',
  },
  anglerfish: {
    name: '深海鮟鱇',
    latin: 'Melanocetus',
    desc: '鮟鱇头上有一根“钓竿”，末端的诱饵里住着会发光的细菌。好奇的小鱼靠近时，鮟鱇就张开大嘴把它吞下。',
    fact: '你找到了躲在岩石后面的鮟鱇！',
    group: 'creature',
  },
  lanternfish: {
    name: '灯笼鱼',
    latin: 'Myctophidae',
    desc: '灯笼鱼身上有一排排会发光的小点，叫发光器。它们白天待在深处，夜晚游到上层觅食。',
    fact: '灯笼鱼可能是地球上数量最多的脊椎动物之一。',
    group: 'creature',
  },
  fishSchool: {
    name: '小鱼群',
    desc: '许多小鱼聚成一群一起游动，转向时整齐划一。成群生活能让它们更不容易被捕食者盯上。',
    group: 'creature',
  },
  siphonophore: {
    name: '管水母',
    latin: 'Siphonophorae',
    desc: '管水母看起来像一条长链，其实是由许多小个体连在一起组成的“群体”，各自负责游泳、捕食或消化。',
    fact: '有的管水母可以长到几十米，比一头鲸鱼还长。',
    group: 'creature',
  },
};
