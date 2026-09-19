import { createShakeDetector } from '@/lib/shake';

/**
 * 手机端独有彩蛋：摇晃手机 → About 页那些标签跟着一块晃。
 * ------------------------------------------------------------
 * 传感器 → 摇晃识别 → 把加速度灌进 identity-physics
 *
 *   devicemotion ──▶ createShakeDetector ──▶ 打开一段"跟着晃"的时间窗
 *                                          └▶ 窗内每次采样都 shove() 一次
 *
 * 三条边界：
 *   1. **只有手机端**：粗指针（触摸屏）+ 有 DeviceMotionEvent 才挂。
 *      桌面浏览器就算塞进传感器事件也不会理。
 *   2. **只有 About 那块在屏幕上时**才听传感器 —— 不然用户在别的区块晃手机，
 *      标签会在看不见的地方被甩得乱七八糟，还白烧电。
 *   3. **尊重 reduced-motion**：开了"减少动态效果"就完全不挂，一行都不跑。
 *
 * iOS Safari 只有用户手势里才能申请运动权限（DeviceMotionEvent.requestPermission），
 * 所以这里不主动弹窗：等用户第一次碰那些标签（pointerdown）时再问一次。
 * Android / 其它浏览器不需要权限，直接听。
 */

/** 一次摇晃之后，"跟着晃"维持多久（毫秒）。窗内继续晃会一直续上 */
const MOTION_WINDOW_MS = 4200;
/** 加速度换算成推力的增益（1 = 一个重力） */
const GAIN = 1.35;
/** 单个方向最多推到几个重力：太大方块会穿墙 / 飞出场地 */
const MAX_ACCEL = 2.4;
/** 小于这个加速度（m/s²）当作"没在动"，避免手抖就乱推 */
const MIN_ACCEL = 1.6;
const GRAVITY = 9.81;

type MotionReading = { x: number; y: number; z: number };

/** 支持 requestPermission 的 DeviceMotionEvent（iOS Safari） */
type PermissionCapableMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export function attachIdentityMotion(
  root: HTMLElement,
  shove: (x: number, y: number) => void,
): () => void {
  if (typeof window.DeviceMotionEvent === 'undefined') return () => {};
  if (!matchMedia('(pointer: coarse)').matches) return () => {};
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const abort = new AbortController();
  const { signal } = abort;
  const detector = createShakeDetector();

  let visible = false;
  let listening = false;
  let windowUntil = 0;
  /** 只给 accelerationIncludingGravity 的浏览器：用它相邻两次的差值当线性加速度 */
  let previous: MotionReading | null = null;

  const reading = (event: DeviceMotionEvent): MotionReading | null => {
    const linear = event.acceleration;
    if (linear && (linear.x !== null || linear.y !== null || linear.z !== null)) {
      previous = null;
      return { x: linear.x ?? 0, y: linear.y ?? 0, z: linear.z ?? 0 };
    }

    const gravity = event.accelerationIncludingGravity;
    if (!gravity) return null;
    const current: MotionReading = { x: gravity.x ?? 0, y: gravity.y ?? 0, z: gravity.z ?? 0 };
    const last = previous;
    previous = current;
    if (!last) return null;
    return { x: current.x - last.x, y: current.y - last.y, z: current.z - last.z };
  };

  const onMotion = (event: DeviceMotionEvent) => {
    const accel = reading(event);
    if (!accel) return;

    const magnitude = Math.hypot(accel.x, accel.y, accel.z);
    const now = performance.now();
    if (detector.push(magnitude, now)) windowUntil = now + MOTION_WINDOW_MS;
    if (now > windowUntil || !visible || magnitude < MIN_ACCEL) return;

    // 推力 = 单位方向 × 强度（以重力为单位）；设备坐标 y 朝屏幕上方，场地里 y 朝下
    const strength = Math.min(MAX_ACCEL, (magnitude / GRAVITY) * GAIN);
    shove((accel.x / magnitude) * strength, -(accel.y / magnitude) * strength);
  };

  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    if (on) window.addEventListener('devicemotion', onMotion);
    else window.removeEventListener('devicemotion', onMotion);
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = Boolean(entry) && entry.isIntersecting && entry.intersectionRatio > 0.12;
      listen(visible);
    },
    { threshold: [0, 0.12, 0.5] },
  );
  observer.observe(root);

  // iOS：第一次碰"关于"这一块时申请一次权限（必须在用户手势里调）。
  // 标签的容器在 body 上（物理层），所以这块和身份区各挂一个，谁先被碰都算。
  const MotionEvent = window.DeviceMotionEvent as PermissionCapableMotionEvent;
  if (typeof MotionEvent.requestPermission === 'function') {
    const targets = [root, document.querySelector('[data-identity-arena]')].filter(
      (el): el is HTMLElement => Boolean(el),
    );
    for (const target of targets) {
      target.addEventListener(
        'pointerdown',
        () => {
          void MotionEvent.requestPermission?.()
            .then((state) => {
              if (state === 'granted' && visible) listen(true);
            })
            .catch(() => {
              /* 拒绝或调用时机不对：当作没有这个彩蛋，什么都不做 */
            });
        },
        { once: true, capture: true, signal },
      );
    }
  }

  return () => {
    abort.abort();
    listen(false);
    observer.disconnect();
    detector.reset();
  };
}
