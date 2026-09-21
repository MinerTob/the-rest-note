import { IDENTITY_INTRO_VOLUME } from '@/lib/identity';
import { nocturneTransport } from './nocturne-transport';

/**
 * 自我介绍页（/about/intro/）：夜曲在这里只是**接着放**，不重新起一套播放器。
 *
 * 演奏（score / cursor / 音频时钟 / 排程 / 位置）全在 `nocturne-transport.ts` 那一台
 * 共用的播放器里，ClientRouter 换页时它一秒都不停。这一页只 attach UI：
 * 把当前秒数、播放状态写到 `[data-nocturne-*]` 上，并在需要时把播放器叫起来。
 *
 * 页面钩子：`[data-nocturne]`（IntroPage 的根节点）。没有这个钩子就不接。
 * 这一页的主题背景音乐由 app.ts 的 `setAboutActive(true)` 让位（见 §5.5）。
 */

let disposeCurrent: (() => void) | undefined;

export function disposeNocturne(): void {
  disposeCurrent?.();
  disposeCurrent = undefined;
}

export function initNocturne(): void {
  const found = document.querySelector<HTMLElement>('[data-nocturne]');
  if (!found || found.dataset.bound) return;
  const root = found;
  disposeNocturne();
  root.dataset.bound = 'true';

  const abort = new AbortController();
  const signal = abort.signal;
  const transport = nocturneTransport();
  let disposed = false;
  // 这一页的目标音量（比演奏模式克制），从**当前**音量滑过去 —— 不归零、不重新淡入
  transport.attachVolume(IDENTITY_INTRO_VOLUME);
  /*
   * 订阅快照：当前秒数 / 状态 / 乐谱就绪都写在页面的 data-* 上
   * （和 identity-player 的 data-* 读数同一个习惯，排查"有没有接着上一页放"就先看它）。
   */
  const unsubscribe = transport.subscribe((snapshot) => {
    if (disposed) return;
    root.dataset.nocturneAt = snapshot.position.toFixed(1);
    root.dataset.nocturneState =
      snapshot.state === 'playing' ? 'playing' : snapshot.state === 'waiting' ? 'waiting' : 'paused';
    if (snapshot.ready) root.dataset.nocturneReady = 'true';
  });
  // 从 About 那一页走过来时它本来就在响：start() 里已经"想播"就什么都不做
  transport.start();

  // 这一页没有播放控件：滑动/点击/按键就是"要它继续响"的意思
  const activate = (event: Event) => {
    /*
     * 入场页挡着的时候不许起播：Gate 上的 pointerdown / keydown 会冒泡到 document，
     * 这些 activate 会赶在"进入"按钮的 click 之前把夜曲启动，露出一个音符。
     * `body.entry-locked` 是主判据；顺带挡一下落在 Gate 里的事件。
     * Gate cleanup 解除锁定之后，"点击或按键可恢复"照旧。
     */
    if (
      document.body.classList.contains('entry-locked') ||
      (event.target as Element | null)?.closest('[data-entry-gate]')
    )
      return;
    if (!transport.isPlaying()) transport.start();
  };
  document.addEventListener('pointerdown', activate, { signal });
  document.addEventListener('keydown', activate, { signal });

  disposeCurrent = () => {
    disposed = true;
    // 只拆 UI：演奏交给那台共用的播放器，换页期间一秒都不断
    unsubscribe();
    abort.abort();
    // 不 dispose 钢琴、也不停播放器：离开这一族时 app.ts 会收（见 nocturne-transport.ts）
    delete root.dataset.bound;
  };
}
