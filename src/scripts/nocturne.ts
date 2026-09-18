import { parseMidi, type MidiNote, type MidiScore } from '@/lib/identity-midi';
import { IDENTITY_INTRO_VOLUME, IDENTITY_TRACK_SRC } from '@/lib/identity';
import { AUDIO } from '@/lib/music';
import { savedPosition, savePosition } from '@/lib/live-timeline';
import { PianoEngine } from './piano';

/**
 * 自我介绍页（/about/intro/）的背景演奏：把 About 页那首夜曲接着放下去。
 *
 * 为什么不交给 MusicManager？因为它放的是 `<audio>` 里的 MP3，
 * 而夜曲是 MIDI + PianoEngine 的采样演奏（与 About 页完全同一条链路）。
 *
 * 两边共用 `live-timeline` 的同一个 id（`identity:nocturne`）：
 * 在 About 页听到第 40 秒时点开自我介绍，这里就从第 40 秒接着弹；
 * 从这一页返回 About，演奏也从这里接着走。
 *
 * 页面钩子：`[data-nocturne]`（IntroPage 的根节点）。没有这个钩子就不启动。
 * 这一页的主题背景音乐由 app.ts 的 `setAboutActive(true)` 让位（见 §5.5）。
 */
const TIMELINE = 'identity:nocturne';
const FIRST = 21;
const LAST = 108;
/** 与 About 页演奏用同一个音量倍数，两页听起来是同一架琴 */
const OUTPUT_GAIN = 1.7;
/** 提前多少秒把音符排进音频时钟（太短会漏音，太长会影响随后切换） */
const LOOKAHEAD = 0.15;
const TICK_MS = 25;

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

  const piano = new PianoEngine(FIRST, LAST, OUTPUT_GAIN);
  const abort = new AbortController();
  const signal = abort.signal;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let score: MidiScore | undefined;
  let notes: MidiNote[] = [];
  let playing = false;
  let loading = false;
  let disposed = false;
  let offset = 0;
  let origin = 0;
  let cursor = 0;
  let timer = 0;
  let lastSave = 0;
  let fadeFrame = 0;

  const duration = () => (score ? score.duration + 0.8 : 0);
  const time = () => (playing ? Math.max(0, piano.currentTime - origin) : offset);
  const setState = (state: 'waiting' | 'playing' | 'paused') => {
    root.dataset.nocturneState = state;
  };

  function tick(): void {
    if (!playing || !score) return;
    if (time() >= duration()) {
      // 循环：和 About 页一样，从头再来一次，中间不留缝
      piano.allNotesOff();
      origin = piano.currentTime;
      offset = 0;
      cursor = 0;
      lastSave = 0;
      savePosition(TIMELINE, 0);
    }
    const now = time();
    if (now - lastSave >= 0.5) {
      savePosition(TIMELINE, now);
      lastSave = now;
      // 便于排查"有没有接着上一页放"：把当前秒数写在页面上（与 identity-player 的 data-* 读数同一个习惯）
      root.dataset.nocturneAt = now.toFixed(1);
    }
    // 只往音频时钟里排；动画帧不负责出声（和 identity-player.ts 同一条规矩）
    while (cursor < notes.length && notes[cursor].start < now + LOOKAHEAD) {
      const note = notes[cursor++];
      if (note.end > now)
        piano.scheduleNote(
          note.midi,
          note.velocity,
          origin + Math.max(note.start, now),
          origin + note.end,
          Math.max(0, now - note.start),
        );
    }
  }

  function fadeIn(): void {
    const target = IDENTITY_INTRO_VOLUME;
    if (reduced.matches) {
      piano.setVolume(target);
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / AUDIO.fadeInMs);
      piano.setVolume(target * progress);
      if (progress < 1) fadeFrame = requestAnimationFrame(step);
    };
    fadeFrame = requestAnimationFrame(step);
  }

  function pause(): void {
    if (!playing) return;
    savePosition(TIMELINE, time());
    playing = false;
    setState('paused');
    window.clearInterval(timer);
    timer = 0;
    piano.allNotesOff();
  }

  async function start(): Promise<void> {
    if (playing || loading || disposed || !score) return;
    loading = true;
    piano.ensure();
    try {
      await piano.preload();
      if (disposed || playing) return;
      // 采样还没好、或浏览器还不让出声（缺一次用户手势）：安静地等，不报错。
      if (piano.getState() !== 'ready' || !piano.isRunning) {
        setState('waiting');
        return;
      }
      offset = savedPosition(TIMELINE, duration());
      cursor = Math.max(0, notes.findIndex((note) => note.end > offset));
      origin = piano.currentTime - offset;
      playing = true;
      setState('playing');
      lastSave = offset;
      root.dataset.nocturneAt = offset.toFixed(1);
      piano.setVolume(0);
      fadeIn();
      timer = window.setInterval(tick, TICK_MS);
    } finally {
      loading = false;
    }
  }

  const activate = () => void start();
  document.addEventListener('pointerdown', activate, { signal });
  document.addEventListener('keydown', activate, { signal });
  document.addEventListener('visibilitychange', () => {
    // 与 About 页一致：切走时停手，切回来接着弹（位置存在同一条时间线上）
    if (document.hidden) pause();
    else void start();
  }, { signal });
  window.addEventListener('pagehide', pause, { signal });

  void fetch(IDENTITY_TRACK_SRC, { signal })
    .then((response) => {
      if (!response.ok) throw new Error('Missing score');
      return response.arrayBuffer();
    })
    .then((data) => {
      if (disposed) return;
      score = parseMidi(new Uint8Array(data));
      notes = score.notes.filter((note) => note.midi >= FIRST && note.midi <= LAST);
      root.dataset.nocturneReady = 'true';
      void start();
    })
    .catch(() => {
      /* 谱子读不到就安静地不播：这是读长文的页面，不该为此弹错误 */
    });

  disposeCurrent = () => {
    disposed = true;
    pause();
    abort.abort();
    cancelAnimationFrame(fadeFrame);
    piano.dispose();
    delete root.dataset.bound;
  };
}
