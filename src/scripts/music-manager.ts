import {
  AUDIO,
  DEFAULT_TRACK_ID,
  clamp01,
  getTrack,
  type Track,
  volumeAt,
} from "@/lib/music";
import { savedPosition, savePosition } from "@/lib/live-timeline";
import { THEMES, trackForTheme } from "@/lib/themes";
import { readBool, readNumber, writeBool, writeNumber } from "./storage";
import type { AppStore } from "./app-state";

/**
 * 背景音乐（主题曲）—— **单一事实来源**版
 * ==================================================================
 * 这套内核只承认两件事是真的，其它一律现场推导：
 *
 *   1. **用户意图**只有一份：`shouldPlay`。它由且仅由 `play()` / `pause()` /
 *      换主题的 force 路径（ThemeManager 的 `crossfadeTo(..., { force: true })`
 *      与同一首时的 `resume()`）改写。浏览器事件（pause / playing / canplay /
 *      error）、autoplay 被拒、About 让位、visibilitychange / pageshow、
 *      `retryIfIdle()` 通通**不许**碰它 —— 它们只影响"此刻能不能响"。
 *   2. **实际在不在播放**只看当前那一个 `HTMLAudioElement`（`isPlaying()` 直接读
 *      `el.paused` / `readyState`）。所以 `getState() === "active"` 必然意味着
 *      元素真的在响，不存在"UI 说在播、元素其实停着"的分裂。
 *
 * 由此派生三条不变量（详见 DEVELOPMENT.md §5.5）：
 *   · `currentTime` 只在两处被主动写：**接管一个 element 时恢复一次**（
 *     `restorePositionOnce()`，每个 element 一生只做一次）与**用户拖进度条**
 *     （`seekToRatio()`）。`play()` / `resume()` / `retryIfIdle()` / 各种事件
 *     都不许再"起播前同步一遍保存位置"—— 同一个元素停在哪儿就是哪儿。
 *   · 自动恢复只有一条路（`requestAutoStart()`），同一时刻最多一条在飞；
 *     任何一次新的启动/切换/暂停都会 `switchToken += 1`，把旧异步操作变成无害的
 *     过期操作（它回来时不许改 `shouldPlay`、不许改 `this.el`、不许停止新的播放）。
 *   · About / MIDI 只是**抢音频焦点**（把背景 MP3 音量归零并暂停），不修改
 *     `shouldPlay`；离开 About 后按 `shouldPlay` 决定要不要接着放。
 *
 * 外围 API 保持兼容：`music-ui.ts`（getState / getProgress / getVolume / track /
 * toggle / setVolume / seekToRatio）、`theme.ts`（track / resume /
 * crossfadeTo({force})）、`app.ts`（setAboutActive）、`entry-gate.ts`
 * （setAutoStart / play）、`audio-unlock.ts`（init / retryIfIdle）、
 * `nocturne-transport.ts`（setDucked）都不需要改。
 */

export type MusicState = "idle" | "ready" | "active" | "paused" | "error";

const KEY = {
  volume: "space.volume",
  muted: "space.muted",
  /** 仍然存"用户暂停过"，只是内部换成正向意图（不迁移 key，不动已有设置） */
  paused: "space.paused",
};

/** 用 rAF 做音量渐变，比 setInterval 更平滑，也不用引入任何库 */
function ramp(
  from: number,
  to: number,
  ms: number,
  onFrame: (value: number) => void,
  done?: () => void,
) {
  if (
    ms <= 0 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    onFrame(clamp01(to));
    done?.();
    return () => {};
  }

  const started = performance.now();
  let frame = 0;
  let cancelled = false;

  const step = (now: number) => {
    if (cancelled) return;
    // 夹进度的原因写在 lib/music.ts 的 clamp01 上：少夹一次下界，
    // 淡入就会断在半路，听起来像"切过去了，但没有声音"。
    const progress = clamp01((now - started) / ms);
    onFrame(volumeAt(from, to, progress));
    if (progress < 1) {
      frame = window.requestAnimationFrame(step);
    } else {
      done?.();
    }
  };

  frame = window.requestAnimationFrame(step);
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}

export class MusicManager extends EventTarget {
  private store: AppStore;
  /** 当前曲目的那一个 <audio>：**"在不在播"的唯一事实** */
  private el: HTMLAudioElement | null = null;
  private trackId: string = DEFAULT_TRACK_ID;
  private volume: number;
  private muted: boolean;
  private ducked = false;
  /** 音频焦点被 About / MIDI 借着（只影响能不能响，不影响用户意图） */
  private inAbout = false;
  /**
   * **唯一的用户播放意图**。`play()` / `pause()` / 换主题的 force 路径才会改它。
   * 持久化仍用 `space.paused`（`shouldPlay = !space.paused`）。
   */
  private shouldPlay: boolean;
  /**
   * 现在允不允许**自动**起播（不包含用户明确的 play()）。
   *
   * 入场页还立着、这一趟又没点过"进入"时，必须为 false：一首 4–5MB 的曲子不该在
   * 用户还没进门时就被建出来、下载、播放。这件事由外面明确告诉它 —— `app.ts` 在
   * 建这个实例时按"页面上有没有入场页 + 这一趟进没进过"传进来，`entry-gate.ts`
   * 在用户点"进入"的那次手势里解除。MusicManager **不自己查 DOM**。
   */
  private autoStart: boolean;
  /**
   * 本次文档里这首歌**已经响过一次**没有。
   * 第一次起播不要把音量从 0 淡上来：那 2.4 秒会把曲子开头吃掉
   * （timeline 在走、声音几乎是 0 —— 听着就像"第一拍没播出来"）。
   */
  private audibleOnce = false;
  /** 记忆里的曲目放不出来时的兜底：只允许回退一次默认曲目 */
  private fellBack = false;
  /** 当前 element 上真实的 media error（getState() 据此报 error） */
  private mediaError = false;
  /**
   * 每首曲子只建一个 <audio> 并留着。
   * 切回已经放过的曲子时文件已经缓冲好，不用重新下载、也不会卡在等
   * canplay 上 —— 这是"切回去没声音"最常见的原因。
   */
  private readonly elements = new Map<string, HTMLAudioElement>();
  /** 这个 element 已经恢复过保存位置了（每个元素一生只恢复一次） */
  private readonly positionRestored = new WeakSet<HTMLAudioElement>();
  /** 已经为这个 element 挂过 loadedmetadata 等待（防止重复挂一堆监听） */
  private readonly positionRestorePending = new WeakSet<HTMLAudioElement>();
  /** 用户手动 seek 时要取消尚未完成的自动恢复，不能稍后把用户的选择盖掉 */
  private readonly cancelPositionRestore = new WeakMap<HTMLAudioElement, () => void>();
  /** 交叉淡入淡出自己的 rAF 与延时：下一次切换 / 暂停 / 播放前要先把它们停掉 */
  private fadeFrames: (() => void)[] = [];
  private pauseTimer = 0;
  private fadeFrame: () => void = () => {};
  /**
   * 操作代号：任何一次启动 / 切换 / 暂停 / 进入或离开 About 都会 +1。
   * 异步的 `await el.play()` 回来之后必须对号 —— 对不上就说明这次操作已经作废，
   * 不许再改状态、不许再停止元素。
   */
  private switchToken = 0;
  /**
   * 同一时刻最多一条启动在飞。**显式** `play()` 与自动恢复共用这一个登记位：
   * 入场页那次点击里 `music.play()` 之后紧跟着 `audioUnlock()` → `retryIfIdle()`，
   * 后者必须看到"已经有一条在飞"而让开，否则同一个元素上会有两条并发 `el.play()`。
   */
  private startInFlight: Promise<boolean> | null = null;
  /** 后台预热另一套主题曲子的定时器 */
  private warmTimer = 0;

  constructor(store: AppStore, options: { autoStart?: boolean } = {}) {
    super();
    this.store = store;
    this.volume = clamp01(readNumber(KEY.volume, AUDIO.volume));
    this.muted = readBool(KEY.muted, false);
    // 兼容既有用户：还是读 space.paused，只是内部换成正向的 shouldPlay
    this.shouldPlay = !readBool(KEY.paused, false);
    // 默认允许自动起播；入场页那趟由 app.ts 明确传 false（见 autoStart 的说明）
    this.autoStart = options.autoStart ?? true;

    // 当前曲目由主题推导（theme profile）：刷新之后曲目一定和主题一致，
    // 不可能出现「主题是 modern，却在放彩蛋曲」这种错位。
    const wanted = trackForTheme(store.get().theme);
    this.trackId = getTrack(wanted) ? wanted : DEFAULT_TRACK_ID;
    this.syncState();

    /*
     * 自己管自己的恢复，不靠任何 UI：切回这个标签页 / 从 bfcache 回来时，
     * 只要"应该响而没响"就再试一次（都走统一的自动启动那一枪）。
     * 被自动播放策略拦下的那一种，等 `audio-unlock.ts` 在页面第一次真实手势时
     * 统一再来（这里不自己挂手势监听）。
     */
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.retryIfIdle();
    });
    window.addEventListener("pageshow", () => this.retryIfIdle());
  }

  /* ---------------- 用户意图（唯一可以写它的地方） ---------------- */

  /**
   * 用户明确要播（播放按钮 / 入场页那次点击 / 换主题）。
   *
   * 写 `shouldPlay = true` 之后：取消还没跑完的淡出与"待执行暂停"（450ms 内又点播放的
   * 竞争就靠这个解决），作废在飞的旧操作，拿到自己的操作号，再走**同一条**启动路径
   * （`startElement()`）。**不 seek**：同一个元素停在哪儿就从哪儿继续。
   *
   * About 让位期间只记意图、不抢 MIDI 的音频焦点。
   */
  async play(): Promise<void> {
    this.shouldPlay = true;
    writeBool(KEY.paused, false);
    this.stopFades();
    this.switchToken += 1;

    if (this.inAbout) {
      this.emit();
      return;
    }

    const token = this.switchToken;
    const el = this.ensureElement();
    this.restorePositionOnce(el, this.trackId);
    const running = this.startElement(el, token);
    // 登记在飞：同一次手势里紧随其后的 audioUnlock() → retryIfIdle() 会因此让开
    this.trackStartInFlight(running);
    const started = await running;
    if (started && token === this.switchToken) this.warmOtherTrack();
  }

  /**
   * 用户明确暂停：写 `shouldPlay = false`（UI 立刻会通过 `getState()` 得到 paused），
   * 立即把当前进度落盘，作废在飞的启动 / 切换，然后按原来的 450ms 淡出再真的 `pause()`。
   * 淡出期间用户又点播放的话，`play()` 的 `stopFades()` 会把这段淡出连同它的
   * `done`（那次 `el.pause()`）一起取消。
   */
  pause(): void {
    this.shouldPlay = false;
    writeBool(KEY.paused, true);
    this.switchToken += 1;
    this.stopFades();

    const el = this.el;
    if (el) {
      if (this.positionRestored.has(el)) savePosition("track:" + this.trackId, el.currentTime);
      this.fadeFrame = ramp(
        el.volume,
        0,
        AUDIO.fadeOutMs,
        (value) => {
          el.volume = value;
        },
        () => el.pause(),
      );
    }
    this.emit();
  }

  toggle(): void {
    /*
     * 不能只看 `shouldPlay`：`shouldPlay === true` 但 autoplay 被浏览器挡住时，
     * 用户点按钮应该是"播放"而不是"暂停"；也不能只看元素，否则暂停中的元素
     * 一旦被浏览器自己 pause 过就永远切不回来。
     * 三种情况：用户暂停中 → play；用户确实在播 → pause；想播但没响起来 → play。
     */
    if (!this.shouldPlay) {
      void this.play();
      return;
    }
    if (this.isPlaying()) {
      this.pause();
      return;
    }
    void this.play();
  }

  /**
   * ThemeManager 的"同一首主题曲"路径（换主题 = 明确要听这一首）。
   * 已经在播就什么都不做，否则走显式 `play()`（由它写下 `shouldPlay = true`）。
   */
  resume(): void {
    if (this.isPlaying() && this.shouldPlay) return;
    void this.play();
  }

  /* ---------------- 自动恢复（唯一一条路，同一时刻最多一条在飞） ---------------- */

  /**
   * 手势解锁 / boot 用：让"该响而没响"的这首接上。
   * 幂等，尊重 `shouldPlay` / About 让位 / 入场页闸门；真正的启动交给 `requestAutoStart()`。
   */
  retryIfIdle(): void {
    if (!this.shouldPlay || this.inAbout || !this.autoStart || this.isPlaying()) return;
    this.requestAutoStart();
  }

  /** 页面加载后调用：这一趟该不该自己响，只在这里决定一次 */
  init(): void {
    if (!this.shouldPlay || this.inAbout || !this.autoStart) {
      this.emit();
      return;
    }
    this.requestAutoStart();
  }

  /**
   * 统一的自动启动：`init()` / `retryIfIdle()`（canplay / pageshow / visibilitychange /
   * audio-unlock 都汇到 retryIfIdle）最终只走这里。
   * 已经有自动启动在飞 → 直接返回，绝不再发第二枪。
   */
  private requestAutoStart(): void {
    if (this.startInFlight) return;
    if (!this.shouldPlay || this.inAbout || !this.autoStart || this.isPlaying()) return;

    this.switchToken += 1;
    const token = this.switchToken;
    const el = this.ensureElement();
    this.restorePositionOnce(el, this.trackId);
    this.trackStartInFlight(this.startElement(el, token));
  }

  /** 登记一次"启动在飞"，结束（成功或失败）后只由它自己释放这个位置 */
  private trackStartInFlight(running: Promise<boolean>): void {
    this.startInFlight = running;
    const clear = (): void => {
      if (this.startInFlight === running) this.startInFlight = null;
    };
    void running.then(clear, clear);
  }

  /**
   * 真正调一次 `el.play()`（显式播放与自动恢复共用）。
   *
   * `await` 回来先对号：这次操作还是最新的、元素还是当前那一个，才允许改状态 / 音量；
   * 过期的操作只许安静退场（旧元素已经不是当前曲目时顺手停掉它）。
   * 失败**不**改 `shouldPlay`、也不伪装成 paused —— `getState()` 自然给出 ready，
   * 下一次可信手势或 `canplay` 还能再来。
   */
  private async startElement(el: HTMLAudioElement, token: number): Promise<boolean> {
    try {
      await el.play();
    } catch {
      if (token === this.switchToken) this.emit();
      return false;
    }

    if (token !== this.switchToken || this.el !== el) {
      if (this.el !== el) {
        el.volume = 0;
        el.pause();
      }
      return false;
    }

    this.mediaError = false;
    this.applyVolumeForStart();
    this.emit();
    return true;
  }

  /* ---------------- About / MIDI：只抢音频焦点 ---------------- */

  /**
   * 进入 / 离开 About（MIDI 演奏期间让位）。
   * **绝不修改 `shouldPlay`** —— 用户意图留着，回来时按它决定要不要接着放；
   * 也不再需要"进来之前想不想播"这种第二份意图。
   */
  setAboutActive(active: boolean): void {
    if (active === this.inAbout) return;
    this.inAbout = active;
    this.ducked = active;
    // 焦点被抢走 / 还回来：在飞的启动与切换都作废
    this.switchToken += 1;
    this.stopFades();

    if (active) {
      for (const el of this.elements.values()) {
        if (el === this.el && this.positionRestored.has(el))
          savePosition("track:" + this.trackId, el.currentTime);
        el.volume = 0;
        el.pause();
      }
      this.emit();
      return;
    }

    // 离开 About：唯一判据是 shouldPlay（不再猜"进来之前想不想播"）
    const wanted = trackForTheme(this.store.get().theme);
    if (wanted !== this.trackId) {
      void this.crossfadeTo(wanted);
      return;
    }
    if (this.shouldPlay) {
      this.requestAutoStart();
      return;
    }
    this.emit();
  }

  /* ---------------- 对外接口（与重构前保持兼容） ---------------- */

  get track(): Track {
    return getTrack(this.trackId) ?? getTrack(DEFAULT_TRACK_ID)!;
  }

  /**
   * 明确解除 / 恢复"允许自动起播"（由 app.ts 与 entry-gate.ts 调用，见 autoStart）。
   * 只翻这个状态，不顺手起播：解除它的那一次是入场页里的真实手势，
   * 入场页自己会在同一个手势里调 `play()`（见 entry-gate.ts）。
   */
  setAutoStart(allowed: boolean): void {
    this.autoStart = allowed;
  }

  /**
   * 现场推导，不缓存。`active` 必然意味着当前元素真的在响 ——
   * 不会出现"状态说在播、元素其实停着"的分裂。
   */
  getState(): MusicState {
    if (this.mediaError) return "error";
    if (!this.shouldPlay) return "paused";
    if (this.inAbout) return "paused";
    if (this.isPlaying()) return "active";
    return this.el ? "ready" : "idle";
  }

  getVolume(): number {
    return this.volume;
  }

  /** Temporary audio focus for the About MIDI performance; does not change saved preferences. */
  setDucked(value: boolean): void {
    this.ducked = this.inAbout || value;
    this.applyVolume(true);
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 只读当前元素的事实；不按保存位置 / 不按任何缓存伪造进度 */
  getProgress(): { currentTime: number; duration: number; ratio: number } {
    const el = this.el;
    const duration = el && Number.isFinite(el.duration) ? el.duration : 0;
    const currentTime = el?.currentTime ?? 0;
    return {
      currentTime,
      duration,
      ratio: duration > 0 ? currentTime / duration : 0,
    };
  }

  /** 用户拖进度条：`currentTime` 的另一个（也是唯一另一个）写入点 */
  seekToRatio(ratio: number): void {
    const el = this.ensureElement();
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    const next = clamp01(ratio) * el.duration;
    el.currentTime = next;
    this.finishPositionRestore(el);
    savePosition("track:" + this.trackId, next);
    this.emit();
  }

  setVolume(value: number): void {
    const next = clamp01(value);
    this.volume = next;
    writeNumber(KEY.volume, next);
    if (next > 0 && this.muted) {
      this.setMuted(false);
    }
    this.applyVolume();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    writeBool(KEY.muted, value);
    this.applyVolume();
    this.emit();
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /** 真实在不在响：直接看元素，不信任何缓存 */
  isPlaying(): boolean {
    const el = this.el;
    return !!el && !el.paused && !el.ended && el.readyState >= 2;
  }

  /* ---------------- 切曲（每首曲子各自的 element + 各自的进度） ---------------- */

  /**
   * 交叉淡入淡出地切换到另一首曲子。
   *
   * - 目标文件不存在：静默失败，当前音乐继续；
   * - `force`：来自一次明确的用户动作（换主题）= "我要听这套主题的音乐" →
   *   写 `shouldPlay = true`；
   * - About 期间：只把"当前曲目"切过去（不出声、不动 `shouldPlay`），
   *   离开 About 时按 `shouldPlay` 决定要不要播；
   * - **不再先 `await waitForCanPlay()`**：那会把用户手势链拖断。直接
   *   `incoming.play()`（浏览器自己会等媒体 ready），旧曲在它真正起播前继续响；
   *   新曲的进度由 `restorePositionOnce()` 负责（metadata 到位时补上，用过的元素
   *   里就是它自己的真实进度，不会再被 storage 覆盖）。
   */
  async crossfadeTo(
    trackId: string,
    options: { ms?: number; force?: boolean } = {},
  ): Promise<boolean> {
    const { ms = AUDIO.crossfadeMs, force = false } = options;
    const next = getTrack(trackId);
    if (!next) return false;

    if (force) {
      this.shouldPlay = true;
      writeBool(KEY.paused, false);
    }

    // 连续快速切换时只有最后一次算数：拿到自己的号，中途被顶替就作废
    const token = (this.switchToken += 1);
    this.stopFades();

    const previous = this.el;
    // 旧曲的进度存在它自己的元素里，切走之前落盘
    if (previous && this.positionRestored.has(previous))
      savePosition("track:" + this.trackId, previous.currentTime);

    const incoming = this.elementFor(next);
    // 新曲只需要"接管时恢复一次"；本次文档用过的元素里就是它自己的真实进度
    this.restorePositionOnce(incoming, next.id);

    if (incoming === previous) {
      this.trackId = next.id;
      this.syncState();
      if (!this.inAbout && this.shouldPlay && !this.isPlaying()) this.requestAutoStart();
      this.emit();
      return true;
    }

    // 过期的异步切歌可能已经启动了一个尚未成为 this.el 的元素：
    // 只允许当前曲目继续响，其余全部静音停掉
    for (const element of this.elements.values()) {
      if (element === previous) continue;
      element.volume = 0;
      element.pause();
    }
    // 进来的那首可能还留着残影（音量没归零就不会淡入）
    incoming.volume = 0;

    if (this.inAbout) {
      // About 期间只换"当前曲目"，不抢 MIDI 焦点：离开 About 再由 shouldPlay 决定
      previous?.pause();
      this.el = incoming;
      this.trackId = next.id;
      this.fellBack = false;
      this.syncState();
      this.emit();
      return true;
    }

    let started = false;
    if (this.shouldPlay) {
      try {
        await incoming.play();
        started = true;
      } catch {
        /* 浏览器不让播：不动 shouldPlay，留 READY 等下一次可信手势 / canplay */
      }
    }

    // 等待期间用户又暂停 / 又切了一次 / 进了 About：这次不算，让新的那次说了算
    if (token !== this.switchToken) {
      if (incoming !== this.el) {
        incoming.volume = 0;
        incoming.pause();
      }
      return false;
    }

    this.el = incoming;
    this.trackId = next.id;
    this.fellBack = false;
    if (started) this.mediaError = false;
    this.syncState();

    const target = this.muted || this.ducked ? 0 : this.volume;

    if (!started) {
      // 没在放（用户暂停 / 被浏览器拦下）：音量先摆好，不做淡入；旧曲停掉
      incoming.volume = target;
      previous?.pause();
    } else {
      this.fadeFrames.push(
        ramp(previous?.volume ?? 0, 0, ms, (value) => {
          if (previous) previous.volume = value;
        }),
      );
      this.fadeFrames.push(
        ramp(incoming.volume, target, ms, (value) => {
          incoming.volume = value;
        }),
      );
      // 淡出结束再停旧的；万一它已经又变成当前元素，就别停
      this.pauseTimer = window.setTimeout(() => {
        if (this.el === previous) return;
        previous?.pause();
      }, ms + 60);
    }

    this.emit();
    // 切过去之后，下一首同样值得提前缓冲（用户来回切主题时尤其明显）
    if (started) this.warmOtherTrack();
    return true;
  }

  /* ---------------- 元素与进度恢复 ---------------- */

  private elementFor(track: Track): HTMLAudioElement {
    const cached = this.elements.get(track.id);
    if (cached) return cached;
    const el = this.buildElement(track);
    this.elements.set(track.id, el);
    return el;
  }

  /**
   * 当前曲目的唯一元素。只做三件事：找到它、设为当前、请求恢复一次进度。
   * 这里**不**播放、**不**改 `shouldPlay`。
   */
  private ensureElement(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = this.elementFor(this.track);
    this.el = el;
    this.mediaError = false;
    this.restorePositionOnce(el, this.trackId);
    return el;
  }

  /** 恢复完成后拆掉等待监听；显式拖动也用它取消尚未完成的自动恢复。 */
  private finishPositionRestore(el: HTMLAudioElement): void {
    this.positionRestored.add(el);
    this.positionRestorePending.delete(el);
    this.cancelPositionRestore.get(el)?.();
    this.cancelPositionRestore.delete(el);
  }

  /**
   * 保存的位置在第一次接管元素时取快照，等浏览器给出有效时长才 seek。
   * iOS 的 loadedmetadata 可能先于有效 duration；只监听一次会永久错过恢复。
   * 在恢复完成前也不能把从 0 起播的 timeupdate 写回 storage 覆盖这份快照。
   */
  private restorePositionOnce(el: HTMLAudioElement, id: string): void {
    if (this.positionRestored.has(el) || this.positionRestorePending.has(el)) return;
    const saved = savedPosition("track:" + id, 0);
    if (saved === 0) {
      this.finishPositionRestore(el);
      return;
    }

    const tryRestore = (): void => {
      if (el.readyState < 1 || !Number.isFinite(el.duration) || el.duration <= 0) return;
      try {
        el.currentTime = saved % el.duration;
      } catch {
        return; // 资源尚不可 seek；下一个媒体事件再试。
      }
      this.finishPositionRestore(el);
    };
    const events = ["loadedmetadata", "durationchange", "canplay"] as const;
    this.positionRestorePending.add(el);
    for (const event of events) el.addEventListener(event, tryRestore);
    this.cancelPositionRestore.set(el, () => {
      for (const event of events) el.removeEventListener(event, tryRestore);
    });
    tryRestore();
  }

  /**
   * 建一个绑好事件的音频元素。
   * 原生事件**只报告事实**：不写 `shouldPlay`、不写"伪状态"、不改 `currentTime`，
   * 最多调一次 `emit()` / `retryIfIdle()`，让 UI 与自动恢复重新读现场。
   */
  private buildElement(track: Track): HTMLAudioElement {
    const el = new Audio();
    el.preload = "auto";
    el.loop = true;
    el.volume = 0;
    el.src = track.src;

    el.addEventListener("playing", () => {
      if (this.el === el) this.emit();
    });

    // 浏览器自己 pause（系统打断、后台标签、切换元素…）不是"用户暂停"：只报告
    el.addEventListener("pause", () => {
      if (this.el === el) this.emit();
    });

    el.addEventListener("timeupdate", () => {
      if (this.el === el && !el.paused && this.positionRestored.has(el))
        savePosition("track:" + track.id, el.currentTime);
    });

    /*
     * 文件就绪而音乐还没响（刷新后常遇到：play() 那一枪打在"还没加载好"上，
     * 或者被自动播放策略挡了）—— 自己再试一次，不用等用户滚到某个位置或点某个 UI。
     * 走的还是统一那条自动启动（同一时刻最多一条在飞）。
     */
    el.addEventListener("canplay", () => {
      if (this.el === el && this.shouldPlay && !this.inAbout && this.autoStart && el.paused) {
        this.retryIfIdle();
      }
    });

    el.addEventListener("error", () => {
      if (this.el !== el) return;
      // 记忆里的曲目放不出来（文件被删了 / 格式不支持）：把坏掉的元素丢掉，
      // 安静地退回默认曲目。放文件进去就能用，不需要改代码。
      if (this.trackId !== DEFAULT_TRACK_ID && !this.fellBack) {
        this.fellBack = true;
        this.elements.delete(this.trackId);
        void this.crossfadeTo(DEFAULT_TRACK_ID, { force: true });
        return;
      }
      // 默认曲目也放不出来：记下真实 media error，不打扰访客
      this.mediaError = true;
      this.emit();
    });

    return el;
  }

  /**
   * 后台把**另一套主题的曲子**先缓冲好。
   *
   * 为什么需要：两首主题曲分别是 5.2MB / 4.3MB，切主题时若那首还没下载过，
   * 手机上是"UI 已经变成本主题、歌还愣在上一首 / 干脆没声"，要等几秒才跟上（本人实测）。
   * 所以第一次播放稳定之后（5 秒）悄悄把另一首拉下来 —— 切主题时它已经就绪。
   *
   * 预热只做两件事：建缓存元素、`load()`。**不**改 this.el / trackId / shouldPlay，
   * **不**恢复进度、**不**播放；那个元素保持 paused + volume 0，直到真被选为当前曲目。
   */
  private warmOtherTrack(): void {
    window.clearTimeout(this.warmTimer);
    this.warmTimer = window.setTimeout(() => {
      // 用户开了省流量模式就别自作主张下 4MB
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection;
      if (connection?.saveData) return;

      const other = THEMES.map((theme) => trackForTheme(theme)).find((id) => id !== this.trackId);
      const track = other ? getTrack(other) : undefined;
      if (!track) return;

      // elementFor 会把元素留在 elements 里，切主题时直接复用这个已经缓冲好的
      const el = this.elementFor(track);
      if (el.readyState >= 3) return;
      try {
        el.load();
      } catch {
        /* 预加载失败无所谓，真正切主题时会再走一次统一的启动 */
      }
    }, 5000);
  }

  /* ---------------- 内部小工具 ---------------- */

  /** 把「当前曲目」写回统一状态（播放器标题等都用它） */
  private syncState(): void {
    this.store.set({ currentTrack: this.trackId }, { persist: false });
  }

  private applyVolume(immediate = false): void {
    const el = this.el;
    if (!el) return;

    const target = this.muted || this.ducked ? 0 : this.volume;
    this.fadeFrame();

    if (this.isPlaying() && !immediate) {
      this.fadeFrame = ramp(el.volume, target, 240, (value) => {
        el.volume = value;
      });
      return;
    }

    if (immediate) {
      this.fadeFrame = ramp(el.volume, target, AUDIO.fadeInMs, (value) => {
        el.volume = value;
      });
      return;
    }

    el.volume = target;
  }

  /**
   * 起播时的音量。
   *
   * **本次文档的第一次**：直接摆到目标音量 —— 元素刚建出来时 volume 是 0，
   * 按老写法要从 0 淡入 2.4 秒，曲子开头那一下（第一拍）就一直压在几乎听不见的音量里，
   * 听起来就是"开头没播出来 / 网络还没加载好 timeline 就先走了"（本人报的 Bug 2）。
   * 之后（暂停再继续、切回已经放过的曲子）：保持原来那点淡入，避免突然一响。
   */
  private applyVolumeForStart(): void {
    const el = this.el;
    if (!el) return;
    const target = this.muted || this.ducked ? 0 : this.volume;
    this.fadeFrame();
    if (!this.audibleOnce) {
      this.audibleOnce = true;
      el.volume = target;
      return;
    }
    this.fadeFrame = ramp(el.volume, target, AUDIO.fadeInMs, (value) => {
      el.volume = value;
    });
  }

  /** 取消所有还在跑的淡入淡出与"淡出结束再 pause"的待执行动作 */
  private stopFades(): void {
    this.fadeFrame();
    this.fadeFrames.forEach((cancel) => cancel());
    this.fadeFrames = [];
    if (this.pauseTimer) {
      window.clearTimeout(this.pauseTimer);
      this.pauseTimer = 0;
    }
  }

  private emit(): void {
    this.dispatchEvent(new CustomEvent("change"));
  }
}
