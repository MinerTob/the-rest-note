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

/** 是不是"手机 / 平板"：iPhone 开了"请求桌面网站"时 UA 会变成 Mac，所以两头都认 */
function isHandheld(): boolean {
  if (matchMedia('(pointer: coarse)').matches) return true;
  return navigator.maxTouchPoints > 1 && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}

/** 申请中的那次立刻返回同一个 Promise：同一次点击里被两个入口各调一次时只问一遍 */
let pendingRequest: Promise<'granted' | 'denied'> | null = null;

async function askOnce(): Promise<'granted' | 'denied'> {
  const Motion = window.DeviceMotionEvent as PermissionCapableMotionEvent | undefined;
  if (!Motion || typeof Motion.requestPermission !== 'function') {
    return 'denied';
  }
  try {
    const state = await Motion.requestPermission();
    return state === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * 被拒绝时说一句实话：这是设备读数，不是彩蛋提示（和 MiniLab 的 "NO DEVICE" 同一种语气）。
 * 只在这一页真的有"关于"实验场时说 —— 别的页面上没必要出声。
 */
function announceMotionOffline(): void {
  if (!document.querySelector('[data-identity]')) return;
  window.dispatchEvent(
    new CustomEvent('space:message', {
      detail: { message: 'MOTION OFFLINE', detail: 'motion & orientation access denied' },
    }),
  );
}

/**
 * 在**入场页**点"进入空间"时申请一次运动与方向权限。
 *
 * iOS 只允许在用户手势里调 `DeviceMotionEvent.requestPermission()`，而"进入"是全站
 * 唯一一次人人都要做的点击 —— 放在这里，用户同意之后这一趟里 About 页的摇晃彩蛋
 * 直接可用，不用先猜着去碰标签。桌面 / 不支持时静默返回，不影响入场。
 *
 * 状态记在 `getGlobal().motionAccess` 上：`true` 批过、`false` 明确拒绝过、`undefined`
 * 还没问过。拒绝过的**不再问** —— iOS 本来也不会再弹，反复调用只会让日志变脏。
 */
export function requestMotionAccess(): void {
  const global = getGlobal();
  if (global.motionAccess !== undefined) return;

  // 只问手持设备：桌面浏览器就算实现了这个方法，也不该为了一个手机彩蛋弹系统框
  if (!isHandheld()) {
    global.motionAccess = false;
    return;
  }

  pendingRequest ??= askOnce();
  void pendingRequest.then((state) => {
    global.motionAccess = state === 'granted';
    if (state === 'denied') announceMotionOffline();
  });
}

export function attachIdentityMotion(
  root: HTMLElement,
  shove: (x: number, y: number) => void,
): () => void {
  /**
   * 排查用的读数（和 identity 的 data-deadline / nocturne 的 data-nocturne-at 同一个习惯）：
   *   data-motion      —— off（没挂：桌面 / 不支持 / reduced-motion）/ idle（不在视口里）
   *                       / listening（在听）/ shaking（刚识别到一次摇晃）
   *   data-motion-shakes —— 识别到几次摇晃
   *   data-motion-pushes —— 真的往场地里推了几次
   * 手机上说"摇了没反应"时，先看这三个数：没 listening 是挂载问题，
   * shakes 不动是阈值问题，pushes 不动是"识别到了但没推"。
   */
  const mark = (state: string) => {
    root.dataset.motion = state;
  };
  const bump = (key: 'motionShakes' | 'motionPushes') => {
    root.dataset[key] = String((Number(root.dataset[key]) || 0) + 1);
  };

  if (typeof window.DeviceMotionEvent === 'undefined') return () => {};
  if (!matchMedia('(pointer: coarse)').matches) return () => {};
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    mark('off');
    return () => {};
  }

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
    if (detector.push(magnitude, now)) {
      windowUntil = now + MOTION_WINDOW_MS;
      bump('motionShakes');
      mark('shaking');
    }
    if (now > windowUntil || !visible || magnitude < MIN_ACCEL) return;

    // 推力 = 单位方向 × 强度（以重力为单位）；设备坐标 y 朝屏幕上方，场地里 y 朝下
    const strength = Math.min(MAX_ACCEL, (magnitude / GRAVITY) * GAIN);
    shove((accel.x / magnitude) * strength, -(accel.y / magnitude) * strength);
    bump('motionPushes');
  };

  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    mark(on ? 'listening' : 'idle');
    if (on) window.addEventListener('devicemotion', onMotion);
    else window.removeEventListener('devicemotion', onMotion);
  };

  // 兜底入口：入场页那次点击没走到（刷新后不再走入场页、或那次还在问）时，
  // 只要这一块在屏幕上，用户点 / 滑页面任何地方就补问一次。
  // 真正申请的动作统一走 requestMotionAccess()，它保证"只问一次"。
  let asked = false;
  const askPermission = () => {
    if (asked) return;
    asked = true;
    document.removeEventListener('pointerdown', askPermission, { capture: true });
    requestMotionAccess();
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = Boolean(entry) && entry.isIntersecting && entry.intersectionRatio > 0.12;
      listen(visible);
      // 问过（批了或拒了）就不再张着耳朵等手势
      document.removeEventListener('pointerdown', askPermission, { capture: true });
      if (visible && getGlobal().motionAccess === undefined) {
        document.addEventListener('pointerdown', askPermission, { capture: true, signal });
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
