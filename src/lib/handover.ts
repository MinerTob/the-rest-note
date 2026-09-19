/**
 * 交棒位置换算 —— 纯逻辑，方便单独测试（tests/handover.test.mjs）。
 *
 * "关于 ⇄ 关于我"换页时，上一页会把演奏交给下一页。交棒记录里必须**分开**记两个位置：
 *
 *   position       交棒那一刻真实听到的演奏位置；
 *   scheduledUntil 已经排进音频时钟的末尾（= position + 预排的那 0.45 秒）。
 *
 * 接手方"现在"在 `position + 已经过去的时间`；
 * 但它只需要排 `scheduledUntil` 之后的音 —— 中间那一段是上一页排好、正在响的，
 * 再排一遍就会重复触发；而把 `scheduledUntil` 当成"现在在哪"，时间轴就会往前跳
 * 0.45 秒（本人实测听到的就是"音乐会向前位移一段"）。
 *
 * 万一这一跳慢得超过了预排余量（from 落在 position 后面），中间那一小段直接跳过，
 * 免得把几百毫秒前就该响的音一起补回来。
 */

export type Handover = { position: number; scheduledUntil: number; at: number };
export type Resume = { position: number; from: number };

export function resumeFromHandover(
  handover: Handover,
  now: number,
  ttlMs: number,
): Resume | null {
  const elapsed = (now - handover.at) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > ttlMs / 1000) return null;

  const position = handover.position + elapsed;
  return { position, from: Math.max(position, handover.scheduledUntil) };
}
