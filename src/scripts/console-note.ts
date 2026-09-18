import { getGlobal } from './global';

/** 控制台里的一句话：给愿意打开 DevTools 的人。 */
export function logConsoleNote(): void {
  const global = getGlobal();
  if (global.consoleLogged) return;
  global.consoleLogged = true;

  const title = 'color:#d3e8ff;background:#10263a;padding:2px 6px;border-radius:3px;font-weight:600';
  const text = 'color:#7b8da2';

  console.log('%cLCD GLASS%c 这个站点是用 Astro 搭的。', title, text);
  console.log('%c         实验室里放了台小乐器，随便弹弹看。', 'color:#2f6fd0');
}
