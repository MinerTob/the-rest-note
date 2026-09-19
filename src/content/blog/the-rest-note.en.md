---
title: "The Rest Note: Leaving a Measure of Silence for Myself"
description: "On September 19, 2026, The Rest Note went live. This is its first development journal — and its first measure."
pubDate: 2026-09-19
lang: en
tags: ["Notes", "Dev"]
---

On September 19, 2026, The Rest Note officially went live.

It feels a little strange to write that sentence.

Before it became a place anyone could visit through a URL, it spent a long time as little more than a folder on my computer: a collection of `.astro`, `.ts`, and `.css` files, accompanied by more rounds of "Something still feels off. Let me change it again." than I can count.

Now, at last, it exists as a real place on the internet.

## It Started as a "Personal Website"

At first, I simply wanted to build a personal website of my own.

But the phrase personal website always felt as though it was missing something. If all I did was arrange my name, introduction, interests, contact information, and a few articles into neat sections, the result would feel more like a digital business card than a place that actually belonged to me.

That wasn't quite what I wanted.

I wanted people to be able to visit without needing a particular reason.

They could read something, listen to music, play a few notes on the piano—or simply do nothing at all.

Eventually, I gave this place a name:

The Rest Note.

The word rest carries two meanings here. It can mean taking a break, but in music, a rest is also a moment of silence written into the score.

A piece of music cannot be filled with notes from beginning to end. Sometimes it is the silence between them that gives the melody room to breathe.

I suppose this website is meant to be something similar.

Between the melodies of life, leave a measure of silence for yourself.

## What It's Built With

The Rest Note is built primarily with Astro 7, with TypeScript for the logic and plain CSS for almost all of the styling.

There is no React, Vue, or Svelte, and no Tailwind. The entire site is ultimately built into static pages, so there is no runtime database and no conventional backend.

But being a static website doesn't mean it has to sit still.

The Rest Note uses the Web Audio API to handle music and piano playback, while the Web MIDI API allows it to communicate with a real MIDI keyboard. On the About page, the identity tags that fall, collide, bounce, and react when you shake your phone are powered by Matter.js.

The Blog and Lab are managed through Astro Content Collections, the site has both Chinese and English versions, and larger assets such as audio files are handled through Git LFS.

So, if I had to reduce the project to a single line, its stack would look something like this:

**Astro 7 + TypeScript + Native CSS + Web Audio API + Web MIDI API + Matter.js + Git LFS**

Which is rather more than I had in mind when I first said:

"I'm just going to make myself a blog."

## A Piano Hidden Inside a Website

Music is probably the least decorative part of this entire project.

There is a 25-key MiniLab inside the Lab section.

You can play it with a mouse, a touchscreen, a computer keyboard, or even connect a real MIDI keyboard and play it directly.

And I hid a few secrets inside it.

Some melodies aren't buttons in a menu. The site never tells you, "Click here to unlock an Easter egg."

You have to actually play them.

When the correct sequence of notes is performed, the website changes its theme, and the music changes with it.

I like designing things this way.

Traditional interfaces are constantly telling us:

Click here.

There's another feature over there.

But I think some things are better left for curious people to discover on their own.

## 88 Keys, and a Little of Me

The About page is probably my favourite part of the site.

It was also one of the most troublesome to build.

There is a complete 88-key piano on the page, with a MIDI nocturne playing above it. As the music continues, tags representing different parts of me begin to appear and fall into the scene.

Music. Aviation. Photography. Astronomy. Technology.

And a few parts of my personality as well: directness, persistence, and an analytical mind.

The tags collide with one another, bounce, settle in different places, and can even be picked up and moved around.

I didn't want the About page to look like this:

Name:
Age:
Hobbies:
About Me:

A person isn't really a collection of fields in a form.

I would rather let those pieces appear gradually, one by one, with the music.

After all, that is usually how we come to know a person.

We don't learn everything in the first second.

## And Then the Bugs Started Teaching Me Things

Once I began testing the site properly, I discovered that "it works" and "it works for someone visiting for the first time" are two very different standards.

At one point, I cleared my browser cache to simulate a completely new visitor.

Then I pressed a piano key.

Nothing happened.

The reason was simple: the piano samples were still downloading, and the original code simply gave up when the sample for a particular note wasn't ready.

As the developer, I knew it was loading.

A visitor wouldn't.

To them, the conclusion would simply be:

It's broken.

My first idea was to add a loading screen and refuse to let anyone enter until every audio file had finished downloading.

But the more I thought about it, the less sense that made. I would have been forcing every visitor to wait because of a technical problem that was mine to solve.

So I changed the approach.

If a piano sample isn't ready yet, a lightweight synthesizer responds immediately. As soon as the real sample becomes available, it quietly takes over.

The result is simple: even on a cold first visit, the very first key should make a sound.

That taught me something surprisingly basic:

The user doesn't need to know why your code isn't ready yet.

They only need to know whether the thing they just touched responded.

## Safari, and the Things You Only Discover on Real Devices

Then my iPhone decided it was time for another lesson.

Browser autoplay restrictions. AudioContext unlocking. Motion and orientation permissions. Safari restoring scroll positions whenever it feels like it.

Some problems can survive dozens of desktop tests and reveal themselves the moment you open the same page on a phone.

At one point, the MIDI performance on the About page behaved in a particularly ridiculous way.

Open the page for the first time:

No sound.

Refresh it:

Maybe still no sound.

Refresh it again:

Perfect.

Eventually, I found the problem. Audio unlocking had been treated as a one-shot attempt. On an iPhone, however, that first interaction might also trigger the Motion & Orientation permission prompt, meaning the precious user gesture needed to unlock audio could effectively be lost.

The solution wasn't to tell people to refresh the page.

It was to teach the program a much more reasonable behaviour:

If it didn't work the first time, try again on the next interaction.

Safari had a few more surprises waiting for me.

For example, it sometimes restores an old scroll position after the entry screen disappears. I ended up having to correct the page position at several carefully chosen moments just to make sure a new visit actually begins at the top.

It doesn't sound particularly elegant.

But it works.

That, I have learned, is sometimes what development looks like.

You begin the day thinking about elegant architecture.

You end it engaged in psychological warfare with a web browser.

## Leaving `localhost` Behind

During development, I saw this address more times than I could possibly count:

`localhost:4321`

When the site lived there, I knew where every button was. I knew how every Easter egg worked. I knew what every strange little interaction was supposed to do.

But it was still only on my computer.

Today, after fixing the last few problems, running the build, pushing the repository, and deploying the site, I opened The Rest Note through a real public URL for the first time.

That felt different from simply seeing a successful build.

Because from that moment on, it was no longer just a project inside my development environment.

Someone else could actually walk in.

Maybe they'll stay for thirty seconds.

Maybe they'll read an article.

Maybe they'll never discover what's hidden inside the MiniLab.

Maybe they'll spend a while listening to the nocturne on the About page.

Or maybe they'll simply look around for a moment and close the tab.

That's fine too.

I never wanted this place to feel as though visitors had something they were required to accomplish.

## The First Measure

The Rest Note is certainly not "finished."

There aren't many articles in the Blog yet. More things will eventually appear in the Lab. The design will change, and I'm sure parts of the code will be rewritten as I learn more.

But I don't really want to say:

"I'll properly begin once everything is finished."

A place that genuinely belongs to someone probably shouldn't have a final version.

It should change as they do.

Today I might write about code. Tomorrow it might be music. Later, perhaps a journey, a photograph, an aircraft I happened to see, or simply a small thought I decided was worth keeping.

Years from now, I may look back and find the code embarrassingly naïve. I may notice a hundred things in the design that I would do differently.

But at least I'll be able to say:

On September 19, 2026, I made it real.

It began with a simple thought—I want to build a blog of my own—and slowly grew into thousands of lines of code, countless revisions, real-device testing, audio systems, MIDI, glass materials, physics, and finally, deployment.

What was once a folder on my computer has become a small corner of the internet.

So I'll leave this here as the first development journal of The Rest Note.

And, perhaps, its first measure.

I don't know what I'll write in the next one yet.

That's all right.

After a rest, the music always continues.
