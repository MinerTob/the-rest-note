import { parseMidi, type MidiNote, type MidiScore } from '@/lib/identity-midi';
import { IDENTITY_TRACK_SRC } from '@/lib/identity';
import { NOCTURNE_TIMELINE, restartPosition, savePosition, savedPosition } from '@/lib/live-timeline';
import { getGlobal } from './global';
import { identityPiano, rampIdentityVolume } from './identity-audio';
import type { PianoEngine } from './piano';

/**
 * 夜曲播放器（transport）—— About / 自我介绍 / 首页关于区**共用同一台**，跨页不重建。
 *
 * 为什么要有它：原来每个页面各自带一套"时钟 + 排程"（identity-player.ts 一套、
 * nocturne.ts 一套），换页时只能靠"提前排 0.45 秒的音 + pause + 下一页接手"糊住那条缝，
 * 那**不是**真正的无缝（音会重复、会跳、要从头排一遍）。
 *
 * 现在：MIDI 的 score / cursor / 音频时钟锚点 / 排程定时器 / 位置记忆全在这里，
 * 挂在 `getGlobal()` 上（window），ClientRouter 换页时**一秒都不停**。
 * 页面脚本只 attach / detach UI：订阅快照画自己的东西、把按钮接过来调 start/pause/seek。
 *
 * 什么时候才停：真的离开"关于这一族"（下一张页面里既没有 `[data-identity]`
 * 也没有 `[data-nocturne]`）时，`app.ts` 的 `astro:before-swap` 会调 `stopNocturneTransport()`，
 * 紧接着 `releaseIdentityPiano()` 把这架琴也收掉。
 */

/** 时间线 id 定义在 lib/live-timeline.ts：换一趟新访问要按它把夜曲进度一起归零 */
const TIMELINE = NOCTURNE_TIMELINE;
const FIRST = 21;
const LAST = 108;
/** 提前多少秒把音符排进音频时钟（太短会漏音，太长会让暂停按钮迟钝） */
const LOOKAHEAD = 0.15;
/** 时钟滴答：排程 + 存进度 + 通知 UI */
const TICK_MS = 25;
/** 曲子末尾留一点空白再从头来（和原来一致） */
const END_PAD = 0.8;
/** 乐谱最多读几次（手机上被打断是常事） */
const SCORE_ATTEMPTS = 3;

export type NocturneState = 'paused' | 'loading' | 'waiting' | 'playing' | 'failed';

export type NocturneSnapshot = {
  state: NocturneState;
  /** 现在演奏到第几秒 */
  position: number;
  /** 整曲长度（含收尾留白）；还没读谱时是 0 */
  duration: number;
  /** 已经循环了几遍 */
  loops: number;
  /** 乐谱读好了没有 */
  ready: boolean;
};

type Listener = (snapshot: NocturneSnapshot) => void;

export class NocturneTransport {
  private score?: MidiScore;
  private notes: MidiNote[] = [];
  private playing = false;
  private loading = false;
  private waiting = false;
  private failed = false;
  private ready = false;
  /** "想播"的意图：场景离开、按暂停都会清掉；切后台只是暂停时钟，不清它 */
  private desired = false;
  /** 这一次开机有没有从 live-timeline 取过位置（第一次起播才取，之后用内存里的 offset） */
  private resumed = false;
  private offset = 0;
  private origin = 0;
  private cursor = 0;
  private loops = 0;
  private timer = 0;
  private lastSave = 0;
  private scorePromise?: Promise<void>;
  private pianoRef?: PianoEngine;
  private cancelRamp: () => void = () => {};
  private readonly listeners = new Set<Listener>();

  constructor() {
    // 切到后台停下来、切回来接着弹；这里只停时钟，不丢"想播"的意图
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.suspend();
      else if (this.desired) void this.begin();
    });
    window.addEventListener('pagehide', () => this.suspend());
  }

  /* ---------------- 页面 UI 用得到的接口 ---------------- */

  /** 订阅快照（attach UI）。返回取消订阅的函数。 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): NocturneSnapshot {
    return {
      state: this.state(),
      position: this.position(),
      duration: this.duration(),
      loops: this.loops,
      ready: this.ready,
    };
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * 这台播放器"想不想播"（用户 / 页面表达过的意图）。
   * 只读：`audio-unlock.ts` 用它决定手势解锁时要不要把夜曲接上 ——
   * 手势本身不等于"要出声"，没表达过想播就不起。
   */
  isDesired(): boolean {
    return this.desired;
  }

  isReady(): boolean {
    return this.ready;
  }

  getScore(): MidiScore | undefined {
    return this.score;
  }

  /** 88 键范围内的音符（画瀑布流用） */
  getNotes(): readonly MidiNote[] {
    return this.notes;
  }

  /** 现在演奏到第几秒 */
  position(): number {
    return this.playing ? Math.max(0, this.piano().currentTime - this.origin) : this.offset;
  }

  duration(): number {
    return this.score ? this.score.duration + END_PAD : 0;
  }

  /**
   * 这一页的目标音量：从**当前**音量滑过去（不归零、不重新淡入）。
   * About 用滑杆上的值、自我介绍用 IDENTITY_INTRO_VOLUME。
   */
  attachVolume(target: number): void {
    this.cancelRamp();
    this.cancelRamp = rampIdentityVolume(this.piano(), Math.min(1, Math.max(0, target)), 600);
  }

  /** 用户手动拖音量滑杆 */
  setVolume(value: number): void {
    this.cancelRamp();
    this.piano().setVolume(value);
  }

  /** 开始 / 继续（真正出声要在用户手势里，这里只管"想播"并尝试） */
  start(): void {
    this.desired = true;
    void this.begin();
  }

  /** 停下并掐音（场景离开、按暂停）。desired 一起清掉。 */
  pause(): void {
    this.desired = false;
    this.suspend();
  }

  /** 从头演奏（"重播"按钮） */
  restart(): void {
    this.suspend();
    this.offset = 0;
    this.cursor = 0;
    this.loops = 0;
    this.lastSave = 0;
    this.resumed = true;
    restartPosition(TIMELINE);
    this.desired = true;
    this.notify();
    void this.begin();
  }

  /** 跳到某个位置（拖进度条） */
  seek(seconds: number): void {
    const total = this.duration();
    const clamped = Math.max(0, total > 0 ? Math.min(seconds, total) : seconds);
    this.offset = clamped;
    this.lastSave = clamped;
    savePosition(TIMELINE, clamped);
    this.cursor = this.indexAfter(clamped);
    if (this.playing) {
      // 正在播：掐掉已经排进时钟的音，把时钟锚点挪到新位置，再按新位置往下排
      const piano = this.piano();
      piano.allNotesOff();
      this.origin = piano.currentTime - clamped;
      this.cursor = this.indexAfter(clamped);
      this.schedule(LOOKAHEAD);
    }
    this.notify();
  }

  /** 真的离开 identity/nocturne 这一族 */
  stop(): void {
    this.pause();
    this.loops = 0;
    this.resumed = false;
    this.notify();
  }

  /* ---------------- 内部 ---------------- */

  private state(): NocturneState {
    if (this.failed) return 'failed';
    if (this.playing) return 'playing';
    if (this.loading) return 'loading';
    if (this.waiting) return 'waiting';
    return 'paused';
  }

  private notify(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private indexAfter(position: number): number {
    const index = this.notes.findIndex((note) => note.end > position);
    return index < 0 ? 0 : index;
  }

  /** 这架琴是全站共用的：引擎被换掉（releaseIdentityPiano）后要重新挂监听 */
  private piano(): PianoEngine {
    const piano = identityPiano();
    if (this.pianoRef !== piano) {
      this.pianoRef = piano;
      // 上下文晚一点才醒（iOS 上 resume 常常不在手势里）：醒了就接着弹
      piano.addEventListener('piano:context', () => {
        if (piano.isRunning) {
          if (this.desired && !this.playing && !this.loading) void this.begin();
          return;
        }
        /*
         * 反方向：**系统**把 AudioContext 从 running 拿走（iOS 音频会话被打断、
         * 权限框、切后台、别的 App 抢音频）。这不是用户按了暂停 —— 所以走 suspend()：
         * 存下此刻位置、掐掉排进时钟的音、`playing = false`，**desired 留着**。
         *
         * 少了这一步，`playing` 会永远停在 true：UI 一直显示"正在播放"、位置冻在
         * 不再前进的 `currentTime` 上（琴键/瀑布流停在某一帧），而 audio-unlock 那句
         * `isDesired() && !isPlaying()` 也永远不成立 —— 后续真实手势也不会接回来，
         * 就是"幽灵演奏"。
         *
         * 上下文回到 running 时上面那一支会 `begin()`，`resumeOffset()` 从刚存的
         * offset 接着弹，不从头开始。
         */
        if (this.playing) this.suspend();
      });
      piano.addEventListener('piano:state', () => {
        if (piano.getState() === 'ready' && piano.isRunning && this.desired && !this.playing && !this.loading)
          void this.begin();
      });
    }
    return piano;
  }

  /** 读谱：只读一次，失败按 1.2s / 2.4s 退避重试 */
  load(): Promise<void> {
    this.scorePromise ??= (async () => {
      for (let attempt = 1; attempt <= SCORE_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(IDENTITY_TRACK_SRC);
          if (!response.ok) throw new Error('Missing score');
          const data = await response.arrayBuffer();
          const score = parseMidi(new Uint8Array(data));
          this.score = score;
          this.notes = score.notes.filter((note) => note.midi >= FIRST && note.midi <= LAST);
          this.ready = true;
          this.notify();
          return;
        } catch {
          if (attempt === SCORE_ATTEMPTS) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
        }
      }
      this.failed = true;
      this.notify();
    })();
    return this.scorePromise;
  }

  private async begin(): Promise<void> {
    if (this.playing || this.loading || !this.desired) return;
    const piano = this.piano();
    this.loading = true;
    this.waiting = false;
    this.notify();
    piano.ensure();
    try {
      await this.load();
      // 首段所需的采样一到就开弹；其余音域继续在后台下载。
      const opening = this.resumeOffset();
      const upcoming = this.notes.filter((note) => note.end > opening);
      const firstNotes = upcoming.filter((note) => note.start < opening + 2);
      await piano.waitForNotes((firstNotes.length ? firstNotes : upcoming.slice(0, 4))
        .map((note) => note.midi));
      if (!this.desired || this.playing || document.hidden) return;
      /*
       * 采样只要不是"全军覆没"就开始弹 —— 缺的那几个音本来就由最近的采样顶替
       * （`bufferFor()` 的退让逻辑），等"一个不差"会把任何一个没下成的采样
       * 变成永远等下去（见 §10）。
       */
      if (piano.getState() === 'failed') {
        this.failed = true;
        return;
      }
      if (!this.ready) return;
      if (!piano.isRunning) {
        // 还没拿到用户手势：安静地等（piano:context 监听会接手）
        this.waiting = true;
        return;
      }
      this.offset = this.resumeOffset();
      this.cursor = this.indexAfter(this.offset);
      this.origin = piano.currentTime - this.offset;
      this.playing = true;
      this.waiting = false;
      this.lastSave = this.offset;
      getGlobal().music?.setDucked(true);
      this.schedule(LOOKAHEAD);
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    } catch {
      this.waiting = true;
    } finally {
      this.loading = false;
      this.notify();
      // AudioContext 可能在 await 读谱/采样期间变为 running；当时的事件因
      // loading 守卫被忽略。收尾时重新核对真实状态，避免永久停在 waiting。
      if (this.desired && !this.playing && this.waiting && piano.isRunning && !document.hidden)
        void this.begin();
    }
  }

  private resumeOffset(): number {
    this.offset = this.resumed ? this.offset : savedPosition(TIMELINE, this.duration());
    this.resumed = true;
    return this.offset;
  }

  /**
   * 停下来但保留 offset / desired。
   * 调用方有两类，语义都是"先停下、位置留着"：
   *   · 用户 / 页面主动（`pause()` 会在此之前清掉 desired、切后台、`start()` 里的接管）；
   *   · **系统拿走了 AudioContext**（`piano:context` 发现 `isRunning === false`）——
   *     这一路不清 desired，等上下文回到 running 再 `begin()` 接着弹。
   */
  private suspend(): void {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.offset = this.position();
      savePosition(TIMELINE, this.offset);
    }
    this.playing = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    if (wasPlaying) {
      this.piano().allNotesOff();
      getGlobal().music?.setDucked(false);
      this.notify();
    }
  }

  private tick(): void {
    if (!this.playing) return;
    const now = this.position();
    if (now >= this.duration()) {
      // 循环：掐掉尾巴、时钟重新锚定，中间不留缝（和原来一致）
      const piano = this.piano();
      piano.allNotesOff();
      this.origin = piano.currentTime;
      this.offset = 0;
      this.cursor = 0;
      this.loops += 1;
      this.lastSave = 0;
      savePosition(TIMELINE, 0);
      this.notify();
      this.schedule(LOOKAHEAD);
      return;
    }
    if (now - this.lastSave >= 0.5) {
      savePosition(TIMELINE, now);
      this.lastSave = now;
    }
    // 只往音频时钟里排；动画帧不负责出声
    this.schedule(LOOKAHEAD);
  }

  private schedule(ahead: number): void {
    const piano = this.piano();
    const now = this.position();
    while (this.cursor < this.notes.length && this.notes[this.cursor].start < now + ahead) {
      const note = this.notes[this.cursor++];
      if (note.end > now)
        piano.scheduleNote(
          note.midi,
          note.velocity,
          this.origin + Math.max(note.start, now),
          this.origin + note.end,
          Math.max(0, now - note.start),
        );
    }
  }
}

/** 取（没有就造）这台播放器。挂在 window 上，换页不重建。 */
export function nocturneTransport(): NocturneTransport {
  const global = getGlobal();
  return (global.nocturne ??= new NocturneTransport());
}

/** 离开 identity/nocturne 这一族时收掉它（app.ts 的 before-swap 调用） */
export function stopNocturneTransport(): void {
  getGlobal().nocturne?.stop();
}
