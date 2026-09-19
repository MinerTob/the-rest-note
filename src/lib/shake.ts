/**
 * 摇晃识别 —— 纯逻辑，方便单独测试（tests/shake.test.mjs）。
 *
 * 用途：手机端独有的彩蛋 —— 摇晃手机时，About 页那些标签跟着一块晃
 * （见 §5.8 与 identity-motion.ts）。这里只回答一个问题：
 * "这一串加速度采样算不算一次摇晃"，不碰 DOM、不碰传感器。
 *
 * 判据不是"某一次超过阈值就触发"：走路、放下手机、公交颠一下都会超过阈值。
 * 摇晃的特征是**来回**——短时间内反复出现强脉冲，所以要求在一个窗口里累计够多次。
 */

export type ShakeDetectorOptions = {
  /** 单次脉冲的阈值（m/s²，1g ≈ 9.81） */
  threshold?: number;
  /** 窗口内累计到多少次脉冲才算一次摇晃 */
  peaks?: number;
  /** 累计窗口（毫秒） */
  windowMs?: number;
  /** 触发一次之后，至少隔多久才允许再触发一次 */
  quietMs?: number;
};

export type ShakeDetector = {
  push(magnitude: number, at?: number): boolean;
  reset(): void;
  /** 当前窗口里已经攒了几次脉冲（调试 / 测试用） */
  readonly peaks: number;
};

export function createShakeDetector(options: ShakeDetectorOptions = {}): ShakeDetector {
  // 默认值按"手机握在手里来回晃两三下"标定：真机上晃一次大约能冲到 15-30m/s²，
  // 但轻轻晃可能只有十几。4 次 ×13 一度太高（本人 iPhone 实测摇了没反应），
  // 放宽到 3 次 ×11：仍然挡住走路、单次颠簸（那是一两次脉冲、且方向不成对）。
  const threshold = options.threshold ?? 11;
  const needed = options.peaks ?? 3;
  const windowMs = options.windowMs ?? 1100;
  const quietMs = options.quietMs ?? 350;

  let hits: number[] = [];
  let lastFired = Number.NEGATIVE_INFINITY;

  return {
    push(magnitude: number, at: number = Date.now()): boolean {
      if (!Number.isFinite(magnitude)) return false;

      if (magnitude >= threshold) hits.push(at);
      const oldest = at - windowMs;
      hits = hits.filter((time) => time >= oldest);

      if (hits.length >= needed && at - lastFired >= quietMs) {
        hits = [];
        lastFired = at;
        return true;
      }

      return false;
    },

    reset(): void {
      hits = [];
    },

    get peaks(): number {
      return hits.length;
    },
  };
}
