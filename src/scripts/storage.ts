/** localStorage 的保险封装：隐私模式下不报错，只当没有存过。 */

export function readString(key: string, fallback: string): string {
  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 忽略 */
  }
}

export function readNumber(key: string, fallback: number): number {
  const raw = readString(key, '');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readBool(key: string, fallback: boolean): boolean {
  const raw = readString(key, '');
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}

export function writeBool(key: string, value: boolean): void {
  writeString(key, value ? '1' : '0');
}

export function writeNumber(key: string, value: number): void {
  writeString(key, String(value));
}
