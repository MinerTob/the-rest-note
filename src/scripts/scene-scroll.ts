/**
 * "看关于区看到哪儿了"的精确记忆（一页一份，按 pathname 存）。
 *
 * 用来解决：在首页关于区（比如 scrollY=4200）点进自我介绍页，返回时**第一帧就停在 4200**，
 * 而不是先渲染首页顶部、再平滑滚回去（那一下还会顺带把首页背景音乐放出来）。
 *
 * 只在 identity/nocturne 这一族内部的换页之间记（`app.ts` 调），一次性取用；
 * 语言切换不走这里 —— 那件事由 `lang.ts` 的"地标对齐"负责（见 §5.4）。
 */

const KEY = 'space.scene-scroll';

type SceneScroll = { path: string; y: number };

/** 记下"离开这一页时停在哪儿"（精确像素） */
export function rememberFamilyScroll(pathname: string = location.pathname): void {
  try {
    const record: SceneScroll = { path: pathname, y: Math.round(window.scrollY) };
    window.sessionStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* 隐私模式下记不住就退回"从头看"，不报错 */
  }
}

/** 回到这个 pathname 时取回位置（取走一次就清掉） */
export function takeFamilyScroll(pathname: string = location.pathname): number | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SceneScroll>;
    if (parsed?.path !== pathname || typeof parsed.y !== 'number' || !Number.isFinite(parsed.y)) return null;
    window.sessionStorage.removeItem(KEY);
    return parsed.y;
  } catch {
    return null;
  }
}

/**
 * 只是看一眼（不消费）：这次换页是不是"回到刚才那一页"。
 * `app.ts` 用它决定要不要把 `#锚点` 从路由手里拿掉 —— 否则路由会带着平滑动画
 * 滚到锚点，看起来就是"先渲染顶部、再滚回关于区"。
 */
export function peekFamilyScroll(pathname: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SceneScroll>;
    return parsed?.path === pathname && typeof parsed.y === 'number' && Number.isFinite(parsed.y)
      ? parsed.y
      : null;
  } catch {
    return null;
  }
}

/** 放到这个 scrollY（instant：html 上有 scroll-behavior: smooth，不能让它滑过去） */
export function restoreScroll(y: number): void {
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
}

/** 语言切换那一趟由 lang.ts 负责恢复，别跟它抢 */
export function isLanguageSwap(targetPathname: string): boolean {
  try {
    return window.sessionStorage.getItem('space.lang-swap') === targetPathname;
  } catch {
    return false;
  }
}
