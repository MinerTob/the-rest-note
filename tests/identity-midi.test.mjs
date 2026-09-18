import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMidi, identityRevealPlan } from "../src/lib/identity-midi.ts";
const path = new URL(
  "../public/music/secret/f-chopin-nocturne-op9-no2-in-e-flat-major.mid",
  import.meta.url,
);
test("provided Chopin score uses a 1/8 pickup and completes four 12/8 bars at tick 11760", () => {
  const s = parseMidi(fs.readFileSync(path)),
    p = identityRevealPlan(s, 9);
  assert.equal(s.ppq, 480);
  assert.equal(s.notes.length, 1329);
  assert.equal(p.endTick, 11760);
  assert.ok(Math.abs(p.deadline - 33.464427875) < 1e-8);
  assert.ok(s.duration > 292 && s.duration < 294);
  assert.ok(s.notes.some((n) => n.releaseTick < n.endTick));
  assert.ok(s.notes.every((n) => n.start <= n.release && n.release <= n.end));
  assert.equal(p.triggers.length, 9);
  assert.equal(new Set(p.triggers).size, 9);
  assert.ok(p.triggers.every((n) => n.start + 1.14 <= p.deadline));
  assert.ok(
    s.notes.every((n) => n.end >= n.start && n.midi >= 21 && n.midi <= 108),
  );
});
test("ten identity tags still land inside the pickup and the first four bars", () => {
  // About 页现在有十个标签（第十个是"自我介绍"）。揭示计划必须仍然把
  // 全部十个塞进"弱起 + 前四小节"这段里，否则重头戏会掉到第五小节。
  const s = parseMidi(fs.readFileSync(path)),
    p = identityRevealPlan(s, 10);
  assert.equal(p.endTick, 11760);
  assert.equal(p.triggers.length, 10);
  assert.equal(new Set(p.triggers).size, 10);
  assert.ok(p.triggers.every((n) => n.tick < p.endTick));
  assert.ok(p.triggers.every((n) => n.start + 1.14 <= p.deadline));
});
const file = (events) =>
  new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    224,
    77,
    84,
    114,
    107,
    0,
    0,
    0,
    events.length,
    ...events,
  ]);
test("tempo changes integrate into seconds and running-status zero velocity releases a note", () => {
  const s = parseMidi(
    file([
      0, 0x90, 60, 80, 0x83, 0x60, 0xff, 0x51, 3, 15, 66, 64, 0x83, 0x60, 60, 0,
      0, 0xff, 47, 0,
    ]),
  );
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].end, 1.5);
});
test("sustain pedal delays note release until pedal-up", () => {
  const s = parseMidi(
    file([
      0, 0x90, 60, 90, 0, 0xb0, 64, 127, 0x83, 0x60, 0x80, 60, 0, 0x83, 0x60,
      0xb0, 64, 0, 0, 0xff, 47, 0,
    ]),
  );
  assert.equal(s.notes[0].endTick, 960);
  assert.equal(s.notes[0].end, 1);
  assert.equal(s.notes[0].releaseTick, 480);
  assert.equal(s.notes[0].release, 0.5);
});
test("invalid and truncated files fail explicitly", () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])));
  assert.throws(() => parseMidi(file([0, 0x90, 60])));
});
