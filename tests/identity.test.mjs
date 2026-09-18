import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_INTRO_VOLUME,
  IDENTITY_MOTION,
  IDENTITY_TAGS,
  IDENTITY_TAG_IDS,
  tagById,
  tagLabel,
  tagLines,
} from '../src/lib/identity.ts';
import { MINILAB_KEYS, midiFromName } from '../src/scripts/notes.ts';

/* ------------------------------------------------------------------
   身份标签：十个，双语，将来由音符触发
   最后一个（intro）是"重头戏"：大 0.2 倍、点开整页自我介绍。
   ------------------------------------------------------------------ */

test('there are exactly ten identity tags', () => {
  assert.equal(IDENTITY_TAGS.length, 10);
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
    'ABOUT ME (you have listened this far — click me, please, I beg you (｡>﹏<｡))',
  ]);
  const chinese = IDENTITY_TAGS.map((tag) => tag.zh);
  assert.deepEqual(chinese, [
    '音乐',
    '二次元',
    '民航',
    '摄影',
    '天文',
    '乐观',
    '直白',
    '坚持',
    '善于分析',
    '自我介绍（听了这么久，点一点我吧，求求了(｡>﹏<｡)）',
  ]);
});

test('the tenth tag is the self-introduction, and it stays last', () => {
  // 揭示顺序 = 数组顺序，所以"重头戏"必须排在第十位，别挪到前面
  const intro = IDENTITY_TAGS[IDENTITY_TAGS.length - 1];
  assert.equal(intro.id, 'intro');
  assert.equal(IDENTITY_TAGS.filter((tag) => tag.id === 'intro').length, 1);
  assert.equal(tagById('intro')?.id, 'intro');
  assert.ok(intro.zh.startsWith('自我介绍'));
  assert.ok(intro.zh.includes('求求了'));
  assert.ok(intro.en.startsWith('ABOUT ME'));
  assert.equal(tagLabel(intro, 'zh'), intro.zh);
  assert.equal(tagLabel(intro, 'en'), intro.en);
});

test('the tenth tag splits into a title line and the note in brackets', () => {
  assert.deepEqual(tagLines(tagById('intro'), 'zh'), {
    title: '自我介绍',
    note: '（听了这么久，点一点我吧，求求了(｡>﹏<｡)）',
  });
  assert.deepEqual(tagLines(tagById('intro'), 'en'), {
    title: 'ABOUT ME',
    note: '(you have listened this far — click me, please, I beg you (｡>﹏<｡))',
  });
  // 其它标签只有一行，不该被拆
  assert.deepEqual(tagLines(tagById('music'), 'zh'), { title: '音乐' });
  assert.deepEqual(tagLines(tagById('music'), 'en'), { title: 'MUSIC' });
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

test('the intro page plays the nocturne a little quieter than the performance', () => {
  // 自我介绍页接着放同一首夜曲（nocturne.ts），但那是读长文的页面：
  // 音量要比 About 页演奏滑块默认的 0.85 克制，而且必须是合法音量。
  assert.ok(IDENTITY_INTRO_VOLUME > 0 && IDENTITY_INTRO_VOLUME <= 1);
  assert.ok(IDENTITY_INTRO_VOLUME < 0.85);
});
