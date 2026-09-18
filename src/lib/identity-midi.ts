/** Standard MIDI format 0/1 reader. Musical time stays in ticks until tempo integration. */
export type MidiNote = {
  midi: number;
  velocity: number;
  channel: number;
  track: number;
  tick: number;
  endTick: number;
  releaseTick: number;
  start: number;
  release: number;
  end: number;
};
export type MidiScore = {
  ppq: number;
  notes: MidiNote[];
  duration: number;
  durationTicks: number;
  tempos: { tick: number; us: number }[];
  signatures: { tick: number; numerator: number; denominator: number }[];
  secondsAt: (tick: number) => number;
};

export function parseMidi(bytes: Uint8Array): MidiScore {
  let p = 0;
  const need = (n: number) => {
    if (p + n > bytes.length) throw new Error("Truncated MIDI");
  };
  const u8 = () => {
    need(1);
    return bytes[p++];
  };
  const u16 = () => u8() * 256 + u8();
  const u32 = () => u16() * 65536 + u16();
  const text = (n: number) =>
    Array.from({ length: n }, u8)
      .map((c) => String.fromCharCode(c))
      .join("");
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = v * 128 + (b & 127);
      if (!(b & 128)) return v;
    }
    throw new Error("Invalid MIDI VLQ");
  };
  if (text(4) !== "MThd") throw new Error("Not a MIDI file");
  const header = u32();
  if (header < 6) throw new Error("Invalid MIDI header");
  const format = u16(),
    tracks = u16(),
    ppq = u16();
  if (format > 1 || !ppq || ppq & 0x8000)
    throw new Error("Unsupported MIDI timing");
  need(header - 6);
  p += header - 6;
  const tempos = [{ tick: 0, us: 500000 }];
  const signatures: MidiScore["signatures"] = [];
  const events: {
    tick: number;
    track: number;
    channel: number;
    kind: number;
    a: number;
    b: number;
    order: number;
  }[] = [];
  let durationTicks = 0;
  for (let track = 0; track < tracks; track++) {
    if (text(4) !== "MTrk") throw new Error("Missing MIDI track");
    const length = u32();
    need(length);
    const end = p + length;
    let tick = 0,
      running = 0;
    while (p < end) {
      tick += vlq();
      let status = u8();
      if (status < 128) {
        p--;
        if (!running) throw new Error("Missing running status");
        status = running;
      }
      if (status < 0xf0) running = status;
      if (status === 0xff) {
        const type = u8(),
          size = vlq();
        need(size);
        if (type === 0x51 && size === 3)
          tempos.push({
            tick,
            us: bytes[p] * 65536 + bytes[p + 1] * 256 + bytes[p + 2],
          });
        if (type === 0x58 && size >= 2)
          signatures.push({
            tick,
            numerator: bytes[p],
            denominator: 2 ** bytes[p + 1],
          });
        p += size;
      } else if (status === 0xf0 || status === 0xf7) {
        const size = vlq();
        need(size);
        p += size;
        running = 0;
      } else if (status < 0xf0) {
        const kind = status >> 4,
          a = u8(),
          b = kind === 12 || kind === 13 ? 0 : u8();
        if (a > 127 || b > 127) throw new Error("Invalid MIDI data");
        events.push({
          tick,
          track,
          channel: status & 15,
          kind,
          a,
          b,
          order: events.length,
        });
      } else throw new Error("Unsupported MIDI status");
      if (p > end) throw new Error("Invalid MIDI track length");
    }
    durationTicks = Math.max(durationTicks, tick);
  }
  tempos.sort((a, b) => a.tick - b.tick);
  signatures.sort((a, b) => a.tick - b.tick);
  const secondsAt = (tick: number) => {
    let seconds = 0,
      previous = 0,
      us = 500000;
    for (const tempo of tempos) {
      if (tempo.tick > tick) break;
      seconds += ((tempo.tick - previous) * us) / ppq / 1e6;
      previous = tempo.tick;
      us = tempo.us;
    }
    return seconds + ((tick - previous) * us) / ppq / 1e6;
  };
  const notes: MidiNote[] = [];
  const down = new Map<string, MidiNote[]>(),
    sustained = new Map<number, MidiNote[]>(),
    pedal = new Set<number>();
  const close = (n: MidiNote, tick: number) => {
    n.endTick = tick;
    n.end = secondsAt(tick);
  };
  for (const e of events.sort((a, b) => a.tick - b.tick || a.order - b.order)) {
    const key = `${e.channel}:${e.a}`;
    if (e.kind === 9 && e.b > 0) {
      const n = {
        midi: e.a,
        velocity: e.b / 127,
        channel: e.channel,
        track: e.track,
        tick: e.tick,
        endTick: durationTicks,
        releaseTick: durationTicks,
        start: secondsAt(e.tick),
        release: secondsAt(durationTicks),
        end: secondsAt(durationTicks),
      };
      notes.push(n);
      const queue = down.get(key) ?? [];
      queue.push(n);
      down.set(key, queue);
    } else if (e.kind === 8 || (e.kind === 9 && e.b === 0)) {
      const n = down.get(key)?.shift();
      if (!n) continue;
      // Note-off ends the visible key press; pedal-up ends the sounding voice.
      n.releaseTick = e.tick;
      n.release = secondsAt(e.tick);
      if (pedal.has(e.channel)) {
        const held = sustained.get(e.channel) ?? [];
        held.push(n);
        sustained.set(e.channel, held);
      } else close(n, e.tick);
    } else if (e.kind === 11 && e.a === 64) {
      if (e.b >= 64) pedal.add(e.channel);
      else {
        pedal.delete(e.channel);
        for (const n of sustained.get(e.channel) ?? []) close(n, e.tick);
        sustained.delete(e.channel);
      }
    }
  }
  return {
    ppq,
    notes: notes.sort((a, b) => a.start - b.start),
    durationTicks,
    duration: secondsAt(durationTicks),
    tempos,
    signatures,
    secondsAt,
  };
}

/** This score encodes its anacrusis as 1/8 followed by 12/8, not a padded silent bar. */
export function identityRevealPlan(score: MidiScore, count: number) {
  const full = score.signatures.find(
    (s) => s.tick > 0 && s.numerator === 12 && s.denominator === 8,
  );
  const pickup = score.signatures[0];
  if (
    !full ||
    pickup?.tick !== 0 ||
    pickup.numerator !== 1 ||
    pickup.denominator !== 8 ||
    full.tick !== score.ppq / 2
  )
    throw new Error("Unexpected identity score pickup");
  const endTick =
    full.tick + (4 * score.ppq * full.numerator * 4) / full.denominator;
  const deadline = score.secondsAt(endTick);
  const melody = score.notes.filter(
    (n) => n.track === 0 && n.tick < endTick && n.start <= deadline - 1.14,
  );
  if (melody.length < count)
    throw new Error("Not enough melody notes for identity tags");
  const triggers = Array.from(
    { length: count },
    (_, i) =>
      melody[Math.floor((i * (melody.length - 1)) / Math.max(1, count - 1))],
  );
  return { endTick, deadline, triggers };
}
