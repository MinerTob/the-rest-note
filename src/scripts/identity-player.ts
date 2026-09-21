import { navigate } from 'astro:transitions/client';
import { createIdentityPhysics, type IdentityLayout } from './identity-physics';
import { attachIdentityMotion } from './identity-motion';
import { createNocturnePlayback } from './identity-playback';
import {
  HANDOVER_AHEAD,
  handOverIdentityPiano,
  identityPiano,
  rampIdentityVolume,
  takeIdentityHandover,
} from './identity-audio';
import {
  parseMidi,
  identityRevealPlan,
  type MidiScore,
  type MidiNote,
} from "@/lib/identity-midi";
import { IDENTITY_TRACK_SRC } from "@/lib/identity";
import { getGlobal } from "./global";
import { takeLanguageSwap } from './lang';

const SOURCE = IDENTITY_TRACK_SRC;
const TIMELINE = "identity:nocturne";
/**
 * 这一页只管"看得见的那一半"：瀑布流、标签物理、播放控件、进度条、主题曲让位。
 *
 * 出声的那一半（手势解锁 / 位置与进度记忆 / 起跑余量 / 暂停恢复）全在
 * `identity-playback.ts` —— 三条被踩过的坑写在那个文件头（起跑余量放 origin、
 * 只排还没开始的音且 elapsed=0、位置只走 live-timeline）。改这里之前先读它。
 */
const FIRST = 21,
  LAST = 108,
  /** 瀑布流画多长的一段（秒）。音频的前瞻不在这一页，见 identity-playback.ts 的 LOOKAHEAD */
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

const VISIT_KEY = 'rest-note.identity-visit';
/** 落点格式版本：v1 存归一化比例，v2 存文档像素，v3 连地板位置一起存 —— 换名字，免得把旧值当新格式读。 */
const LAYOUT_VERSION = 'v3';

/**
 * 一次"进入网站"（地址栏输入 / 外链 / 书签 = navigation type `navigate`）算一次新的访问：
 * 先把 visit id 清掉，下面 layoutCookieName() 就会生成一个新的，
 * 于是落点 cookie 是新的、标签会被音乐重新抛一遍。
 *
 * 为什么需要：浏览器"继续上次的标签页"时会把 sessionStorage 一起恢复，
 * 同一个 visit id 会让上一趟的落点沿用下来 —— 本人反馈的"每一次进入新 cookies 的动作
 * 都不见了"就是这个。刷新 / 前进后退不算新访问（沿用同一个 visit），
 * 和入场页 rest-note.entry-passed 是同一条规矩（见 entry-gate.ts）。
 */
try {
  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if ((navigation?.type ?? 'navigate') === 'navigate') sessionStorage.removeItem(VISIT_KEY);
} catch {
  /* 隐私模式下读不到就当作没有 —— 下面会退回随机 visit id */
}

function layoutCookieName(): string {
  let visit = '';
  try {
    visit = sessionStorage.getItem(VISIT_KEY) ?? '';
    if (!visit) {
      visit = crypto.randomUUID().replace(/-/g, '');
      sessionStorage.setItem(VISIT_KEY, visit);
    }
  } catch {
    visit = Math.random().toString(36).slice(2);
  }
  return `rest-note-identity-${LAYOUT_VERSION}-${visit}`;
}
const layoutCookie = layoutCookieName();
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
  // 这架琴是 About / 自我介绍 / 首页关于区共用的：从别处接手时，声音已经在响了
  const piano = identityPiano();
  let cancelVolumeRamp: () => void = () => {};
  /*
   * 上一页那架琴还在跑（三个"关于"页面共用同一个实例）：音量从**当前**值滑过来，
   * 别先归零再淡入 —— 那一下归零就是"换页时听起来断了一截"的来源。
   */
  if (piano.isRunning) cancelVolumeRamp = rampIdentityVolume(piano, Number(volume.value), 600);
  else piano.setVolume(Number(volume.value));
  const music = getGlobal().music;
  const abort = new AbortController(),
    signal = abort.signal;
  let score: MidiScore | undefined,
    plan: ReturnType<typeof identityRevealPlan> | undefined;
  let disposed = false,
    seeking = false,
    wantsPlayback = true,
    loop = 0,
    frame = 0,
    tickPosition = 0,
    sceneActive = true,
    needsAnimation = true;
  let width = 720,
    height = 300,
    tint = "#5588bb",
    ink = "#243244",
    darkInk = "#bcd9ef";
  // 播放模块直接读这个数组（只读、不复制），所以谱子读完后 push 进去，别重新赋值
  const notes: MidiNote[] = [];
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

  /**
   * 统一的"叫醒播放"入口：这一区在屏幕上、用户想听、谱子也读好了，才叫播放模块接手。
   * 音频还没被手势解锁时它会停在 `waiting`，等下一次手势（`arm()` + `enter()`）再试 ——
   * 这正是手机端"第一次滑到关于区没声音"的那条路。
   */
  const startPlayback = () => {
    if (disposed || !score || !sceneActive || !wantsPlayback || document.hidden) return;
    void playback.enter();
  };
  piano.addEventListener(
    "piano:context",
    () => {
      // 上下文从 interrupted / suspended 醒过来（iOS 随时可能发生）：接着放
      if (piano.isRunning) startPlayback();
    },
    { signal },
  );
  /**
   * 采样还在下载时不要"报错让人刷新"，等它加载完自己接上。
   * 场景：用户进站后立刻往下滑到关于区 —— 那一刻采样可能还没齐，
   * 早先的版本会显示"请刷新重试"，而不会自己再试一次。
   *
   * 这里**不要求** `getLoadedRatio() >= 1`：缺的那几个音本来就会用最近的采样顶替，
   * 而"必须一个不差"会把任何一个采样下载失败变成永远等下去（见 §10）。
   */
  piano.addEventListener(
    "piano:state",
    () => {
      if (piano.getState() === "ready" && piano.isRunning) startPlayback();
    },
    { signal },
  );
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const duration = () => (score ? score.duration + 0.8 : 0);
  const label = () => {
    const playing = playback.playing;
    play.setAttribute('aria-label', playing ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play'));
    play.setAttribute("aria-pressed", String(playing));
    // 图标只认 'playing'；'waiting' 是"想放但音频还没被手势解锁"，CSS 不加图标
    root.dataset.state = playing ? "playing" : playback.state === "waiting" ? "waiting" : "paused";
  };
  /*
   * 出声的那一半交给 identity-playback.ts：解锁（arm）、位置与进度记忆、
   * 起跑余量、进/出这一区的暂停恢复都在那边。这一页只读它的 `state` 和 `pos()`
   * 来画瀑布流、放标签、写读数 —— 不再自己维护 offset / origin / cursor / timer。
   */
  const playback = createNocturnePlayback({
    engine: piano,
    timeline: TIMELINE,
    notes,
    duration,
    /*
     * 换页交棒（关于 ⇄ 关于我）：离开这一页时把"听到哪 / 排到哪"交给下一张
     * "关于"族页面，接手时从那一段之后接着排 —— 换页那几百毫秒声音不断。
     * 换算与"两个位置必须分开"的坑见 lib/handover.ts 与 identity-playback.ts 的 begin()。
     */
    handover: {
      take: takeIdentityHandover,
      give: handOverIdentityPiano,
      ahead: HANDOVER_AHEAD,
    },
    onState: (state) => {
      label();
      // 主题曲让位：夜曲在放的时候背景音乐一直是静音（见 §5.5）
      music?.setDucked(state === "playing");
      if (state === "playing") {
        status.textContent = zh
          ? "肖邦 · 降 E 大调夜曲 Op.9 No.2 · 循环演奏"
          : "Chopin · Nocturne in E-flat major, Op.9 No.2 · Looping";
        if (!frame) frame = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        draw();
        if (state === "waiting")
          status.textContent = zh
            ? "点击或按键，即可接入钢琴演奏。"
            : "Click or press a key to join the piano performance.";
      }
    },
    onTick: (position) => {
      // 播放模块撞到曲尾会自己从头再来（位置变小 = 又一遍）
      if (position < tickPosition) {
        loop += 1;
        root.dataset.loops = String(loop);
      }
      tickPosition = position;
      if (!plan) return;
      // 标签跟着乐句出场：歌走到哪一颗音，才放出哪一个标签（第一遍）
      if (loop === 0 && needsAnimation)
        plan.triggers.forEach((n, i) => {
          if (position >= n.start) reveal(i, n);
        });
      // 乐谱截止时刻或已经进第二遍：还没上场的直接补齐，别让它们永远缺席
      if (needsAnimation && (loop > 0 || position >= plan.deadline)) {
        plan.triggers.forEach((n, i) => reveal(i, n));
        needsAnimation = false;
        root.dataset.settled = "true";
      }
    },
  });
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
    const t = playback.pos(),
      hit = height - 66,
      unit = width / 52;
    const active = new Set<number>();
    if (score) {
      for (const n of notes) {
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
    const total = score ? duration() : 0;
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
  /**
   * 只画不动声音：出声（排程、进度写回、循环）全在 identity-playback.ts 里，
   * 动画帧永远不触发声音（这条规矩从旧版沿用下来，别再挪回去）。
   */
  function render() {
    if (!playback.playing) return;
    draw();
    frame = requestAnimationFrame(render);
  }
  play.addEventListener(
    "click",
    () => {
      if (!score) return;
      // 播放键本身就是一次合法手势：先把 AudioContext 叫起来，再交给播放模块切换
      playback.arm();
      wantsPlayback = !playback.playing;
      playback.toggle();
    },
    { signal },
  );
  const activate = (event: Event) => {
    if (
      (event.target as Element | null)?.closest(
        "[data-identity-play], [data-identity-restart], [data-identity-progress], [data-identity-volume]",
      )
    )
      return;
    // 用户手势是唤醒音频的唯一时机（iOS 只认手势）：下滑/按键/wheel 都顺手叫一次
    playback.arm();
    startPlayback();
  };
  document.addEventListener("pointerdown", activate, { signal });
  document.addEventListener("keydown", activate, { signal });
  document.addEventListener("wheel", activate, { signal, passive: true });
  restart.addEventListener(
    "click",
    () => {
      if (!score) return;
      playback.arm();
      wantsPlayback = true;
      loop = 0;
      tickPosition = 0;
      needsAnimation = true;
      clearLayout();
      delete root.dataset.settled;
      physics.reset();
      // 清进度 + 从头来（播放模块负责把 0 写回 live-timeline）
      playback.restart();
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
      if (!score) return;
      seeking = true;
      // 拖动时"正在放"的接着从新位置放、"停着"的只记住新位置（模块自己分这两种情况）
      playback.seek((Number(progress.value) / 1000) * duration());
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
      // 手动拖音量时先停掉"换页滑行"，否则两个值会互相打架
      cancelVolumeRamp();
      piano.setVolume(Number(volume.value));
    },
    { signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      // 切走停手（进度写在 live-timeline 里），切回来接着弹
      if (document.hidden) playback.leave();
      else startPlayback();
    },
    { signal },
  );
  /*
   * 手机端"第一次滑到关于区没声音"的兜底：那一次往往只是音频还没被手势解锁
   * （上下文还在 suspended / interrupted），于是播放模块只能停在"点击或按键"。
   * 解锁不一定发生在同一个手势里，所以这里挂一个"只要没在放、且这一区还在屏幕上，
   * 任何一次点击/触摸都再试一次"的兜底 —— 成了就不再调（`enter()` 自己会早退）。
   *
   * 注意要 `arm()`：这一次 pointerdown 就是那个来之不易的手势，得在它里面把
   * AudioContext 叫醒；不叫醒的话下一次 `enter()` 还是只能停在 waiting。
   */
  document.addEventListener(
    "pointerdown",
    () => {
      if (playback.playing) return;
      playback.arm();
      startPlayback();
    },
    { capture: true, signal },
  );
  window.addEventListener("pagehide", () => playback.leave(), { signal });
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
  /**
   * 读乐谱。失败会自动重试两次再报错 —— 手机上这一下被系统/网络打断是常事，
   * 而原来的行为是直接写"请刷新重试"：本人实测过"必须手动刷新一下才开始加载"。
   * 重试之间隔 1.2s / 2.4s，都在同一条 abort 信号上，换页时不会漏。
   */
  let scoreAttempts = 0;
  const loadScore = (): void => {
    scoreAttempts += 1;
    void fetch(SOURCE, { signal })
      .then((r) => {
        if (!r.ok) throw new Error("Missing score");
        return r.arrayBuffer();
      })
      .then((data) => {
        if (disposed) return;
        score = parseMidi(new Uint8Array(data));
        plan = identityRevealPlan(score, tags.length);
        // 播放模块拿的是同一个数组（只读），所以这里 push 而不是重新赋值
        notes.length = 0;
        notes.push(...score.notes.filter((n) => n.midi >= FIRST && n.midi <= LAST));
        root.dataset.ready = "true";
        root.dataset.deadline = String(plan.deadline);
        root.dataset.deadlineTick = String(plan.endTick);
        root.dataset.duration = String(duration());
        root.dataset.keyCount = "88";
        play.disabled = false;
        restart.disabled = false;
        progress.disabled = false;
        label();
        draw();
        startPlayback();
      })
      .catch(() => {
        if (disposed || signal.aborted) return;
        if (scoreAttempts < 3) {
          status.textContent = zh ? "乐谱加载中…" : "Loading the score…";
          window.setTimeout(loadScore, 1200 * scoreAttempts);
          return;
        }
        status.textContent = zh
          ? "乐谱读取失败，请刷新重试。"
          : "The score could not load. Please reload.";
        play.textContent = zh ? "无法播放" : "Unavailable";
      });
  };
  loadScore();
  disposeCurrent = () => {
    disposed = true;
    /*
     * 停手：播放模块把"此刻听到的位置"写回 live-timeline，并在配了交棒时
     * 先往前排一小段、**不掐音**就把接续点交给下一张"关于"族页面（换页不断音）；
     * 没配交棒、或者当时并没有在放，就正常收声。
     * 真的离开"关于"这一族页面时，app.ts 会在 astro:before-swap 里
     * 调 releaseIdentityPiano() 收掉这架琴并清掉交棒记录（三个页面共用一个实例）。
     */
    playback.dispose();
    cancelVolumeRamp();
    cancelAnimationFrame(frame);
    frame = 0;
    // 离开这一页之前把"此刻"的落点写下来（不是上一次静止时的旧快照）：
    // 换页时标签多半还躺着没睡，旧快照会缺几条，下次回到这一页就会整排重抛。
    writeLayout(physics.snapshot());
    abort.abort();
    detachMotion();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    physics.dispose();
    // 不 dispose 钢琴：这架琴是三个"关于"页面共用的（见 identity-audio.ts）
    delete root.dataset.bound;
    setActiveCurrent = undefined;
  };
  setActiveCurrent = (active) => {
    sceneActive = active;
    // 滚进这一区 → 想听就接着从记忆位置放；滚走 → 停手但把进度留下
    if (active) startPlayback();
    else playback.leave();
  };
}
