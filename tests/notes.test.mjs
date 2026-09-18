import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYBOARD_MAP,
  MINILAB_FIRST_MIDI,
  MINILAB_KEYS,
  MINILAB_KEY_COUNT,
  frequency,
  isBlackKey,
  isCKey,
  midiFromKey,
  midiFromName,
  noteName,
} from '../src/scripts/notes.ts';
import { EASTER_EGGS } from '../src/lib/easter-eggs.ts';

/** 从彩蛋配置里取音符，避免测试和配置各写一份、慢慢对不上 */
const EGG_NOTES = [...new Set(EASTER_EGGS.flatMap((egg) => egg.notes))];

test('MiniLab is exactly 25 keys, C4 to C6', () => {
  assert.equal(MINILAB_KEY_COUNT, 25);
  assert.equal(MINILAB_KEYS.length, 25);
  assert.equal(MINILAB_FIRST_MIDI, 60);
  assert.equal(MINILAB_KEYS[0], 60);
  assert.equal(MINILAB_KEYS.at(-1), 84);
  assert.equal(noteName(MINILAB_KEYS[0]), 'C4');
  assert.equal(noteName(MINILAB_KEYS.at(-1)), 'C6');
});

test('note names round-trip through midi numbers', () => {
  for (const midi of MINILAB_KEYS) {
    assert.equal(midiFromName(noteName(midi)), midi);
  }
});

test('every note used by an easter egg is a playable key', () => {
  assert.ok(EGG_NOTES.length > 0, 'there should be at least one egg');
  for (const name of EGG_NOTES) {
    const midi = midiFromName(name);
    assert.ok(Number.isFinite(midi), `${name} should parse`);
    assert.ok(MINILAB_KEYS.includes(midi), `${name} should be on the keyboard`);
  }
});

test('noteName handles accidentals and octave boundaries', () => {
  assert.equal(noteName(61), 'C#4');
  assert.equal(noteName(59), 'B3');
  assert.equal(noteName(72), 'C5');
  assert.equal(noteName(0), 'C-1');
});

test('midiFromName rejects nonsense instead of guessing', () => {
  assert.ok(Number.isNaN(midiFromName('H4')));
  assert.ok(Number.isNaN(midiFromName('E')));
  assert.ok(Number.isNaN(midiFromName('')));
  assert.ok(Number.isNaN(midiFromName('C#')));
});

test('black and white keys are classified correctly', () => {
  const blacks = MINILAB_KEYS.filter(isBlackKey);
  const whites = MINILAB_KEYS.filter((midi) => !isBlackKey(midi));
  assert.equal(blacks.length, 10);
  assert.equal(whites.length, 15);
  assert.equal(isCKey(60), true);
  assert.equal(isCKey(72), true);
  assert.equal(isCKey(62), false);
});

test('frequency is tuned to A4 = 440 Hz', () => {
  assert.equal(frequency(69), 440);
  assert.ok(Math.abs(frequency(60) - 261.6256) < 0.001);
  assert.ok(Math.abs(frequency(84) - 1046.5023) < 0.001);
});

test('the computer keyboard reaches every one of the 25 keys', () => {
  const offsets = Object.values(KEYBOARD_MAP);
  assert.equal(new Set(offsets).size, 25);
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    Array.from({ length: 25 }, (_, index) => index),
  );
  assert.equal(midiFromKey('z'), MINILAB_FIRST_MIDI);
  assert.equal(midiFromKey('m'), MINILAB_FIRST_MIDI + 11);
  assert.equal(midiFromKey('q'), MINILAB_FIRST_MIDI + 12);
  assert.equal(midiFromKey('i'), MINILAB_FIRST_MIDI + 24);
  assert.equal(midiFromKey('Z'), MINILAB_FIRST_MIDI);
  assert.equal(midiFromKey('!'), null);
});