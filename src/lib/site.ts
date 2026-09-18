import type { Lang, UIKey } from '@/i18n/ui';

/**
 * 站点身份信息 —— 想改名字、域名、导航，都在这里改。
 *
 * 注意：这里只放事实性信息。
 * 不要写自我介绍、个人宣言、经历、能力或目标 —— 那些由本人自己填。
 */
export const SITE = {
  /** TODO: 换成你的名字或昵称 */
  name: 'The Rest Note',
  /** 左上角的小标识（1-2 个字符最好看） */
  mark: 'RN',
  /** 与 astro.config.mjs 里的 site 保持一致 */
  url: 'https://example.com',
  /** 用于 meta description / RSS，只描述这个网站的内容范围 */
  description: {
    zh: '音乐 · 技术 · 实验 · 记录',
    en: 'Music · technology · experiments · notes',
  } satisfies Record<Lang, string>,
  tagline: {
    zh: '在生活的旋律之间，留一拍安静给自己。',
    en: 'Between life’s melodies, leave a quiet beat for yourself.',
  } satisfies Record<Lang, string>,
  location: {
    tz: 'Asia/Singapore',
    offset: 'UTC+08:00',
    city: { zh: '新加坡', en: 'Singapore' } satisfies Record<Lang, string>,
  },
  /** 想加就加，例如 { label: 'GitHub', href: 'https://github.com/you' } */
  socials: [] as { label: string; href: string }[],
} as const;

/** `external: true` 的项指向站外：新标签页打开，带一个很轻的 ↗。 */
export const NAV: { key: UIKey; href: string; external?: boolean }[] = [
  { key: 'nav.home', href: '/' },
  { key: 'nav.blog', href: '/blog/' },
  { key: 'nav.lab', href: '/lab/' },
  { key: 'nav.about', href: '/about/' },
  { key: 'nav.github', href: 'https://github.com/minertob', external: true },
];

/**
 * 首页名字下面的四个词。刻意保持到"词"的层级，
 * 不展开成句子 —— 首页靠 UI 表达，不靠文案。
 */
export const FOCUS = ['MUSIC', 'TECH', 'LAB', 'NOTES'] as const;

/** 这个网站实际用到的东西（可以从仓库里核对） */
export const TOOLS = [
  'Astro',
  'TypeScript',
  'Web Audio API',
  'Web MIDI API',
  'CSS backdrop-filter',
  'MuseScore',
] as const;

/** 首页 / 页脚的系统状态清单 */
export const SYSTEM_STATUS: { key: UIKey; state: 'online' | 'ready' | 'idle'; href?: string }[] = [
  { key: 'sys.blog', state: 'online', href: '/blog/' },
  { key: 'sys.music', state: 'ready' },
  { key: 'sys.lab', state: 'online', href: '/lab/' },
];
