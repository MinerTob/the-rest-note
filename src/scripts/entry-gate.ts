import type { MusicManager } from './music-manager';
import { requestMotionAccess } from './identity-motion';
import { primeIdentityPiano } from './identity-audio';
import { primeMiniLabPiano } from './minilab';
import { visitSession } from './visit-session';

function applySystemLanguage(gate: HTMLElement): void {
  const language = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
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

  applySystemLanguage(gate);
  setPageLocked(gate, true);
  const button = gate.querySelector<HTMLButtonElement>('[data-entry-button]');
  if (!button || gate.dataset.bound) return true;
  gate.dataset.bound = 'true';

  const enter = () => {
    if (visit.hasEntered()) return;
    visit.markEntered();

    // This call must stay directly inside the trusted click handler: it is what
    // unlocks audible playback under browser autoplay policies.
    void music.play();

    // 运动与方向权限也只能在用户手势里申请。这里是全站人人都要做的那一次点击，
    // 同意之后 About 页的摇晃彩蛋当趟就能用（iOS 上不在这里问，用户到了那一页
    // 还得先碰标签才可能拿到权限，实测就是"摇了没反应"）。
    requestMotionAccess();

    // 同一个手势里顺手把"关于"那架钢琴的 AudioContext 建起来。
    // iOS 只允许在用户手势里创建/唤醒 AudioContext：不在这里做，用户滑到关于区时
    // 那次创建是"手势之外"的，上下文会挂起，夜曲不会自动开始（本人 iPhone 实测）。
    // 只在真正会用到它的页面（首页关于区 / About / 自我介绍）预载，别的页面不动。
    primeIdentityPiano();

    // 同一手势里也把 MiniLab 那架琴预热：它的采样原来要等你第一次按琴键才开始下载，
    // 于是第一声只能拿合成器顶上（本人反馈"第一声不是真实音源"）。现在走到实验室前就绪。
    primeMiniLabPiano();

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
