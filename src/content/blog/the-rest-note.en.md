---
title: "The Rest Note: I Finally Left Myself a Beat of Rest"
description: "On September 19, 2026, The Rest Note went live. This is its first development journal — and its first measure."
pubDate: 2026-09-19
lang: en
tags: ["Notes", "Dev"]
---

On September 19, 2026, **The Rest Note officially went live.**

Writing that sentence feels a little strange.

For a long time, before anyone could actually reach it through a URL, it was nothing more than a folder on my computer—a collection of `.astro`, `.ts`, and `.css` files, along with more rounds of *“This still doesn't feel right. Let me change it again.”* than I could count.

Now, at last, it has become a real place on the internet.

## It Started as a “Personal Website”

At first, I simply wanted to build a personal website of my own.

But the idea of a *personal website* always felt like it was missing something. If I simply arranged my name, introduction, interests, contact information, and a few articles into neat sections, it would feel more like a digital business card than a place of my own.

That wasn't what I wanted.

I wanted people to be able to open the site without necessarily coming here to find something.

They could read an article, listen to some music, play a few notes—or do nothing at all.

Eventually, I gave it a name:

**The Rest Note.**

*Rest* can mean taking a break. In music, it can also mean a moment of silence.

A piece of music cannot be filled with notes from beginning to end. It is often the silent spaces between them that give the phrases around them room to breathe.

I think this website is meant to be something like that.

> **Between the phrases of life, leave a quiet beat for yourself.**

## What I Built It With

The Rest Note is built primarily with **Astro 7**, with **TypeScript** for its logic and native CSS for almost all of its styling.

I didn't use React, Vue, or Svelte, and there is no Tailwind either. The entire site is ultimately built as static pages, so there is no database and no conventional backend.

But being a static website doesn't mean it has to sit still.

The Rest Note uses the **Web Audio API** for music and piano playback, and the **Web MIDI API** to connect to a real MIDI keyboard. On the About page, the tags that fall, collide, can be dragged around, and even react when you shake your phone are powered by **Matter.js**.

The Blog and Lab use Astro Content Collections, the site is available in both Chinese and English, and larger assets such as audio files are managed through Git LFS.

So the stack now looks something like this:

**Astro 7 + TypeScript + Native CSS + Web Audio API + Web MIDI API + Matter.js + Git LFS**

Which sounds like quite a lot for something that started with:

*“I'm just going to make myself a blog.”*

## A Piano Hidden Inside a Website

Of everything on this site, music is probably the last thing I would call decoration.

There is a 25-key MiniLab in the Lab.

You can play it with a mouse, a touchscreen, or a computer keyboard. You can also connect a real MIDI keyboard and play it directly.

I also hid a few little secrets inside it.

Some melodies aren't buttons in a menu, and the site won't simply tell you, *“Click here to trigger an Easter egg.”*

You actually have to play them.

Once the right notes appear in the right order, the site's theme changes, and the music changes with it.

I really like designing things this way.

Unlike a traditional interface, it doesn't constantly tell you:

**You can click here.**

**There's another feature over there.**

Some things are simply better left for curious people to discover on their own.

## 88 Keys, and a Little About Me

The About page is one of my favourite parts of the site—and also one of the parts I spent the most time wrestling with.

There is a full **88-key piano** on the page, with a MIDI nocturne playing above it. As the music continues, tags representing different parts of me begin to appear from above and fall according to the laws of physics.

Music. Aviation. Photography. Astronomy. Technology...

And also directness, persistence, and an analytical mind.

They collide with one another, bounce a little, settle in different places, and can be dragged around.

I didn't want the About page to be the traditional:

> Name:
> Age:
> Hobbies:
> About Me:

Because a real person isn't made up of a few fields on a form.

I would rather let those pieces appear gradually with the music.

Just like getting to know someone.

You don't learn everything about them in the first second.

## Then the Bugs Started Teaching Me

Once I really started building the site, I realised that **“it runs”** and **“it works properly for someone visiting for the first time”** are two completely different things.

One day, I cleared my browser cache to simulate someone visiting the site for the very first time.

Then I pressed a piano key.

**Nothing happened.**

The reason was simple: the piano samples hadn't finished downloading, and the code at the time simply stopped if it couldn't find the sample it needed.

As the developer, I knew:

*It's loading.*

A visitor wouldn't.

They would simply think:

**It's broken.**

At first, I even considered adding a loading screen and making visitors wait until every audio file had finished downloading before they could enter the site.

But the more I thought about it, the more it felt like I was making every visitor pay for a technical problem that was mine to solve.

So I took a different approach.

If a sample isn't ready yet, a lightweight synthesizer responds first. Once the actual piano sample finishes loading, it naturally takes over.

That way, even on someone's very first visit, the first key they press should make a sound.

It taught me a very simple lesson:

**Users don't need to know why your code isn't ready yet.**

They only need to know whether the thing they just pressed responded.

## Safari, and the Things You Only Discover on Real Devices

Then it was my iPhone's turn to teach me something.

Browser autoplay restrictions, unlocking an `AudioContext`, motion and orientation permissions, the way Safari restores scroll positions...

Some problems can survive dozens of tests on a computer and suddenly appear the moment you try the same thing on a phone.

At one point, the MIDI performance on the About page behaved in a particularly ridiculous way.

Open it for the first time:

**No sound.**

Refresh once:

**Still maybe no sound.**

Refresh again—

**It works.**

Eventually, I found out that audio unlocking had originally been designed as a one-time attempt. The problem was that on an iPhone, the first interaction could also bring up the Motion & Orientation permission prompt, so that precious user gesture might not successfully unlock the audio at all.

In the end, the solution wasn't to make the user refresh the page.

It was to teach the program:

**If it doesn't work the first time, try again on the next interaction.**

There were plenty of similar problems.

Safari sometimes quietly restores the previous scroll position after the entry screen disappears, so I even had to pull the page back to the top at several different moments after entering the site.

It sounds a little silly.

But it works.

Sometimes that's just what development is like.

You think you're working on elegant architecture, only to end up in some strangely primitive battle of wits with a web browser.

## It Finally Left localhost Behind

During development, I saw this address far too many times:

`localhost:4321`

While the site was running there, I knew where every button was. I knew how every Easter egg was triggered.

But it was still only on my computer.

Then today, I fixed the last few problems, finished the build, pushed the repository, deployed the site, and opened The Rest Note through a real public URL for the first time.

That moment felt different from simply seeing a successful build.

Because from then on, it was no longer just something inside my development environment.

**Other people could actually walk in.**

They might stay for only a few seconds.

They might read an article.

They might never discover what's hidden inside the MiniLab.

They might spend a while listening to the nocturne on the About page.

Or they might do nothing at all—look around for a moment, then close the page.

I'm fine with all of those.

I never intended this to be a place where visitors had to accomplish anything.

## The First Measure

The Rest Note is, of course, nowhere near “finished.”

There aren't many articles in the Blog yet. More things will be added to the Lab, and the design will certainly continue to change.

But I don't really want to say:

*“I'll properly begin once everything is finished.”*

Because a place that truly belongs to someone probably shouldn't have a final version.

It should change along with them.

Today, I might write about code. Tomorrow, music. Later, perhaps a journey, a photograph, an aircraft I happened to come across, or simply some small thought that occurred to me one day.

Years from now, I might look back and think the code I wrote today was naïve, or notice all sorts of things in the design that weren't quite mature yet.

But at least I'll know this:

**On September 19, 2026, I really built it.**

It began with a simple thought—*“I want to make a blog of my own.”* Then came tens of thousands of lines of code, rebuilding things over and over again, testing on real phones, loading audio, MIDI, glass materials, physics, and finally, deployment.

A folder on my computer had finally become a tiny corner of the internet.

So I'll leave this article here as the first development journal of The Rest Note.

And as its first measure.

I don't know what the next measure will be about yet.

That's okay.

**After every rest, the music goes on.**
