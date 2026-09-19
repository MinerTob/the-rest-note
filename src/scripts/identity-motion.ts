import { createShakeDetector } from '@/lib/shake';
import { getGlobal } from './global';

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
 * 所以不主动弹窗：**只要这一块在屏幕上，用户第一次点 / 滑这页的任何地方就申请一次**。
 * 只挂在标签上是不够的 —— 实测本人（iPhone）只是摇了手机、没先碰标签，于是权限从没被
 * 申请过，传感器一个事件都收不到，看起来就是"摇了没反应"。Android / 其它浏览器不需要权限。
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

/**
 * 在**入场页**点"进入空间"时申请一次运动与方向权限。
 *
 * iOS 只允许在用户手势里调 `DeviceMotionEvent.requestPermission()`，而"进入"是全站
 * 唯一一次人人都要做的点击 —— 放在这里，用户同意之后这一趟里 About 页的摇晃彩蛋
 * 直接可用，不用先猜着去碰标签。桌面 / 不支持时静默返回，不影响入场。
 * 同意过就记在 getGlobal().motionAccess 上，后面不会反复问。
 */
export function requestMotionAccess(): void {
  const MotionEvent = window.DeviceMotionEvent as PermissionCapableMotionEvent | undefined;
  if (!MotionEvent || typeof MotionEvent.requestPermission !== 'function') return;
  // 只问触摸设备：桌面浏览器就算实现了这个方法，也不该为了一个手机彩蛋弹系统框
  if (!matchMedia('(pointer: coarse)').matches) return;
  if (getGlobal().motionAccess) return;

  try {
    void MotionEvent.requestPermission()
      .then((state) => {
        if (state === 'granted') getGlobal().motionAccess = true;
      })
      .catch(() => {
        /* 没有传感器 / 不在手势里：当作没这回事 */
      });
  } catch {
    /* 老浏览器上 requestPermission 可能直接抛：同样忽略 */
  }
}

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

  // iOS：必须在一个用户手势里申请权限。挂到 document 上（捕获阶段、只触发一次），
  // 且只在这一块真的在屏幕上时挂着 —— 这样"看着标签点/滑一下"就把权限要到手了，
  // 又不会在读别的区块时白弹一个系统框。
  const MotionEvent = window.DeviceMotionEvent as PermissionCapableMotionEvent;
  // 入场页点"进入"时通常已经问过了（见 requestMotionAccess）；批准过就不再问
  const needsPermission =
    typeof MotionEvent.requestPermission === 'function' && !getGlobal().motionAccess;
  let permissionAsked = false;
  const askPermission = () => {
    if (permissionAsked) return;
    permissionAsked = true;
    document.removeEventListener('pointerdown', askPermission, { capture: true });
    void MotionEvent.requestPermission?.()
      .then((state) => {
        if (state === 'granted') listen(visible);
      })
      .catch(() => {
        /* 拒绝或调用时机不对：当作没有这个彩蛋，什么都不做 */
      });
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = Boolean(entry) && entry.isIntersecting && entry.intersectionRatio > 0.12;
      listen(visible);
      // 只有这一块在屏幕上时才张着耳朵等那次手势
      if (needsPermission && !permissionAsked) {
        if (visible) document.addEventListener('pointerdown', askPermission, { capture: true, signal });
        else document.removeEventListener('pointerdown', askPermission, { capture: true });
      }
    },
    { threshold: [0, 0.12, 0.5] },
  );
  observer.observe(root);

  return () => {
    abort.abort();
    listen(false);
    observer.disconnect();
    document.removeEventListener('pointerdown', askPermission, { capture: true });
    detector.reset();
  };
}
