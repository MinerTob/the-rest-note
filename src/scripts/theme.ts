import { getGlobal } from './global';
import type { AppStore } from './app-state';
import type { MusicManager } from './music-manager';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  isThemeName,
  trackForTheme,
  type ThemeName,
} from '@/lib/themes';

export { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, isThemeName };
export type { ThemeName };

/**
 * Theme Manager
 * ------------------------------------------------------------
 * 主题只由 <html data-theme="..."> 决定，所有颜色/材质都写在
 * tokens.css 的对应选择器里。切换主题 = 改一个属性，
 * 不需要重新渲染页面，也不需要碰任何组件里的 CSS。
 *
 * 它同时负责两件"跟着主题走"的事：
 *   1. 过渡：把旧的背景渐变复制成一层 ghost，淡出，做出真正的 crossfade
 *   2. 音乐：通过 theme profile 把当前曲目切到该主题对应的那首
 *
 * 注意顺序：theme 与 currentTrack 是**同一次** store.set() 写入的，
 * 所以不存在"界面已经回到 modern，音乐还是 canon"的中间态。
 */

type ThemeChangeDetail = { theme: ThemeName; previous: ThemeName };

const FADE_MS = 640;

export class ThemeManager extends EventTarget {
  private store: AppStore;
  private ghost: HTMLElement | null = null;
  private ghostTimer = 0;
  private shiftTimer = 0;
  private music: MusicManager | null = null;

  constructor(store: AppStore) {
    super();
    this.store = store;
    this.apply(store.get().theme);
  }

  /** 音乐系统晚于主题初始化，所以由 app.ts 在创建后接上 */
  attachMusic(music: MusicManager): void {
    this.music = music;
  }

  /**
   * 把当前主题重新写到 <html> 上。
   *
   * 客户端路由换页时，Astro 会用新文档的 <html> 属性覆盖当前这份，
   * 而服务端渲染出来的 <html> 上没有 data-theme（它属于访客，不属于页面），
   * 于是 data-theme 被抹掉，主题看着就退回了默认值 —— 但状态和音乐还在
   * baroque，两边对不上。每次 boot 都重新贴一次。
   */
  syncTheme(): void {
    this.apply(this.store.get().theme);
  }

  get theme(): ThemeName {
    return this.store.get().theme;
  }

  /**
   * @param animate 是否播放过渡（默认开）
   * @param persist 是否写入 localStorage（默认开）
   */
  setTheme(next: ThemeName, options: { animate?: boolean; persist?: boolean } = {}): void {
    const { animate = true, persist = true } = options;
    const previous = this.store.get().theme;

    if (next === previous) {
      if (persist) this.store.set({ theme: next });
      return;
    }

    if (animate) this.beginTransition();

    // theme 和 currentTrack 一起写：状态永远同步
    this.store.set({ theme: next, currentTrack: trackForTheme(next) }, { persist });
    this.apply(next);
    this.followMusic(next);

    this.dispatchEvent(
      new CustomEvent<ThemeChangeDetail>('theme:change', { detail: { theme: next, previous } }),
    );
  }

  toggle(): void {
    this.setTheme(this.theme === 'modern' ? 'baroque' : 'modern');
  }

  /* ---------------- 内部 ---------------- */

  private apply(theme: ThemeName): void {
    document.documentElement.dataset.theme = theme;
    this.syncThemeColor();
  }

  /** 让浏览器地址栏/状态栏也跟着主题走 */
  private syncThemeColor(): void {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    if (paper) meta.content = paper;
  }

  /**
   * 让音乐跟上主题。
   * 换主题是一次明确的用户动作，所以这里要让对应主题的曲目真的出声 ——
   * 包括从"用户暂停过"或"被浏览器拦下"的状态里接上，而不是只换个名字。
   * 任何失败都只是静默，并且播放器会回到真实在放的那首。
   */
  private followMusic(theme: ThemeName): void {
    const music = this.music ?? getGlobal().music;
    if (!music) return;

    const id = trackForTheme(theme);
    if (music.track.id === id) {
      music.resume();
      return;
    }
    void music.crossfadeTo(id, { force: true });
  }

  /**
   * 真正的 crossfade：把当前背景渐变复制成一层固定的 ghost 盖在 .ambient 上，
   * 换完主题之后把它淡出。这样渐变是"融"过去的，不会闪白，也不会黑屏。
   */
  private beginTransition(): void {
    const root = document.documentElement;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ambient = document.querySelector<HTMLElement>('.ambient');
    if (ambient) {
      const styles = getComputedStyle(ambient);
      const ghost = document.createElement('div');
      ghost.className = 'ambient-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.backgroundColor = styles.backgroundColor;
      ghost.style.backgroundImage = styles.backgroundImage;
      document.body.appendChild(ghost);

      this.ghost?.remove();
      this.ghost = ghost;

      // 先让初始状态落一帧，再开始淡出
      void ghost.offsetWidth;
      ghost.style.transition = `opacity ${FADE_MS}ms var(--ease)`;
      ghost.style.opacity = '0';

      window.clearTimeout(this.ghostTimer);
      this.ghostTimer = window.setTimeout(() => {
        ghost.remove();
        if (this.ghost === ghost) this.ghost = null;
      }, FADE_MS + 80);
    }

    // 颜色层面：只在这 640ms 内给全站补间，平时不给任何元素常驻 transition
    root.classList.add('theme-shift');
    window.clearTimeout(this.shiftTimer);
    this.shiftTimer = window.setTimeout(() => {
      root.classList.remove('theme-shift');
    }, FADE_MS + 60);
  }
}

/** 站点级单例：客户端路由切换后仍然是同一个实例 */
export function initTheme(store: AppStore): ThemeManager {
  const global = getGlobal();
  global.theme ??= new ThemeManager(store);
  global.theme.syncTheme();
  return global.theme;
}