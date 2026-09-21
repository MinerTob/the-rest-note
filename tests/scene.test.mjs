import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENE_ENTER,
  SCENE_LEAVE,
  SCENE_THRESHOLDS,
  sceneCoverage,
  sceneDecision,
} from '../src/lib/scene.ts';

const VIEWPORT = 852;
/** 跑一段几何：区块高 `height`，上沿在视口坐标 `top` 处 */
const geometry = (height, top) => ({ viewportHeight: VIEWPORT, top, bottom: top + height });

test('a section taller than the viewport counts as full coverage once it fills the screen', () => {
  const tall = 1600;
  assert.equal(sceneCoverage(geometry(tall, 0)), 1, '铺满视口');
  assert.equal(sceneCoverage(geometry(tall, -400)), 1, '上下都超出视口');
  assert.equal(sceneCoverage(geometry(tall, 452)), 400 / 852, '露出 400px 就是 400/852');
  assert.equal(sceneCoverage(geometry(tall, 852)), 0, '刚好在屏幕下面');
});

test('a section shorter than the viewport counts as full coverage when it is fully visible', () => {
  const short = 679;
  assert.equal(sceneCoverage(geometry(short, 173)), 1, '整块都在屏幕上');
  assert.equal(sceneCoverage(geometry(short, 614)), 238 / 679);
  assert.equal(sceneCoverage(geometry(short, 0)), 1, '顶部被切掉的还是铺满');
});

test('coverage needs a sane viewport and section to mean anything', () => {
  assert.equal(sceneCoverage({ viewportHeight: 0, top: 0, bottom: 100 }), 0);
  assert.equal(sceneCoverage({ viewportHeight: 800, top: 100, bottom: 100 }), 0);
  // 倒过来的 rect（不该发生）不能算出负数
  assert.equal(sceneCoverage({ viewportHeight: 800, top: 300, bottom: 100 }), 0);
});

test('entering needs more coverage than leaving (that gap is the hysteresis)', () => {
  assert.equal(SCENE_ENTER > SCENE_LEAVE, true);
  assert.equal(sceneDecision(false, SCENE_ENTER - 0.01), false, '差一点点不算进入');
  assert.equal(sceneDecision(false, SCENE_ENTER), true);
  assert.equal(sceneDecision(true, SCENE_LEAVE + 0.01), true, '还在带子里就保持激活');
  assert.equal(sceneDecision(true, SCENE_LEAVE), true);
  assert.equal(sceneDecision(true, SCENE_LEAVE - 0.01), false, '真的走远了才停');
});

test('the mobile URL bar collapsing does not flip the scene (the reported bug)', () => {
  // 真机/无头 Chrome 实测（393×852，关于区高 679px）：停在关于区的激活边界上，
  // 地址栏收起/展开让判据从 0.35 抖到 0.373 —— 旧代码的进出同一个 0.35 阈值
  // 于是 pause/start/pause/start 连着切了 5 次（就是"前几秒明显断续"）。
  const jitters = [
    [0.35, 0.373],
    [0.35, 0.34],
    [0.373, 0.35],
  ];
  for (const [a, b] of jitters) {
    for (const active of [false, true]) {
      assert.equal(
        sceneDecision(active, a),
        sceneDecision(active, b),
        `${a} ↔ ${b} 这种抖动不得改变激活状态`,
      );
    }
  }
  // 迟滞带（0.55 - 0.25 = 0.30）比实测抖动量高一个量级 —— 这才是"不抖"的原因
  const measuredJitter = Math.max(...jitters.map(([a, b]) => Math.abs(a - b)));
  assert.ok(measuredJitter < 0.05);
  assert.ok(SCENE_ENTER - SCENE_LEAVE > measuredJitter * 4);
});

test('a real leave still happens once the section is scrolled away', () => {
  assert.equal(sceneDecision(true, sceneCoverage(geometry(679, 700))), false);
  assert.equal(sceneDecision(false, sceneCoverage(geometry(679, 173))), true);
});

test('the observer threshold grid is dense and inside 0..1', () => {
  assert.ok(SCENE_THRESHOLDS.length >= 20);
  assert.equal(SCENE_THRESHOLDS[0], 0);
  assert.equal(SCENE_THRESHOLDS.at(-1), 1);
  for (let i = 1; i < SCENE_THRESHOLDS.length; i += 1) {
    const gap = SCENE_THRESHOLDS[i] - SCENE_THRESHOLDS[i - 1];
    assert.ok(gap > 0 && gap <= 0.05, '网格要密到 5% 以内');
  }
});
