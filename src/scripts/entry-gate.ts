import type { MusicManager } from './music-manager';
import { requestMotionAccess } from './identity-motion';
import { audioUnlock } from './audio-unlock';
import { primeIdentityPiano } from './identity-audio';
import { primeMiniLabPiano } from './minilab';
import { getMidiBridge } from './midi';
import { stopNocturneTransport } from './nocturne-transport';
import { visitSession } from './visit-session';

/**
 * 入场页的文案语言跟**当前这一页的页面语言**走，不看 `navigator.language`。
 *
 * `<html data-lang>` 是 `BaseLayout.astro` 按当前页面 `lang` 渲染出来的，也就是"这份文档
 * 到底是哪一版"。NEW VISIT 的入口语言已经由 URL 定死（`BaseHead.astro` 把 `/en...`
 * 归一化到 `/en/`、其余归到 `/`），所以这里再拿系统语言挑文案就会出现两边打架：
 * 系统是中文的人打开 `/en/`，会看到英文首页配中文入场页（本人报的问题）。
 *
 * 路由 / 文档语言是唯一真相：`data-lang === 'en'` 就英文，其它一律中文。
 */
function applyPageLanguage(gate: HTMLElement): void {
  const language = document.documentElement.dataset.lang === 'en' ? 'en' : 'zh';
  for (const element of gate.querySelectorAll<HTMLElement>('[data-entry-copy]')) {
    element.textContent = element.dataset[language] ?? element.dataset.en ?? '';
  }

  const label = language === 'zh' ? '进入网站' : 'Enter website';
  gate.setAttribute('aria-label', label);
  gate.querySelector<HTMLButtonElement>('[data-entry-button]')?.setAttribute('aria-label', label);
  gate.dataset.language = language;
  gate.classList.add('is-ready');
}

function setPageLocked(gate: HTMLElement, locked: boolean): void {
  document.body.classList.toggle('entry-locked', locked);
  for (const child of [...document.body.children]) {
    if (!(child instanceof HTMLElement) || child === gate || child.classList.contains('ambient')) continue;
    child.inert = locked;
  }
}

export function initEntryGate(music: MusicManager): boolean {
  const gate = document.querySelector<HTMLElement>('[data-entry-gate]');
  if (!gate) return false;

  /*
   * 拦不拦人，全部交给 visit-session.ts 判定 —— 这里不再自己看
   * `PerformanceNavigationTiming.type`。只看 type 的话，"在地址栏里重新输入同一个网址"
   * 会被当成刷新而沿用上一趟的"已进入"标记，入场页不再出现（本人报的 bug）；
   * 现在那条路靠"历史条目上的访问 id 已经被新导航顶掉"认出来，见 lib/visit.ts。
   *
   * 判据只有一条：**这一趟点过"进入"没有**。新的一趟访问在判定时就已经把那个标记清掉了
   * （见 visit-session.ts），所以"刷新之后又冒出入场页"不会发生；
   * 反过来，站内换页（ClientRouter 不换文档）时这一趟当然还是"已进入"，
   * 入场页不会跟着新的 HTML 又长出来 —— 这里**不能**拿"这次文档加载算不算新访问"来判，
   * 那个答案是给"要不要清标记"用的，整份文档里始终是同一个值。
   */
  const visit = visitSession();
  if (visit.hasEntered()) {
    gate.remove();
    document.body.classList.remove('entry-locked');
    return false;
  }

  applyPageLanguage(gate);
  setPageLocked(gate, true);
  const button = gate.querySelector<HTMLButtonElement>('[data-entry-button]');
  if (!button || gate.dataset.bound) return true;
  gate.dataset.bound = 'true';

  const enter = () => {
    if (visit.hasEntered()) return;
    visit.markEntered();

    /*
     * 同一时刻告诉服务端网关"这个 session 已经进过门"（它会给 HttpOnly cookie
     * `rest_note_entered=1`，之后子路由才不会被 302 回首页，见 server/）。
     *
     * **只发不等**：`void fetch(...)` 绝不 await —— 下面那串动作（`music.play()` /
     * `audioUnlock()`）必须留在这一次点击的**同步可信手势**里。一旦 await，iOS 就丢了
     * trusted user activation，音频解锁会失败（这是硬约束）。网络失败也无所谓：
     * 本地 sessionStorage 那套仍然管用，进站不受影响。
     */
    void fetch('/api/enter', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => {});

    /*
     * 进来之前先把夜曲的播放意图收掉。
     *
     * 在 About / 关于区那一页"地址栏重新输入网址"时，文档带着上一个位置加载，
     * About 场景是 active、transport 的 desired 也是 true；入场页收尾才把页面拉回
     * Home。如果先解锁音频（下面第 6 步），夜曲会赶在回位之前抢响第一个音。
     * 这里只是清掉那点播放意图（player 自己的 stop()：desired 归零 + suspend），
     * 不改调度、不改 AudioContext。
     */
    stopNocturneTransport();

    /*
     * About 让位还开着的话关掉：否则 Home 的背景音乐仍被 About 状态挡着，
     * 下面那次 play() 不出声。只有这一页真在关于区（`data-scene="active"`）时才需要，
     * 别的页面 `inAbout` 本来就是 false，不必动。
     */
    music.setAboutActive(false);

    // 用户点了"进入"：先解除闸门，后面那一下 play() 与解锁才不会被它挡住
    music.setAutoStart(true);

    // 这一下必须留在可信手势里：它才是自动播放策略认的那次启动
    const musicStart = music.play();

    /*
     * 同一个可信手势里解锁整套音频（见 audio-unlock.ts）：把"第一次手势就解锁"
     * 那条挂上（这一次就是那一次）、建/唤醒"关于"那架钢琴的 AudioContext
     * （iOS 只允许在手势里做，晚了会挂起）、再按各自意图恢复。
     * MP3 上面那一下已经起播，这里是幂等的。
     */
    audioUnlock({ preloadSamples: false });

    // 运动与方向权限也只能在用户手势里申请。这里是全站人人都要做的那一次点击，
    // 同意之后 About 页的摇晃彩蛋当趟就能用（iOS 上不在这里问，用户到了那一页
    // 还得先碰标签才可能拿到权限，实测就是"摇了没反应"）。
    requestMotionAccess();

    // 同一手势里先唤醒 MiniLab 音频上下文；采样等 MP3 起播后再下载。
    primeMiniLabPiano({ preload: false });

    // Keep the trusted gesture for creating/resuming both AudioContexts, but let
    // the entry MP3 obtain its first audible data before 30+ piano sample requests.
    // This is tied to actual playback settlement, not a guessed timeout.
    const preloadPianos = () => {
      primeIdentityPiano();
      primeMiniLabPiano();
    };
    void musicStart.then(preloadPianos, preloadPianos);

    /*
     * 紧接着在**同一个可信入场手势**里申请 Web MIDI 权限。
     *
     * 为什么必须放在这里：实体 MIDI 键盘在拿到 `MIDIAccess` 之前，网页根本收不到它的按键事件，
     * 所以"实体 MIDI 第一次按键"没法当触发手势；而入场页这一次点击是全站人人都会做的可信手势。
     * 此时上面那句 `primeMiniLabPiano()` 已唤醒音频上下文；采样在 MP3 起播后预热，
     * Lab 里的 prime() 仍作为重试兜底。
     *
     * 不 await：`requestMIDIAccess({ sysex:false })` 由浏览器处理权限，这里不等它 ——
     * 本次点击后面的收尾（遮罩动画、拉回顶部等）继续留在同一个同步任务里。
     */
    void getMidiBridge().start();

    gate.classList.add('is-leaving');
    button.disabled = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      setPageLocked(gate, false);
      gate.remove();
      /*
       * 进站就落在首页最顶上（#home）。
       *
       * 浏览器"继续上次的标签页"／恢复会话时，会把上一次的滚动位置（有时还有 URL 里的
       * #about / #blog）一起带回来，于是点完"进入"发现自己不在首页 —— 本人反馈：
       * 只有干净的内置浏览器正常，别的浏览器一点开始就直接停在关于区或博客区。
       * 这里把地址里那次遗留的锚点去掉、页面拉回顶部；用 instant 是因为
       * html 有 scroll-behavior: smooth，不然会当着他的面滑一大段。
       * 站内导航（客户端路由）不走这里，所以"返回关于"这类锚点跳转不受影响。
       *
       * 注意：`history.state` 要原样带过去 —— 那上面有这一趟访问的 id
       * （visit-session.ts 盖的章）和 Astro 的 index / 滚动位置。传 null 会把它们抹掉，
       * 于是"带着 #锚点进站 → 进站 → 刷新"会被当成新访问，入场页又冒出来。
       */
      if (location.hash && location.hash !== '#home') {
        history.replaceState(history.state, '', location.pathname + location.search);
      }
      /*
       * 拉回顶部要补两次：Safari 经常在遮罩收起之后才把上次的滚动位置恢复回来，
       * 只滚一次会被它盖掉。第二、三次都跳过有 #锚点 的情况 —— 那是用户自己点了
       * 站内跳转（例如"返回关于"），不能抢。
       */
      const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      toTop();
      requestAnimationFrame(toTop);
      window.setTimeout(() => {
        if (!location.hash) toTop();
      }, 260);
      const main = document.querySelector<HTMLElement>('#main');
      if (main) {
        main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
      }
    };
    gate.addEventListener('animationend', cleanup, { once: true });
    window.setTimeout(cleanup, reduced ? 0 : 820);
  };

  button.addEventListener('click', enter, { once: true });
  window.requestAnimationFrame(() => button.focus({ preventScroll: true }));
  return true;
}
