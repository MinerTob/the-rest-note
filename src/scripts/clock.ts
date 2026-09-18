import { getGlobal } from './global';

/** LCD 本地时间：新加坡时区，每秒更新，带非常轻微的刷新感。 */

export function initClock(): void {
  const panels = document.querySelectorAll<HTMLElement>('[data-clock]');
  if (panels.length === 0) return;

  const timeZone = 'Asia/Singapore';
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interval = window.setInterval(tick, 1000);
  getGlobal().timers.push(interval);

  tick();

  function tick(): void {
    const now = new Date();
    const parts = timeFormat.formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '--';
    const time = `${pick('hour')}:${pick('minute')}:${pick('second')}`;

    const dateParts = dateFormat.formatToParts(now);
    const datePick = (type: string) => dateParts.find((part) => part.type === type)?.value ?? '';
    const dateText = `${datePick('year')}.${datePick('month')}.${datePick('day')} ${datePick('weekday').toUpperCase()}`;

    panels.forEach((panel) => {
      const timeEl = panel.querySelector<HTMLElement>('[data-clock-time]');
      const dateEl = panel.querySelector<HTMLElement>('[data-clock-date]');
      if (timeEl && timeEl.textContent !== time) {
        timeEl.textContent = time;
        if (!reduceMotion) {
          timeEl.classList.remove('is-tick');
          // 强制重排，让动画可以重复播放
          void timeEl.offsetWidth;
          timeEl.classList.add('is-tick');
        }
      }
      if (dateEl && dateEl.textContent !== dateText) {
        dateEl.textContent = dateText;
      }
    });
  }
}
