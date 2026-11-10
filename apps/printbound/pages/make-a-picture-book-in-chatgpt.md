---
title: How to make a picture book in ChatGPT
eyebrow: Free guide
meta: Everything you need is ChatGPT and an afternoon: no signup, no tool to install. This is the same playbook our own print system follows.
description: A step-by-step guide to making a picture book in ChatGPT: a copy-paste starter prompt, the character-and-style-sheet trick that keeps your hero looking the same on every page, and the print specs (size, margins, lettering) that make pages worth printing.
head: How to Make a Picture Book in ChatGPT (Free Prompt) — PrintBound
---

<!-- deno-fmt-ignore-file -->

ChatGPT can write a story starring your own kid and paint every page. The catch:
ask it casually and you get a hero whose hair changes color on page 4, words
that drift off the edge, and art too small to print. This guide fixes all three:
a starter prompt to paste in, the consistency trick that does most of the work,
and the specs that make each page sharp enough for paper, where a phone screen
forgives and a printed page doesn't.

[The starter prompt](#prompt) · [The style sheet](#style-sheet) ·
[Outline](#outline) · [Generating pages](#generate) · [Lettering](#lettering) ·
[Proofreading](#proofread) · [The cover](#cover) ·
[What makes a page print-ready](#print-ready)

<h2 id="prompt">The starter prompt (copy and paste)</h2>

Paste this into ChatGPT and it walks you through the whole process in the right
order. Every rule in it is explained in the steps below.

```prompt Starter prompt
I want to make an illustrated picture book for my child, about 32 pages. Work with me step by step.

1. First, help me write a one-paragraph character and style sheet: my child's first name, age, hair, eyes, skin tone, one signature clothing detail (like a yellow raincoat), the color palette, and the art medium (for example: soft warm watercolor with gentle outlines). We will reuse this paragraph word for word in every image prompt.

2. Next, outline the story: one beat per page, with one or two short sentences of story text for each page.

3. Then generate the pages ONE AT A TIME, at your highest image quality, landscape (wider than tall), about 2784 x 2176 pixels. Begin every image prompt with the character and style sheet repeated word for word. Paint the page's story text into the illustration: large, clean, high-contrast lettering on a quiet part of the art, spelled exactly as written. Let the background art run all the way to the edges, but keep faces, characters, and every word at least 10% in from each edge.

4. Show me each page and wait for my OK before the next one. If I say a word is misspelled or something looks off, regenerate that page.
```

One note before you start: if any character is drawn from a photo of a real
person, your child included, make sure you have that person's OK (or, for a
child, that you're their parent or guardian). It matters even for a book that
never leaves your house.

<h2 id="style-sheet">Step 1: Write one character and style sheet</h2>

Inconsistent characters are the single most common way homemade AI picture books
go wrong: the model has no memory of what your hero looked like two pages ago
unless you tell it, every time. The fix is one paragraph, written once:

- Name, age, hair, eyes, skin tone
- One signature clothing detail: a yellow raincoat, red boots
- The color palette: say, moonlit blues with warm gold accents
- The art medium: for example, "soft warm watercolor, gentle outlines"

Then the rule that does the work: **repeat that paragraph word for word at the
top of every single image prompt.** Not paraphrased, not "same character as
before" — verbatim. Paraphrase it once and page 9's Maya gets a different
raincoat.

<h2 id="outline">Step 2: Outline the story, one beat per page</h2>

Plan about **32 pages**, the classic picture-book length, the same count as most
of the books already on your kid's shelf. One story beat per page, one or two
short sentences of text. Short lines matter twice over: they read well aloud,
and they're what the image model letters most reliably. If you're planning to
print with us, 32 pages is also our minimum; don't stop short.

Get the outline finished and approved before generating a single image. Changing
the story midway means regenerating pages, and each page takes a minute or two.

<h2 id="generate">Step 3: Generate pages one at a time, at high quality</h2>

Two settings decide whether the pages survive printing:

- **Highest image quality, every page.** Ask for it explicitly. Draft-quality
  images garble lettering and smear fine detail.
- **Landscape, about 2784 × 2176 pixels.** That's the size a 9×7-inch printed
  page needs at 300 DPI. Smaller images look fine on screen and blurry on paper;
  upscaling can sharpen a big image, not invent a small one.

Generate one page at a time and look at each before moving on. Batch-generating
ten pages feels faster right up until you notice page 3 drifted and everything
after it inherited the drift.

<h2 id="lettering">Step 4: Put the words in the art</h2>

The best-looking picture books have the story text painted into the
illustration: hand-lettered across a night sky, tucked into a quiet corner of
the meadow. Modern image models letter well at high quality, but they render
exactly what you type, so direct them like a typographer:

- **Spell every word exactly** as it should appear. A typo in the prompt is a
  typo in the book.
- **Say where the words go and how they look**: "two short lines, hand-lettered
  in the calm sky, off to the side, not over her face."
- **Ask for large, clean, high-contrast lettering** on a quiet part of the art.
  If the background is busy there, ask for a soft translucent panel behind the
  words.
- **Keep the whole text block at least 10% in from every edge** and biased
  toward the center, never tucked in a corner. (Why: see the print-ready specs
  below.)

<h2 id="proofread">Step 5: Proofread like a print shop</h2>

Review every page against three questions: is every word spelled right and easy
to read? Does the character match the style sheet: same hair, same raincoat,
same medium? Did the palette hold? Any miss, regenerate that one page; tweak the
wording or placement in the prompt and go again. Model-drawn text deserves a
proofread; a regeneration takes a minute, and a misspelled page lasts as long as
the book does.

<h2 id="cover">Step 6: Make the cover</h2>

Generate one more landscape image: the front cover, with **the title lettered
into the illustration, and nothing else**. No subtitle, no author credit; covers
read best when the title stars the hero's name (_Maya & the Moon Garden_). Keep
the lettering well inside the safe area and spelled exactly. If you want a back
cover too, make it a quiet wordless pattern that echoes the book's palette: no
scene, no characters.

<h2 id="print-ready">What makes a page print-ready</h2>

If the book only ever lives on a screen, you can relax all of this. If it might
ever become a printed book, these four specs are the difference:

- **Resolution: about 2784 × 2176 pixels, landscape.** A 9×7-inch page printed
  at 300 DPI needs every one of those pixels.
- **Bleed: background art runs to every edge.** Print presses trim about an
  eighth of an inch off each side, so art must overshoot the page; a white rim
  where the art stopped short looks homemade.
- **Safe area: faces and characters stay \~7–9% in from every edge.** Anything
  closer risks the trim clipping it.
- **Text stays 10% in from every edge**, a step further than the art, because a
  clipped letter is far more noticeable than a clipped leaf.

Follow those while you generate and every page comes out ready for paper, with
no rework later. When the book's done and you're weighing how to print it, from
do-it-yourself print-on-demand to handing us the job, the companion page walks
the whole landscape:
[print your ChatGPT story as a real book](print-your-chatgpt-book). And if
anyone at your house is wondering whether printing AI-generated art is allowed
at all, the answer for your own family is yes;
[the copyright guide](can-you-print-ai-images) has the plain-English answer with
sources.
