import {
  EASTER_EGGS,
  HOLD_TO_ARM,
  eggForTheme,
  isArmChord,
  type EasterEgg,
} from '@/lib/easter-eggs';
import { createSequenceSession, type SequenceSession } from '@/lib/sequences';
import { getGlobal } from './global';
import { getDocumentLang, getPreferredLang } from './lang';
import type { AppStore } from './app-state';
import type { ThemeManager } from './theme';

/**
 * Easter Egg Manager
 * ------------------------------------------------------------
 *   Note Input → Sequence Detector → Easter Egg Manager → Theme Manager
 *                                                       └→ Music Manager
 *
 * 最重要的规则：
 *
 *   序列识别**只在提示模式里**运行。
 *
 * 普通状态下随便弹什么 —— 鼠标、触摸、电脑键盘、真实 MIDI 键盘 ——
 * 都只是弹钢琴，永远不会触发彩蛋。只有先进入提示模式，
 * 提示模式才会按当前主题挑一条序列开始逐个点亮琴键。
 *
 * 进入提示模式有两个等价入口（配置见 lib/easter-eggs.ts 的 HOLD_TO_ARM）：
 *   · 电脑键盘：Shift + P
 *   · 触屏 / 鼠标：同时按住 D4 与 F#4 一秒（手机上没有 Shift，只有这条）
 *
 * 它自己不认识 MiniLab，也不知道琴键长什么样：
 * - 输入只有 window 上的 'minilab:note' / 'minilab:release' 事件
 * - 输出只有三件事：改主题（音乐跟着 theme profile 走）、
 *   记下解锁、加上一行动词很短的 LCD 提示
 */

export type EggHintDetail = {
  armed: boolean;
  /** 下一格需要弹的音；null 表示没有提示 */
  note: string | null;
};

type EggEntry = { egg: EasterEgg; session: SequenceSession };

function announce(message: string, detail?: string): void {
  window.dispatchEvent(new CustomEvent('space:message', { detail: { message, detail } }));
}

export class EasterEggManager extends EventTarget {
  private store: AppStore;
  private theme: ThemeManager;
  private entries: EggEntry[];
  private armedId: string | null = null;
  /** 当前被按住不放的音：长按入口用，只有 note / release 两个来源会写它 */
  private held = new Set<string>();
  private holdTimer = 0;
  /** 这一次"按住"已经触发过，松开之前不会触发第二次 */
  private holdFired = false;

  constructor(store: AppStore, theme: ThemeManager) {
    super();
    this.store = store;
    this.theme = theme;
    this.entries = EASTER_EGGS.map((egg) => ({
      egg,
      session: createSequenceSession(egg.notes, { maxGapMs: egg.maxGapMs }),
    }));
  }

  get hintArmed(): boolean {
    return this.armedId !== null;
  }

  /**
   * Shift+P：进入 / 退出隐藏提示模式。
   * 页面上没有 MiniLab 时什么也不做；当前主题没有对应序列时也不做。
   */
  toggleHint(): void {
    if (this.armedId !== null) {
      this.disarm();
      return;
    }

    if (!document.querySelector('[data-minilab]')) return;

    const egg = eggForTheme(this.store.get().theme);
    if (!egg) return;

    const entry = this.entryFor(egg.id);
    if (!entry) return;

    entry.session.reset();
    this.armedId = egg.id;
    this.store.set({ hintMode: true }, { persist: false });

    // 极短的一行设备语气提示 —— 不解释规则，也不泄露答案
    announce(egg.hintLabel);
    this.emitHint();
  }

  disarm(): void {
    if (this.armedId === null) return;
    this.armedId = null;
    this.store.set({ hintMode: false }, { persist: false });
    this.emitHint();
  }

  /**
   * 长按入口：某个音被按住。
   *
   * 只有入口要求的音**全部**被按住满 HOLD_TO_ARM.holdMs 才切换提示模式；
   * 中途松开任何一个就作废重来。按着不放只触发一次 ——
   * 想再切换（退出提示模式）得先松开、再重新按住一段同样的时间。
   */
  holdNote(note: string): void {
    this.held.add(note);
    this.syncHold();
  }

  /** 长按入口：某个音松开了 */
  releaseNote(note: string): void {
    this.held.delete(note);
    this.syncHold();
  }

  private syncHold(): void {
    if (!isArmChord(this.held)) {
      if (this.holdTimer !== 0) {
        window.clearTimeout(this.holdTimer);
        this.holdTimer = 0;
      }
      this.holdFired = false;
      return;
    }

    // 已经在计时 / 这一次已经触发过，就什么都不做
    if (this.holdFired || this.holdTimer !== 0) return;

    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      this.holdFired = true;
      this.toggleHint();
    }, HOLD_TO_ARM.holdMs);
  }

  /**
   * 一个音进来了。
   * 没在提示模式里 → 直接返回，什么都不判断。
   */
  note(note: string): void {
    const entry = this.armedId === null ? null : this.entryFor(this.armedId);
    if (!entry) return;

    const result = entry.session.push(note);

    if (result.matched) {
      this.trigger(entry);
      return;
    }

    // 按对：当前键先变成 ACCEPTED，再亮起下一个
    if (result.correct) {
      window.dispatchEvent(new CustomEvent('egg:accept', { detail: { note } }));
    } else {
      // 按错：不重置页面、不弹窗，只让当前提示很轻地闪一下
      window.dispatchEvent(
        new CustomEvent('egg:miss', { detail: { note: entry.session.awaiting } }),
      );
    }

    this.emitHint();
  }

  private entryFor(id: string): EggEntry | undefined {
    return this.entries.find((entry) => entry.egg.id === id);
  }

  private trigger(entry: EggEntry): void {
    const { egg } = entry;
    announce(egg.message, egg.detail?.[this.lang()]);

    // 先记下解锁，再切主题 —— 两条写入都是显式的
    const unlocked = this.store.get().unlockedTracks;
    if (egg.unlocks && !unlocked.includes(egg.unlocks)) {
      this.store.set({ unlockedTracks: [...unlocked, egg.unlocks], eggActive: true });
    } else {
      this.store.set({ eggActive: true });
    }

    // 主题变了，曲目由 theme profile 一起带过去（不会状态分裂）
    this.theme.setTheme(egg.resultTheme);

    if (this.armedId === egg.id) {
      this.armedId = null;
      this.store.set({ hintMode: false }, { persist: false });
      this.emitHint();
    }
  }

  private emitHint(): void {
    const entry = this.armedId === null ? null : this.entryFor(this.armedId);
    const detail: EggHintDetail = {
      armed: this.armedId !== null,
      note: entry ? (entry.session.awaiting ?? null) : null,
    };
    window.dispatchEvent(new CustomEvent('egg:hint', { detail }));
  }

  private lang() {
    return getPreferredLang() ?? getDocumentLang();
  }
}

/** 站点级单例：客户端路由切换后依然保持进度 */
export function initEasterEggs(store: AppStore, theme: ThemeManager): void {
  const global = getGlobal();
  const manager = (global.eggs ??= new EasterEggManager(store, theme));

  if (global.eggsBound) return;
  global.eggsBound = true;

  // 唯一的音符来源。MIDI、触摸、鼠标、电脑键盘最终都走这里，
  // 但只有提示模式内部才会去比对序列。
  // 同时喂给长按入口：它只关心"哪几个音正被按住"，不看序列。
  window.addEventListener('minilab:note', (event) => {
    const detail = (event as CustomEvent<{ note?: string }>).detail;
    if (!detail?.note) return;
    manager.holdNote(detail.note);
    manager.note(detail.note);
  });

  // 松键：长按入口靠它判断"中途松手了没有"
  window.addEventListener('minilab:release', (event) => {
    const detail = (event as CustomEvent<{ note?: string }>).detail;
    if (detail?.note) manager.releaseNote(detail.note);
  });

  // Shift + P：电脑上的隐藏入口，而且只在真的有 MiniLab 的页面上有效
  // （手机上按不了，等价动作是同时按住 D4 + F#4 一秒，见 HOLD_TO_ARM）
  window.addEventListener('keydown', (event) => {
    if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'p') return;

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return;
    }

    if (!document.querySelector('[data-minilab]')) return;

    event.preventDefault();
    manager.toggleHint();
  });
}
