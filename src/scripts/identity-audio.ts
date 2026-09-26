import { PianoEngine } from './piano';
import { getGlobal } from './global';

/**
 * "关于"这一族的钢琴引擎：About 页 / 自我介绍页 / 首页的关于区共用同一架琴
 * ------------------------------------------------------------
 * 这三处放的是同一首夜曲（MIDI + 采样演奏，见 §5.8 / §5.15）。
 * 引擎挂在 getGlobal() 上，全站只有这一个；真正"接着往下弹"的那台播放器是
 * `nocturne-transport.ts`（score / cursor / 音频时钟 / 排程都在它那儿，跨页不停）。
 * 真的去了别的页面（下一张页面里没有夜曲），`app.ts` 会 `releaseIdentityPiano()` 收掉。
 */

/** 音域与音量倍数：identity-player.ts 与 nocturne.ts 必须完全一致，所以集中放这里 */
export const IDENTITY_PIANO_RANGE = { first: 21, last: 108, gain: 1.7 } as const;

/** 取这架琴（没有就造一个）。三个"关于"页面拿到的永远是同一个实例 */
export function identityPiano(): PianoEngine {
  const global = getGlobal();
  return (global.identityPiano ??= new PianoEngine(
    IDENTITY_PIANO_RANGE.first,
    IDENTITY_PIANO_RANGE.last,
    IDENTITY_PIANO_RANGE.gain,
    true,
  ));
}

/** 这一页需不需要这架琴（首页的关于区 / 独立 About 页 / 自我介绍页） */
export function usesIdentityPiano(): boolean {
  return Boolean(document.querySelector('[data-identity], [data-nocturne]'));
}

/**
 * **必须在用户手势里调用**：把琴的 AudioContext 建起来（并开始预载采样）。
 *
 * 为什么单独有这么一个函数：iOS 只允许在用户手势里创建/唤醒 AudioContext。
 * 原来的顺序是"用户滑到关于区 → 才 `new AudioContext()`" —— 那一下不在手势里，
 * 在 iPhone 上建出来是 suspended 的，于是只会显示"点击或按键，即可接入钢琴演奏"，
 * 不会自己开始弹（本人实测）；桌面浏览器在那次入场点击之后就已经放行，所以看不到这个问题。
 *
 * 现在由 `audio-unlock.ts` 统一调它：入场页点"进入空间"那次手势、
 * 以及页面第一次 pointerdown / keydown（没走入场页的刷新 / 站内换页）。
 * 这里不再自己挂 document 监听 —— 以前和 MusicManager 的手势兜底重复，两个入口。
 */
export function primeIdentityPiano(options: { preload?: boolean } = {}): void {
  if (!usesIdentityPiano()) return;
  identityPiano().ensure(options);
}

/** 下一张页面不再需要这架琴：停声、断开节点、关掉 AudioContext */
export function releaseIdentityPiano(): void {
  const global = getGlobal();
  global.identityPiano?.dispose();
  global.identityPiano = undefined;
}

/**
 * 音量滑行：从**当前**音量滑到目标值，返回取消函数。
 * 接手别人的琴时用它代替"先归零再淡入"——那一下归零就是"断"的来源。
 */
export function rampIdentityVolume(piano: PianoEngine, target: number, ms: number): () => void {
  const from = piano.getVolume();
  const started = performance.now();
  let frame = requestAnimationFrame(function step(now: number) {
    const progress = Math.min(1, (now - started) / Math.max(1, ms));
    piano.setVolume(from + (target - from) * progress);
    if (progress < 1) frame = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(frame);
}
