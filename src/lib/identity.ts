import type { Lang } from '@/i18n/ui';

/**
 * About 页 88 键音乐介绍的十个双语标签。
 * MIDI 旋律起音触发标签动画；identity-midi.ts 根据弱起和四小节计算截止时间。
 * ANALYTICAL 表示拆解问题、找规律，不是“细心”。
 *
 * 最后一个 intro 是刻意排在队尾的“重头戏”：它比其他标签大 0.2 倍，
 * 点一下会跳到整页自我介绍（/about/intro/）。揭示顺序 = 数组顺序，
 * 所以它永远是最后一个落地的标签，别把它挪到前面。
 */
export const IDENTITY_TAG_IDS = [
  'music',
  'anime',
  'aviation',
  'photography',
  'astronomy',
  'optimistic',
  'direct',
  'persistent',
  'analytical',
  'intro',
] as const;

export type IdentityTagId = (typeof IDENTITY_TAG_IDS)[number];

export type IdentityTag = {
  id: IdentityTagId;
  zh: string;
  en: string;
  /**
   * 未来触发这个标签的音符（例如 'F#4'，必须是 MiniLab 上的键）。
   * 现在是空的，这是刻意的：音符要跟乐句一起定，
   * 先编一套只会变成以后要拆掉的东西。
   */
  trigger?: string;
};

export const IDENTITY_TAGS: readonly IdentityTag[] = [
  { id: 'music', zh: '音乐', en: 'MUSIC' },
  { id: 'anime', zh: '二次元', en: 'ANIME' },
  { id: 'aviation', zh: '民航', en: 'AVIATION' },
  { id: 'photography', zh: '摄影', en: 'PHOTOGRAPHY' },
  { id: 'astronomy', zh: '天文', en: 'ASTRONOMY' },
  { id: 'optimistic', zh: '乐观', en: 'OPTIMISTIC' },
  { id: 'direct', zh: '直白', en: 'DIRECT' },
  { id: 'persistent', zh: '坚持', en: 'PERSISTENT' },
  { id: 'analytical', zh: '善于分析', en: 'ANALYTICAL' },
  {
    id: 'intro',
    zh: '自我介绍（听了这么久，点一点我吧，求求了(｡>﹏<｡)）',
    en: 'ABOUT ME (you have listened this far — click me, please, I beg you (｡>﹏<｡))',
  },
];

export function tagLabel(tag: IdentityTag, lang: Lang): string {
  return lang === 'zh' ? tag.zh : tag.en;
}

/**
 * 第十个标签的文案太长，排版时拆成两行：
 * 第一行是主标题（"自我介绍" / "ABOUT ME"），第二行是括号里那句请求。
 * 其它标签只有一行，`note` 为 undefined。
 */
export function tagLines(tag: IdentityTag, lang: Lang): { title: string; note?: string } {
  const label = tagLabel(tag, lang);
  const at = label.search(/[（(]/);
  if (at < 0) return { title: label };
  return { title: label.slice(0, at).trim(), note: label.slice(at).trim() };
}

export function tagById(id: string): IdentityTag | undefined {
  return IDENTITY_TAGS.find((tag) => tag.id === id);
}

/**
 * 标签落地动画的规格，由 identity-player.ts 使用，
 * 免得以后一边做一边猜。
 *
 * 一次落地分五段，一段都不能省：
 *
 *     impact（音符碰到琴键）
 *       → ejection（被撞出来，瞬间就有了速度）
 *       → flight（走一条很浅的抛物线，飞的时候带一点旋转）
 *       → landing（落到自己的位置）
 *       → settle（极轻地回弹一下，停住）
 *
 * 关键：不要做成 scale(0) → scale(1)。那是"出现"，不是"被弹出来"。
 * 也不要因此变成小游戏：没有粒子、没有分数、没有 Combo。
 */
export const IDENTITY_MOTION = {
  /** 弹出瞬间：很短，靠它给出初速度 */
  ejectionMs: 120,
  /** 飞行时长区间（ms）：离碰撞点越远的标签飞得越久 */
  flightMs: [420, 760],
  /** 落地后的回弹与停稳 */
  settleMs: 260,
  /** 抛物线最高点相对落点抬升多少（px）。很轻，不要变成弹跳球 */
  arcLift: 26,
  /** 落地回弹的幅度（px） */
  bounce: 5,
  /** 飞行过程中的旋转上限（deg） */
  rotate: 3,
} as const;

/**
 * 这个体验使用的 MIDI 乐谱，声音来自现有 PianoEngine：
 * 把曲子放进来、或者改这一行就好。
 */
export const IDENTITY_TRACK_SRC = '/music/secret/f-chopin-nocturne-op9-no2-in-e-flat-major.mid';

/**
 * 自我介绍页接着放这首夜曲时的音量。
 * 比 About 页的演奏（滑块默认 0.85）低一点：那一页是"在演奏"，
 * 这一页是读长文，音乐应该退回到背景的位置。
 */
export const IDENTITY_INTRO_VOLUME = 0.7;
