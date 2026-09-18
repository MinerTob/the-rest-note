/**
 * 钢琴采样清单（纯数据 + 纯函数，可单独测试）。
 *
 * 采样来源：Salamander Grand Piano (Alexander Holm)，CC BY 3.0。
 * 文件放在 public/audio/piano/，命名为音名，例如 C4.mp3 / Ds4.mp3（Ds = D#）。
 * 采样点按每三个半音一个铺开，所以任何一个音最多只需要变速一个半音。
 */

export type PianoSample = {
  /** 音名，同时也是文件名（不含扩展名） */
  name: string;
  midi: number;
  src: string;
};

/** 采样点：C / D# / F# / A 四个位置，覆盖的音域各不相同 */
const PLAN = [
  { name: 'C', semitone: 0, from: 1, to: 8 },
  { name: 'Ds', semitone: 3, from: 1, to: 7 },
  { name: 'Fs', semitone: 6, from: 1, to: 7 },
  { name: 'A', semitone: 9, from: 0, to: 7 },
] as const;

export const PIANO_BASE = '/audio/piano';

function midiOf(octave: number, semitone: number): number {
  return (octave + 1) * 12 + semitone;
}

export const PIANO_SAMPLES: PianoSample[] = PLAN.flatMap((point) => {
  const list: PianoSample[] = [];
  for (let octave = point.from; octave <= point.to; octave += 1) {
    const name = `${point.name}${octave}`;
    list.push({ name, midi: midiOf(octave, point.semitone), src: `${PIANO_BASE}/${name}.mp3` });
  }
  return list;
});

/** 离这个音最近的采样 */
export function nearestSample(midi: number, samples: PianoSample[] = PIANO_SAMPLES): PianoSample {
  let best = samples[0];
  let bestDistance = Math.abs(midi - best.midi);

  for (const sample of samples) {
    const distance = Math.abs(midi - sample.midi);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }

  return best;
}

/** 用播放速率把采样移到目标音高 */
export function playbackRateFor(sample: PianoSample, midi: number): number {
  return Math.pow(2, (midi - sample.midi) / 12);
}

/**
 * 覆盖 [min, max] 这段音域所需的最小采样集合。
 * 多取一个半音的余量，保证两端也落在最近的采样上。
 */
export function samplesForRange(
  min: number,
  max: number,
  samples: PianoSample[] = PIANO_SAMPLES,
): PianoSample[] {
  const needed = new Map<string, PianoSample>();

  for (let midi = min; midi <= max; midi += 1) {
    const sample = nearestSample(midi, samples);
    needed.set(sample.name, sample);
  }

  // 两端再各留一个采样，避免边界音落在很远的采样上
  const sorted = [...samples].sort((a, b) => a.midi - b.midi);
  const withMargin = new Set(needed.values());
  for (const target of [min, max]) {
    const index = sorted.findIndex((sample) => sample.midi >= target);
    for (const candidate of [sorted[index - 1], sorted[index], sorted[index + 1]]) {
      if (candidate) withMargin.add(candidate);
    }
  }

  return sorted.filter((sample) => withMargin.has(sample));
}
