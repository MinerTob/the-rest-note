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

export type MusicState = "idle" | "ready" | "active" | "paused" | "error";

const KEY = {
  volume: "space.volume",
  muted: "space.muted",
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
  private fallbackBound = false;
  private fellBack = false;
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

  constructor(store: AppStore) {
    super();
    this.store = store;
    this.volume = clamp01(readNumber(KEY.volume, AUDIO.volume));
    this.muted = readBool(KEY.muted, false);
    this.userPaused = readBool(KEY.paused, false);

    // 当前曲目由主题推导（theme profile）：刷新之后曲目一定和主题一致，
    // 不可能出现「主题是 modern，却在放彩蛋曲」这种错位。
    const wanted = trackForTheme(store.get().theme);
    this.trackId = getTrack(wanted) ? wanted : DEFAULT_TRACK_ID;
    this.syncState();
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
    if (active === this.inAbout) return;
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
    if (this.inAbout || this.isPlaying()) return;
    if (this.userPaused) {
      this.setState("paused");
      return;
    }
    void this.attemptStart();
  }

  /** 浏览器拦截自动播放时，挂一次性监听，等用户第一次交互后再初始化 */
  private bindAutoplayFallback(): void {
    if (this.fallbackBound) return;
    this.fallbackBound = true;

    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "touchstart",
    ];
    const onFirstGesture = () => {
      events.forEach((name) =>
        window.removeEventListener(name, onFirstGesture),
      );
      this.fallbackBound = false;
      if (!this.userPaused) void this.attemptStart();
    };
    events.forEach((name) =>
      window.addEventListener(name, onFirstGesture, {
        once: false,
        passive: true,
      }),
    );
  }

  private async attemptStart(): Promise<void> {
    if (this.inAbout) return;
    const el = this.ensureElement();
    try {
      this.syncLive(el, this.trackId);
      await el.play();
      if (this.inAbout || this.el !== el) {
        el.pause();
        return;
      }
      this.setState("active");
      this.applyVolume(true);
    } catch {
      this.setState("ready");
      this.bindAutoplayFallback();
    }
  }

  /**
   * 建一个绑好事件的音频元素。
   * 所有事件都先确认自己仍是「当前元素」——换曲之后，旧元素的事件要失效。
   */
  private buildElement(track: Track): HTMLAudioElement {
    const el = new Audio();
    el.preload = "auto";
    el.loop = true;
    el.volume = 0;
    el.src = track.src;
    el.addEventListener("loadedmetadata", () => {
      if (this.el === el && !this.inAbout) this.syncLive(el, track.id);
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
    if (this.inAbout) return;
    this.userPaused = false;
    writeBool(KEY.paused, false);
    // 用户明确要播：把还没跑完的切换作废，以这次为准
    this.switchToken += 1;
    this.stopFades();
    const el = this.ensureElement();
    try {
      this.syncLive(el, this.trackId);
      await el.play();
      if (this.inAbout || this.el !== el) {
        el.pause();
        return;
      }
      this.setState("active");
      this.applyVolume(true);
      // 播放稳定之后，后台把另一套主题的曲子也缓冲好（见 warmOtherTrack）
      this.warmOtherTrack();
    } catch {
      /*
       * 被浏览器拦下（或那一次手势被系统弹窗吃掉）时挂上一次性监听，
       * 等下一次交互自己再试 —— 之前这里只把状态标成 ready 就完了，
       * 用户再按播放键也可能还是不出声，只能刷新页面（本人实测）。
       */
      this.setState("ready");
      this.bindAutoplayFallback();
    }
  }

  pause(): void {
    this.userPaused = true;
    writeBool(KEY.paused, true);
    const el = this.el;
    this.switchToken += 1;
    this.stopFades();
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
        // 浏览器还是不让播：不硬来，等下一次手势
        this.bindAutoplayFallback();
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
