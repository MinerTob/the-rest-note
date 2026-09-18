import { navigate } from 'astro:transitions/client';
import { createIdentityPhysics, type IdentityLayout } from './identity-physics';
import {
  parseMidi,
  identityRevealPlan,
  type MidiScore,
  type MidiNote,
} from "@/lib/identity-midi";
import { IDENTITY_TRACK_SRC } from "@/lib/identity";
import { PianoEngine } from "./piano";
import { getGlobal } from "./global";
import { savedPosition, savePosition, restartPosition } from "@/lib/live-timeline";

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
  return `rest-note-identity-${visit}`;
}
const layoutCookie = layoutCookieName();
function readLayout(): IdentityLayout | undefined {
  try {
    const value = document.cookie.split('; ').find((part) => part.startsWith(`${layoutCookie}=`))?.split('=').slice(1).join('=');
    const parsed = value ? JSON.parse(decodeURIComponent(value)) : undefined;
    return Array.isArray(parsed) ? parsed : undefined;
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
  const piano = new PianoEngine(FIRST, LAST, 1.7);
  piano.setVolume(Number(volume.value));
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
  const restoredCount = physics.restore(readLayout() ?? []);
  needsAnimation = restoredCount < tags.length;
  piano.addEventListener(
    "piano:context",
    () => {
      if (piano.isRunning && wantsPlayback && !playing && !loading && !disposed)
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
    while (cursor < notes.length && notes[cursor].start < now + 0.15) {
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
  function pause() {
    if (!playing) return;
    offset = time();
    savePosition(TIMELINE, offset);
    playing = false;
    clearInterval(timer);
    cancelAnimationFrame(frame);
    timer = 0;
    frame = 0;
    piano.allNotesOff();

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
      offset = savedPosition(TIMELINE, duration());
      root.dataset.loops = String(loop);
      if (!needsAnimation) root.dataset.settled = "true";
      music?.setDucked(true);
      cursor = notes.findIndex((n) => n.end > offset);
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
      status.textContent = zh
        ? "钢琴采样未能完整加载，请刷新后重试。"
        : "Piano samples could not load. Please reload and try again.";
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
    () => piano.setVolume(Number(volume.value)),
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
  window.addEventListener("pagehide", pause, { signal });
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
    pause();
    abort.abort();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    physics.dispose();
    piano.dispose();
    delete root.dataset.bound;
    setActiveCurrent = undefined;
  };
  setActiveCurrent = (active) => {
    sceneActive = active;
    if (active && wantsPlayback) void start();
    if (!active) pause();
  };
}
