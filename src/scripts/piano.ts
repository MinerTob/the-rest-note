import {
  nearestSample,
  playbackRateFor,
  samplesForRange,
  type PianoSample,
} from "@/lib/piano";
import { MINILAB_FIRST_MIDI, MINILAB_KEY_COUNT } from "./notes";
import { describeError, recordAudioFlight } from "./audio-flight-recorder";

/**
 * Piano Sound Engine
 * ------------------------------------------------------------
 * 只做一件事：把 MIDI 音高变成钢琴声。
 * 它不碰背景音乐，背景音乐也不碰它 —— 两条链路完全独立。
 *
 * 用法：
 *   const piano = new PianoEngine();
 *   piano.noteOn(60, 0.8);   // 在用户手势里调用，AudioContext 才会解锁
 *   piano.noteOff(60);
 *
 * 采样没加载好之前 noteOn 是安静的（不会报错），加载完成后自动正常发声。
 */

export type PianoState = "idle" | "loading" | "ready" | "failed";

/** 力度 → 峰值增益。刻意压低，避免弹一下就爆音。 */
function peakFor(velocity: number): number {
  const v = Math.min(1, Math.max(0, velocity));
  return 0.045 + 0.2 * Math.pow(v, 1.4);
}

const ATTACK = 0.008;
const DECAY = 1.1;
const SUSTAIN = 0.42;
const RELEASE = 0.34;
/** 单音最长存活时间，防止 noteOff 丢失时留下挂住的声音 */
const MAX_HOLD = 9;
/** 采样最多分几轮下完（手机上一次请求被系统/网络打断是常事，见 preload()） */
const PRELOAD_ATTEMPTS = 4;
/** 上一轮没下完，隔多久补下一轮 */
const PRELOAD_RETRY_MS = 1500;

type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** 该重置的时候用它判断是不是同一个声音 */
  token: number;
};

export class PianoEngine extends EventTarget {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private voices = new Map<number, Voice>();
  private state: PianoState = "idle";
  private loading: Promise<void> | null = null;
  /** 已经下过几轮：给"补下漏掉的那几个"收口，免得一直空转 */
  private attempts = 0;
  /** 补下那一轮的定时器：dispose 要收掉 */
  private retryTimer = 0;
  private token = 0;
  private volume = 0.9;

  private scheduled = new Set<AudioBufferSourceNode>();
  private firstMidi: number;
  private lastMidi: number;
  private outputGain: number;
  constructor(
    firstMidi = MINILAB_FIRST_MIDI,
    lastMidi = MINILAB_FIRST_MIDI + MINILAB_KEY_COUNT - 1,
    outputGain = 1,
  ) {
    super();
    this.firstMidi = firstMidi;
    this.lastMidi = lastMidi;
    this.outputGain = outputGain;
  }
  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }
  get isRunning(): boolean {
    return this.ctx?.state === "running";
  }

  /** Audio-clock scheduling for MIDI playback, using the same samples and envelope as MiniLab. */
  scheduleNote(
    midi: number,
    velocity: number,
    start: number,
    end: number,
    elapsed = 0,
  ): void {
    const ctx = this.ctx,
      master = this.master,
      buffer = this.bufferFor(midi);
    if (!ctx || !master || !buffer || end <= ctx.currentTime) return;
    const at = Math.max(ctx.currentTime, start),
      off = Math.max(at + 0.01, end);
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRateFor(nearestSample(midi), midi);
    const sampleOffset = Math.max(0, elapsed) * source.playbackRate.value;
    if (sampleOffset >= buffer.duration) return;
    const peak = peakFor(velocity);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(
      peak,
      at + Math.min(ATTACK, (off - at) / 2),
    );
    const decayEnd = Math.min(at + ATTACK + DECAY, off);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(peak * SUSTAIN, 0.0002),
      decayEnd,
    );
    gain.gain.setValueAtTime(Math.max(peak * SUSTAIN, 0.0002), off);
    gain.gain.exponentialRampToValueAtTime(0.0001, off + RELEASE);
    source.connect(gain).connect(master);
    this.scheduled.add(source);
    source.onended = () => {
      this.scheduled.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(at, sampleOffset);
    source.stop(off + RELEASE + 0.02);
  }

  getState(): PianoState {
    return this.state;
  }

  /** 已解码的采样数 / 需要的总数，用于显示加载进度 */
  getLoadedRatio(): number {
    const wanted = this.requiredSamples.length || 1;
    return Math.min(1, this.buffers.size / wanted);
  }

  /**
   * 这个音现在有解码好的采样吗？
   * MiniLab 用它决定"这一下走采样还是先拿合成器顶上" —— 冷启动第一次按琴键时
   * 采样往往还在下载，不能让它变成"点了没反应"（见 §10）。
   */
  hasSampleFor(midi: number): boolean {
    return this.bufferFor(midi) !== null;
  }

  get requiredSamples(): PianoSample[] {
    return samplesForRange(this.firstMidi, this.lastMidi);
  }

  /**
   * 必须在用户手势里调用一次。
   * 浏览器不允许在交互之前创建/恢复 AudioContext。
   */
  ensure(): void {
    // 诊断：AudioContext 的每一次建/唤醒都记下来（只读，不动任何时机）
    recordAudioFlight("piano.ensure.enter", {
      hasContext: Boolean(this.ctx),
      contextState: this.ctx?.state ?? null,
      state: this.state,
      attempts: this.attempts,
    });
    /*
     * 上下文已经被关掉（dispose 之后又被引用、或系统回收）—— 整套重来。
     * 只认 `failed` 就返回是另一种死法：状态还写着 ready，声音却永远出不来。
     */
    if (this.ctx && this.ctx.state === "closed") {
      this.ctx = null;
      this.master = null;
      this.buffers.clear();
      this.loading = null;
      this.attempts = 0;
      this.setState("idle");
    }

    // 采样下了好几轮还是全军覆没：先不再空转（重建引擎会重新给机会）
    if (this.state === "failed" && this.attempts >= PRELOAD_ATTEMPTS) {
      recordAudioFlight("piano.ensure.return", { reason: "failed-after-attempts" });
      return;
    }

    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        recordAudioFlight("piano.ensure.return", { reason: "no-audiocontext-ctor" });
        this.setState("failed");
        return;
      }
      this.ctx = new Ctor();
      recordAudioFlight("piano.context.created", { state: this.ctx.state });
      this.ctx.addEventListener("statechange", () => {
        recordAudioFlight("piano.context.statechange", { state: this.ctx?.state ?? null });
        this.emit("piano:context");
      });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * this.outputGain;
      this.master.connect(this.ctx.destination);
    }

    /*
     * 注意：iOS 上 AudioContext 有**第三种状态 `interrupted`**（系统权限框、切后台、
     * 别的 App 抢音频会话都会让它进这个状态）。只认 `suspended` 的话它就永远醒不过来 ——
     * 表现就是"关于区一直显示『点击或按键，即可接入钢琴演奏』、点播放没反应、刷新几次才好"
     * （本人实测）。所以这里只判断"没在跑就叫它 resume"。
     */
    if (this.ctx.state !== "running") {
      // 诊断：resume 是"能不能出声"的关口，前后各记一条（仍然 fire-and-forget，只是挂上观察回调）
      const ctx = this.ctx;
      recordAudioFlight("piano.resume.before", { state: ctx.state });
      void ctx.resume().then(
        () => recordAudioFlight("piano.resume.resolved", { state: ctx.state }),
        (error: unknown) =>
          recordAudioFlight("piano.resume.rejected", {
            ...describeError(error),
            state: ctx.state,
          }),
      );
    } else {
      recordAudioFlight("piano.resume.skipped", { reason: "already-running", state: this.ctx.state });
    }
    void this.preload();
  }

  /**
   * 下载并解码需要的采样。
   *
   * 分轮进行：一轮最多 PRELOAD_ATTEMPTS 次，缺的那几个隔 1.5 秒补下一轮。
   * 上一版这里有个"自己把自己挡在门外"的写法：开头 `if (this.state === 'ready') return`
   * —— 只要**有一个**采样成功，状态就变成 ready，于是后面那段"补下漏掉的"永远进不来，
   * 手机上一次请求被打断就再也补不上（那几个音只能拿最近的采样顶替，甚至没声），
   * 表现就是本人说的"文件都下好了、点播放还是不出声/进不了可播放状态"。
   * 现在按"还缺不缺"判断（补齐了就直接返回），用 attempts 收口。
   */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    if (!this.ctx) return Promise.resolve();

    const needed = this.requiredSamples;
    // 齐了就不用再下；下够轮数就收手（剩下的音由最近采样顶替，见 bufferFor()）
    if (this.buffers.size >= needed.length) return Promise.resolve();
    if (this.attempts >= PRELOAD_ATTEMPTS) return Promise.resolve();

    this.attempts += 1;
    // 一个都还没解出来时才回到 loading；已经有声了就别把状态往回退
    if (this.buffers.size === 0) this.setState("loading");
    const ctx = this.ctx;

    this.loading = (async () => {
      let ok = 0;

      // 并发 4 个，别一次打满
      const queue = [...needed];
      const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
          const sample = queue.shift();
          if (!sample) return;
          try {
            const response = await fetch(sample.src, { cache: "force-cache" });
            if (!response.ok) continue;
            const data = await response.arrayBuffer();
            const buffer = await ctx.decodeAudioData(data);
            if (ctx !== this.ctx) return;
            this.buffers.set(sample.midi, buffer);
            ok += 1;
            this.emit("piano:progress");
          } catch {
            /* 单个采样失败不影响其它 */
          }
        }
      });

      await Promise.all(workers);
      if (ctx !== this.ctx) return;

      this.setState(this.buffers.size > 0 ? "ready" : "failed");
      /*
       * setState 只在状态真的变了时发事件 —— 但这一轮补到了东西，得说一声：
       * 正等着"采样齐了再开弹"的地方（identity-player 的 piano:state）才接得上。
       */
      if (ok > 0) this.emit("piano:state");

      this.loading = null;
      const missing = needed.filter((sample) => !this.buffers.has(sample.midi));
      if (missing.length === 0) return;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = 0;
        void this.preload();
      }, PRELOAD_RETRY_MS);
    })();

    return this.loading;
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master) this.master.gain.value = this.volume * this.outputGain;
  }

  /** 当前音量：换页接手别人的琴时，音量要"从这里滑过去"，所以得能读出来 */
  getVolume(): number {
    return this.volume;
  }

  noteOn(midi: number, velocity = 0.8): void {
    this.ensure();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    // 同一个音重复触发时先收掉旧的声音
    this.noteOff(midi, 0.02);

    const buffer = this.bufferFor(midi);
    if (!buffer) return;

    const sample = nearestSample(midi);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRateFor(sample, midi);

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const peak = peakFor(velocity);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + ATTACK);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(peak * SUSTAIN, 0.0002),
      now + ATTACK + DECAY,
    );

    source.connect(gain).connect(master);

    const token = (this.token += 1);
    source.onended = () => {
      const current = this.voices.get(midi);
      if (current?.token === token) this.voices.delete(midi);
    };

    source.start(now);
    source.stop(now + MAX_HOLD);
    this.voices.set(midi, { source, gain, token });
  }

  noteOff(midi: number, release = RELEASE): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);

    const ctx = this.ctx;
    if (!ctx) {
      try {
        voice.source.stop();
      } catch {
        /* 已经停了 */
      }
      return;
    }

    const now = ctx.currentTime;
    const gain = voice.gain.gain;
    const current = Math.max(gain.value, 0.0001);

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(current, now);
    gain.exponentialRampToValueAtTime(0.0001, now + release);
    voice.source.stop(now + release + 0.02);
  }

  allNotesOff(): void {
    this.scheduled.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    });
    this.scheduled.clear();
    [...this.voices.keys()].forEach((midi) => this.noteOff(midi, 0.08));
  }

  dispose(): void {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.attempts = 0;
    this.allNotesOff();
    this.voices.clear();
    this.buffers.clear();
    this.loading = null;
    if (this.master) this.master.disconnect();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.state = "idle";
  }

  /** 找最接近的已解码采样；两侧都可以退一步 */
  private bufferFor(midi: number): AudioBuffer | null {
    const exact = this.buffers.get(nearestSample(midi).midi);
    if (exact) return exact;

    let best: { distance: number; buffer: AudioBuffer } | null = null;
    for (const [sampleMidi, buffer] of this.buffers) {
      const distance = Math.abs(sampleMidi - midi);
      if (!best || distance < best.distance) best = { distance, buffer };
    }
    return best?.buffer ?? null;
  }

  private setState(state: PianoState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("piano:state");
  }

  private emit(name: string): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { state: this.state } }),
    );
  }
}
