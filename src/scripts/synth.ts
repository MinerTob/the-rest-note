import { frequency } from './notes';

type Voice = {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
};

/**
 * MiniLab 的发声引擎：不用任何采样文件，直接用振荡器合成。
 * 音色偏"电钢琴"，起音很快、尾音柔和，音量克制。
 */
export class KeysSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice>();

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.2;
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** 必须在用户手势里调用一次，浏览器才允许出声 */
  unlock(): void {
    const ctx = this.ensure();
    // 同 piano.ts：iOS 的第三种状态 interrupted 也要唤醒，不能只认 suspended
    if (ctx && ctx.state !== 'running') void ctx.resume();
  }

  noteOn(midi: number, velocity = 0.85): void {
    const ctx = this.ensure();
    const master = this.master;
    if (!ctx || !master) return;
    if (ctx.state !== 'running') void ctx.resume();
    if (this.voices.has(midi)) return;

    const now = ctx.currentTime;
    const freq = frequency(midi);
    const level = Math.min(1, Math.max(0.15, velocity));

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5 * level, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.2 * level, now + 0.55);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(Math.min(9000, freq * 9), now);
    filter.frequency.exponentialRampToValueAtTime(Math.min(3200, freq * 3.2), now + 0.7);

    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.002, now);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.14;

    osc1.connect(gain);
    osc2.connect(osc2Gain);
    osc2Gain.connect(gain);
    gain.connect(filter);
    filter.connect(master);

    osc1.start(now);
    osc2.start(now);

    this.voices.set(midi, { osc1, osc2, gain, filter });
  }

  noteOff(midi: number): void {
    const ctx = this.ctx;
    const voice = this.voices.get(midi);
    if (!ctx || !voice) return;

    const now = ctx.currentTime;
    const release = 0.34;

    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + release);

    voice.osc1.stop(now + release + 0.05);
    voice.osc2.stop(now + release + 0.05);

    this.voices.delete(midi);
  }

  allNotesOff(): void {
    [...this.voices.keys()].forEach((midi) => this.noteOff(midi));
  }
}
