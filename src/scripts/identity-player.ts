import { navigate } from 'astro:transitions/client';
import { createIdentityPhysics, type IdentityLayout } from './identity-physics';
import { attachIdentityMotion } from './identity-motion';
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
import { savedPosition, savePosition, restartPosition } from "@/lib/live-timeline";
import { takeLanguageSwap } from './lang';

const SOURCE = IDENTITY_TRACK_SRC;
const TIMELINE = "identity:nocturne";
const FIRST = 21,
  LAST = 108,
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
  root.dataset.bound = "true";
  const zh = root.dataset.lang === "zh";
  const canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
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
  let handover = takeIdentityHandover();
  const adopted = handover !== null;
  let cancelVolumeRamp: () => void = () => {};
  if (adopted) cancelVolumeRamp = rampIdentityVolume(piano, Number(volume.value), 600);
  else piano.setVolume(Number(volume.value));
  const abort = new AbortController(),
    signal = abort.signal;
  let score: MidiScore, plan: ReturnType<typeof identityRevealPlan>;
  let disposed = false,
    loading = false,
    seeking = false,
    wantsPlayback = true,
    playing = false,
    offset = 0,
    origin = 0,
    loop = 0,
    frame = 0,
    timer = 0,
    cursor = 0,
    sceneActive = true,
    needsAnimation = true;
  let lastPositionSave = 0;
  let width = 720,
    height = 300,
    tint = "#5588bb",
    ink = "#243244",
    darkInk = "#bcd9ef";
  let notes: MidiNote[] = [];
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
  piano.addEventListener(
    "piano:context",
    () => {
      if (piano.isRunning && wantsPlayback && !playing && !loading && !disposed)
        void start();
    },
    { signal },
  );
  /**
   * 采样还在下载时不要"报错让人刷新"，等它加载完自己接上。
   * 场景：用户进站后立刻往下滑到关于区 —— 那一刻采样可能还没齐，
   * 原来的 start() 会走到 catch 显示"请刷新重试"，而不会自己再试一次。
   */
  piano.addEventListener(
    "piano:state",
    () => {
      if (
        piano.getState() === "ready" &&
        piano.getLoadedRatio() >= 1 &&
        piano.isRunning &&
        wantsPlayback &&
        sceneActive &&
        !playing &&
        !loading &&
        !disposed
      )
        void start();
    },
    { signal },
  );
  const music = getGlobal().music;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const time = () =>
    playing ? Math.max(0, piano.currentTime - origin) : offset;
  const duration = () => score.duration + 0.8;
  const label = () => {
    play.setAttribute('aria-label', playing ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play'));
    play.setAttribute("aria-pressed", String(playing));
    root.dataset.state = playing ? "playing" : "paused";
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
  function tick() {
    if (!playing) return;
    const t = time();
    if (t >= duration()) {
      piano.allNotesOff();
      origin = piano.currentTime;
      offset = 0;
      cursor = 0;
      loop += 1;
      savePosition(TIMELINE, 0);
      lastPositionSave = 0;
      root.dataset.loops = String(loop);
    }
    const now = time();
    if (now - lastPositionSave >= 0.5) {
      savePosition(TIMELINE, now);
      lastPositionSave = now;
    }
    // Schedule ahead on the audio clock; animation frames never trigger sound.
    schedule(0.15);
    if (loop === 0 && needsAnimation)
      plan.triggers.forEach((n, i) => {
        if (now >= n.start) reveal(i, n);
      });
    if (needsAnimation && (loop > 0 || now >= plan.deadline)) {
      plan.triggers.forEach((n, i) => reveal(i, n));
      needsAnimation = false;
      root.dataset.settled = "true";
    }
  }
  function render() {
    if (!playing) return;
    draw();
    frame = requestAnimationFrame(render);
  }
  /**
   * 把接下来 ahead 秒内的音排进音频时钟。
   * 平时 ahead 只有 0.15 秒；换页交棒时会用大得多的值先排一小段，
   * 于是换页那几百毫秒里声音照样在走（见 identity-audio.ts 的 HANDOVER_AHEAD）。
   */
  function schedule(ahead: number) {
    const now = time();
    while (cursor < notes.length && notes[cursor].start < now + ahead) {
      const n = notes[cursor++];
      if (n.end > now)
        piano.scheduleNote(
          n.midi,
          n.velocity,
          origin + Math.max(n.start, now),
          origin + n.end,
          Math.max(0, now - n.start),
        );
    }
  }
  /**
   * keepRinging = true 时不掐音：留给下一个"关于"页面接着响（无缝换页用）。
   * 平时（暂停按钮、离开这一族页面）就是原来的行为，立刻收声。
   */
  function pause(keepRinging = false) {
    if (!playing) return;
    offset = time();
    savePosition(TIMELINE, offset);
    playing = false;
    clearInterval(timer);
    cancelAnimationFrame(frame);
    timer = 0;
    frame = 0;
    if (!keepRinging) piano.allNotesOff();

    music?.setDucked(false);
    label();
    draw();
  }
  async function start() {
    if (playing || loading || disposed || !score || !sceneActive) return;
    loading = true;
    play.disabled = true;
    piano.ensure();
    try {
      await piano.preload();
      if (disposed || !sceneActive || !wantsPlayback || document.hidden) return;
      if (piano.getState() !== "ready" || piano.getLoadedRatio() < 1)
        throw new Error("Samples unavailable");
      if (!piano.isRunning) {
        label();
        root.dataset.state = "waiting";
        status.textContent = zh
          ? "点击或按键，即可接入钢琴演奏。"
          : "Click or press a key to join the piano performance.";
        return;
      }
      // 接手上一页的交棒点（换页不断音）；没有就按 live-timeline 的记忆继续
      if (adopted && handover !== null) {
        // 交棒时那一段（position → scheduledUntil）已经由上一页排好、正在响，
        // 所以这里只排它之后的音：既不重复，也不会把时间轴往前推。
        const from = handover.from;
        offset = handover.position;
        handover = null;
        cursor = notes.findIndex((n) => n.start >= from);
      } else {
        offset = savedPosition(TIMELINE, duration());
        cursor = notes.findIndex((n) => n.end > offset);
      }
      root.dataset.loops = String(loop);
      music?.setDucked(true);
      if (cursor < 0) cursor = 0;
      origin = piano.currentTime - offset;
      playing = true;
      restart.disabled = false;
      progress.disabled = false;
      label();
      status.textContent = zh
        ? "肖邦 · 降 E 大调夜曲 Op.9 No.2 · 循环演奏"
        : "Chopin · Nocturne in E-flat major, Op.9 No.2 · Looping";
      tick();
      timer = window.setInterval(tick, 25);
      render();
    } catch {
      // 还没加载完（不是真的失败）就别吓唬人：等 piano:state 变 ready 会自己接上
      status.textContent =
        piano.getState() === "failed"
          ? zh
            ? "钢琴采样未能完整加载，请刷新后重试。"
            : "Piano samples could not load. Please reload and try again."
          : zh
            ? "钢琴采样加载中…"
            : "Loading the piano samples…";
      label();
    } finally {
      loading = false;
      if (!disposed) play.disabled = false;
    }
  }
  play.addEventListener(
    "click",
    () => {
      wantsPlayback = !playing;
      if (playing) pause();
      else void start();
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
    if (wantsPlayback && !playing) void start();
  };
  document.addEventListener("pointerdown", activate, { signal });
  document.addEventListener("keydown", activate, { signal });
  document.addEventListener("wheel", activate, { signal, passive: true });
  restart.addEventListener(
    "click",
    () => {
      pause();
      restartPosition(TIMELINE);
      wantsPlayback = true;
      offset = 0;
      loop = 0;
      cursor = 0;
      needsAnimation = true;
      clearLayout();
      delete root.dataset.settled;
      physics.reset();
      void start();
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
      const wasPlaying = playing || (loading && wantsPlayback);
      pause();
      offset = Math.max(0, Math.min(duration(), (Number(progress.value) / 1000) * duration()));
      savePosition(TIMELINE, offset);
      cursor = notes.findIndex((note) => note.end > offset);
      if (cursor < 0) cursor = 0;
      draw();
      wantsPlayback = wasPlaying;
      if (wasPlaying) void start();
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
      if (document.hidden) pause();
      else if (sceneActive && wantsPlayback) void start();
    },
    { signal },
  );
  window.addEventListener("pagehide", () => pause(), { signal });
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
  void fetch(SOURCE, { signal })
    .then((r) => {
      if (!r.ok) throw new Error("Missing score");
      return r.arrayBuffer();
    })
    .then((data) => {
      if (disposed) return;
      score = parseMidi(new Uint8Array(data));
      plan = identityRevealPlan(score, tags.length);
      notes = score.notes.filter((n) => n.midi >= FIRST && n.midi <= LAST);
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
      if (sceneActive) void start();
    })
    .catch(() => {
      if (!disposed) {
        status.textContent = zh
          ? "乐谱读取失败，请刷新重试。"
          : "The score could not load. Please reload.";
        play.textContent = zh ? "无法播放" : "Unavailable";
      }
    });
  disposeCurrent = () => {
    disposed = true;
    // 交棒：先把接下来这一小段排进音频时钟，再停下来（不掐音），
    // 于是换页过程中声音是连续的；下一个页面从交棒位置接着往下排。
    // 真的离开"关于"这一族页面时，app.ts 会调 releaseIdentityPiano() 收掉这架琴。
    if (playing) {
      const at = time();
      schedule(HANDOVER_AHEAD);
      pause(true);
      handOverIdentityPiano(at, at + HANDOVER_AHEAD);
    }
    cancelVolumeRamp();
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
    if (active && wantsPlayback) void start();
    if (!active) pause();
  };
}
