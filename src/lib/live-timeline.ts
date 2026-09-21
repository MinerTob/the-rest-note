const pausedPositions = new Map<string, number>();
const positionKeyFor = (id: string) => `space.position.v1.${id}`;
/** 所有播放位置 key 的前缀：换一趟访问时按它把存下来的位置一起归零 */
const POSITION_PREFIX = 'space.position.v1.';

/**
 * "关于"这一族那首夜曲的时间线 id（`identity-player.ts` / `nocturne.ts` /
 * `nocturne-transport.ts` 共用同一条）。
 * 放在这里是因为"哪些位置要归零"由访问边界决定（见 `resetAudioTimelines()` /
 * visit-session.ts），那边只该认识"位置"这件事，不该去 import 音频调度模块。
 */
export const NOCTURNE_TIMELINE = 'identity:nocturne';

/** Playback position that advances only while its audio is actually playing. */
export function savedPosition(id: string, duration: number): number {
  let value = pausedPositions.get(id);
  if (value === undefined) {
    try {
      const parsed = Number(sessionStorage.getItem(positionKeyFor(id)));
      value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch { value = 0; }
    pausedPositions.set(id, value);
  }
  return duration > 0 ? value % duration : Math.max(0, value);
}

export function savePosition(id: string, position: number): void {
  const value = Number.isFinite(position) ? Math.max(0, position) : 0;
  pausedPositions.set(id, value);
  try { sessionStorage.setItem(positionKeyFor(id), String(value)); } catch { /* In-memory fallback. */ }
}

export function restartPosition(id: string): void {
  savePosition(id, 0);
}

/**
 * 换一趟**新访问**时把本站音频时间线全部归零：内存 Map 与 sessionStorage 一起清。
 *
 * 为什么需要：`space.position.v1.*` 是 sessionStorage —— 它跟着标签页活，刷新、
 * 站内换页、前进后退都该保留（那是"这首歌听到哪了"）。但"地址栏重新输入网址 / 外链 /
 * 新标签页"是一趟新访问：新的一趟不该接着上一趟的播放位置往下放，MP3 与夜曲都从 0 开始。
 *
 * - `ids` 是要归零的 id（背景音乐那些 `track:<曲目 id>` + `NOCTURNE_TIMELINE`）；
 * - 另外扫一遍 storage 里所有 `space.position.v1.*`，把这次没列到的（例如已经解锁过的
 *   隐藏曲目、或以后新增的曲子）一并归零 —— 只碰这个前缀下的 key，**不清整个
 *   sessionStorage**（访问 id、语言偏好、入场标记都不在这儿）。
 * - 存储写入复用 `restartPosition()`，不复制一套逻辑。
 */
export function resetAudioTimelines(ids: readonly string[]): void {
  for (const id of ids) restartPosition(id);

  try {
    const stale: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(POSITION_PREFIX)) stale.push(key.slice(POSITION_PREFIX.length));
    }
    for (const id of stale) restartPosition(id);
  } catch {
    /* 隐私模式：内存 Map 已经归零，storage 读不到就算了 */
  }
}
