import type { MusicManager } from './music-manager';
import type { MiniLabController } from './minilab';
import type { ThemeManager } from './theme';
import type { MidiBridge } from './midi';
import type { PianoEngine } from './piano';
import type { EasterEggManager } from './easter-eggs';
import type { AppStore } from './app-state';

/** 挂在 window 上的共享状态：客户端路由切换页面后，音乐等系统还能继续活着。 */

export type SpaceGlobal = {
  timers: number[];
  /** 唯一的应用状态。所有系统都从这里读写，见 app-state.ts */
  store?: AppStore;
  music?: MusicManager;
  theme?: ThemeManager;
  midi?: MidiBridge;
  piano?: PianoEngine;
  /** "关于"这一族共用的钢琴引擎：About / 自我介绍 / 首页关于区跨页不断音（见 identity-audio.ts） */
  identityPiano?: PianoEngine;
  /** 上一次交棒：演奏排到了第几秒 + 什么时候交的 */
  identityHandover?: { position: number; at: number };
  eggs?: EasterEggManager;
  minilab?: MiniLabController;
  windowKeysBound?: boolean;
  eggsBound?: boolean;
  consoleLogged?: boolean;
  messagesBound?: boolean;
  themeSwitchBound?: boolean;
  contactBound?: boolean;
};

export function getGlobal(): SpaceGlobal {
  const holder = window as unknown as { __space?: SpaceGlobal };
  holder.__space ??= { timers: [] };
  return holder.__space;
}

export function clearTimers(): void {
  const global = getGlobal();
  global.timers.forEach((timer) => {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  });
  global.timers = [];
}
