import { savedPosition, savePosition } from '@/lib/live-timeline';
import { clamp01, type Track } from '@/lib/music';
import { sharedAudioContext } from './shared-audio-context';

/** Decoded MP3 playback on the piano's already running AudioContext. */
export class SharedMusic {
  private buffer: AudioBuffer | null = null;
  private bufferId = '';
  private loading: Promise<AudioBuffer> | null = null;
  private loadingId = '';
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private offset = 0;
  private activeDuration = 0;
  private startedAt = 0;
  private trackId = '';
  private saveTimer = 0;
  private volume = 0;

  async prepare(track: Track): Promise<boolean> {
    const ctx = sharedAudioContext();
    if (!ctx) return false;
    if (this.bufferId === track.id && this.buffer) return true;
    if (this.loadingId !== track.id || !this.loading) {
      this.loadingId = track.id;
      this.loading = (async () => {
        const response = await fetch(track.src, { cache: 'force-cache' });
        if (!response.ok) throw new Error('MP3 unavailable');
        return ctx.decodeAudioData(await response.arrayBuffer());
      })();
    }
    try {
      const buffer = await this.loading;
      if (this.loadingId !== track.id) return false;
      this.buffer = buffer;
      this.bufferId = track.id;
      return true;
    } catch {
      if (this.loadingId === track.id) this.loading = null;
      return false;
    }
  }

  get isPlaying(): boolean {
    return !!this.source && sharedAudioContext()?.state === 'running';
  }

  get hasSource(): boolean {
    return !!this.source;
  }

  get duration(): number {
    return this.source ? this.activeDuration :
      this.bufferId === this.trackId ? this.buffer?.duration ?? 0 : 0;
  }

  get activeTrackId(): string {
    return this.trackId;
  }

  get position(): number {
    const ctx = sharedAudioContext();
    const elapsed = this.source && ctx ? Math.max(0, ctx.currentTime - this.startedAt) : 0;
    const duration = this.duration;
    return duration > 0 ? (this.offset + elapsed) % duration : this.offset;
  }

  start(track: Track, volume: number): boolean {
    const ctx = sharedAudioContext();
    if (!ctx || ctx.state !== 'running' || this.bufferId !== track.id || !this.buffer) return false;
    if (this.isPlaying && this.trackId === track.id) {
      this.setVolume(volume);
      return true;
    }
    this.stop();
    this.volume = clamp01(volume);
    this.trackId = track.id;
    this.activeDuration = this.buffer.duration;
    this.offset = savedPosition('track:' + track.id, this.buffer.duration);
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.connect(gain);
    try {
      source.start(0, this.offset);
    } catch {
      source.disconnect();
      gain.disconnect();
      return false;
    }
    this.source = source;
    this.gain = gain;
    this.startedAt = ctx.currentTime;
    this.saveTimer = window.setInterval(() => {
      if (this.isPlaying) savePosition('track:' + this.trackId, this.position);
    }, 500);
    return true;
  }

  stop(): void {
    if (this.source) {
      this.offset = this.position;
      if (this.trackId) savePosition('track:' + this.trackId, this.offset);
      try { this.source.stop(); } catch { /* Context was closed. */ }
      this.source.disconnect();
      this.source = null;
    }
    this.gain?.disconnect();
    this.gain = null;
    if (this.saveTimer) window.clearInterval(this.saveTimer);
    this.saveTimer = 0;
  }

  seek(track: Track, seconds: number): void {
    if (this.bufferId !== track.id || !this.buffer) return;
    const wasPlaying = this.isPlaying;
    this.stop();
    this.trackId = track.id;
    this.offset = Math.min(Math.max(0, seconds), this.buffer.duration);
    savePosition('track:' + track.id, this.offset);
    if (wasPlaying) this.start(track, this.volume);
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    if (this.gain) this.gain.gain.value = clamp01(volume);
  }
}
