import {
  nearestSample,
  playbackRateFor,
  samplesForRange,
  type PianoSample,
} from "@/lib/piano";
import { MINILAB_FIRST_MIDI, MINILAB_KEY_COUNT } from "./notes";

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

  get requiredSamples(): PianoSample[] {
    return samplesForRange(this.firstMidi, this.lastMidi);
  }

  /**
   * 必须在用户手势里调用一次。
   * 浏览器不允许在交互之前创建/恢复 AudioContext。
   */
  ensure(): void {
    if (this.state === "failed") return;

    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        this.setState("failed");
        return;
      }
      this.ctx = new Ctor();
      this.ctx.addEventListener("statechange", () =>
        this.emit("piano:context"),
      );
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * this.outputGain;
      this.master.connect(this.ctx.destination);
    }

    if (this.ctx.state === "suspended") void this.ctx.resume();
    void this.preload();
  }

  /** 下载并解码需要的采样（只做一次，失败就标记 failed） */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    if (this.state === "ready" || this.state === "failed" || !this.ctx) {
      return Promise.resolve();
    }

    this.setState("loading");
    const ctx = this.ctx;
    const needed = this.requiredSamples;

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
      if (ctx === this.ctx) this.setState(ok > 0 ? "ready" : "failed");
    })();

    return this.loading;
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master) this.master.gain.value = this.volume * this.outputGain;
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
