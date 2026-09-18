import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THEME,
  THEMES,
  isThemeName,
  nextTheme,
  trackForTheme,
} from '../src/lib/themes.ts';
import { EASTER_EGGS, eggForTheme } from '../src/lib/easter-eggs.ts';
import { TRACKS, getTrack } from '../src/lib/music.ts';
import { MINILAB_KEYS, midiFromName } from '../src/scripts/notes.ts';

/* ------------------------------------------------------------------
   Theme Profile：曲目由主题推导，不是独立状态
   ------------------------------------------------------------------ */

test('every theme maps to a track that actually exists', () => {
  for (const theme of THEMES) {
    const id = trackForTheme(theme);
    assert.ok(getTrack(id), `${theme} -> ${id} should be a real track`);
  }
});

test('the theme -> track mapping is stable', () => {
  // 这两条是"状态不会分裂"的锚点：改这里之前先想清楚刷新后的表现
  assert.equal(trackForTheme('modern'), 'dao-xiang');
  assert.equal(trackForTheme('baroque'), 'canon');
});

test('only the default theme has a non-hidden track', () => {
  const visible = TRACKS.filter((track) => !track.hidden).map((track) => track.id);
  assert.deepEqual(visible, [trackForTheme(DEFAULT_THEME)]);
});

test('nextTheme is its own inverse', () => {
  for (const theme of THEMES) {
    assert.equal(nextTheme(nextTheme(theme)), theme);
    assert.notEqual(nextTheme(theme), theme);
  }
});

test('isThemeName only accepts configured themes', () => {
  for (const theme of THEMES) assert.equal(isThemeName(theme), true);
  assert.equal(isThemeName('cyberpunk'), false);
  assert.equal(isThemeName(''), false);
  assert.equal(isThemeName(null), false);
  assert.equal(isThemeName(undefined), false);
});

/* ------------------------------------------------------------------
   彩蛋按主题分流：一个主题下只存在一条序列
   ------------------------------------------------------------------ */

test('every theme has exactly one egg, and it belongs to that theme', () => {
  for (const theme of THEMES) {
    const egg = eggForTheme(theme);
    assert.ok(egg, `${theme} should have an egg`);
    assert.equal(egg.theme, theme);
    assert.equal(EASTER_EGGS.filter((item) => item.theme === theme).length, 1);
  }
});

test('the two themes do not share a melody', () => {
  const modern = eggForTheme('modern');
  const baroque = eggForTheme('baroque');
  assert.notDeepEqual(modern.notes, baroque.notes);
});

test('an egg never sends the visitor back to the theme they are already on', () => {
  for (const egg of EASTER_EGGS) {
    assert.notEqual(egg.resultTheme, egg.theme, `${egg.id} would be a no-op`);
  }
});

test('an egg only unlocks a hidden track', () => {
  for (const egg of EASTER_EGGS) {
    if (!egg.unlocks) continue;
    const track = getTrack(egg.unlocks);
    assert.ok(track, `${egg.id} unlocks a track that does not exist`);
    assert.equal(track.hidden, true, `${egg.id} unlocks a visible track`);
  }
});

test('every egg note is playable on the 25-key MiniLab', () => {
  for (const egg of EASTER_EGGS) {
    for (const name of egg.notes) {
      const midi = midiFromName(name);
      assert.ok(Number.isFinite(midi), `${name} should parse`);
      assert.ok(MINILAB_KEYS.includes(midi), `${name} is not on the keyboard`);
    }
  }
});

test('an egg needs at least two notes and a sane gap window', () => {
  for (const egg of EASTER_EGGS) {
    assert.ok(egg.notes.length >= 2, `${egg.id} is too short to be a melody`);
    assert.ok(egg.maxGapMs > 0, `${egg.id} needs a time window`);
    // 提示模式那行字绝不能就是答案本身
    assert.ok(!egg.hintLabel.includes(egg.notes[0]), `${egg.id} leaks its first note`);
  }
});