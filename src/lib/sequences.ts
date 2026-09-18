/**
 * 旋律识别器 —— 纯逻辑，方便单独测试。
 *
 * 两个东西：
 *
 *   createSequenceDetector —— 只看"最近弹的若干音是否等于某条序列"。
 *     用于"弹对了就触发"，不关心中间过程。
 *
 *   createSequenceSession —— 逐步匹配，随时能回答"下一个需要的音是什么"。
 *     提示模式（一次只亮一个键）靠它。
 */

export type SequenceDetector = {
  push(note: string, at?: number): number;
  reset(): void;
  readonly history: readonly string[];
};

export function createSequenceDetector(
  sequences: readonly (readonly string[])[],
  options: { maxGapMs?: number } = {},
): SequenceDetector {
  const maxGapMs = options.maxGapMs ?? 2600;
  const maxLength = Math.max(1, ...sequences.map((sequence) => sequence.length));
  const buffer: { note: string; at: number }[] = [];

  return {
    push(note: string, at: number = Date.now()): number {
      buffer.push({ note, at });

      // 前面的音符离现在太久 / 缓冲过长，都丢掉
      while (buffer.length > 0 && at - buffer[0].at > maxGapMs) {
        buffer.shift();
      }
      while (buffer.length > maxLength) {
        buffer.shift();
      }

      for (let index = 0; index < sequences.length; index += 1) {
        const sequence = sequences[index];
        if (sequence.length > buffer.length) continue;

        const tail = buffer.slice(-sequence.length);
        const matched = tail.every((item, position) => item.note === sequence[position]);

        if (matched) {
          buffer.length = 0;
          return index;
        }
      }

      return -1;
    },

    reset(): void {
      buffer.length = 0;
    },

    get history(): readonly string[] {
      return buffer.map((item) => item.note);
    },
  };
}

/* ------------------------------------------------------------------ */

export type SessionPush = {
  /** 刚刚按下的音是不是当前需要的那个 */
  correct: boolean;
  /** 是否刚刚凑齐整条序列 */
  matched: boolean;
  /** 已经正确走了几步（0 表示还在等第一个音） */
  progress: number;
};

export type SequenceSession = {
  push(note: string, at?: number): SessionPush;
  reset(): void;
  readonly progress: number;
  readonly length: number;
  /** 下一格需要的音；已经走完则为 null */
  readonly awaiting: string | null;
};

/**
 * 逐步匹配一条序列。
 * 按错不会清空一切：如果按下的正好是序列的第一个音，就从第一步重新开始。
 */
export function createSequenceSession(
  sequence: readonly string[],
  options: { maxGapMs?: number } = {},
): SequenceSession {
  const maxGapMs = options.maxGapMs ?? 2600;
  let progress = 0;
  let lastAt = 0;

  return {
    push(note: string, at: number = Date.now()): SessionPush {
      // 中间停太久就当重新开始
      if (progress > 0 && lastAt > 0 && at - lastAt > maxGapMs) {
        progress = 0;
      }

      const expected = sequence[progress];
      const correct = note === expected;

      if (correct) {
        progress += 1;
        lastAt = at;

        if (progress >= sequence.length) {
          progress = 0;
          return { correct: true, matched: true, progress: sequence.length };
        }

        return { correct: true, matched: false, progress };
      }

      // 按错：只有正好是第一个音才从第一步续上
      progress = note === sequence[0] ? 1 : 0;
      lastAt = progress > 0 ? at : 0;
      return { correct: false, matched: false, progress };
    },

    reset(): void {
      progress = 0;
      lastAt = 0;
    },

    get progress(): number {
      return progress;
    },

    get length(): number {
      return sequence.length;
    },

    get awaiting(): string | null {
      return progress < sequence.length ? sequence[progress] : null;
    },
  };
}
