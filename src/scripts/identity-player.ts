import { navigate } from 'astro:transitions/client';
import { createIdentityPhysics, type IdentityLayout } from './identity-physics';
import { attachIdentityMotion } from './identity-motion';
import { identityRevealPlan, type MidiNote } from "@/lib/identity-midi";
import { takeLanguageSwap } from './lang';
import { visitSession } from './visit-session';
import { nocturneTransport } from './nocturne-transport';

const FIRST = 21,
  LEAD = 2.4;
const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
const keyPositions = (() => {
  let whites = 0;
  return Array.from({ length: 88 }, (_, i) => {
    const midi = FIRST + i;
    const dark = black(midi);
    const x = dark ? whites - 0.31 : whites++;
    return { midi, dark, x, width: dark ? 0.62 : 1 };
  });
})();
let disposeCurrent: (() => void) | undefined;
let setActiveCurrent: ((active: boolean) => void) | undefined;
/** 每次 initIdentity 递增：被换掉的旧实例不许再动新实例（见下面的 dispose / setActive） */
let identityGeneration = 0;

/** 落点格式版本：v1 存归一化比例，v2 存文档像素，v3 连地板位置一起存 —— 换名字，免得把旧值当新格式读。 */
const LAYOUT_VERSION = 'v3';

/**
 * 落点 cookie 的名字里带上"这一趟访问"的 id（visit-session.ts）：
 * 新的一趟访问 = 新 cookie = 标签会被音乐重新抛一遍；同一趟（刷新 / 前进后退）
 * 沿用同一个名字，落点才不会丢。
 *
 * 判定规矩全在 `src/lib/visit.ts`（含"地址栏里重新输入同一个网址"那种：
 * 只看 navigation type 会漏掉，见 §10）。这里**只读**访问 id，不碰夜曲时间线，
 * 也不碰音频运行时 —— 三套状态各管各的（见 visit-session.ts 的说明）。
 */
const layoutCookie = `rest-note-identity-${LAYOUT_VERSION}-${visitSession().token}`;
function readLayout(): IdentityLayout | undefined {
  try {
    const value = document.cookie.split('; ').find((part) => part.startsWith(`${layoutCookie}=`))?.split('=').slice(1).join('=');
    const parsed: unknown = value ? JSON.parse(decodeURIComponent(value)) : undefined;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as { floor?: unknown; items?: unknown };
    if (typeof candidate.floor !== 'number' || !Array.isArray(candidate.items)) return undefined;
    return candidate as IdentityLayout;
  } catch { return undefined; }
}
function writeLayout(layout: IdentityLayout): void {
  try { document.cookie = `${layoutCookie}=${encodeURIComponent(JSON.stringify(layout))}; Path=/; SameSite=Lax`; } catch { /* Cookie storage is optional. */ }
}
function clearLayout(): void {
  try { document.cookie = `${layoutCookie}=; Path=/; Max-Age=0; SameSite=Lax`; } catch { /* Cookie storage is optional. */ }
}

export function disposeIdentity(): void {
  disposeCurrent?.();
  disposeCurrent = undefined;
}
export function setIdentityActive(active: boolean): void {
  setActiveCurrent?.(active);
}
export function initIdentity(): void {
  const found = document.querySelector<HTMLElement>("[data-identity]");
  if (!found || found.dataset.bound) return;
  const root: HTMLElement = found;
  disposeIdentity();
  const generation = (identityGeneration += 1);
  const zh = root.dataset.lang === "zh";
  const canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
  const ctx = canvas.getContext("2d");
  // 拿不到 2d 上下文就先别把 data-bound 立起来 —— 那是个"已初始化"的记号，
  // 立了之后这次没跑完，后面每次 initIdentity() 都会被它挡在门外，整块区域就
  // 一直死着，只能刷新页面（本人报过"必须手动刷新才开始加载"）。留个空门，
  // 滚回这一块时还能再试一次。
  if (!ctx) return;
  root.dataset.bound = "true";
  const play = root.querySelector<HTMLButtonElement>("[data-identity-play]")!;
  const restart = root.querySelector<HTMLButtonElement>(
    "[data-identity-restart]",
  )!;
  const progress = root.querySelector<HTMLInputElement>("[data-identity-progress]")!;
  const status = root.querySelector<HTMLElement>("[data-identity-status]")!;
  const clock = root.querySelector<HTMLOutputElement>("[data-identity-time]")!;
  const volume = root.querySelector<HTMLInputElement>(
    "[data-identity-volume]",
  )!;
  const tags = [...root.querySelectorAll<HTMLElement>("[data-identity-tag]")];
  /*
   * 演奏本身交给全站共用的那台播放器（nocturne-transport.ts）：
   * 这一页只 attach UI —— 画瀑布流、按钮、滑杆、标签的物理效果。
   * 从自我介绍页返回（或反过来）时，音频时钟、排程、演奏位置都没停过，
   * 所以这里不需要"接手/交棒"，也不需要淡入。
   */
  const transport = nocturneTransport();
  transport.attachVolume(Number(volume.value));
  const abort = new AbortController(),
    signal = abort.signal;
  let plan: ReturnType<typeof identityRevealPlan> | undefined;
  let disposed = false,
    seeking = false,
    wantsPlayback = true,
    frame = 0,
    rendering = false,
    sceneActive = true,
    needsAnimation = true;
  let width = 720,
    height = 300,
    tint = "#5588bb",
    ink = "#243244",
    darkInk = "#bcd9ef";
  const physics = createIdentityPhysics(root, tags, writeLayout, (el) => {
    const href = el.dataset.identityLink;
    if (!href) return;
    // 走 ClientRouter 的 navigate()，换页跟站内其它链接一样是平滑过渡；
    // 万一 router 还没就绪，退回一次普通跳转。
    void navigate(href).catch(() => window.location.assign(href));
  });
  // 手机端独有的彩蛋：摇晃手机 → 这些标签跟着一块晃。
  // 桌面、开了 reduced-motion、或传感器不可用时，这个函数直接返回空实现。
  const detachMotion = attachIdentityMotion(root, (x, y) => physics.shove(x, y));
  // 落点记忆先摆出来当兜底：万一声音还没解锁，也不会是一片空地。
  // 换语言时地板可能挪了位置（英文内容更高），restore() 会按地板差值整体平移。
  physics.restore(readLayout());
  // 从别的页面走进来（或第一次来）→ 方块再落一次，每次都能玩；
  // 切语言只是"同一页换种说法" → 已经在场上的原地不动（记成已落地，音乐不会再抛它们），
  // 还没上场的继续按乐谱排队 —— 歌走到哪一颗音，才放出哪一个标签。
  needsAnimation = true;
  if (takeLanguageSwap()) physics.markPlaced();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const time = () => transport.position();
  const duration = () => transport.duration();
  const notes = (): readonly MidiNote[] => transport.getNotes();
  /**
   * 页面状态跟着播放器的快照走（不再自己维护一份 playing / loading）。
   * waiting / failed 的文案与原来一致：采样还在路上或还没拿到用户手势时，
   * 安静地把话说清楚，等 piano:context / piano:state 自己接上。
   */
  const renderStatus = (state: string, ready: boolean) => {
    const playing = state === 'playing';
    play.setAttribute('aria-label', playing ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play'));
    play.setAttribute('aria-pressed', String(playing));
    root.dataset.state = playing ? 'playing' : state === 'waiting' ? 'waiting' : 'paused';
    if (!ready && state === 'failed') {
      status.textContent = zh ? '乐谱读取失败，请刷新重试。' : 'The score could not load. Please reload.';
      return;
    }
    if (state === 'waiting') {
      status.textContent = zh
        ? '点击或按键，即可接入钢琴演奏。'
        : 'Click or press a key to join the piano performance.';
      return;
    }
    if (state === 'failed') {
      status.textContent = zh
        ? '钢琴采样未能完整加载，请刷新后重试。'
        : 'Piano samples could not load. Please reload and try again.';
      return;
    }
    if (state === 'loading') {
      status.textContent = zh ? '钢琴采样加载中…' : 'Loading the piano samples…';
      return;
    }
    status.textContent = zh
      ? '肖邦 · 降 E 大调夜曲 Op.9 No.2 · 循环演奏'
      : 'Chopin · Nocturne in E-flat major, Op.9 No.2 · Looping';
  };
  /** 乐谱就绪后才有瀑布流和标签的抛出计划 */
  const adoptScore = () => {
    const score = transport.getScore();
    if (!score || plan) return;
    plan = identityRevealPlan(score, tags.length);
    root.dataset.ready = 'true';
    root.dataset.deadline = String(plan.deadline);
    root.dataset.deadlineTick = String(plan.endTick);
    root.dataset.duration = String(duration());
    root.dataset.keyCount = '88';
    play.disabled = false;
    restart.disabled = false;
    progress.disabled = false;
    draw();
  };
  function colors() {
    const s = getComputedStyle(root);
    tint = s.getPropertyValue("--accent-2").trim();
    ink = s.getPropertyValue("--ink-2").trim();
    darkInk = s.getPropertyValue("--lcd-ink").trim();
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    width = r.width;
    height = r.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function draw() {
    ctx!.clearRect(0, 0, width, height);
    const t = time(),
      hit = height - 66,
      unit = width / 52;
    const active = new Set<number>();
    if (transport.isReady()) {
      for (const n of notes()) {
        if (n.start <= t && n.release > t) active.add(n.midi);
        if (reduced.matches || n.release < t || n.start > t + LEAD) continue;
        const k = keyPositions[n.midi - FIRST];
        if (!k) continue;
        const bottom = hit - ((n.start - t) * hit) / LEAD,
          top = hit - ((n.release - t) * hit) / LEAD;
        const y = Math.max(0, top),
          end = Math.min(hit, bottom);
        if (end <= y) continue;
        ctx!.globalAlpha = n.track === 0 ? 0.72 : 0.33;
        ctx!.fillStyle = tint;
        ctx!.beginPath();
        ctx!.roundRect(
          k.x * unit + 1,
          y,
          Math.max(2, k.width * unit - 2),
          end - y,
          3,
        );
        ctx!.fill();
      }
    }
    ctx!.globalAlpha = 1;
    for (const k of [
      ...keyPositions.filter((k) => !k.dark),
      ...keyPositions.filter((k) => k.dark),
    ]) {
      ctx!.fillStyle = active.has(k.midi)
        ? tint
        : k.dark
          ? "#27303b"
          : "#edf1f2";
      ctx!.beginPath();
      ctx!.roundRect(
        k.x * unit + 0.5,
        hit,
        k.width * unit - 1,
        k.dark ? 41 : 65,
        [0, 0, 2, 2],
      );
      ctx!.fill();
      if (!k.dark && (k.midi % 12 === 0 || k.midi === 21)) {
        ctx!.fillStyle = active.has(k.midi) ? darkInk : ink;
        ctx!.font = "8px monospace";
        ctx!.fillText(
          k.midi === 21 ? "A0" : `C${Math.floor(k.midi / 12) - 1}`,
          k.x * unit + 2,
          height - 6,
        );
      }
    }
    const total = transport.isReady() ? duration() : 0;
    const ratio = total > 0 ? t / total : 0;
    const displayRatio = seeking ? Number(progress.value) / 1000 : ratio;
    const format = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
    clock.value = `${format(t)} / ${format(total)}`;
    if (!seeking) progress.value = String(Math.round(ratio * 1000));
    progress.style.setProperty('--progress', `${displayRatio * 100}%`);
  }
  function reveal(index: number, n: MidiNote) {
    const c = canvas.getBoundingClientRect(), stage = root.getBoundingClientRect();
    const key = keyPositions[n.midi - FIRST];
    physics.reveal(index, { x: Math.max(stage.left + 30, Math.min(stage.right - 30, c.left + (key.x + key.width / 2) * width / 52)), y: c.top + scrollY + height - 66 });
  }
  /** 标签抛出计划：跟着播放器的位置走（原来放在 tick() 里，逻辑照旧） */
  function revealOnSchedule() {
    if (!plan || !needsAnimation) return;
    const now = time();
    if (transport.snapshot().loops === 0)
      plan.triggers.forEach((n, i) => {
        if (now >= n.start) reveal(i, n);
      });
    if (transport.snapshot().loops > 0 || now >= plan.deadline) {
      plan.triggers.forEach((n, i) => reveal(i, n));
      needsAnimation = false;
      root.dataset.settled = "true";
    }
  }
  /** 只在真的在播的时候挂动画帧；位置从播放器读，动画帧不负责出声 */
  function render() {
    if (disposed) {
      frame = 0;
      rendering = false;
      return;
    }
    draw();
    if (!seeking) revealOnSchedule();
    if (transport.isPlaying()) frame = requestAnimationFrame(render);
    else {
      frame = 0;
      rendering = false;
    }
  }
  function startRendering() {
    if (rendering || disposed) return;
    rendering = true;
    frame = requestAnimationFrame(render);
  }
  /** 场景离开 / 按暂停：让播放器停，UI 立刻画最后一帧 */
  function pause(options: { byUser?: boolean } = {}) {
    transport.pause(options);
    draw();
  }
  function start(options: { byUser?: boolean } = {}) {
    if (!sceneActive || !wantsPlayback) return;
    transport.start(options);
  }
  /*
   * 订阅播放器的快照：状态、位置、循环数都从那里来。
   * 从自我介绍页回来时声音本来就在响 —— 这里只是把按钮、文字、动画接上，
   * 第一帧就是 playing，没有淡入、没有从头排一遍。
   */
  const unsubscribe = transport.subscribe((snapshot) => {
    if (disposed) return;
    adoptScore();
    renderStatus(snapshot.state, snapshot.ready);
    root.dataset.loops = String(snapshot.loops);
    if (snapshot.ready) {
      play.disabled = false;
      restart.disabled = false;
      progress.disabled = false;
    }
    if (snapshot.state === "playing") startRendering();
    draw();
  });
  play.addEventListener(
    "click",
    () => {
      if (transport.isPlaying()) {
        wantsPlayback = false;
        // 用户自己按的暂停：记下来，自动恢复不许再把它接回去（见 nocturne-transport.ts）
        pause({ byUser: true });
      } else {
        wantsPlayback = true;
        // 用户自己按的播放：清掉暂停记号，这次以他为准
        start({ byUser: true });
      }
    },
    { signal },
  );
  const activate = (event: Event) => {
    /*
     * 入场页挡着的时候一个字都不许起：Gate 自己收到的 pointerdown / keydown 会冒泡到
     * document，这些旧 activate 会赶在"进入"按钮的 click 之前把夜曲启动，而那次手势
     * 本身就是可信手势 —— 于是页面还在 About 位置就先漏一个音符。
     * `body.entry-locked` 是主判据（pointerdown / keydown / wheel 统一挡住）；
     * 顺带再挡一下落在 Gate 里的事件。Gate cleanup 解除锁定后这里自然放行。
     */
    if (
      document.body.classList.contains('entry-locked') ||
      (event.target as Element | null)?.closest('[data-entry-gate]')
    )
      return;
    if (
      (event.target as Element | null)?.closest(
        "[data-identity-play], [data-identity-restart], [data-identity-progress], [data-identity-volume]",
      )
    )
      return;
    if (wantsPlayback && !transport.isPlaying()) start({ byUser: true });
  };
  document.addEventListener("pointerdown", activate, { signal });
  document.addEventListener("keydown", activate, { signal });
  document.addEventListener("wheel", activate, { signal, passive: true });
  restart.addEventListener(
    "click",
    () => {
      wantsPlayback = true;
      needsAnimation = true;
      clearLayout();
      delete root.dataset.settled;
      physics.reset();
      transport.restart();
    },
    { signal },
  );
  const finishSeek = () => {
    seeking = false;
    draw();
  };
  progress.addEventListener("pointerdown", () => { seeking = true; }, {
    signal,
  });
  progress.addEventListener("keydown", () => { seeking = true; }, {
    signal,
  });
  progress.addEventListener(
    "input",
    () => {
      if (!transport.isReady()) return;
      seeking = true;
      // 拖到哪就跳到哪：播放器自己掐掉排进去的音、重新锚定时钟，不用停一下再起
      transport.seek((Number(progress.value) / 1000) * duration());
      draw();
    },
    { signal },
  );
  progress.addEventListener("change", finishSeek, { signal });
  progress.addEventListener("pointerup", finishSeek, { signal });
  progress.addEventListener("pointercancel", finishSeek, { signal });
  progress.addEventListener("blur", finishSeek, { signal });
  volume.addEventListener(
    "input",
    () => {
      // 手动拖音量时先停掉"换页滑行"，否则两个值会互相打架（播放器内部处理）
      transport.setVolume(Number(volume.value));
    },
    { signal },
  );
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const themeObserver = new MutationObserver(() => {
    colors();
    draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  colors();
  resize();
  // 乐谱由播放器读（读一次全站共用，失败自己退避重试）；这里只要在它好了以后接上
  void transport.load();
  disposeCurrent = () => {
    // 已经被新实例顶掉的旧生命周期不许再动手（换页 / 重复 init 时的保险）
    if (generation !== identityGeneration) return;
    disposed = true;
    /*
     * 只拆 UI：播放器、音频时钟、排程、演奏位置都不动 —— 换页时声音一直在走。
     * 真的离开"关于"这一族页面时，app.ts 的 before-swap 会调 stopNocturneTransport()
     * 与 releaseIdentityPiano() 把它收掉。
     */
    unsubscribe();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    rendering = false;
    // 离开这一页之前把"此刻"的落点写下来（不是上一次静止时的旧快照）：
    // 换页时标签多半还躺着没睡，旧快照会缺几条，下次回到这一页就会整排重抛。
    writeLayout(physics.snapshot());
    abort.abort();
    detachMotion();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    physics.dispose();
    // 不 dispose 钢琴、也不停播放器：它们是三个"关于"页面共用的（见 nocturne-transport.ts）
    delete root.dataset.bound;
    setActiveCurrent = undefined;
  };
  setActiveCurrent = (active) => {
    if (generation !== identityGeneration) return;
    sceneActive = active;
    if (active && wantsPlayback) start();
    if (!active) pause();
  };
}
