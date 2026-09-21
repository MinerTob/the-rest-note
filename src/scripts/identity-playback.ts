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
 *   5. 换页交棒        —— 离开这一页时先把接下来一小段排满、**不掐音**再交出去，
 *                        下一个"关于"族页面从"已经排到哪"之后接着排（可选，见 handover）
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
  /**
   * 跨页交棒（可选）：进这一页时接手上一页的交棒点，离开这一页时把"听到哪、
   * 已经排到哪"交给下一个页面。不给就不参与交棒（换页时正常收声）。
   *
   * 交给外面的两个函数之所以不写死在这里：换算规则（`position` 与 `from` 必须分开）
   * 和交棒记录存在哪儿都属于页面那一层，纯逻辑部分在 `lib/handover.ts`（有单测）。
   */
  handover?: {
    /** 接手上一页的交棒点；没有、或已经过期就返回 null */
    take: () => { position: number; from: number } | null;
    /** 交出：position 是此刻听到的位置，scheduledUntil 是已经排到的位置 */
    give: (position: number, scheduledUntil: number) => void;
    /** 交棒前先往前排多久的音（秒）—— 换页那几百毫秒就靠它不断音 */
    ahead: number;
  };
};

/** 起跑余量：刚醒来（或被打断后醒来）的音频线程先跑一个渲染周期，避免头几个音发颤 */
const LEAD = 0.14;
/** 提前排多久的音频。手机上一次多排一点，调度晚一拍也不至于断音 */
const LOOKAHEAD = 0.4;
const TICK_MS = 25;

export function createNocturnePlayback(options: Options) {
  const { engine, timeline, notes, duration, onState, onTick, handover: handoverBridge } = options;

  let state: NocturneState = 'idle';
  /** 用户想不想听（滑走或按暂停都会让它变成 false，滑回来/再按恢复） */
  let wanted = true;
  let cursor = 0;
  /** 音频时钟 ↔ 乐曲位置的映射：pos = ctx.currentTime - origin */
  let origin = 0;
  let lastPos = 0;
  let timer = 0;
  let loading = false;
  /** 上一页交来的接续点：只在这一次开口时用一次（换页时才有） */
  let handover = handoverBridge?.take() ?? null;

  const setState = (next: NocturneState) => {
    if (state === next) return;
    state = next;
    onState?.(next);
  };

  /** 用函数读状态，别让 TS 把 await 前后的判断收窄掉 */
  const isPlaying = () => state === 'playing';

  /** 当前听到的位置（秒） */
  const pos = (): number =>
    state === 'playing' ? Math.max(0, engine.currentTime - origin) : lastPos;

  /** 把 now 之后 ahead 秒内的音符排进音频时钟 */
  const schedule = (ahead = LOOKAHEAD) => {
    const now = pos();
    while (cursor < notes.length && notes[cursor].start < now + ahead) {
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
   *
   * `adopt` 非空 = 接手上一页正在响的那一段（只在换页时发生）：
   *   · **不掐音**（上一页已经把 position → from 那一段排进音频时钟了，正在响）；
   *   · **不重排那一段**，cursor 从 `from` 之后开始；
   *   · 不需要起跑余量（音频线程本来就是热的）；
   *   · 时间轴映射用 `position`（真实听到的位置）、排程起点用 `from` —— 这两个数必须分开，
   *     拿 `from` 当"现在在哪"，时间轴就会往前跳那 0.45 秒（本人实测的"音乐向前位移一段"）。
   */
  const begin = (from: number, adopt: { position: number; from: number } | null = null) => {
    const at = adopt ? adopt.position : from;
    if (adopt) cursor = notes.findIndex((note) => note.start >= adopt.from);
    else {
      engine.allNotesOff();
      cursor = notes.findIndex((note) => note.start >= from);
    }
    if (cursor < 0) cursor = notes.length;
    lastPos = at;
    origin = engine.currentTime + (adopt ? 0 : LEAD) - at;
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
    if (isPlaying() || loading) return;
    loading = true;
    try {
      engine.ensure();
      await engine.preload();
      if (!wanted || isPlaying()) return;
      if (engine.getState() === 'failed') {
        setState('waiting');
        return;
      }
      // 音频还没被手势解锁：停在 waiting，等外面在手势里再叫一次 enter()
      if (!engine.isRunning) {
        setState('waiting');
        return;
      }
      // 换页交接（关于 ⇄ 关于我）：接手上手那一小段，不从记忆位置重新弹一遍
      const adopted = handover;
      handover = null;
      if (adopted) begin(adopted.position, adopted);
      else begin(savedPosition(timeline, duration()));
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
      const wasPlaying = state === 'playing';
      lastPos = wasPlaying ? pos() : lastPos;
      savePosition(timeline, lastPos);
      if (wasPlaying && handoverBridge) {
        /*
         * 换页交棒：先把接下来 `ahead` 秒的音排进音频时钟（它们会继续响），
         * 再交出"听到哪 + 排到哪"。所以这一支里**故意不 allNotesOff** ——
         * 换页那几百毫秒不断音，下一个页面从 scheduledUntil 之后接着排。
         * 真的离开"关于"这一族时，app.ts 会调 releaseIdentityPiano() 把那架琴整个关掉。
         */
        schedule(handoverBridge.ahead);
        handoverBridge.give(lastPos, lastPos + handoverBridge.ahead);
      } else {
        engine.allNotesOff();
      }
      setState('paused');
    },
  };
}

export type NocturnePlayback = ReturnType<typeof createNocturnePlayback>;
