import { getGlobal } from './global';

/** 行内"已复制"停留多久 */
const COPIED_MS = 1200;

/**
 * 老办法：选中一个隐藏的 textarea，再让浏览器复制。
 *
 * execCommand('copy') 在类型定义里已经标了弃用，但没有 Clipboard API 的
 * 上下文里只有它能用，运行时它一直都在 —— 所以这里从类型上绕开那个标记。
 */
function legacyCopy(): boolean {
  const exec = (document as unknown as { execCommand?: (commandId: string) => boolean })
    .execCommand;
  return typeof exec === 'function' ? exec.call(document, 'copy') === true : false;
}

/**
 * 复制到剪贴板。
 *
 * 先试 Clipboard API（只在安全上下文里有），不行再退回老办法。
 * 两种都不成时返回 false —— 这时候不做任何"成功"反馈：
 * 说"我复制好了"是句谎话，访客自己选中文本复制仍然可行。
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 没有权限或不是安全上下文：继续试下一种 */
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    document.body.appendChild(field);
    field.select();
    const ok = legacyCopy();
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * 联系面板的复制交互。
 *
 * 绑在 document 上（事件委托），客户端路由换页之后不用重新绑一次。
 * 反馈只有两处，都很轻：行内把 COPY 换成 COPIED，以及系统提示里
 * 留一句"复制了什么"。两个文案都从 DOM 里读，所以自动跟着语言走，
 * 不需要在脚本里再维护一份字典。
 */
export function initContact(): void {
  const global = getGlobal();
  if (global.contactBound) return;
  global.contactBound = true;

  const rowTimers = new WeakMap<HTMLElement, number>();

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const trigger = target?.closest<HTMLElement>('[data-contact-copy]');
    const text = trigger?.dataset.contactCopy?.trim();
    if (!trigger || !text) return;

    void writeClipboard(text).then((ok) => {
      if (!ok) return;

      const row = trigger.closest<HTMLElement>('[data-contact-row]');
      if (!row) return;

      row.dataset.copied = 'true';
      window.clearTimeout(rowTimers.get(row));
      const timer = window.setTimeout(() => {
        delete row.dataset.copied;
      }, COPIED_MS);
      rowTimers.set(row, timer);
      global.timers.push(timer);

      // 顺手在 LCD 系统提示里说明复制的是哪个账号
      const label = row.querySelector<HTMLElement>('[data-contact-done]')?.textContent?.trim();
      if (!label) return;
      window.dispatchEvent(
        new CustomEvent('space:message', { detail: { message: label, detail: text } }),
      );
    });
  });
}