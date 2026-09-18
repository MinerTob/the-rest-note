/**
 * 主题定义 + Theme Profile
 * ------------------------------------------------------------
 * 这个文件是纯数据，不碰 DOM，也不碰 localStorage，
 * 所以服务端渲染、客户端脚本、测试都可以直接引用。
 *
 * Theme Profile 的意思是：主题不只决定颜色，还决定
 * "这个空间里正在发生什么"。目前唯一被主题绑定的运行时状态
 * 是当前曲目：
 *
 *     ThemeManager → Theme Profile → MusicManager
 *
 * 因为当前曲目永远由当前主题推导出来，所以不可能出现
 * "导航栏说 modern，播放器还在放 canon" 这种状态分裂。
 *
 * 要加第三套主题：
 *   1. tokens.css 里加 html[data-theme="xxx"] { ... }
 *   2. 这里的 THEMES / THEME_TRACK 各加一条
 */

export const THEMES = ['modern', 'baroque'] as const;
export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = 'modern';

/** 与 BaseHead 里的预置脚本共用同一个 key */
export const THEME_STORAGE_KEY = 'space.theme';

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** 主题 → 该主题下的曲目（默认音乐 / 隐藏曲目） */
export const THEME_TRACK: Record<ThemeName, string> = {
  modern: 'dao-xiang',
  baroque: 'canon',
};

export function trackForTheme(theme: ThemeName): string {
  return THEME_TRACK[theme] ?? THEME_TRACK[DEFAULT_THEME];
}

export function nextTheme(theme: ThemeName): ThemeName {
  return theme === 'modern' ? 'baroque' : 'modern';
}