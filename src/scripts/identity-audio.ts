import { PianoEngine } from './piano';
import { getGlobal } from './global';

/**
 * "关于"这一族的钢琴引擎：About 页 / 自我介绍页 / 首页的关于区共用同一架琴
 * ------------------------------------------------------------
 * 这三处放的是同一首夜曲（MIDI + 采样演奏，见 §5.8），片内互相跳转时如果各自
 * `new PianoEngine()`，换页那一瞬间会：旧页面 `dispose()`（allNotesOff + 关掉
 * AudioContext）→ 新页面重新解码采样 → 从 0 淡入。听起来就是"停一下再从头接上"。
 *
 * 所以引擎挂到 getGlobal() 上，全站只有这一个：
 *   · 离开时**交棒**：还在响的音留着不掐，并记下"声音已经排到第几秒"；
 *   · 接手的页面直接接着往下排 —— 不重新解码、不从 0 淡入、音量滑过去而不是跳过去；
 *   · 真的去了别的页面（下一张页面里没有夜曲），才 `releaseIdentityPiano()` 收掉。
 */

/** 音域与音量倍数：identity-player.ts 与 nocturne.ts 必须完全一致，所以集中放这里 */
export const IDENTITY_PIANO_RANGE = { first: 21, last: 108, gain: 1.7 } as const;

/**
 * 交棒时提前排多久的音频（秒）。
 * 这一小段是留给"换页"的余量：交棒后旧页面立刻停止排程，
 * 但已经排进音频时钟的音会照常在接下来这几百毫秒里响，所以换页过程中声音是连续的。
 */
export const HANDOVER_AHEAD = 0.45;

/** 交棒记录多久之内算"接着上一页"（毫秒） */
const HANDOVER_TTL = 4000;

type Handover = { position: number; at: number };

/** 取这架琴（没有就造一个）。三个"关于"页面拿到的永远是同一个实例 */
export function identityPiano(): PianoEngine {
  const global = getGlobal();
  return (global.identityPiano ??= new PianoEngine(
    IDENTITY_PIANO_RANGE.first,
    IDENTITY_PIANO_RANGE.last,
    IDENTITY_PIANO_RANGE.gain,
  ));
}

/** 离开时交棒：`position` 是"已经排进音频时钟的末尾位置"，接手方从那里继续 */
export function handOverIdentityPiano(position: number): void {
  getGlobal().identityHandover = { position, at: performance.now() };
}

/**
 * 接手上一页的交棒点，返回"从第几秒开始往下排"。
 * 正常情况下就是交棒位置；万一这一跳慢得超过了预排余量，超出的那一段直接跳过 ——
 * 不然会把好几秒前就该响的音一起补回来，听上去是一堆音挤在一起。
 * 没有交棒（或太久远）返回 null，调用方就按原来的 live-timeline 记忆继续。
 */
export function takeIdentityHandover(): number | null {
  const global = getGlobal();
  const handover: Handover | undefined = global.identityHandover;
  global.identityHandover = undefined;
  if (!handover) return null;

  const elapsed = (performance.now() - handover.at) / 1000;
  if (elapsed > HANDOVER_TTL / 1000) return null;
  return handover.position + Math.max(0, elapsed - HANDOVER_AHEAD);
}

/** 下一张页面不再需要这架琴：停声、断开节点、关掉 AudioContext */
export function releaseIdentityPiano(): void {
  const global = getGlobal();
  global.identityHandover = undefined;
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
