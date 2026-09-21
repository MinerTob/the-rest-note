/**
 * 访问边界（visit boundary）—— 纯逻辑，方便单独测试（tests/visit.test.mjs）。
 *
 * 这一层只回答一个问题：**这次文档加载算不算"一趟新的访问"**（= 入场页要不要出现）。
 * 它不碰 DOM、不碰存储，把"读到的信号"交给调用方（src/scripts/visit-session.ts）。
 *
 * 为什么不能只看 `performance.getEntriesByType('navigation')[0].type`：
 *
 * | 用户动作 | Chrome 报的 type | 我们想要的 |
 * | --- | --- | --- |
 * | 地址栏输入 / 外链 / 书签 | `navigate` | 新访问 |
 * | 地址栏里重新输入**同一个**网址 | `navigate`（条目被顶掉） | 新访问 |
 * | 刷新（F5 / 刷新按钮） | `reload` | 同一趟 |
 * | 前进 / 后退 / bfcache | `back_forward` | 同一趟 |
 *
 * 麻烦在于**不同浏览器给"地址栏里重新输入同一个网址"报的 type 不一样**：有的报
 * `navigate`，有的把它当成一次刷新（`reload`）。只看 type 时，后者会被当成"刷新"，
 * 于是上一趟的 `entry-passed` 被沿用、入场页不出现（本人报的这个 bug）。
 *
 * 所以这里加第二个信号：**当前历史条目上有没有我们自己盖的访问 id**
 * （`history.state` 里的 `restNoteVisit`，每次开机盖章，见 visit-session.ts）。
 *   · 刷新：条目原样留下来 → 章还在 → 同一趟；
 *   · 地址栏重新输入网址：那是一次新的导航，条目被顶掉/换掉 → 章没了 → 新访问。
 * 两个信号合起来，上面那张表里六种情形都能分得开（见 tests/visit.test.mjs）。
 */

/** 这次加载的导航类型（`PerformanceNavigationTiming.type` 归一化之后） */
export type NavigationKind = 'navigate' | 'reload' | 'back_forward' | 'unknown';

/** `history.state` 里记"这个历史条目属于哪一趟访问"的字段（与 Astro 自己的 index / scrollX / scrollY 共存） */
export const VISIT_STATE_KEY = 'restNoteVisit';

export type VisitSignals = {
  /** 这次加载的导航类型 */
  navigation: NavigationKind;
  /** sessionStorage 里上一趟留下的访问 id；新标签页 / 隐私模式拿不到时是 null */
  sessionToken: string | null;
  /** 当前历史条目上盖着的访问 id；不是我们盖的 / 没有就是 null */
  entryToken: string | null;
};

export type VisitBoundary = 'new' | 'same';

/** `PerformanceNavigationTiming.type` → 归一化后的四种 */
export function navigationKind(raw: string | null | undefined): NavigationKind {
  return raw === 'navigate' || raw === 'reload' || raw === 'back_forward' ? raw : 'unknown';
}

/** 从 `history.state` 里读出我们盖的访问 id（读不出来就是 null） */
export function readEntryToken(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const token = (state as Record<string, unknown>)[VISIT_STATE_KEY];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * 把访问 id 盖进当前历史条目，**保留条目上原有的字段**。
 * Astro 的客户端路由把 `{ index, scrollX, scrollY }` 存在同一个 state 上，
 * 换页/刷新时靠它恢复滚动位置 —— 覆盖掉就会把"回到原处"弄丢。
 */
export function stampEntryToken(state: unknown, token: string): Record<string, unknown> {
  const base = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  return { ...base, [VISIT_STATE_KEY]: token };
}

/**
 * 这次加载是"新的一趟访问"还是"同一趟的又一次加载"。
 *
 * 默认往"新访问"偏：只有能确定是同一趟的情形才返回 `'same'` ——
 * 入场页多出现一次只是多按一下，漏掉一次却是本人报的 bug。
 */
export function visitBoundary({ navigation, sessionToken, entryToken }: VisitSignals): VisitBoundary {
  // 这个标签页里还没有访问 id：新标签页、或者存储被清过 —— 一趟新访问
  if (!sessionToken) return 'new';

  switch (navigation) {
    // 地址栏输入 / 外链 / 书签：新的导航
    case 'navigate':
      return 'new';
    // 刷新：真正的刷新会带着我们盖在这一条目上的访问 id；
    // 把"重新输入同一个网址"报成 reload 的浏览器里，条目是新的（章没了）→ 也算新访问
    case 'reload':
      return entryToken === sessionToken ? 'same' : 'new';
    // 前进 / 后退 / bfcache：回到的是原来那个条目，同一趟
    case 'back_forward':
      return 'same';
    // 认不出来的类型（包括拿不到 navigation entry 的情况）：当成新访问
    default:
      return 'new';
  }
}
