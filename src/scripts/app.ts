import { clearTimers, getGlobal } from './global';
import { AppStore } from './app-state';
import { initClock } from './clock';
import { initEasterEggs } from './easter-eggs';
import { initLangSwitch, markIncomingLanguageText } from './lang';
import { initMiniLab } from './minilab';
import { initMusicUI } from './music-ui';
import { initContact } from './contact';
import { initIdentity, disposeIdentity, setIdentityActive } from './identity-player';
import { initNocturne, disposeNocturne } from './nocturne';
import { primeIdentityPianoOnFirstGesture, releaseIdentityPiano } from './identity-audio';
import { initSystemMessages } from './system-message';
import { initTheme } from './theme';
import { initThemeSwitcher } from './theme-switch';
import { logConsoleNote } from './console-note';
import { MusicManager } from './music-manager';
import { initEntryGate } from './entry-gate';
import { trackInputModality } from './input-modality';

let disposeJourney: (() => void) | undefined;

function initJourney(root: HTMLElement, music: MusicManager): void {
  disposeJourney?.();
  const sections = [...root.querySelectorAll<HTMLElement>('[data-journey-section]')];
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-section-target]')];
  const about = root.querySelector<HTMLElement>('[data-journey-section="about"]');
  let aboutActive = false;

  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    const id = (visible?.target as HTMLElement | undefined)?.dataset.journeySection;
    if (!id) return;
    links.forEach((link) => {
      if (link.dataset.sectionTarget === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-34% 0px -52% 0px', threshold: [0, 0.01, 0.25, 0.5] });
  sections.forEach((section) => sectionObserver.observe(section));

  const aboutObserver = about ? new IntersectionObserver(([entry]) => {
    // The About section is taller than a phone viewport, so its intersection
    // ratio may never reach 35% on mobile. That made the observer immediately
    // pause a performance that the play button had just started, and repeated
    // edge crossings could rapidly stop/start the scheduler. Treat any real
    // intersection as active; the zero crossing is stable on every viewport.
    const active = entry.isIntersecting;
    if (active === aboutActive) return;
    aboutActive = active;
    if (active) {
      music.setAboutActive(true);
      initIdentity();
      setIdentityActive(true);
    } else {
      setIdentityActive(false);
      music.setAboutActive(false);
    }
  }, { threshold: 0 }) : undefined;
  if (about && aboutObserver) aboutObserver.observe(about);

  disposeJourney = () => {
    sectionObserver.disconnect();
    aboutObserver?.disconnect();
    if (aboutActive) disposeIdentity();
    disposeJourney = undefined;
  };
}

/**
 * 客户端入口。
 * 只在需要交互的地方运行：音乐、时钟、语言切换、MiniLab、彩蛋。
 * 正文内容全部是构建时静态渲染的。
 *
 * 初始化顺序是有讲究的：
 *   AppStore → Theme → Music → MiniLab → EasterEgg → ThemeSwitcher
 * 状态在最前面，读状态的系统在后面。
 */
function boot(): void {
  disposeJourney?.();
  const global = getGlobal();
  clearTimers();

  // 0) 焦点圈开关：先记下"最近一次是鼠标还是键盘"，后面的脚本聚焦才不会画出蓝框
  trackInputModality();

  // 1) 统一状态
  global.store ??= new AppStore();

  // 2) 主题：必须在其它 UI 初始化之前就位，后面的组件才能读到正确的 token
  const theme = initTheme(global.store);

  initSystemMessages();
  initLangSwitch();
  initClock();
  logConsoleNote();

  // 3) 音乐系统常驻。当前曲目由主题推导，刷新后也不会和主题错位。
  global.music ??= new MusicManager(global.store);
  theme.attachMusic(global.music);
  const journey = document.querySelector<HTMLElement>('[data-journey]');
  // "关于"这一族页面（About、自我介绍）都让主题背景音乐让位：
  // 它们放的是同一首夜曲的钢琴演奏，不是 MusicManager 里的 MP3。
  const aboutFamily = Boolean(document.querySelector('[data-identity], [data-nocturne]'));
  global.music.setAboutActive(aboutFamily && !journey);
  initMusicUI(global.music);

  // 4) 交互组件
  initContact();
  if (!journey) initIdentity();
  initNocturne();
  // 夜曲的 AudioContext 必须在用户手势里唤醒（iOS）：入场页那次点击之外，
  // 再留一条"第一次触摸/按键就唤醒"的兜底，见 identity-audio.ts。
  primeIdentityPianoOnFirstGesture();
  initMiniLab();
  initEasterEggs(global.store, theme);
  initThemeSwitcher(global.store, theme);
  if (journey) initJourney(journey, global.music);

  // 首次硬加载由入场页里的真实点击解锁声音；站内导航不重复拦截。
  const gated = initEntryGate(global.music);
  if (!gated) global.music.init();
}

document.addEventListener('astro:before-swap', (event) => {
  disposeJourney?.();
  disposeIdentity();
  disposeNocturne();
  getGlobal().minilab?.dispose();
  getGlobal().minilab = undefined;

  // 夜曲的跨页交棒：下一张页面仍然是"关于"这一族（About / 自我介绍 / 首页关于区）时，
  // 这架琴就留着 —— 已经排进音频时钟的音继续响，新页面从交棒位置接着往下排，
  // 于是"关于 → 关于我"听起来是一口气弹下来的。去别的页面才真的收掉它。
  if (!event.newDocument.querySelector('[data-identity], [data-nocturne]')) releaseIdentityPiano();

  // 换页的瞬间就把主题写进即将替换上来的那份文档。不然 <html data-theme>
  // 会被新文档的属性覆盖掉，主题在换页时退回默认值。
  const theme = document.documentElement.dataset.theme;
  if (theme) event.newDocument.documentElement.dataset.theme = theme;

  // 语言切换：给即将上场的文档里的文字挂好“从右滑入”。
  // 只动文字，页面骨架不做任何动画。
  markIncomingLanguageText(event.newDocument);
});

document.addEventListener('astro:page-load', boot);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
