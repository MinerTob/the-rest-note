---
title: "A Nocturne for You"
description: "One NEW VISIT, one nocturne that should not have played, and two good decisions that outlived their assumptions."
pubDate: 2026-09-22
lang: en
tags: ["Notes", "Dev"]
---

Some bugs crash the program.

Some throw errors.

And some wait until you innocently click **Enter**, then greet you with the opening note of Chopin's *Nocturne in E-flat major*.

Today, I got the third kind.

At first, it barely seemed worth fixing.

My site has an entry gate. When a visit is considered new, the gate appears first; only after you click **Enter the space** does the site properly open. The page should start from Home, the music timeline should reset, and everything should feel like a fresh arrival.

That was the design, anyway.

Reality was slightly more romantic.

If my previous visit had ended on the About section, I could type the URL into the address bar again, land on the entry screen, click the button—

**ding.**

Chopin would say hello first.

Just one note.

Not enough to call it a performance, but more than enough to make me stare at the screen and ask:

**Why are you playing?**

## A Nocturne from an Earlier Era

The funny part is that this was not really a new bug.

It was an old fix.

Earlier in the project, the MIDI nocturne on the About page sometimes failed to start because of browser autoplay restrictions. Web Audio is particularly sensitive to user activation, so I added a fallback that made perfect sense at the time:

if the user clicked, pressed a key, or interacted with the About page, try starting the nocturne again.

It worked.

Then the site evolved.

I added an entry gate. Audio unlocking was centralized. Visit state became more deliberate. NEW VISIT and SAME VISIT started meaning different things.

But that old fallback was still alive.

The page beneath the entry gate was inert, but a `pointerdown` on the gate itself could still bubble all the way up to `document`.

So the browser effectively performed this little comedy:

I press the Enter button.

Old code receives `pointerdown`:

> Understood. The user would like some Chopin.

`transport.start()`.

The browser notices that this is, in fact, a genuine user gesture, so the AudioContext wakes up too.

**Ding.**

A moment later, the newer entry-gate code receives the actual `click`:

> Wait. This is a new visit. The nocturne should not be playing.

`stopNocturneTransport()`.

Unfortunately, the bullet had already left the barrel.

## The Most Dangerous Moment Is When You Think the Bug Is Already Fixed

The first fix was perfectly reasonable.

If the nocturne should not play before entering the site, then the entry handler should stop it before unlocking the rest of the audio system.

Conceptually, that was correct.

It also failed.

Because `pointerdown` happens before `click`.

The real problem was not that the Enter button reacted too slowly. The problem was that the old document-level activation fallback should never have been allowed to respond while the entry gate was active.

The final fix was almost embarrassingly small.

While the entry gate is locking the site, the About and Intro pages simply refuse to respond to those global "resume the nocturne" gestures.

Once the gate is gone, the old behavior works normally again.

No MIDI engine rewrite.

No scheduler surgery.

No AudioContext redesign.

Just an actual gate in front of a path that had somehow survived every architectural change around it.

The nocturne finally went quiet.

## Then the Page Started Haunting Me

With the audio bug gone, another tiny problem immediately became visible.

If my previous visit ended on About, then I entered the URL again, I could sometimes see a faint remnant of the old About page behind the entry animation before the site eventually returned to Home.

That one was more dangerous.

A while ago, I had deliberately implemented scroll restoration so that refreshing About would keep you on About, refreshing Blog would keep you on Blog, and navigating between related pages would preserve their exact positions.

So the obvious solution—

```js
scrollTo(0, 0)
```

—would certainly fix the new problem.

It would also enthusiastically destroy several old fixes.

## What Does a NEW VISIT Actually Mean?

That was when the question changed.

Instead of asking:

> How do I hide the old page before returning to Home?

I asked:

> If the system already considers this a NEW VISIT, why should the new visit inherit the previous visit's scroll position at all?

The entry gate should not mean:

> Restore the previous page, then place a welcome screen over it.

It should mean:

> A new visit begins at Home, and the entry gate sits on top of that fresh starting point.

That sounds like a small wording change.

Architecturally, it is not.

It gave the scrolling system two much cleaner rules:

**NEW VISIT → the initial position belongs to Home.**

**SAME VISIT → preserve the existing scroll restoration behavior.**

Now re-entering the URL no longer brings the old About state into a new visit, while an ordinary refresh still returns exactly where it should.

And with that, Bug A disappeared too.

## One Bug Is a Bug. Enough Bugs Become a System.

The most interesting part of today was not that two bugs finally died.

It was realizing, again, how codebases slowly become what developers affectionately call spaghetti.

Bad code is not always born bad.

The old "click anywhere to wake the nocturne" fallback was once the correct answer to a real problem.

The scroll-restoration machinery exists because another real problem needed solving.

Every individual change can be justified.

Time is what makes things complicated.

Fix A is introduced for one reason.

Feature B begins to rely on A.

Feature C later changes the world in which A operates.

A few years later—or, in this project, a few hours later—A is still faithfully doing exactly what it was written to do.

The world around it has simply moved on.

And suddenly, yesterday's safety net becomes today's bug.

I am starting to think technical debt is not always a collection of terrible decisions.

Quite often, it is simply:

**a collection of good decisions that lived long enough to outlast their assumptions.**

---

Today, an AI and I spent an unreasonable amount of time dismantling chocolate chips around one computer.

My collection of biological cells supplied the intuition:

> Something about this feels wrong.

Its collection of parameters supplied the archaeology:

> This `pointerdown` fires before that `click`.

The computer supplied the suffering.

By the end of the night, the audio bug was gone.

Bug A was gone too.

Now, when a new visit begins, the site waits quietly at Home for me to press Enter.

No ghost of the previous page.

No accidental trigger.

And nobody decides, on my behalf, that clicking **Enter the space** means I must immediately be serenaded by Chopin.

At least, not today.

As Minecraft has taught us, there are two possible futures for every bug:

some get fixed;

the others survive long enough

to become features.
