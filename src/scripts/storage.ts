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

/**
 * sessionStorage 版的布尔读写（跟着标签页活，浏览器会话结束就没了）。
 *
 * 只给"这一趟访问内才有意义"的意图用 —— 例如夜曲播放器记的"用户自己按过暂停"
 * （见 nocturne-transport.ts）：同一趟里刷新不能被自动恢复覆盖，而新的一趟该从头来。
 * 和 localStorage 版一样，隐私模式下静默降级。
 */
export function readSessionBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeSessionBool(key: string, value: boolean): void {
  try {
    window.sessionStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* 忽略 */
  }
}
