---
title: Print your ChatGPT story as a real book
eyebrow: Printing guide
meta: You made the book: the story, the pages, maybe a cover. Here's what it takes to get it onto paper, every route included, and what each one costs.
description: You made a book in ChatGPT. Here's what it takes to print it: the specs that make pages print-ready (300 DPI, bleed, a 32-page floor), every route from DIY print-on-demand to a local shop, and what each one costs.
head: How to Print an AI-Generated Book: Turn Your ChatGPT Story Into a Real Book — PrintBound
---

<!-- deno-fmt-ignore-file -->

A book made in ChatGPT lives as a stack of images in a chat window. Turning that
into a bound book on a shelf takes two things: pages that meet print specs, and
a press to put them on paper. This page covers both: what "print-ready" means in
numbers, and the full landscape of ways to get it printed, from do-it-yourself
print-on-demand to handing us the whole job.

Haven't made the book yet? Start with our free guide,
[how to make a picture book in ChatGPT](make-a-picture-book-in-chatgpt)
(copy-paste starter prompt included), then come back here. And if a quieter
question is holding you back (_is it even OK to print AI-generated art?_), the
answer for your own family is yes:
[the copyright guide](can-you-print-ai-images) covers why, with sources.

[What print-ready means](#print-ready) ·
[Getting pages out of the chat](#export) · [Your printing options](#options) ·
[Where PrintBound fits](#printbound) · [Common questions](#faq)

<h2 id="print-ready">What "print-ready" means</h2>

A phone screen forgives almost anything; a printed page forgives nothing.
Whatever route you pick below, the press will hold your pages to the same four
specs:

- **Resolution: 300 DPI at the printed size.** For a 9×7-inch landscape page
  that's about **2784 × 2176 pixels**. Chat-default image sizes fall well short:
  they look crisp on screen and soft on paper, and upscaling can sharpen a
  near-miss but can't invent detail that was never there.
- **Bleed: art runs past every edge.** Presses print slightly oversized pages
  and trim about an eighth of an inch (3&nbsp;mm) off each side. Backgrounds
  must overshoot the trim line; art that stops at the edge leaves a thin white
  rim where the blade landed.
- **Safe area: faces and words stay in from the edges.** The same trim that
  removes the bleed can clip anything near it. Keep characters roughly 7–9% in
  from every edge and text a full 10% in; a clipped letter is far more
  noticeable than a clipped leaf.
- **Page count: about 32 interior pages.** Most binderies need roughly 24–32
  pages before a proper bound spine works at all. 32 is the classic picture-book
  length, and it's our minimum too.

One more decision before any printing: **trim size**, the finished page
dimensions. Picture books are usually square (8.5×8.5&nbsp;in) or landscape (9×7
or 10×8&nbsp;in). Pick the trim first, because your images' aspect ratio has to
match it; a stack of landscape pages can't become a square book without cropping
every scene.

<h2 id="export">Getting the pages out of the chat</h2>

Download each page image at full size: the download button on the image itself,
not a screenshot. A screenshot captures the image at your screen's resolution,
which throws away most of the pixels the press needs. Name the files in reading
order (`page-01`, `page-02`, …) as you go; sorting 32 near-identical watercolors
by memory is worse than it sounds.

<h2 id="options">Your options for printing it</h2>

There are several ways to print a book like this, and the right one depends on
how much of the production work you want to do yourself. All of these work;
here's what each one asks of you.

### Print-on-demand, do-it-yourself (Lulu, Blurb, and similar)

Print-on-demand services will bind a single copy of a full-color book, typically
**a print cost plus shipping** for a 32-page softcover, depending on trim,
paper, and cover. The catch is that they take finished files, not images: you
assemble an interior PDF at the exact trim size plus bleed, and a separate
wraparound cover PDF whose spine width you calculate from the page count and
paper stock. Expect an evening in a layout tool and, if you're wise, one proof
copy before the version you keep. If you enjoy that kind of production work,
this is the cheapest path to a bookstore-grade object.

### Photo-book builders (Shutterfly, Mixbook, and similar)

Drag-and-drop editors, no PDF required: the gentlest tooling of any route. If
your story text is already painted into the art, full-bleed image pages carry
the whole book cleanly. The result reads as a photo album rather than a picture
book: thicker photo paper, album-style binding, often a logo page at the back.
For some books that's fine; for a book meant to sit beside the ones on your
kid's shelf, it shows.

### A local print shop

The fastest way to hold a draft; many shops turn a job around in a day or two.
Binding options usually run to spiral, staple, or perfect-bound on cardstock
rather than a true casebound picture book, and they'll want a finished PDF just
like the print-on-demand route. Good for proofing the book before committing to
a nicer edition; rarely the keeper copy itself.

<h3 id="printbound">Where PrintBound fits</h3>

PrintBound prepares a complete book from your saved text, document files or
ordered page artwork. Review the composed interior and cover before requesting a
quote. The quote is for those exact files, your quantity, destination and
shipping option. PrintBound is the seller; its checkout and receipt cover one
print purchase.

Prepare and review your complete document in the book studio. A destination
quote shows the shipping options and final total before you decide to buy.

<h2 id="faq">Common questions</h2>

### What resolution do AI-generated images need to print well?

300 DPI at the final printed size. For a 9×7-inch landscape page with bleed,
that's about 2784×2176 pixels. Ask for the size explicitly when generating; chat
defaults fall short.

### How many pages does a printed book need?

Most binderies need roughly 24–32 interior pages before a bound spine works.
Plan for about 32, the classic picture-book length and our minimum. If your book
came out shorter, a few new spreads are quicker to add than you'd think; the
[outline step of the guide](make-a-picture-book-in-chatgpt#outline) shows how.

### How much does it cost to print a book made in ChatGPT?

The price depends on your selected document, binding, quantity, destination and
shipping. A PrintBound quote shows the complete total and expiry before you
decide to buy.

### My images are too small. Can upscaling fix them?

Partly. Upscaling sharpens an image that's already close to print size, and it's
a step we run on every book. What it can't do is invent detail that was never
there: a chat-default image blown up to full-page stays soft, and painted
lettering suffers first. The reliable fix is regenerating those pages at about
2784×2176 pixels; the style-sheet method in
[the guide](make-a-picture-book-in-chatgpt#style-sheet) keeps the regenerated
pages matching the rest of the book.
