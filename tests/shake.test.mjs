import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShakeDetector } from '../src/lib/shake.ts';

/** 按固定间隔喂一串采样，返回第一次触发的时间点（没有就返回 null） */
function feed(detector, magnitudes, gap = 60) {
  let at = 0;
  for (const magnitude of magnitudes) {
    if (detector.push(magnitude, at)) return at;
    at += gap;
  }
  return null;
}

test('a single jolt is not a shake', () => {
  const detector = createShakeDetector();
  assert.equal(detector.push(30, 0), false);
  assert.equal(detector.push(2, 100), false);
  assert.equal(feed(detector, [2, 2, 2, 2]), null);
});

test('calm readings never fire', () => {
  const detector = createShakeDetector();
  const quiet = Array.from({ length: 200 }, () => 9.81);
  assert.equal(feed(detector, quiet), null);
});

test('repeated strong peaks inside the window fire', () => {
  const detector = createShakeDetector();
  // 第四次强脉冲落在 360ms（每次采样间隔 60ms）
  assert.equal(feed(detector, [20, 2, 22, 2, 19, 2, 21]), 360);
});

test('peaks spread wider than the window never accumulate', () => {
  const detector = createShakeDetector();
  // 每 500ms 才颠一下：窗口是 1100ms，攒不满 4 次
  assert.equal(feed(detector, [20, 20, 20, 20, 20, 20], 500), null);
});

test('once fired, quietMs blocks an immediate second shot', () => {
  const detector = createShakeDetector();
  const first = feed(detector, [20, 20, 20, 20]);
  assert.equal(first, 180);

  // 紧接着继续猛晃：安静期没过完不该再触发
  let at = first + 20;
  for (let i = 0; i < 8; i += 1) {
    assert.equal(detector.push(20, at), false);
    at += 20;
  }

  // 安静期过去之后可以再触发
  let fired = false;
  for (let i = 0; i < 30 && !fired; i += 1) {
    fired = detector.push(20, at);
    at += 30;
  }
  assert.equal(fired, true);
});

test('nonsense readings are ignored instead of counting as peaks', () => {
  const detector = createShakeDetector();
  assert.equal(detector.push(Number.NaN, 0), false);
  assert.equal(detector.push(Number.POSITIVE_INFINITY, 10), false);
  assert.equal(detector.peaks, 0);
});

test('reset drops the peaks gathered so far', () => {
  const detector = createShakeDetector();
  detector.push(20, 0);
  detector.push(20, 60);
  assert.equal(detector.peaks, 2);
  detector.reset();
  assert.equal(detector.peaks, 0);
  assert.equal(detector.push(20, 120), false);
});

test('thresholds are configurable', () => {
  const gentle = createShakeDetector({ threshold: 4, peaks: 2, windowMs: 500, quietMs: 0 });
  assert.equal(gentle.push(5, 0), false);
  assert.equal(gentle.push(5, 50), true);
});
