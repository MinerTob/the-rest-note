import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSequenceDetector, createSequenceSession } from '../src/lib/sequences.ts';
import { EASTER_EGGS } from '../src/lib/easter-eggs.ts';

/** 用配置里的第一条彩蛋当作被测序列，避免测试和配置各写一份 */
const SECRET = [...EASTER_EGGS[0].notes];
const OPTS = { maxGapMs: EASTER_EGGS[0].maxGapMs };

/** 依次 push，返回最后一次的判定结果 */
function feed(detector, notes, gap = 200) {
  let at = 0;
  let result = -1;
  for (const note of notes) {
    result = detector.push(note, at);
    at += gap;
  }
  return result;
}

test('the hidden phrase is recognised', () => {
  const detector = createSequenceDetector([SECRET], OPTS);
  assert.equal(feed(detector, SECRET), 0);
});

test('an incomplete phrase never fires', () => {
  for (let length = 1; length < SECRET.length; length += 1) {
    const detector = createSequenceDetector([SECRET], OPTS);
    assert.equal(feed(detector, SECRET.slice(0, length)), -1, SECRET.slice(0, length).join(' '));
  }
});

test('a wrong or reversed phrase never fires', () => {
  const candidates = [
    [...SECRET.slice(0, -1), 'C6'],
    [...SECRET].reverse(),
    [...SECRET.slice(0, -1), SECRET.at(-2)],
  ];
  for (const notes of candidates) {
    const detector = createSequenceDetector([SECRET], OPTS);
    assert.equal(feed(detector, notes), -1, notes.join(' '));
  }
});

test('playing around does not drift into a false positive', () => {
  const detector = createSequenceDetector([SECRET], OPTS);
  const noodling = [
    'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5',
    'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4',
  ];
  assert.equal(feed(detector, noodling), -1);
});

test('a pause longer than maxGapMs restarts the phrase', () => {
  const detector = createSequenceDetector([SECRET], { maxGapMs: 1000 });
  detector.push(SECRET[0], 0);
  detector.push(SECRET[1], 500);
  assert.equal(detector.push(SECRET[2], 3000), -1);
  assert.deepEqual([...detector.history], [SECRET[2]]);
});

test('a stale first note cannot be reused to complete the phrase', () => {
  const detector = createSequenceDetector([SECRET], OPTS);
  detector.push(SECRET[0], 0);
  detector.push(SECRET[1], 1000);
  detector.push(SECRET[2], 2000);
  assert.equal(detector.push(SECRET[3], 2000 + OPTS.maxGapMs + 1), -1);
});

test('a match clears the buffer so it does not fire twice by accident', () => {
  const detector = createSequenceDetector([SECRET], OPTS);
  assert.equal(feed(detector, SECRET), 0);
  assert.deepEqual([...detector.history], []);
  assert.equal(detector.push(SECRET[0], 5000), -1);
});

test('history stays bounded by the longest configured phrase', () => {
  const detector = createSequenceDetector([SECRET], OPTS);
  for (const note of ['C4', 'D4', 'E4', 'F4', 'G4', 'A4']) {
    detector.push(note, 0);
  }
  assert.ok(detector.history.length <= SECRET.length);
});

test('reset clears pending notes', () => {
  const detector = createSequenceDetector([SECRET], OPTS);
  detector.push(SECRET[0], 0);
  detector.reset();
  assert.deepEqual([...detector.history], []);
});

test('several phrases are matched independently', () => {
  const second = ['C4', 'C4', 'G4'];
  const detector = createSequenceDetector([SECRET, second], OPTS);
  assert.equal(feed(detector, SECRET), 0);
  assert.equal(feed(detector, second, 200), 1);
  assert.equal(feed(detector, ['C4', 'C4'], 200), -1);
});

test('an extra leading note does not block a later match', () => {
  const detector = createSequenceDetector([SECRET], { maxGapMs: 100000 });
  assert.equal(feed(detector, [SECRET[0], ...SECRET]), 0);
});

/* ------------------------------------------------------------------
   逐步匹配：提示模式（一次只亮一个键）靠它
   ------------------------------------------------------------------ */

test('session walks forward one note at a time', () => {
  const session = createSequenceSession(SECRET, OPTS);
  assert.equal(session.awaiting, SECRET[0]);
  assert.equal(session.progress, 0);

  for (let index = 0; index < SECRET.length - 1; index += 1) {
    const result = session.push(SECRET[index], index * 200);
    assert.equal(result.correct, true);
    assert.equal(result.matched, false);
    assert.equal(result.progress, index + 1);
    assert.equal(session.awaiting, SECRET[index + 1]);
  }
});

test('session reports a match only on the final note, then resets', () => {
  const session = createSequenceSession(SECRET, OPTS);
  let result;
  SECRET.forEach((note, index) => {
    result = session.push(note, index * 200);
  });
  assert.equal(result.matched, true);
  assert.equal(result.progress, SECRET.length);
  assert.equal(session.progress, 0);
  assert.equal(session.awaiting, SECRET[0]);
});

test('session keeps waiting for the same note after a wrong one', () => {
  const session = createSequenceSession(SECRET, OPTS);
  session.push(SECRET[0], 0);
  const wrong = 'C4';
  assert.ok(!SECRET.includes(wrong), 'the wrong note must not be in the phrase');

  const result = session.push(wrong, 200);
  assert.equal(result.correct, false);
  assert.equal(result.matched, false);
  assert.equal(session.awaiting, SECRET[0], 'a wrong note restarts, it never skips ahead');
});

test('session restarts from one when the wrong note is the first note', () => {
  const session = createSequenceSession(SECRET, OPTS);
  session.push(SECRET[0], 0);
  session.push(SECRET[1], 200);
  const result = session.push(SECRET[0], 400);
  assert.equal(result.correct, false);
  assert.equal(result.progress, 1);
  assert.equal(session.awaiting, SECRET[1]);
});

test('session restarts when the player pauses too long', () => {
  const session = createSequenceSession(SECRET, { maxGapMs: 1000 });
  session.push(SECRET[0], 0);
  session.push(SECRET[1], 500);
  assert.equal(session.progress, 2);

  // 停太久之后再弹的音，按"重新开始"来判定，所以它不算接上了第三步
  const stale = session.push(SECRET[2], 5000);
  assert.equal(stale.correct, false);
  assert.equal(session.progress, 0);
  assert.equal(session.awaiting, SECRET[0]);

  // 重新弹第一个音就能继续
  assert.equal(session.push(SECRET[0], 5200).correct, true);
  assert.equal(session.awaiting, SECRET[1]);
});

test('session reset clears progress', () => {
  const session = createSequenceSession(SECRET, OPTS);
  session.push(SECRET[0], 0);
  session.reset();
  assert.equal(session.progress, 0);
  assert.equal(session.awaiting, SECRET[0]);
});

test('a phrase of one note still behaves', () => {
  const session = createSequenceSession(['C4'], OPTS);
  assert.equal(session.push('C4', 0).matched, true);
  assert.equal(session.progress, 0);
});