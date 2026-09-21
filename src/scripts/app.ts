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
import { SCENE_ENTER, SCENE_THRESHOLDS, sceneCoverage, sceneDecision } from '@/lib/scene';
import { stopNocturneTransport } from './nocturne-transport';
import {
  isLanguageSwap,
  peekFamilyScroll,
  rememberFamilyScroll,
  restoreScroll,
  takeFamilyScroll,
} from './scene-scroll';

let disposeJourney: (() => void) | undefined;
/** 本次"页面加载"有没有 boot 过。防止同一次加载里 boot 跑两遍（见文件末尾）。 */
let booted = false;
/** 换页时"先恢复、boot 里再用一次"的 scrollY（同一份文档里换页时用） */
let pendingRestore: number | null = null;
/** 恢复落点时从路由手里拿掉的 `#锚点`，位置放好后再接回地址栏 */
let pendingHash = '';

/**
 * 路由自己记下的"刷新后该停在哪儿"。
 *
 * ClientRouter 每次硬加载都会 `history.replaceState({ index, scrollX, scrollY })`
 * 把**浏览器此刻的滚动位置**写进当前历史条目，并按这个值负责恢复落点
 * （见 astro/dist/transitions/router.js：`if (history.state) scrollTo({ left, top })`）。
 * 也就是说"刷新后该停在哪儿"这个决定权在路由手里，我们不去替它决定 ——
 * 这里只是把它记下的值读出来，好让那次恢复是**瞬间**完成的（见 boot 里的用法）。
 * 只读：不写历史条目、不改地址、不碰 hash。
 */
function routerSavedScrollY(): number | null {
  const state = history.state as { scrollY?: unknown } | null;
  const y = state?.scrollY;
  return typeof y === 'number' && Number.isFinite(y) && y > 0 ? y : null;
}

/** 关于区这一刻算不算"在观看区域"（与 initJourney 的迟滞判据共用进入阈值） */
function aboutOnScreen(journey: HTMLElement): boolean {
  const section = journey.querySelector<HTMLElement>('[data-journey-section="about"]');
  if (!section) return false;
  const rect = section.getBoundingClientRect();
  return (
    sceneCoverage({ viewportHeight: window.innerHeight, top: rect.top, bottom: rect.bottom }) >=
    SCENE_ENTER
  );
}

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

  /*
   * "关于"这一条的激活判定：**迟滞**，不是单个阈值。
   *
   * 以前是 `entry.intersectionRatio >= 0.35` 同时管进和出，判据又是"露出 ÷ 区块高度"：
   * 手机地址栏收起/展开会让视口高度变 60–120px，同一个滚动位置上这个比值能跳 0.02–0.15，
   * 卡在 0.35 附近时就 pause → allNotesOff → start → schedule 反复横跳 ——
   * 本人看到的就是"第一次滚到底没声、回来之后前几秒明显断续"。
   *
   * 现在：判据换成覆盖度（露出 ÷ min(区块, 视口)），进出用两个不同阈值
   * （0.55 / 0.25，中间 0.30 是迟滞带），视口抖动落在带子里就什么也不做。
   * 纯逻辑与实测数据见 lib/scene.ts 与 tests/scene.test.mjs。
   * 这里没有 setTimeout / debounce —— 不抖是因为判据本身稳，不是因为拖时间。
   */
  const aboutObserver = about ? new IntersectionObserver(([entry]) => {
    const coverage = sceneCoverage({
      viewportHeight: entry.rootBounds?.height ?? window.innerHeight,
      top: entry.boundingClientRect.top,
      bottom: entry.boundingClientRect.bottom,
    });
    const next = sceneDecision(aboutActive, coverage);
    if (next === aboutActive) return;
    aboutActive = next;
    // 排查读数（和 data-motion / data-nocturne-at 同一个习惯）：active / idle
    if (about) about.dataset.scene = next ? 'active' : 'idle';
    if (next) {
      music.setAboutActive(true);
      initIdentity();
      setIdentityActive(true);
    } else {
      setIdentityActive(false);
      music.setAboutActive(false);
    }
  }, { threshold: [...SCENE_THRESHOLDS] }) : undefined;
  if (about && aboutObserver) aboutObserver.observe(about);

  disposeJourney = () => {
    sectionObserver.disconnect();
    aboutObserver?.disconnect();
    /*
     * 无条件收掉这一页的播放器。以前写成 `if (aboutActive) disposeIdentity()`：
     * "滚进关于区 → 再滚回上面（aboutActive 变 false）→ 点别的页面"这条路上，
     * 播放器不会被 dispose，它挂在 document 上的 pointerdown / wheel 监听、
     * ResizeObserver、物理引擎都会活到下一页去（旧生命周期和新页面交叉）。
     * disposeIdentity() 本身是幂等的，没初始化过就当没发生。
     */
    disposeIdentity();
    if (about) delete about.dataset.scene;
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
  /*
   * 同一次"页面加载"只准 boot 一次。
   *
   * ClientRouter 在**初始硬加载**上也会发 `astro:page-load`（router.js 里
   * `addEventListener('load', onPageLoad)`），而这里原来在 DOMContentLoaded（或脚本
   * 一执行完）还会自己 boot 一次 —— 于是刷新时 boot 会跑两遍：
   *
   *   boot #1 → initJourney → 观察器 → initIdentity → 建播放器、开始读谱/预载采样
   *   boot #2 → disposeJourney → disposeIdentity → abort 掉正在飞的请求、拆掉物理引擎
   *            → 再 initJourney → 再建一个播放器
   *
   * 中间那次 dispose 会掐掉刚起来的那一套（本人报的"刷新之后夜曲进不了可播放状态"
   * 就是从这条缝里漏出来的）。现在 boot 由 booted 把关：同一次加载里第二次调用直接返回，
   * 换页（astro:after-swap）时才把闸门打开。
   */
  if (booted) return;
  booted = true;

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
  /*
   * 换页带过来的落点：这里再对齐一次（关于区把标签搬进 body 之后文档高度会变），
   * 顺便用它决定"这一页上来就在关于区吗" —— 少了这一步，从自我介绍页返回时
   * 会先按首页顶部放一下背景音乐、再被观察器纠正（本人听到的"先响一下首页音乐"）。
   */
  const restored = pendingRestore ?? takeFamilyScroll(window.location.pathname);
  pendingRestore = null;
  if (restored !== null) {
    restoreScroll(restored);
    // 布局随后一两帧还会动（关于区把标签搬进 body）：再对齐一次，仍然是 instant
    requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - restored) > 4) restoreScroll(restored);
    });
  } else {
    /*
     * 硬加载（刷新 / 重新打开网址）这一趟：路由恢复了落点，但它那次
     * `scrollTo({ left, top })` **没带 behavior**，于是被 `html { scroll-behavior: smooth }`
     * 接管成一段平滑滚动 —— 第 0 帧先渲染开始页顶部，再慢慢滑下去，看起来就是
     * "刷新之后又跳回顶部"（而且这期间 `aboutOnScreen()` 读到的是顶部的几何，
     * 背景 MP3 的状态也跟着判错）。
     *
     * 这里在 boot 里用同一个值再放一次，用 `behavior: 'instant'` 覆盖掉那段动画：
     * 落点还是路由定的那个，只是第一帧就到位。放在 `initEntryGate()` / `music.init()`
     * 之前，是为了让"这一刻算不算在关于区"用**落好之后的**几何来判断（页面优先、音乐跟随）。
     *
     * 站内换页那一趟不走这里（`restored !== null` 时走上面的精确恢复）。
     * 带 `#锚点` 的刷新同样走这里：路由读的是同一个值，我们只是把它瞬间坐实，
     * 不会覆盖浏览器的锚点定位（浏览器那次锚点滚动早就完成了）。
     */
    const saved = routerSavedScrollY();
    if (saved !== null && Math.abs(window.scrollY - saved) > 4) {
      restoreScroll(saved);
    }
  }
  global.music.setAboutActive(aboutFamily && (!journey || aboutOnScreen(journey)));
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
  const leavingFamily = Boolean(document.querySelector('[data-identity], [data-nocturne]'));
  const carryingNocturne = Boolean(event.newDocument.querySelector('[data-identity], [data-nocturne]'));
  disposeJourney?.();
  disposeIdentity();
  disposeNocturne();
  getGlobal().minilab?.dispose();
  getGlobal().minilab = undefined;

  /*
   * 夜曲的跨页：下一张页面还是"关于"这一族（About / 自我介绍 / 首页关于区）时，
   * 播放器和这架琴都**什么都不做** —— 音频时钟、排程、演奏位置一秒都不停，
   * 新页面只是 attach 自己的 UI（见 nocturne-transport.ts）。真的去别的页面才收掉。
   */
  if (carryingNocturne) {
    /*
     * 这次是"回到刚才那一页"吗？看目标页上有没有我们记下的落点。
     *
     * 顺序很要紧：**先判断是不是回去，再决定要不要记新的** —— 反过来会把正要用的
     * 那条覆盖掉（本人那次"先到顶部再滚回关于区"就是这里顺序写反了）。
     * 是回去：把 `#锚点` 从路由手里拿掉 —— 不拿掉的话路由会 `location.href = to.href`，
     * 浏览器带着平滑动画滚到锚点，位置由我们精确恢复（`#锚点` 在 after-swap 里接回地址栏）。
     * 不是回去（进子页）：把精确 scrollY 记下来，回来时第一帧就停在原处。
     * 切语言那一趟跳过 —— 那件事由 lang.ts 的"地标对齐"负责，别跟它抢。
     */
    const returning = event.to ? peekFamilyScroll(event.to.pathname) : null;
    if (event.to && returning !== null) {
      pendingHash = event.to.hash;
      event.to.hash = '';
    } else if (leavingFamily && !isLanguageSwap(event.to?.pathname ?? '')) {
      rememberFamilyScroll(window.location.pathname);
    }
  } else {
    stopNocturneTransport();
    releaseIdentityPiano();
  }

  // 换页的瞬间就把主题写进即将替换上来的那份文档。不然 <html data-theme>
  // 会被新文档的属性覆盖掉，主题在换页时退回默认值。
  const theme = document.documentElement.dataset.theme;
  if (theme) event.newDocument.documentElement.dataset.theme = theme;

  // 语言切换：给即将上场的文档里的文字挂好“从右滑入”。
  // 只动文字，页面骨架不做任何动画。
  markIncomingLanguageText(event.newDocument);
});

// 换页真的发生了：放开闸门，让这一页的 boot 跑一次（见 boot() 开头的说明）。
document.addEventListener('astro:after-swap', () => {
  booted = false;
  /*
   * 回到这一页：**第一帧就直接落在离开时那个 scrollY 上**（instant）。
   * 放在这里是因为 router 换页时的 scrollTo(0, 0) 已经发生、而新页面的第一帧还没拍，
   * 所以不会出现"先渲染顶部再滚回来"那一下。
   */
  const restored = takeFamilyScroll(window.location.pathname);
  if (restored !== null) {
    restoreScroll(restored);
    pendingRestore = restored;
    if (pendingHash) {
      // 地址栏把 `#锚点` 接回去（路由那次已经被我们拿掉，不然它会滚一遍）
      try {
        history.replaceState(
          history.state,
          '',
          `${window.location.pathname}${window.location.search}${pendingHash}`,
        );
      } catch {
        /* 忽略非法状态 */
      }
      pendingHash = '';
    }
  }
});

document.addEventListener('astro:page-load', boot);

/*
 * 兜底：万一这个浏览器 / 版本根本不发 `astro:page-load`，初始加载也得能启动。
 * 只在"确实还没 boot 过"时才补一次 —— 这就是防止重复 boot 的那道闸门。
 */
const bootIfPageLoadMissed = (): void => {
  if (!booted) boot();
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootIfPageLoadMissed, { once: true });
} else {
  bootIfPageLoadMissed();
}
