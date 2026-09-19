---
title: "Web MIDI input"
summary: "Plug in a real MIDI keyboard and play the browser's piano engine directly (PC only)."
lang: en
status: online
order: 2
---

Input devices are read through the Web MIDI API. Note On starts a note, Note Off releases it, velocity drives volume, and the matching key on screen lights up while you play.

**PC only.** Every browser on iOS is WebKit underneath, and WebKit does not implement Web MIDI: the device never appears in the list, and plugging a keyboard in does nothing. On a phone, play the MiniLab with your fingers.

On a desktop browser that does not support it, a single line reads `MIDI / NOT SUPPORTED` — no modal.
