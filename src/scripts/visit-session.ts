import {
  navigationKind,
  readEntryToken,
  stampEntryToken,
  visitBoundary,
  type NavigationKind,
} from '@/lib/visit';
import { NOCTURNE_TIMELINE, resetAudioTimelines } from '@/lib/live-timeline';
import { TRACKS } from '@/lib/music';

/**
 * 访问会话（visit session）—— 浏览器这边的"这一趟访问"状态。
 * ------------------------------------------------------------------
 * 三套状态从此彻底分开，谁也不许动别人的：
 *
 *   1. **访问状态**（这里）：这一趟访问的 id + 这一趟点没点过"进入网站"。
 *      存储：sessionStorage `rest-note.visit` / `rest-note.entry-passed`，
 *      外加当前历史条目上的一个章（`history.state.restNoteVisit`，见 lib/visit.ts）。
 *   2. **音频时间线**（`src/lib/live-timeline.ts`）：背景音乐与 `identity:nocturne`
 *      播到第几秒。它跟着标签页活：刷新 / 站内换页 / 前进后退都**保留**（那是"这首歌
 *      听到哪了"）；只有判定为**新的一趟访问**时才归零 —— 新的一趟该从 0 开始放
 *      （见 createSession() 里的 `resetAudioTimelines()`）。
 *   3. **音频运行时**（`piano.ts` / `identity-audio.ts`）：PianoEngine、AudioContext、
 *      采样缓冲、排程。跟上面两个状态没有任何关系。
 *
 * 判定规则（原话见 lib/visit.ts 的表）：能确定是同一趟才叫同一趟 ——
 *   · 地址栏输入 / 外链 / 书签 → 新访问；
 *   · 刷新 → 同一趟（历史条目上的章还在）；若浏览器把"地址栏重新输入同一个网址"
 *     也报成刷新，那条目是新的、章没了 → 照样认成新访问；
 *   · 前进 / 后退 → 同一趟；
 *   · 新标签页 → 新访问（sessionStorage 本来就是空的）。
 */

/** 这一趟访问的 id（sessionStorage，跟着标签页走） */
const VISIT_KEY = 'rest-note.visit';
/** 这一趟访问里是否已经点过"进入网站" */
const ENTRY_KEY = 'rest-note.entry-passed';

export type VisitSession = {
  /** 这一趟访问的 id：落点 cookie 之类"每趟不一样"的东西用它 */
  token: string;
  /** 这次**文档加载**是不是一趟新访问（= 入场页该不该出现） */
  isNew: boolean;
  /** 这一趟里是否已经点过"进入网站"（点过就不用再拦） */
  hasEntered(): boolean;
  /** 记下"这一趟已经进去过了" */
  markEntered(): void;
};

let current: VisitSession | undefined;
/** 隐私模式读不到 sessionStorage 时的内存兜底：至少本次文档不会重复弹入场页 */
let enteredInMemory = false;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* 隐私模式：内存兜底顶上 */
  }
}

function forget(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* 隐私模式 */
  }
}

function newToken(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function navigationNow(): NavigationKind {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return navigationKind(entry?.type);
}

/**
 * 在**当前历史条目**上盖章。每次 boot 都要盖一次：
 * Astro 的客户端路由换页时是 `history.pushState({ index, scrollX, scrollY })`，
 * 会把条目上原有的字段整个换掉（router.js 的 moveToLocation）—— 不补盖的话，
 * "站内换页之后按刷新"就会被当成新访问，凭空多一次入场页。
 */
function stampEntry(token: string): void {
  try {
    history.replaceState(stampEntryToken(history.state, token), '');
  } catch {
    /* 某些沙盒 / file:// 下 replaceState 会抛，忽略：退化成只看导航类型 */
  }
}

function createSession(): VisitSession {
  const previous = read(VISIT_KEY);
  const boundary = visitBoundary({
    navigation: navigationNow(),
    sessionToken: previous,
    entryToken: readEntryToken(history.state),
  });
  const isNew = boundary === 'new';
  const token = isNew || !previous ? newToken() : previous;

  write(VISIT_KEY, token);
  /*
   * 新的一趟访问：把"这一趟进没进过"和**音频时间线**一起归零。
   *
   * 地址栏重新输入网址 / 外链 / 新标签页是一趟新访问 —— 它不该接着上一趟的播放位置
   * 往下放：MP3 与夜曲都要从 0 开始。这里清的是 `space.position.v1.*` 那组 key，
   * **不清整个 sessionStorage**（访问 id 刚写进去，入场标记由 forget() 单独负责）。
   * 同一趟的刷新 / 前进后退 / 站内换页都走不到这里（isNew 为 false），位置照旧保留。
   */
  if (isNew) {
    forget(ENTRY_KEY);
    resetAudioTimelines([
      ...TRACKS.map((track) => `track:${track.id}`),
      NOCTURNE_TIMELINE,
    ]);
  }
  stampEntry(token);
  /*
   * 排查读数（和 data-motion / data-nocturne-at 同一个习惯）：这次文档加载被判定成
   * `new`（新的一趟）还是 `same`（同一趟）。"为什么又弹入场页 / 为什么没弹"先看它。
   */
  document.documentElement.dataset.visit = isNew ? 'new' : 'same';

  return {
    token,
    isNew,
    hasEntered: () => enteredInMemory || read(ENTRY_KEY) === '1',
    markEntered: () => {
      enteredInMemory = true;
      write(ENTRY_KEY, '1');
    },
  };
}

/**
 * 取这一趟访问的会话。同一份文档里只会判定一次（模块级缓存）——
 * 所以"一个文档里 boot 跑了两次"也不会算出两个结论；
 * 每次调用都会顺手把访问 id 补盖到当前历史条目上（换页之后需要）。
 */
export function visitSession(): VisitSession {
  current ??= createSession();
  stampEntry(current.token);
  return current;
}
