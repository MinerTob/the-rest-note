/** 25 键 MiniLab 的音符与键盘映射（纯数据 + 纯函数，可单独测试）。 */

export const MINILAB_FIRST_MIDI = 60; // C4
export const MINILAB_KEY_COUNT = 25; // C4 → C6

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** midi 60 -> 'C4' */
export function noteName(midi: number): string {
  const name = NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/** 'C#4' 这样的音名转回 midi（测试与配置校验用） */
export function midiFromName(name: string): number {
  const match = /^([A-G]#?)(-?\d)$/.exec(name.trim());
  if (!match) return Number.NaN;
  const index = NAMES.indexOf(match[1] as (typeof NAMES)[number]);
  if (index < 0) return Number.NaN;
  return (Number.parseInt(match[2], 10) + 1) * 12 + index;
}

export function isBlackKey(midi: number): boolean {
  return NAMES[((midi % 12) + 12) % 12].includes('#');
}

export function isCKey(midi: number): boolean {
  return ((midi % 12) + 12) % 12 === 0;
}

export function frequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 计算机键盘 → 相对 C4 的半音偏移（两排，和常见 MIDI 键盘一致） */
export const KEYBOARD_MAP: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23, i: 24,
};

export function midiFromKey(key: string): number | null {
  const offset = KEYBOARD_MAP[key.toLowerCase()];
  return offset === undefined ? null : MINILAB_FIRST_MIDI + offset;
}

/** 25 个琴键的音高列表 */
export const MINILAB_KEYS: number[] = Array.from(
  { length: MINILAB_KEY_COUNT },
  (_, index) => MINILAB_FIRST_MIDI + index,
);
