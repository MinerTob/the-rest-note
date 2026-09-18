const pausedPositions = new Map<string, number>();
const positionKeyFor = (id: string) => `space.position.v1.${id}`;

/** Playback position that advances only while its audio is actually playing. */
export function savedPosition(id: string, duration: number): number {
  let value = pausedPositions.get(id);
  if (value === undefined) {
    try {
      const parsed = Number(sessionStorage.getItem(positionKeyFor(id)));
      value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch { value = 0; }
    pausedPositions.set(id, value);
  }
  return duration > 0 ? value % duration : Math.max(0, value);
}

export function savePosition(id: string, position: number): void {
  const value = Number.isFinite(position) ? Math.max(0, position) : 0;
  pausedPositions.set(id, value);
  try { sessionStorage.setItem(positionKeyFor(id), String(value)); } catch { /* In-memory fallback. */ }
}

export function restartPosition(id: string): void {
  savePosition(id, 0);
}
