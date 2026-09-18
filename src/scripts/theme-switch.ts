import { nextTheme } from '@/lib/themes';
import { getGlobal } from './global';
import { getDocumentLang, getPreferredLang } from './lang';
import type { AppStore } from './app-state';
import type { ThemeManager } from './theme';

/**
 * Theme Switcher
 * ------------------------------------------------------------
 * 只有解锁过至少一首隐藏曲目之后才存在的那个小椭圆控件。
 * 它没有任何自己的状态：显示什么、点了做什么，全部来自 AppStore。
 *
 * 没有解锁 → 控件根本不存在（hidden，且不占位置、不在无障碍树里）。
 */

export function initThemeSwitcher(store: AppStore, theme: ThemeManager): void {
  const global = getGlobal();

  if (!global.themeSwitchBound) {
    global.themeSwitchBound = true;
    // 状态变了就重画 —— 包括"刚刚解锁"这一刻
    store.addEventListener('change', () => render());
  }

  const host = document.querySelector<HTMLElement>('[data-theme-switch]');
  const button = host?.querySelector<HTMLButtonElement>('[data-theme-switch-btn]');

  if (button && button.dataset.bound !== '1') {
    button.dataset.bound = '1';
    button.addEventListener('click', () => theme.toggle());
  }

  render();
}

function render(): void {
  const global = getGlobal();
  const store = global.store;
  const host = document.querySelector<HTMLElement>('[data-theme-switch]');
  if (!host || !store) return;

  const state = store.get();
  const unlocked = state.unlockedTracks.length > 0;
  host.hidden = !unlocked;
  if (!unlocked) return;

  const target = nextTheme(state.theme);
  host.dataset.themeNow = state.theme;
  host.dataset.themeNext = target;

  const valueEl = host.querySelector<HTMLElement>('[data-theme-switch-value]');
  if (valueEl && valueEl.textContent !== target.toUpperCase()) {
    valueEl.textContent = target.toUpperCase();
  }

  const button = host.querySelector<HTMLButtonElement>('[data-theme-switch-btn]');
  if (button) {
    const lang = getPreferredLang() ?? getDocumentLang();
    const template = lang === 'zh' ? button.dataset.labelZh : button.dataset.labelEn;
    const label = (template ?? '').replace('{theme}', target);
    if (label && button.getAttribute('aria-label') !== label) {
      button.setAttribute('aria-label', label);
    }
  }
}