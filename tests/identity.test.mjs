import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_MOTION,
  IDENTITY_TAGS,
  IDENTITY_TAG_IDS,
  tagById,
  tagLabel,
} from '../src/lib/identity.ts';
import { MINILAB_KEYS, midiFromName } from '../src/scripts/notes.ts';

/* ------------------------------------------------------------------
   身份标签：九个，双语，将来由音符触发
   ------------------------------------------------------------------ */

test('there are exactly nine identity tags', () => {
  assert.equal(IDENTITY_TAGS.length, 9);
  assert.deepEqual(
    IDENTITY_TAGS.map((tag) => tag.id),
    [...IDENTITY_TAG_IDS],
  );
});

test('every tag has an id, a Chinese and an English label', () => {
  for (const tag of IDENTITY_TAGS) {
    assert.ok(tag.id.length > 0);
    assert.ok(tag.zh.length > 0, `${tag.id} has no Chinese label`);
    assert.ok(tag.en.length > 0, `${tag.id} has no English label`);
  }
});

test('labels match the list that was actually provided', () => {
  const english = IDENTITY_TAGS.map((tag) => tag.en);
  assert.deepEqual(english, [
    'MUSIC',
    'ANIME',
    'AVIATION',
    'PHOTOGRAPHY',
    'ASTRONOMY',
    'OPTIMISTIC',
    'DIRECT',
    'PERSISTENT',
    'ANALYTICAL',
  ]);
  const chinese = IDENTITY_TAGS.map((tag) => tag.zh);
  assert.deepEqual(chinese, ['音乐', '二次元', '民航', '摄影', '天文', '乐观', '直白', '坚持', '善于分析']);
});

test('ANALYTICAL is about analysis, not being careful', () => {
  // 本人明确说过：这个标签指的是拆解问题、找规律，不是"小心谨慎"
  assert.equal(tagById('analytical')?.zh, '善于分析');
  assert.ok(!IDENTITY_TAGS.some((tag) => tag.zh.includes('细心')));
});

test('tagLabel picks the right language', () => {
  const tag = tagById('music');
  assert.equal(tagLabel(tag, 'zh'), '音乐');
  assert.equal(tagLabel(tag, 'en'), 'MUSIC');
});

test('a trigger, once assigned, has to be a playable key', () => {
  // 现在一个都没分配（音符要跟乐句一起定），但接口留着：
  // 以后填进来的必须是 MiniLab 上的键，否则"音符触发标签"这条链根本走不通。
  const triggers = IDENTITY_TAGS.map((tag) => tag.trigger).filter(Boolean);
  for (const name of triggers) {
    const midi = midiFromName(name);
    assert.notEqual(midi, null, `${name} is not a note`);
    assert.ok(
      MINILAB_KEYS.some((key) => key.name === name),
      `${name} is not on the 25-key MiniLab`,
    );
  }
  assert.equal(new Set(triggers).size, triggers.length, 'two tags share a trigger');
});

test('the motion spec stays inside the range that reads as "landing", not "bouncing"', () => {
  // 这一组数字是给未来实现用的边界：一旦调过头，动画就变成小游戏了
  assert.ok(IDENTITY_MOTION.ejectionMs > 0 && IDENTITY_MOTION.ejectionMs <= 200);
  const [near, far] = IDENTITY_MOTION.flightMs;
  assert.ok(near < far);
  assert.ok(far <= 900);
  assert.ok(IDENTITY_MOTION.arcLift <= 40);
  assert.ok(IDENTITY_MOTION.bounce <= 8);
  assert.ok(IDENTITY_MOTION.rotate <= 5);
});