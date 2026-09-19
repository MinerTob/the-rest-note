import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resumeFromHandover } from '../src/lib/handover.ts';

/** 交棒时听到第 10 秒，并且已经把 0.45 秒预排进了音频时钟 */
const HANDOVER = { position: 10, scheduledUntil: 10.45, at: 5000 };
const TTL = 4000;

test('resuming right after the handover keeps the heard position, not the scheduled end', () => {
  // 200ms 之后接手：现在应该在 10.2 秒，而不是 10.45 秒 ——
  // 把预排末端当成"现在"，音乐就会往前跳那 0.45 秒（本人实测到的那个 bug）
  const resume = resumeFromHandover(HANDOVER, 5200, TTL);
  assert.ok(resume);
  assert.equal(Math.round(resume.position * 100) / 100, 10.2);
  assert.equal(Math.round(resume.from * 100) / 100, 10.45, '已经排过的那段不要重排');
});

test('position advances with wall time, and never goes backwards', () => {
  for (const elapsed of [0, 50, 200, 449]) {
    const resume = resumeFromHandover(HANDOVER, HANDOVER.at + elapsed, TTL);
    assert.ok(resume);
    assert.equal(Math.round((resume.position - 10) * 1000), elapsed);
    assert.ok(resume.from >= resume.position);
  }
});

test('a slow swap skips the gap instead of piling notes up', () => {
  // 800ms 才接手：预排的 0.45 秒已经放完了，中间那段直接跳过
  const resume = resumeFromHandover(HANDOVER, 5800, TTL);
  assert.ok(resume);
  assert.equal(Math.round(resume.position * 100) / 100, 10.8);
  assert.equal(Math.round(resume.from * 100) / 100, 10.8, 'from 不能落在 position 之前');
});

test('a stale or nonsense handover is ignored', () => {
  assert.equal(resumeFromHandover(HANDOVER, HANDOVER.at + TTL + 1, TTL), null);
  assert.equal(resumeFromHandover(HANDOVER, HANDOVER.at - 500, TTL), null);
  assert.equal(resumeFromHandover(HANDOVER, Number.NaN, TTL), null);
});
