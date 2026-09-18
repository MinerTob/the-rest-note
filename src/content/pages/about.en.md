---
title: "This site"
description: "What this site is made of: static rendering, two languages, a music system, and a 25-key MiniLab."
lang: en
---

This is a personal site. Pages are statically rendered at build time; only the music, the instrument and the clock need client-side JavaScript.

## Sections

- **Blog** — notes and records
- **Lab** — the experiment area, where the MiniLab lives
- **About** — this page

## Sound

Background music is handled by the Music Manager. The 25-key MiniLab in the Lab plays a sampled piano and never interferes with it.

Browsers do not allow audio before a user interaction, so the music system starts in `READY` and only makes sound after your first click, key press or piano note. Default volume is 30%.

## Interface

Colour and material are driven by one set of design tokens: gradients, liquid glass, LCD details. Components only use semantic variables and never hard-code a colour.