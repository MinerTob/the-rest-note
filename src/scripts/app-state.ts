import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemeName,
  trackForTheme,
  type ThemeName,
} from '@/lib/themes';
import { readString, writeString } from './storage';

/**
 * Application State
 * ------------------------------------------------------------
 * 全站唯一的一份状态。Footer / Navigation / MiniLab / Music Player /
 * Easter Egg / Theme Switcher 都从这里读，没有第二个真相来源。
 *
 *   ThemeManager    → theme
 *   MusicManager    → currentTrack
 *   EasterEggManager→ unlockedTracks / hintMode / eggActive
 *
 * 谁来改状态，谁就必须走 set()，这样：
 *   - 一次写入里改掉的东西永远是一起变的（不会 half-updated）
 *   - 落盘的时机只有一个地方
 *   - 任何 UI 只要监听 'change' 就能立刻跟上
 */

export type AppStateSnapshot = {
  theme: ThemeName;
  currentTrack: string;
  unlockedTracks: readonly string[];
  hintMode: boolean;
  eggActive: boolean;
};

const UNLOCKED_KEY = 'space.unlocked';

function readUnlocked(): string[] {
  const raw = readString(UNLOCKED_KEY, '');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export type AppStateChange = {
  state: AppStateSnapshot;
  previous: AppStateSnapshot;
};

export class AppStore extends EventTarget {
  private state: AppStateSnapshot;

  constructor() {
    super();

    const stored = readString(THEME_STORAGE_KEY, '');
    const theme: ThemeName = isThemeName(stored) ? stored : DEFAULT_THEME;

    this.state = {
      theme,
      currentTrack: trackForTheme(theme),
      unlockedTracks: readUnlocked(),
      // 提示模式与彩蛋激活都是"这一段浏览里的事"，不落盘
      hintMode: false,
      eggActive: false,
    };
  }

  get(): AppStateSnapshot {
    return this.state;
  }

  /** 只有这个入口能改状态。persist=false 用于临时状态（提示模式等）。 */
  set(patch: Partial<AppStateSnapshot>, options: { persist?: boolean } = {}): void {
    const { persist = true } = options;
    const previous = this.state;

    const next: AppStateSnapshot = { ...previous, ...patch };
    if (
      next.theme === previous.theme &&
      next.currentTrack === previous.currentTrack &&
      next.hintMode === previous.hintMode &&
      next.eggActive === previous.eggActive &&
      sameList(next.unlockedTracks, previous.unlockedTracks)
    ) {
      return;
    }

    this.state = next;

    if (persist) {
      writeString(THEME_STORAGE_KEY, next.theme);
      writeString(UNLOCKED_KEY, next.unlockedTracks.length ? JSON.stringify(next.unlockedTracks) : '');
    }

    this.dispatchEvent(new CustomEvent<AppStateChange>('change', { detail: { state: next, previous } }));
  }

  isUnlocked(trackId: string): boolean {
    return this.state.unlockedTracks.includes(trackId);
  }

  hasUnlocks(): boolean {
    return this.state.unlockedTracks.length > 0;
  }
}