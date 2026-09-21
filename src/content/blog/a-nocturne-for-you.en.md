---
title: "A Nocturne for You"
description: "One NEW VISIT, one nocturne that should not have played, and a mountain of legacy built from decisions that were right at the time."
pubDate: 2026-09-22
lang: en
tags: ["Notes", "Dev"]
---

Some bugs crash the page.

Some break a button.

And some wait until you innocently click **Enter the space**, then greet you with the opening note of Chopin's *Nocturne in E-flat major*.

Today, I got the third kind.

Strictly speaking, though, that was not even the worst problem I dealt with.

It was simply the moment when the whole mess finally became funny.

---

It started with a few tiny things I wanted to polish on my personal site.

The site has its own concept of a visit.

On a fresh visit, an Entry Gate appears before the rest of the site is revealed.

On an ordinary refresh, it should not.

If I refresh while reading the Blog section, I want to stay there.

If I refresh on About, I want to remain on About.

If I move from About into my introduction page and then return, I even want the precise scroll position to survive.

None of that sounds particularly dramatic.

The real trouble begins with one deceptively simple question:

**What exactly counts as entering the site again?**

---

## The Difference Between a Refresh and a Return

Eventually, the entire day revolved around one distinction.

There are **SAME VISIT** transitions.

A normal reload.

Back and forward navigation.

Internal ClientRouter transitions.

Moving between the About section and its related introduction page.

Those should preserve continuity.

Then there are **NEW VISIT** transitions.

Typing the URL into the address bar again.

Opening the site in a new tab.

Those should feel like arriving again.

The Entry Gate should return.

Music should begin from the start.

The underlying page should begin at Home.

State from the previous visit should not follow the user around like a ghost.

Unfortunately, browsers have their own opinions about navigation history, scroll restoration, autoplay policy, document lifetime, and audio state.

Those opinions do not always line up neatly with mine.

One of the earliest problems was that re-entering the URL could still behave as though the previous visit had never ended.

The Entry Gate might not return.

The old scroll position could survive.

The old audio position could survive too.

From the user's perspective, it felt like opening the front door only to discover that the room behind it had never been reset.

---

## Then the Audio System Developed a Personality

The site has two different kinds of audio.

There is ordinary background music, played as MP3.

Then there is the MIDI piano performance on the About section.

That second system uses Web Audio and an AudioContext.

Which means browser autoplay rules matter.

A lot.

A newly created AudioContext cannot always begin making sound on its own. Browsers often require a genuine user gesture first.

Earlier in the project, the nocturne occasionally failed to start because of that restriction.

So I added fallbacks.

Click the page: try again.

Press a key: try again.

Interact with the About page: try again.

At the time, that was a perfectly sensible fix.

And it worked.

Then the site grew.

The Entry Gate was added.

The background music gained its own MusicManager.

The nocturne gained a dedicated transport.

Eventually, audio activation was centralized into a single `audio-unlock.ts`, instead of letting the MP3 player and MIDI system each maintain their own private pile of gesture fallbacks.

The intended rule became much cleaner:

**A user gesture may unlock audio, but audio should only resume if that part of the site already intends to play.**

That sounded civilized.

Then I hard-refreshed the site.

Silence.

No MP3.

No MIDI.

---

## The Browser Has Its Own Definition of Permission

That problem turned out not to be entirely a bug in my code.

A hard reload destroys the old document.

It destroys the old AudioContext too.

The next page creates a fresh one.

And browsers are under no obligation to say:

> You were listening five seconds ago, so I will allow this brand-new document to make sound automatically.

The site can try to restore playback.

The browser can still refuse.

If it does, the only reliable fallback is to wait for another genuine `pointerdown` or `keydown`.

That produces a strangely backwards experience.

A normal refresh can leave the site silent.

But re-entering through the Entry Gate often works perfectly, because the gate naturally provides a fresh, trusted click.

It is not that NEW VISIT is somehow more powerful.

It simply comes with a user gesture.

---

## The Music Returned, but Its Timeline Did Not

Eventually, re-entering the site worked again.

The Entry Gate appeared.

I clicked it.

Audio played.

Great.

Except the music did not begin from the start.

The background track continued from its previous position.

The nocturne did the same.

The reason was simple once I found it.

Playback positions were being stored in sessionStorage.

The MP3 timelines looked like:

`track:dao-xiang`

`track:canon`

The nocturne used:

`identity:nocturne`

At that point, NEW VISIT only reset one thing:

whether the user had already passed the Entry Gate.

It did not reset any audio positions.

So the visit system said:

> Welcome back. This is a fresh arrival.

The audio system replied:

> Excellent. We will continue from bar 47.

That obviously did not match the intended experience.

The eventual rule became:

**NEW VISIT resets audio timelines.**

**SAME VISIT preserves them.**

That distinction mattered.

Resetting audio on every reload would have created a different problem: refresh the About page halfway through the nocturne, and suddenly Chopin starts over from the beginning.

So visit state and audio state finally began to agree on what "new" actually meant.

I thought that was probably the end of it.

That was optimistic.

---

## A Nocturne for You

Then came the funniest bug of the day.

The reproduction steps were wonderfully specific.

End a visit on About.

Type the site URL into the address bar again.

The Entry Gate appears normally.

Click **Enter the space**.

**Ding.**

One piano note.

Then the site returns to Home.

Just one note.

Not enough to call it a performance.

More than enough to make me stare at the monitor and ask:

**Why are you playing?**

The first fix seemed obvious.

Before unlocking the audio system inside the Entry Gate, stop the nocturne transport.

So the entry sequence became roughly:

stop the nocturne;

enable the background music;

unlock the audio system;

continue into the site.

Perfectly reasonable.

I tested it.

**Ding.**

Still there.

---

## The Problem Was Not That `stop()` Was Late

It was that the shot had already been fired.

Buried in the older About code was one of those early audio fallbacks.

At the document level, it listened for gestures such as:

`pointerdown`

`keydown`

and, in one place, even `wheel`.

The meaning was simple:

> If the user interacts while the nocturne wants to be playing, try starting it again.

The page underneath the Entry Gate was inert.

But the Entry Gate itself still lived inside the same document.

Its events could still bubble upward.

So the real sequence was:

I press the Enter button.

`pointerdown` fires first.

It bubbles to `document`.

The old About fallback receives it.

It concludes:

> The user has interacted.
> The user must want Chopin.

`transport.start()`.

That very same `pointerdown` is also a trusted user gesture.

The browser allows the AudioContext to wake up.

The nocturne gets its chance.

**Ding.**

Only after that does the button's actual `click` handler run.

The newer code says:

> Wait. This is a NEW VISIT. The nocturne should not be playing.

`stopNocturneTransport()`.

Too late.

The bullet has already left the barrel.

The final fix was almost comically small.

While the Entry Gate is locking the site, those old document-level "resume the nocturne on interaction" handlers simply return without doing anything.

Once the gate is gone, they behave exactly as before.

No MIDI rewrite.

No scheduler rewrite.

No AudioContext surgery.

Just one rule for an old piece of code:

**Not now.**

The nocturne finally stayed quiet.

---

## Then the Page Started Haunting Me

Once the audio bug was gone, another tiny problem immediately became visible.

If the previous visit had ended on About, then I re-entered the URL, the Entry Gate would appear correctly—but I could sometimes still see a trace of the old About page behind it.

After pressing Enter, the site would finally return to Home.

This was more dangerous than the audio bug.

Because preserving scroll position on refresh was not an accident.

It was a feature I had already spent time building.

Refresh About: remain on About.

Refresh Blog: remain on Blog.

Go back and forward: preserve the relevant position.

Move between related About pages: restore the precise scroll offset.

So the obvious fix:

```js
scrollTo(0, 0)
```

would certainly solve the new problem.

It could also cheerfully destroy several older fixes at once.

This is the point where a tiny visual bug starts standing next to structural load-bearing code.

---

## Hide the Ghost, or Ask Why It Exists?

The safest idea was straightforward.

If the Entry Gate is animating away, and the scroll position underneath may still be changing, simply keep the underlying page invisible until Home is ready.

That is a good engineering fix.

It does not fight the browser.

It does not rewrite scroll restoration.

It merely controls when the user is allowed to see the page.

But something about it still bothered me.

Because the old About position would still exist.

We would merely be hiding it.

So I asked a different question:

> If this has already been classified as a NEW VISIT, why should it inherit the previous visit's About position in the first place?

That question changed the problem.

---

## NEW VISIT Should Mean More Than "Show the Gate Again"

If a visit is truly new, then it should not merely mean:

> Show the Entry Gate again.

It should mean:

> Start this visit from the site's initial state.

In other words, Home should be the real underlying starting point.

The Entry Gate should simply sit on top of Home.

It should not work like this:

restore the old About position;

restore the old scroll state;

cover everything with a gate;

then, after the animation, drag the page back to Home.

Once phrased that way, the logic became much clearer.

**NEW VISIT: initial target is Home.**

**SAME VISIT: restore the previous position.**

Those are different states.

They should not share the same initial scroll semantics.

At that point, the "ghost page" stopped looking like an animation bug.

It was really exposing a state-modeling bug.

The question was no longer:

> How do I hide the old page?

It became:

> Why is the old page part of a new visit at all?

That change in framing finally made the system converge.

---

## Bug A and Bug B Did Not Need Names Anymore

During development, it is convenient to call things Bug A and Bug B.

Inside one long conversation, everyone knows what that means.

Outside it, those names are useless.

In plain language, the two real problems were:

**Does the site correctly distinguish continuity from a genuinely new visit?**

And:

**Do scroll state and audio state obey that same boundary?**

When those systems disagreed, everything strange followed naturally.

The Entry Gate appeared at the wrong time.

Scroll positions survived when they should not.

Audio timelines continued from old visits.

The nocturne woke up through an event listener that belonged to an earlier era.

The old About page haunted the background of a supposedly fresh arrival.

It looked like half a dozen unrelated bugs.

Most of them were different symptoms of one deeper issue:

**different parts of the site had different answers to the question, "Is this still the same visit?"**

Once visit state, scroll state, and audio state began speaking the same language, the problems finally started disappearing together.

---

## How a Mountain of Legacy Code Is Born

By the end of the day, I had a better appreciation for what we jokingly call "史山代码"—a mountain of accumulated history.

Not necessarily bad code.

Historical code.

One layer says:

> The nocturne sometimes stays silent.
> Resume it on user interaction.

Another says:

> The Entry Gate must prevent audio from leaking through.

Another says:

> Refreshes should preserve scroll position.

Another says:

> Re-entering the site should count as a fresh visit.

Another says:

> Fresh visits must reset audio timelines.

Another eventually discovers:

> The ancient user-interaction fallback can hear a `pointerdown` from the Entry Gate and fire before the new `click` handler gets a chance to stop it.

Every layer has a reason to exist.

Many of them were the correct solution when they were written.

The problem is that new logic does not erase old logic automatically.

It settles on top of it.

After enough time, you are no longer looking at a system designed all at once.

You are looking at archaeology.

You find a strange line of code.

You think:

> Why on earth is this here?

You delete it.

Something on the other side of the application starts singing.

That is when you discover it was load-bearing.

---

## Technical Debt Is Not Always the Result of Bad Decisions

I am increasingly convinced that technical debt is often misunderstood.

It is tempting to imagine that every ugly codebase must have been created by someone making terrible decisions.

Usually, the reality is less satisfying.

Someone made a reasonable decision.

The environment changed.

The old decision remained.

The old "wake the nocturne on interaction" fallback genuinely solved a problem once.

The scroll restoration system genuinely fixed another one.

The Entry Gate improved the arrival experience.

Centralized audio unlocking made the architecture cleaner.

None of those decisions were individually absurd.

The trouble began when all of them met.

That is why a legacy mess is often not a collection of bad ideas.

It is:

**a collection of good ideas that outlived the assumptions that made them good.**

---

## A Pile of Cells, a Pile of Data, and One Unfortunate Computer

At some point during all of this, the entire situation became funny enough that we described it in biological terms.

I am a pile of cells.

The AI is a pile of parameters and training data.

Together, we spent the evening surrounding one computer.

![A black-and-white comic joking that learning the fundamentals helps you know when AI is talking nonsense.](../../images/fat%20whale.png)

*Another way to summarize today's development process.*

My job was to say:

> Something about this feels wrong.

Its job was to dig through the code and reply:

> `pointerdown` fires before `click`.

I asked:

> If this is a NEW VISIT, why should it inherit About at all?

It translated that into:

> NEW VISIT overrides the initial scroll target to Home.

The computer handled the consequences.

That may actually be a reasonable summary of modern software development.

Carbon provides intuition.

Silicon performs archaeology.

The machine being edited absorbs the damage.

---

By the end of the night, the audio bug was gone.

A fresh visit resets the audio timeline properly.

The nocturne no longer fires a warning shot when the Entry Gate receives a click.

A new visit no longer drags the previous About state into the background.

A normal refresh still keeps the user where they were.

NEW VISIT and SAME VISIT finally mean different things all the way through the system.

Is the code perfect now?

Of course not.

It has simply reached another temporary equilibrium.

Will some of the code written today eventually become part of the next mountain of legacy code?

Almost certainly.

That is probably not a question of probability.

It is a question of time.

Fortunately, Minecraft has already taught us the correct philosophy.

Some bugs get fixed.

The others survive long enough

to become features.
