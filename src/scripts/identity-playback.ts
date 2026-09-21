import { savedPosition, savePosition } from '@/lib/live-timeline';
import type { PianoEngine } from './piano';

/**
 * 夜曲播放器（重写版）
 * ------------------------------------------------------------
 * 只管一件乐器在"放一首夜曲"这件事。四件事，各写一处，互不掺和：
 *
 *   1. 解锁 arm()      —— 在用户手势里建/唤醒 AudioContext（iOS 只认手势）
 *   2. 位置            —— `pos() / seek() / 进度写回`，唯一的真值来源
 *   3. 起跑余量        —— 刚醒来的音频线程要一个渲染周期才稳（LEAD），
 *                        它算在**位置**里，绝不塞进时间轴映射
 *   4. 暂停 / 恢复     —— 只有两个来源：用户按键、进/出关于区
 *
 * 它不认识 DOM、不认识瀑布流、不认识标签物理；外面通过 onState 和 pos() 读它。
 */

export type NocturneNote = { midi: number; velocity: number; start: number; end: number };
export type NocturneState = 'idle' | 'waiting' | 'playing' | 'paused';

type Options = {
  engine: PianoEngine;
  /** live-timeline 的 id（跨页/刷新共用的进度） */
  timeline: string;
  notes: NocturneNote[];
  /** 乐谱总长（含尾部留白），决定何时回到开头 */
  duration: () => number;
  onState?: (state: NocturneState) => void;
  onTick?: (position: number) => void;
};

/** 起跑余量：刚醒来（或被打断后醒来）的音频线程先跑一个渲染周期，避免头几个音发颤 */
const LEAD = 0.14;
/** 提前排多久的音频。手机上一次多排一点，调度晚一拍也不至于断音 */
const LOOKAHEAD = 0.4;
const TICK_MS = 25;

export function createNocturnePlayback(options: Options) {
  const { engine, timeline, notes, duration, onState, onTick } = options;

  let state: NocturneState = 'idle';
  /** 用户想不想听（滑走或按暂停都会让它变成 false，滑回来/再按恢复） */
  let wanted = true;
  let cursor = 0;
  /** 音频时钟 ↔ 乐曲位置的映射：pos = ctx.currentTime - origin */
  let origin = 0;
  let lastPos = 0;
  let timer = 0;
  let loading = false;

  const setState = (next: NocturneState) => {
    if (state === next) return;
    state = next;
    onState?.(next);
  };

  /** 当前听到的位置（秒） */
  const pos = (): number =>
    state === 'playing' ? Math.max(0, engine.currentTime - origin) : lastPos;

  /** 把 now 之后 LOOKAHEAD 秒内的音符排进音频时钟 */
  const schedule = () => {
    const now = pos();
    while (cursor < notes.length && notes[cursor].start < now + LOOKAHEAD) {
      const note = notes[cursor++];
      if (note.end <= now) continue;
      /*
       * 只排"还没开始"的音（`Math.max` 兜住极少数差一两毫秒的边界）。
       * 已经开始过的不再重排 —— 重排会在同一瞬间重敲几个没有音头的音（手机上的"颤动"）。
       */
      engine.scheduleNote(
        note.midi,
        note.velocity,
        origin + note.start,
        origin + note.end,
        0,
      );
    }
  };

  const tick = () => {
    if (state !== 'playing') return;
    if (pos() >= duration()) {
      engine.allNotesOff();
      cursor = 0;
      lastPos = 0;
      origin = engine.currentTime;
      savePosition(timeline, 0);
    }
    schedule();
    const now = pos();
    if (now - lastPos >= 0.5) {
      lastPos = now;
      savePosition(timeline, now);
    }
    onTick?.(now);
  };

  /**
   * 从 from 秒开始播。
   *
   * 起跑余量放在 **origin** 里（`origin = currentTime + LEAD - from`），不是加在 from 上：
   * 加在 from 上会把"开头第一个音"直接跳过去（本人踩过）。放在 origin 里的效果是
   * 整条时间轴顺延 LEAD，音符之间的相对关系、位置读数、以及第一个音都完好。
   */
  const begin = (from: number) => {
    engine.allNotesOff();
    cursor = notes.findIndex((note) => note.start >= from);
    if (cursor < 0) cursor = notes.length;
    lastPos = from;
    origin = engine.currentTime + LEAD - from;
    setState('playing');
    window.clearInterval(timer);
    timer = window.setInterval(tick, TICK_MS);
    tick();
  };

  const leave = () => {
    wanted = false;
    if (state !== 'playing') return;
    lastPos = pos();
    savePosition(timeline, lastPos);
    window.clearInterval(timer);
    timer = 0;
    engine.allNotesOff();
    setState('paused');
  };

  const enter = async () => {
    wanted = true;
    if (state === 'playing' || loading) return;
    loading = true;
    try {
      engine.ensure();
      await engine.preload();
      if (!wanted || state === 'playing') return;
      if (engine.getState() === 'failed') {
        setState('waiting');
        return;
      }
      // 音频还没被手势解锁：停在 waiting，等外面在手势里再叫一次 enter()
      if (!engine.isRunning) {
        setState('waiting');
        return;
      }
      begin(savedPosition(timeline, duration()));
    } finally {
      loading = false;
    }
  };

  return {
    /** 在用户手势里调用：建/唤醒 AudioContext。幂等，可以反复调 */
    arm(): void {
      engine.ensure();
    },

    /** 这一区进入视野：想听就接着从记忆位置开始 */
    enter,

    /** 离开这一区：停手，但保留进度 */
    leave,

    /** 播放键：在"放"和"停"之间切换 */
    toggle(): void {
      if (state === 'playing') leave();
      else void enter();
    },

    /** 重播：清进度，从头来 */
    restart(): void {
      savePosition(timeline, 0);
      lastPos = 0;
      cursor = 0;
      if (state === 'playing') begin(0);
      else void enter();
    },

    /** 拖进度条 */
    seek(seconds: number): void {
      const target = Math.max(0, Math.min(duration(), seconds));
      savePosition(timeline, target);
      lastPos = target;
      if (state === 'playing') begin(target);
      else cursor = Math.max(0, notes.findIndex((note) => note.start >= target));
    },

    pos,

    get playing(): boolean {
      return state === 'playing';
    },

    get state(): NocturneState {
      return state;
    },

    dispose(): void {
      window.clearInterval(timer);
      timer = 0;
      if (state === 'playing') lastPos = pos();
      savePosition(timeline, lastPos);
      engine.allNotesOff();
      setState('paused');
    },
  };
}

export type NocturnePlayback = ReturnType<typeof createNocturnePlayback>;
