---
title: "Audio system notes"
description: "How sound is organised on this site: the Music Manager, the sampled piano, and the 25-key Lab instrument."
pubDate: 2026-09-16
lang: en
tags: ["Audio", "Web"]
---

Notes on how the audio side of this site works, so future me can change it without re-reading everything.

## Two kinds of sound

There are two unrelated kinds of sound here, so they live on two separate chains:

- **Background music** — handled by the Music Manager: current track, volume, playback state, fades.
- **MiniLab notes** — handled by the Piano Sound Engine, whose only job is turning a MIDI note into sound. It does not care what the background music is doing, and it never pauses it.

The split is practical: background music has to survive page navigation, while a piano key has to start the moment it is pressed and stop when it is released.

## Samples, not oscillators

MiniLab plays real piano samples rather than synthesised tones. Samples are spaced three semitones apart and the gaps are filled by playback rate, so pitch stays accurate.

Sample source: Salamander Grand Piano (Alexander Holm), CC BY 3.0.

## Browsers will not autoplay

Every browser blocks audio before a user interaction. So the music system starts in `READY`, not `ACTIVE`: the page only prepares the object, and sound begins after the first click, key press, or piano note.

That has a side benefit — the site never blares at you on load. The default volume is deliberately kept at 30%.

## What the Music Manager really does

Switching tracks is not just swapping a `src`. A few things have to be handled:

1. Fade the current track out instead of cutting it off.
2. Guard against events from the old audio element polluting the new state.
3. If a track cannot play because the file is missing, fall back to the default track rather than getting stuck.
