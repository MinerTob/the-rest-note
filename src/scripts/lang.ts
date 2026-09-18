import { defaultLang, languages, type Lang } from '@/i18n/ui';
import { readString, writeString } from './storage';
import { navigate } from 'astro:transitions/client';

const KEY = 'space.lang';
const TRANSITION_KEY = 'space.lang-transition';
const SCROLL_KEY = 'space.lang-scroll';

/* 时长与 global.css 里 .lang-slide-out / .lang-slide-in 的 var(--dur-2) 对齐。 */
const SLIDE_MS = 240;
const OUT_CLASS = 'lang-slide-out';
const IN_CLASS = 'lang-slide-in';

/* 这些节点不参与文字动画：脚本/样式没有视觉，背景层和入场页保持静止。 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TITLE',
  'TEXTAREA',
  'OPTION',
  'CANVAS',
  'IFRAME',
]);
const SKIP_ZONES = '.ambient, .entry-gate, svg';

let switching = false;
let scrollRestoreReady = false;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * 找出页面上真正承载文字的元素。
 * 一个元素被收进来后就不再收它的后代，避免同一段文字被父子两层各平移一次。
 */
function collectTextElements(root: Document): HTMLElement[] {
  const picked = new Set<HTMLElement>();
  const elements: HTMLElement[] = [];
  const walker = root.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;

    const element = node.parentElement;
    if (!element || SKIP_TAGS.has(element.tagName) || element.closest(SKIP_ZONES)) continue;
    if (picked.has(element)) continue;

    let coveredByAncestor = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (picked.has(parent)) {
        coveredByAncestor = true;
        break;
      }
    }
    if (coveredByAncestor) continue;

    picked.add(element);
    elements.push(element);
  }

  return elements;
}

/** 记住元素原本的透明度，动画结束后回到这个值（平时都是 1，只有少数弱化文字不是）。 */
function rememberOpacity(element: HTMLElement, opacity: string): void {
  if (opacity !== '1') element.style.setProperty('--lang-opacity', opacity);
}

function forgetOpacity(element: HTMLElement): void {
  element.style.removeProperty('--lang-opacity');
}

/** 去掉页面入场动画（.rise）：切语言时只让文字动，页面骨架不跟着起伏。 */
function dropEntranceAnimation(element: HTMLElement): void {
  element.classList.remove('rise', 'rise--2', 'rise--3', 'rise--4');
}

function stripEntranceAnimation(root: Document): void {
  root
    .querySelectorAll<HTMLElement>('.rise, .rise--2, .rise--3, .rise--4')
    .forEach(dropEntranceAnimation);
}

function playOut(elements: HTMLElement[]): void {
  // 先一次性读完成透明度，再统一改类名，避免边读边写触发反复重算样式。
  const opacities = elements.map((element) => window.getComputedStyle(element).opacity);
  elements.forEach((element, index) => {
    dropEntranceAnimation(element);
    rememberOpacity(element, opacities[index]);
    element.classList.add(OUT_CLASS);
  });
}

function playIn(elements: HTMLElement[]): void {
  elements.forEach((element) => {
    dropEntranceAnimation(element);
    element.classList.remove(OUT_CLASS);
    rememberOpacity(element, window.getComputedStyle(element).opacity);
    element.classList.add(IN_CLASS);
  });

  window.setTimeout(() => {
    elements.forEach((element) => {
      element.classList.remove(IN_CLASS);
      forgetOpacity(element);
    });
  }, SLIDE_MS + 80);
}

function takePendingTransition(): boolean {
  try {
    if (window.sessionStorage.getItem(TRANSITION_KEY) !== '1') return false;
    window.sessionStorage.removeItem(TRANSITION_KEY);
    return true;
  } catch {
    return false;
  }
}

function clearPendingTransition(): void {
  try {
    window.sessionStorage.removeItem(TRANSITION_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 换语言前记下当前位置：换页之后要放回去。 */
function rememberScrollPosition(): void {
  try {
    window.sessionStorage.setItem(
      SCROLL_KEY,
      JSON.stringify({ y: Math.round(window.scrollY), hash: window.location.hash }),
    );
  } catch {
    /* 隐私模式：跳过，退回浏览器默认行为 */
  }
}

/**
 * 换语言之后把滚动位置放回去（本人要求：切语言不要弹回页面顶部）。
 *
 * ClientRouter 每次换页都会 `scrollTo(0, 0)`（见 astro/dist/transitions/router.js 的
 * moveToLocation），所以这里挂在 `astro:after-swap` 上 —— 它就在那次滚动之后、
 * View Transition 拍"新页面"快照之前跑，位置能稳稳接上，动画也不会跳。
 */
function restoreScrollPosition(): void {
  let saved: { y?: number; hash?: string } | undefined;
  try {
    const raw = window.sessionStorage.getItem(SCROLL_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(SCROLL_KEY);
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (!saved || typeof saved.y !== 'number') return;

  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: Math.min(saved.y, max), left: 0, behavior: 'instant' });

  // 顺手把锚点接回去：router 只按 to.href 写地址，`#about` 这种锚点会被丢掉。
  if (saved.hash && !window.location.hash) {
    try {
      if (document.querySelector(saved.hash)) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${saved.hash}`,
        );
      }
    } catch {
      /* 忽略非法选择器 */
    }
  }
}

export function getDocumentLang(): Lang {
  const value = document.documentElement.dataset.lang;
  return value && value in languages ? (value as Lang) : defaultLang;
}

export function getPreferredLang(): Lang | null {
  const stored = readString(KEY, '');
  return stored && stored in languages ? (stored as Lang) : null;
}

/** 把界面文案（导航、按钮、状态）切到指定语言；正文内容不动。 */
export function swapChrome(lang: Lang): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const text = el.getAttribute(`data-${lang}`);
    if (text !== null) el.textContent = text;
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const text = el.getAttribute(`data-aria-${lang}`);
    if (text !== null) el.setAttribute('aria-label', text);
  });
}

/** 两种语言共用同一个地址时（比如 404），不换页，只把文案滑出、换掉、再滑入。 */
async function switchChromeInPlace(target: Lang): Promise<void> {
  const elements = prefersReducedMotion() ? [] : collectTextElements(document);
  if (!elements.length) {
    swapChrome(target);
    return;
  }

  playOut(elements);
  await delay(SLIDE_MS);
  swapChrome(target);

  // swapChrome 会重写其中一些元素的 textContent，重新收一份再滑入。
  document.querySelectorAll<HTMLElement>(`.${OUT_CLASS}`).forEach((element) => {
    element.classList.remove(OUT_CLASS);
  });
  playIn(collectTextElements(document));
}

/**
 * 换页前一瞬，给即将插入的新文档里的文字挂上“从右滑入”。
 * 动画从新页面第一帧就开始，不会先亮着静止文字再跳一下。
 */
export function markIncomingLanguageText(doc: Document): void {
  if (!takePendingTransition() || prefersReducedMotion()) return;
  stripEntranceAnimation(doc);
  collectTextElements(doc).forEach((element) => element.classList.add(IN_CLASS));
}

/** 新页面接管之后收尾：清掉标记，并在动画播完后摘掉类名。 */
function playIncomingTransition(): void {
  clearPendingTransition();

  if (!document.querySelector(`.${IN_CLASS}`)) return;
  window.setTimeout(() => {
    document.querySelectorAll<HTMLElement>(`.${IN_CLASS}`).forEach((element) => {
      element.classList.remove(IN_CLASS);
    });
  }, SLIDE_MS + 120);
}

export function initLangSwitch(): void {
  if (!scrollRestoreReady) {
    scrollRestoreReady = true;
    document.addEventListener('astro:after-swap', restoreScrollPosition);
  }
  playIncomingTransition();
  const pageLang = getDocumentLang();
  const preferred = getPreferredLang();

  // 进来时：如果之前选过别的语言，界面文案跟随偏好（内容语言仍然由 URL 决定）
  if (preferred && preferred !== pageLang) {
    swapChrome(preferred);
  }

  document.querySelectorAll<HTMLAnchorElement>('[data-lang-switch]').forEach((link) => {
    if (link.dataset.ready === '1') return;
    link.dataset.ready = '1';

    link.addEventListener('click', async (event) => {
      const target = link.dataset.langSwitch as Lang | undefined;
      if (!target || !(target in languages)) return;

      // 保留浏览器原生的新标签页/新窗口行为。
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      if (switching) return;
      switching = true;

      writeString(KEY, target);
      const href = link.href;

      try {
        if (new URL(href).pathname === window.location.pathname) {
          await switchChromeInPlace(target);
          return;
        }

        const animate = !prefersReducedMotion();
        const elements = animate ? collectTextElements(document) : [];
        if (elements.length) {
          playOut(elements);
          await delay(SLIDE_MS);
        }

        if (animate) {
          try {
            window.sessionStorage.setItem(TRANSITION_KEY, '1');
          } catch {
            /* 隐私模式下仍然保留滑出和客户端导航，只跳过滑入标记。 */
          }
        }

        // 换语言 = 换页，但人还站在同一个位置：把滚动位置交给下一页。
        rememberScrollPosition();
        await navigate(href);
      } finally {
        // 导航成功时旧文字已随页面移除；失败时让它们重新显形。
        document.querySelectorAll<HTMLElement>(`.${OUT_CLASS}`).forEach((element) => {
          element.classList.remove(OUT_CLASS);
          forgetOpacity(element);
        });
        clearPendingTransition();
        switching = false;
      }
    });
  });
}
