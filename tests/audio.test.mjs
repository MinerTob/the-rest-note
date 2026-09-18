import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUDIO, clamp01, easeOutQuad, volumeAt } from '../src/lib/music.ts';

/* ------------------------------------------------------------------
   音量渐变：进度必须两头都夹住
   ------------------------------------------------------------------ */

test('clamp01 keeps a value inside [0, 1]', () => {
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(-0.003), 0);
  assert.equal(clamp01(1.004), 1);
});

test('clamp01 never returns a non-finite volume', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const value = clamp01(bad);
    assert.ok(Number.isFinite(value), `${bad} -> ${value}`);
    assert.ok(value >= 0 && value <= 1);
  }
});

test('the easing starts at zero and lands exactly on one', () => {
  assert.equal(easeOutQuad(0), 0);
  assert.equal(easeOutQuad(1), 1);
  assert.equal(easeOutQuad(-0.5), 0);
  assert.equal(easeOutQuad(2), 1);
});

test('a rAF timestamp earlier than the start cannot give a negative volume', () => {
  // 这就是「切过去却没有声音」那一版：progress 为负 -> 音量 -0.003 -> 抛错
  const value = volumeAt(0, AUDIO.volume, -0.013);
  assert.equal(value, 0);
  assert.ok(value >= 0);
});

test('volumeAt lands exactly on its target at the end of the ramp', () => {
  assert.equal(volumeAt(0, AUDIO.volume, 1), AUDIO.volume);
  assert.equal(volumeAt(0.2, 0, 1), 0);
  assert.equal(volumeAt(0, 0.8, 1.4), 0.8);
});

test('every frame of a ramp is a legal volume', () => {
  for (let step = -20; step <= 120; step += 1) {
    for (const from of [0, 0.05, 0.3, 1]) {
      for (const to of [0, 0.3, 1]) {
        const value = volumeAt(from, to, step / 100);
        assert.ok(
          Number.isFinite(value) && value >= 0 && value <= 1,
          `progress ${step / 100} from ${from} to ${to} -> ${value}`,
        );
      }
    }
  }
});

test('a fade-in never goes backwards', () => {
  let previous = -1;
  for (let step = 0; step <= 100; step += 1) {
    const value = volumeAt(0, 0.3, step / 100);
    assert.ok(value >= previous, `${value} < ${previous}`);
    previous = value;
  }
});