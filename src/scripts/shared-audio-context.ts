/** The identity piano and its background track share one long-lived audio clock. */
let context: AudioContext | null = null;

export function sharedAudioContext(): AudioContext | null {
  return context?.state === 'closed' ? null : context;
}

export function ensureSharedAudioContext(): AudioContext | null {
  if (!sharedAudioContext()) {
    const Ctor = window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context!.state !== 'running') void context!.resume().catch(() => {});
  return context;
}

/** Apply the visitor's chosen silent-switch tradeoff when the Nocturne is requested. */
export function configureSharedPlaybackSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try { session.type = 'playback'; } catch { /* Unsupported by this WebKit version. */ }
  }
}
