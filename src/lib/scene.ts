/**
 * 场景激活（scene activation）—— 纯逻辑，方便单独测试（tests/scene.test.mjs）。
 *
 * 首页是四条 `min-height: 100svh` 的长页，滚到"关于"那一条时要放夜曲、滚走要停。
 * 这件事看起来只是个 IntersectionObserver 阈值，实际有两个坑：
 *
 * 1. **用"露出高度 ÷ 区块高度"当判据会随视口大小漂移**。手机地址栏收起/展开会让
 *    视口高度变 60–120px，同一个滚动位置上这个比值能跳 0.02–0.15 —— 卡在阈值上时
 *    就会 pause/start 反复横跳（本人报的"前几秒明显断续、卡顿"）。
 * 2. **进入和退出用同一个阈值**，等于没有迟滞：比值在阈值上下抖动一次就切一次。
 *
 * 这里的做法：
 *   · 判据换成 `sceneCoverage()` —— **露出高度 ÷ min(区块高度, 视口高度)**。
 *     区块比视口高时，铺满视口就算 1（不会因为区块更长而永远到不了 1）；
 *     区块比视口矮时，整块都看得见才算 1。视口高度变化对它的影响小得多。
 *   · 进出用**两个不同阈值**（`SCENE_ENTER` > `SCENE_LEAVE`），中间那段是迟滞带：
 *     只有真的跨过去才换状态，抖动落在带子里就什么也不做。
 *
 * 注意：这里没有任何 setTimeout / debounce —— 迟滞本身就是"不抖"的原因，
 * 不是为了掩盖问题而拖时间（本人明确要求不要用固定延迟）。
 */

/** 进入阈值：区块覆盖 `min(区块, 视口)` 的这个比例才算"进入观看区域" */
export const SCENE_ENTER = 0.55;
/** 退出阈值：掉到这个比例以下才算"真的离开了"（远小于进入阈值 = 迟滞带） */
export const SCENE_LEAVE = 0.25;

/** IntersectionObserver 的 threshold 网格：够密，锚点落在哪都能收到回调（不是用来判定的） */
export const SCENE_THRESHOLDS: readonly number[] = Array.from({ length: 41 }, (_, i) => i / 40);

export type SceneGeometry = {
  /** 视口高度（`entry.rootBounds.height`，拿不到时用 `window.innerHeight`） */
  viewportHeight: number;
  /** 区块在视口坐标里的上沿（`entry.boundingClientRect.top`） */
  top: number;
  /** 区块在视口坐标里的下沿 */
  bottom: number;
};

/** 区块"铺满视口"的程度：0 = 完全看不见，1 = 看得见的那部分和区块/视口里较矮的一方一样高 */
export function sceneCoverage({ viewportHeight, top, bottom }: SceneGeometry): number {
  const height = Math.max(0, bottom - top);
  const visible = Math.max(0, Math.min(bottom, viewportHeight) - Math.max(top, 0));
  const reference = Math.min(height, viewportHeight);
  if (!(reference > 0)) return 0;
  return Math.min(1, Math.max(0, visible / reference));
}

/**
 * 迟滞判定：返回"现在应该是激活状态吗"。
 * `active` 是上一次的结果 —— 状态只会真的跨过 enter / leave 时翻转。
 */
export function sceneDecision(
  active: boolean,
  coverage: number,
  enter: number = SCENE_ENTER,
  leave: number = SCENE_LEAVE,
): boolean {
  if (active) return coverage >= leave;
  return coverage >= enter;
}
