import { getGlobal } from './global';

/** LCD 系统提示：很短，很安静，不打断浏览。 */
export function initSystemMessages(): void {
  const global = getGlobal();
  if (global.messagesBound) return;
  global.messagesBound = true;

  let timer = 0;

  window.addEventListener('space:message', (event) => {
    const detail = (event as CustomEvent<{ message?: string; detail?: string }>).detail;
    const host = document.querySelector<HTMLElement>('[data-system-message]');
    if (!host || !detail?.message) return;

    const textEl = host.querySelector<HTMLElement>('[data-system-message-text]');
    const subEl = host.querySelector<HTMLElement>('[data-system-message-detail]');

    if (textEl) textEl.textContent = detail.message;
    if (subEl) {
      subEl.textContent = detail.detail ?? '';
      subEl.hidden = !detail.detail;
    }

    host.dataset.visible = 'true';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      host.dataset.visible = 'false';
    }, 3600);

    global.timers.push(timer);
  });
}
