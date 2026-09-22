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
import { readBool, readNumber, readString, writeBool, writeNumber } from "./storage";
import { describeError, describeMediaElement, recordAudioFlight } from "./audio-flight-recorder";
import type { AppStore } from "./app-state";

export type MusicState = "idle" | "ready" | "active" | "paused" | "error";

const KEY = {
  volume: "space.volume",
  muted: "space.muted",
  paused: "space.paused",
};

/** 诊断用：这些原生事件全记一条（只观察，不 preventDefault、不 play/pause） */
const FLIGHT_MEDIA_EVENTS = [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "pause",
  "waiting",
  "stalled",
  "suspend",
  "abort",
  "emptied",
  "error",
  "ended",
] as const;

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
  private el: HTMLAudioElement | null = null;
  private trackId: string = DEFAULT_TRACK_ID;
  private volume: number;
  private muted: boolean;
  private ducked = false;
  private inAbout = false;
  /** 进入 MIDI 演奏前，主题音乐是否应在离开后继续。 */
  private resumeAfterAbout = false;
  private state: MusicState = "idle";
  private fadeFrame: () => void = () => {};
  private userPaused: boolean;
  /**
   * 现在允不允许**自动**起播（不包含用户明确的 play()）。
   *
   * 入场页还立着、这一趟又没点过"进入"时，必须为 false：一首 4–5MB 的曲子不该在
   * 用户还没进门时就被建出来、下载、播放。这件事由外面明确告诉它 —— `app.ts` 在
   * 建这个实例时按"页面上有没有入场页 + 这一趟进没进过"传进来，`entry-gate.ts`
   * 在用户点"进入"的那次手势里解除。MusicManager **不自己查 DOM**。
   *
   * 只管自动启动：`pageshow` / `visibilitychange` / `canplay` / 手势兜底这几条
   * 恢复路径都要经过它；入场页按钮里那次真实的 `play()` 不走这里。
   */
  private autoStart: boolean;
  private fellBack = false;
  /**
   * 本次文档里这首歌**已经响过一次**没有。
   * 第一次起播不要把音量从 0 淡上来：那 2.4 秒会把曲子开头吃掉
   * （timeline 在走、声音几乎是 0 —— 听着就像"第一拍没播出来"）。
   */
  private audibleOnce = false;
  /**
   * 每首曲子只建一个 <audio> 并留着。
   * 切回已经放过的曲子时文件已经缓冲好，不用重新下载、也不会卡在等
   * canplay 上 —— 这是"切回去没声音"最常见的原因。
   */
  private readonly elements = new Map<string, HTMLAudioElement>();
  /** 交叉淡入淡出自己的 rAF 与延时：下一次切换前要先把它们停掉 */
  private fadeFrames: (() => void)[] = [];
  private pauseTimer = 0;
  /** 只让最后一次切换生效，被打断的那次直接作废 */
  private switchToken = 0;
  /** 后台预热另一套主题曲子的定时器 */
  private warmTimer = 0;

  constructor(store: AppStore, options: { autoStart?: boolean } = {}) {
    super();
    this.store = store;
    this.volume = clamp01(readNumber(KEY.volume, AUDIO.volume));
    this.muted = readBool(KEY.muted, false);
    this.userPaused = readBool(KEY.paused, false);
    // 默认允许自动起播；入场页那趟由 app.ts 明确传 false（见 autoStart 的说明）
    this.autoStart = options.autoStart ?? true;

    // 当前曲目由主题推导（theme profile）：刷新之后曲目一定和主题一致，
    // 不可能出现「主题是 modern，却在放彩蛋曲」这种错位。
    const wanted = trackForTheme(store.get().theme);
    this.trackId = getTrack(wanted) ? wanted : DEFAULT_TRACK_ID;
    this.syncState();

    /*
     * 自己管自己的恢复，不靠任何 UI：切回这个标签页 / 从 bfcache 回来时，
     * 只要"应该响而没响"就再试一次。被自动播放策略拦下的那一种，等
     * `audio-unlock.ts` 在页面第一次真实手势时统一再来（这里不自己挂手势监听）。
     */
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.retryIfIdle();
    });
    window.addEventListener("pageshow", () => this.retryIfIdle());

    // 诊断：这一刻的全部启动条件（只读）
    recordAudioFlight("music.constructor", {
      autoStart: this.autoStart,
      userPaused: this.userPaused,
      muted: this.muted,
      inAbout: this.inAbout,
      trackId: this.trackId,
      state: this.state,
      storedPausedRaw: readString(KEY.paused, ""),
      storedVolumeRaw: readString(KEY.volume, ""),
    });
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
   * 手势解锁用：让"该响而没响"的这首接上（幂等，尊重 userPaused / About 让位 / 闸门）。
   * `audio-unlock.ts` 在第一次 pointerdown / keydown 时调它 —— 手势本身不等于
   * "要出声"，这里只恢复本来就应该播放的那一首。
   */
  retryIfIdle(): void {
    // 诊断：进来先把五个条件记下来；每个提前 return 都写清是哪一个
    recordAudioFlight("music.retryIfIdle.enter", {
      state: this.state,
      userPaused: this.userPaused,
      autoStart: this.autoStart,
      inAbout: this.inAbout,
      playing: this.isPlaying(),
    });
    if (this.userPaused) {
      recordAudioFlight("music.retryIfIdle.return", { reason: "userPaused" });
      return;
    }
    if (this.inAbout) {
      recordAudioFlight("music.retryIfIdle.return", { reason: "inAbout" });
      return;
    }
    if (!this.autoStart) {
      recordAudioFlight("music.retryIfIdle.return", { reason: "autoStart=false" });
      return;
    }
    if (this.isPlaying()) {
      recordAudioFlight("music.retryIfIdle.return", { reason: "already-playing" });
      return;
    }
    void this.attemptStart();
  }

  /** 把「真实在放的那首」写回统一状态，播放器显示的就是这个值 */
  private syncState(): void {
    this.store.set({ currentTrack: this.trackId }, { persist: false });
  }

  /**
   * 后台把**另一套主题的曲子**先缓冲好。
   *
   * 为什么需要：两首主题曲分别是 5.2MB / 4.3MB，而切主题走的 `crossfadeTo()`
   * 会先 `waitForCanPlay()`（最多等 6 秒）再交叉淡入。桌面网络快、或者曲子早已
   * 在缓存里，感觉是"瞬间切过去"；手机上一旦那首还没下载过，就会是
   * **UI 已经变成本主题、歌还愣在上一首 / 干脆没声**，要等几秒才跟上（本人实测）。
   * 所以第一次播放稳定之后（5 秒）悄悄把另一首拉下来 —— 切主题时它已经就绪。
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
        /* 预加载失败无所谓，到真正切主题时会再等一次 */
      }
    }, 5000);
  }

  get track(): Track {
    return getTrack(this.trackId) ?? getTrack(DEFAULT_TRACK_ID)!;
  }

  setAboutActive(active: boolean): void {
    // 诊断：About 让位是"刷新时被谁按住"的常见嫌疑，进出一共记两条
    recordAudioFlight("setAboutActive.enter", {
      active,
      inAbout: this.inAbout,
      state: this.state,
      playing: this.isPlaying(),
      userPaused: this.userPaused,
      resumeAfterAbout: this.resumeAfterAbout,
    });
    if (active === this.inAbout) {
      recordAudioFlight("setAboutActive.exit", { active, noop: true, state: this.state });
      return;
    }
    const leaving = this.inAbout && !active;

    // MIDI 只是临时取得音频焦点，不应篡改用户的播放/暂停偏好。
    // 进入前记住主题音乐是否本来就应该继续，离开后再按这个意图恢复。
    if (active) this.resumeAfterAbout = this.isPlaying() || !this.userPaused;

    this.inAbout = active;
    this.ducked = active;
    this.switchToken += 1;
    this.stopFades();
    this.fadeFrame();
    if (active) {
      for (const el of this.elements.values()) {
        if (el === this.el) savePosition("track:" + this.trackId, el.currentTime);
        el.volume = 0;
        el.pause();
      }
      this.setState("paused");
    } else if (leaving) {
      const shouldResume = this.resumeAfterAbout && !this.userPaused;
      this.resumeAfterAbout = false;
      const wanted = trackForTheme(this.store.get().theme);
      if (wanted !== this.trackId)
        void this.crossfadeTo(wanted);
      else if (shouldResume)
        void this.play();
      else
        this.setState("paused");
    }

    recordAudioFlight("setAboutActive.exit", {
      active,
      leaving,
      state: this.state,
      playing: this.isPlaying(),
      userPaused: this.userPaused,
    });
  }

  private syncLive(el: HTMLAudioElement, id: string): void {
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = savedPosition("track:" + id, el.duration);
  }

  getState(): MusicState {
    return this.state;
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

  seekToRatio(ratio: number): void {
    const el = this.ensureElement();
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    const next = clamp01(ratio) * el.duration;
    el.currentTime = next;
    savePosition("track:" + this.trackId, next);
    this.emit();
  }

  /** 页面加载后调用：能自动播就播，不能就等第一次交互。 */
  init(): void {
    recordAudioFlight("music.init.enter", {
      state: this.state,
      userPaused: this.userPaused,
      autoStart: this.autoStart,
      inAbout: this.inAbout,
      playing: this.isPlaying(),
    });
    if (this.inAbout) {
      recordAudioFlight("music.init.return", { reason: "inAbout" });
      return;
    }
    if (!this.autoStart) {
      recordAudioFlight("music.init.return", { reason: "autoStart=false" });
      return;
    }
    if (this.isPlaying()) {
      recordAudioFlight("music.init.return", { reason: "already-playing" });
      return;
    }
    if (this.userPaused) {
      recordAudioFlight("music.init.return", { reason: "userPaused" });
      this.setState("paused");
      return;
    }
    void this.attemptStart();
  }

  /**
   * 被浏览器拦下自动播放时**不再自己挂手势监听**：全局的手势解锁统一由
   * `audio-unlock.ts` 负责，它会在第一次 pointerdown / keydown 时调 `retryIfIdle()`。
   * 这里只是把状态标成 ready，等那只手落下来。
   *
   * （本轮只在这里插诊断记录，控制流一行没改。）
   */
  private async attemptStart(): Promise<void> {
    recordAudioFlight("attemptStart.enter", {
      state: this.state,
      inAbout: this.inAbout,
      userPaused: this.userPaused,
      autoStart: this.autoStart,
      trackId: this.trackId,
      playing: this.isPlaying(),
    });
    if (this.inAbout) {
      recordAudioFlight("attemptStart.return", { reason: "inAbout" });
      return;
    }
    const el = this.ensureElement();
    recordAudioFlight("attemptStart.element", {
      trackId: this.trackId,
      current: this.el === el,
      ...describeMediaElement(el),
    });
    try {
      recordAudioFlight("attemptStart.beforeSync", { trackId: this.trackId });
      this.syncLive(el, this.trackId);
      recordAudioFlight("attemptStart.afterSync", {
        currentTime: Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(3)) : null,
      });
      recordAudioFlight("attemptStart.beforePlay", {
        state: this.state,
        current: this.el === el,
        ...describeMediaElement(el),
      });
      await el.play();
      recordAudioFlight("attemptStart.playResolved", {
        current: this.el === el,
        inAbout: this.inAbout,
        ...describeMediaElement(el),
      });
      if (this.inAbout || this.el !== el) {
        recordAudioFlight("attemptStart.pausingStaleElement", {
          current: this.el === el,
          inAbout: this.inAbout,
        });
        el.pause();
        return;
      }
      this.setState("active");
      this.applyVolumeForStart();
    } catch (error) {
      recordAudioFlight("attemptStart.playRejected", {
        ...describeError(error),
        current: this.el === el,
        inAbout: this.inAbout,
        ...describeMediaElement(el),
      });
      this.setState("ready");
    }
  }

  /**
   * 建一个绑好事件的音频元素。
   * 所有事件都先确认自己仍是「当前元素」——换曲之后，旧元素的事件要失效。
   */
  private buildElement(track: Track): HTMLAudioElement {
    const el = new Audio();
    /*
     * 诊断：原生媒体事件的只读监听（只观察。**不** preventDefault、**不** play/pause，
     * 也不影响下面那些既有监听的行为）。element 事件是"谁把声音停了"的第一现场，
     * 尤其是 pause / waiting / stalled / error。
     */
    for (const type of FLIGHT_MEDIA_EVENTS) {
      el.addEventListener(type, () => {
        recordAudioFlight(`media.${type}`, {
          trackId: track.id,
          current: this.el === el,
          musicState: this.state,
          inAbout: this.inAbout,
          userPaused: this.userPaused,
          ...describeMediaElement(el),
        });
      });
    }
    el.preload = "auto";
    el.loop = true;
    el.volume = 0;
    el.src = track.src;
    el.addEventListener("loadedmetadata", () => {
      if (this.el === el && !this.inAbout) this.syncLive(el, track.id);
    });
    /*
     * 文件就绪而音乐还没响（刷新后常遇到：play() 那一枪打在"还没加载好"上，
     * 或者被自动播放策略挡了）—— 自己再试一次，不用等用户滚到某个位置或点某个 UI。
     */
    el.addEventListener("canplay", () => {
      if (this.el === el && el.paused) this.retryIfIdle();
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
      // 默认曲目也放不出来：停在 error，不打扰访客
      this.setState("error");
    });

    el.addEventListener("pause", () => {
      if (this.el !== el) return;
      if (this.state === "active") this.setState("paused");
    });

    el.addEventListener("playing", () => {
      if (this.el !== el) return;
      this.setState("active");
    });
    el.addEventListener("timeupdate", () => {
      if (this.el === el && !el.paused) savePosition("track:" + track.id, el.currentTime);
    });

    return el;
  }

  private elementFor(track: Track): HTMLAudioElement {
    const cached = this.elements.get(track.id);
    if (cached) return cached;
    const el = this.buildElement(track);
    this.elements.set(track.id, el);
    return el;
  }

  private ensureElement(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = this.elementFor(this.track);
    this.el = el;
    return el;
  }

  async play(): Promise<void> {
    recordAudioFlight("explicitPlay.enter", {
      state: this.state,
      inAbout: this.inAbout,
      userPaused: this.userPaused,
      autoStart: this.autoStart,
      trackId: this.trackId,
      playing: this.isPlaying(),
    });
    if (this.inAbout) {
      recordAudioFlight("explicitPlay.return", { reason: "inAbout" });
      return;
    }
    this.userPaused = false;
    writeBool(KEY.paused, false);
    // 用户明确要播：把还没跑完的切换作废，以这次为准
    this.switchToken += 1;
    this.stopFades();
    const el = this.ensureElement();
    try {
      this.syncLive(el, this.trackId);
      recordAudioFlight("explicitPlay.beforePlay", {
        trackId: this.trackId,
        current: this.el === el,
        ...describeMediaElement(el),
      });
      await el.play();
      recordAudioFlight("explicitPlay.resolved", {
        current: this.el === el,
        inAbout: this.inAbout,
        ...describeMediaElement(el),
      });
      if (this.inAbout || this.el !== el) {
        el.pause();
        return;
      }
      this.setState("active");
      this.applyVolumeForStart();
      // 播放稳定之后，后台把另一套主题的曲子也缓冲好（见 warmOtherTrack）
      this.warmOtherTrack();
    } catch (error) {
      /*
       * 被浏览器拦下（或那一次手势被系统弹窗吃掉）时挂上一次性监听，
       * 等下一次交互自己再试 —— 之前这里只把状态标成 ready 就完了，
       * 用户再按播放键也可能还是不出声，只能刷新页面（本人实测）。
       * 现在不自己挂监听了：等页面第一次真实手势由 audio-unlock.ts 统一再来一次。
       */
      recordAudioFlight("explicitPlay.rejected", {
        ...describeError(error),
        current: this.el === el,
        inAbout: this.inAbout,
        ...describeMediaElement(el),
      });
      this.setState("ready");
    }
  }

  pause(): void {
    this.userPaused = true;
    writeBool(KEY.paused, true);
    const el = this.el;
    this.switchToken += 1;
    this.stopFades();
    // 诊断：找出是谁把音乐按停了（只读，签名与行为都不动）
    recordAudioFlight("pause.called", {
      state: this.state,
      hasElement: Boolean(el),
      trackId: this.trackId,
      playing: this.isPlaying(),
      stack: (() => {
        try {
          return new Error().stack ?? null;
        } catch {
          return null;
        }
      })(),
      ...(el ? describeMediaElement(el) : {}),
    });
    if (!el) {
      this.setState("paused");
      return;
    }
    savePosition("track:" + this.trackId, el.currentTime);
    this.fadeFrame();
    this.fadeFrame = ramp(
      el.volume,
      0,
      AUDIO.fadeOutMs,
      (value) => {
        el.volume = value;
      },
      () => el.pause(),
    );
    this.setState("paused");
  }

  toggle(): void {
    // 诊断：按下去之前"UI 觉得"和"元素实际"各是什么
    recordAudioFlight("toggle.called", {
      state: this.state,
      playing: this.isPlaying(),
      userPaused: this.userPaused,
      inAbout: this.inAbout,
      trackId: this.trackId,
    });
    // 看元素本身，不看缓存的状态：状态说 active 但元素其实停着的话，
    // 按一次按钮必须能真的放出声，而不是把"暂停"再按一遍。
    if (this.isPlaying()) {
      this.pause();
    } else {
      void this.play();
    }
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
   * 缓存的曲子、已经在元素里的位置都不动，点下去就按目标音量出声。
   *
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

  /**
   * 交叉淡入淡出地切换到另一首曲子。
   * - 目标文件不存在时什么都不做（静默失败），当前音乐继续播放。
   * - force：这次切换来自一次明确的用户动作（换主题），等于"我要听这套主题
   *   的音乐"，所以会清掉之前的暂停，换完是真的出声，而不只是换个名字。
   */
  async crossfadeTo(
    trackId: string,
    options: { ms?: number; force?: boolean } = {},
  ): Promise<boolean> {
    const { ms = AUDIO.crossfadeMs, force = false } = options;
    const next = getTrack(trackId);
    if (!next) return false;

    if (this.inAbout) {
      // 在 MIDI 演奏期间切主题仍代表一次明确的“我要听这套主题”操作。
      if (force) {
        this.clearPause();
        this.resumeAfterAbout = true;
      }
      this.switchToken += 1;
      this.stopFades();
      this.el?.pause();
      this.el = this.elementFor(next);
      this.el.volume = 0;
      this.el.pause();
      this.trackId = next.id;
      this.syncState();
      return true;
    }

    // 连续快速切换时只有最后一次算数：拿到自己的号，中途被顶替就作废
    const token = (this.switchToken += 1);
    if (force) this.clearPause();

    const previous = this.el;
    if (previous) savePosition("track:" + this.trackId, previous.currentTime);
    const incoming = this.elementFor(next);
    if (incoming === previous) return true;

    // 上一次还没跑完的淡入淡出 / 待执行的暂停，先全部取消
    this.stopFades();

    // 过期的异步切歌可能已经启动了一个尚未成为 this.el 的元素。
    // 新切换开始时只允许当前曲目继续参与交叉淡出，其余全部静音停掉。
    for (const element of this.elements.values()) {
      if (element === previous) continue;
      element.volume = 0;
      element.pause();
    }

    // 进来的那首可能还留着残影（音量没归零就不会淡入）：先归零
    incoming.volume = 0;

    try {
      // 等文件真的可以播放再切换，避免把正在放的曲子关掉却换不上新的
      await withTimeout(waitForCanPlay(incoming), 6000);
    } catch {
      // 目标放不出来：当前音乐继续，并让播放器回到"真实在放的那首"
      this.syncState();
      return false;
    }

    // 等待期间用户又切了一次：这次不算，让新的那次说了算
    if (token !== this.switchToken) {
      return false;
    }

    let started = false;
    if (!this.userPaused) {
      try {
        this.syncLive(incoming, next.id);
        await incoming.play();
        started = true;
      } catch {
        // 浏览器还是不让播：不硬来，等 audio-unlock 在第一次手势时统一再来
      }
    }

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

    const target = this.muted || this.ducked ? 0 : this.volume;

    if (!started) {
      // 没在放（用户暂停 / 被浏览器拦下）：音量先摆好，不做淡入
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

    this.syncState();
    this.setState(started ? "active" : this.userPaused ? "paused" : "ready");
    // 切过去之后，下一首同样值得提前缓冲（用户来回切主题时尤其明显）
    if (started) this.warmOtherTrack();
    return true;
  }

  /** 真实在不在响：直接看元素，不信缓存的状态 */
  isPlaying(): boolean {
    const el = this.el;
    return !!el && !el.paused && !el.ended && el.readyState >= 2;
  }

  /**
   * 只是因为暂停 / 被浏览器拦下才没在放，就把当前这首接上。
   * 注意这里判断的是元素本身：状态可能显示 active，但元素其实已经停了。
   */
  resume(): void {
    if (this.isPlaying() && this.state === "active") return;
    void this.play();
  }

  /** 取消所有还在跑的淡入淡出与待执行的暂停 */
  private stopFades(): void {
    this.fadeFrame();
    this.fadeFrames.forEach((cancel) => cancel());
    this.fadeFrames = [];
    if (this.pauseTimer) {
      window.clearTimeout(this.pauseTimer);
      this.pauseTimer = 0;
    }
  }

  private clearPause(): void {
    if (!this.userPaused) return;
    this.userPaused = false;
    writeBool(KEY.paused, false);
  }

  private setState(state: MusicState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    this.dispatchEvent(new CustomEvent("change"));
  }
}

function waitForCanPlay(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("audio-error"));
    };
    const cleanup = () => {
      el.removeEventListener("canplay", ok);
      el.removeEventListener("error", fail);
    };
    if (el.readyState >= 3) {
      resolve();
      return;
    }
    el.addEventListener("canplay", ok);
    el.addEventListener("error", fail);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
