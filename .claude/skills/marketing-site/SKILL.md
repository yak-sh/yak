---
name: marketing-site
description: >
  Use when writing, reviewing or restructuring any venture's marketing
  site: a home page, landing page or pricing page, a hero, headline,
  kicker, feature list, example cards, call to action or sign-up copy,
  even when the request only says "tweak the home page", "clean up the
  copy", "write the pitch", "make it clearer" or "are we selling
  everything?". Covers what a marketing site is for and how its copy is
  written. Who a product is for and what it costs are business-model;
  yaks.app's own audience, plans and pages are yaks-app-business; guide
  pages, READMEs and doc comments are writing-documentation.
---

# Marketing sites

A stranger lands on the page carrying two questions they may never put into
words: what is this, and is it for me? A marketing site exists to answer both,
plainly enough that the right person presses the one button and the wrong one
leaves knowing why. Every heading, line, example and feature on the page either
helps answer them or is in the way.

That makes a marketing page harder to write than it looks. We know the product
from the inside, so our own words feel clear to us: "space", "store", "Keep what
people make". The visitor has none of that context and won't stay long enough
to build it. And a hero feels like the place for a flourish, so the sentence
that most needs to be plain is the one most often written for effect.

A public page holds only what a visitor needs. No draft marker, task or memory
id, decision date, or note about the owner, agents or our process, in its text
or anywhere view-source reaches, comments in served HTML, JS and CSS included;
and no line about how the page was written or who wrote it. Notes for us go in
code that isn't served.

## What Jeff wants from it

Jeff, 2026-10-31, verbatim, on the yaks.app home page (T-134185):

> can we do some mockups of making the homepage more "dynamic"? right now it
> just kinda scrolls normally and some stuff is before the fold and some above.
> the goal of any marketing site is to plainly describe the product such that
> the target audience (see our use-case docs) knows what the product is and
> that it's for them.
>
> so, i want two things: first, copy cleanup. second, mockups that help
> introduce the product by doing more than just scrolling through each section
> of information. i think we can do better.
>
> for copy, most things are just too "mannered prose" and therefore confusing.
> what does "Keep what people make" mean? "Bring people together"? "Make it
> yours"? etc etc. this is all to clever and just not clear. it should be clear.
>
> some more examples of slop: "Start with what you need"
> "a world you can explore together", "Apps in the same space can work with the
> same saved item, each adding its own details." users won't know what a
> "space" is. we never describe that.
>
> and are we giving the most compelling pitch? are we selling all our features
> or did we leave things out? any simple product fixes that would make the
> pitch much more compelling? any low-hanging fruit? etc etc

And then: "probably make a marketing-site skill" (T-134186). Shown the YC
advice below, he said, verbatim:

> yep, perfect. nothing there disagrees with what i said. by "dynamic" i don't
> mean flashy and distracting. i'm thinking things like: keep THE BUTTON on
> screen! remove extraneous pitch material and don't make people scroll past
> miles of detail about every feature. the "dynamic" would help someone
> understand the product without having to dig. i assumed good design went
> without saying, but it seems we gotta put YC's advice in a skill.

And on the home page's examples, verbatim:

> we should probably not show every demo app as a grid and instead use rolling
> slides or something. it's meant to evoke "optionality" and perhaps trigger
> ideas, not to display a menu of options.

## What YC says

These are Y Combinator's words, not Jeff's, each opened from its source. They
agree with him, and they add a few tests worth running.

Kevin Hale, on what a visitor asks of a landing page, in order
([Startup School, week 7](https://ycombinator.com/blog/startup-school-week-7-recap-kevin-hale-on-conversion-rates-and-pricing)):
"what is this?", "Is it right for me?" (any "reflection of themselves… or…
their problems"), "Is it legit?", "Who else is using it?", "How much is it,
what's the catch?", "Where can I get help?". His copy-paste test: "can I just
copy-paste a sentence on this page… that I can put into an email." And on the
button: "is there any information that I put on this page that keeps me from
pushing the button", and "your call-to-action should be as close to that Magic
Moment as possible."

Michael Seibel
([How to pitch your company](https://www.ycombinator.com/blog/how-to-pitch-your-company/)):
"eliminate jargon, acronyms, marketing speak, and any ambiguous terms such as
"platform"", and "explain what you do in the simplest language possible". His
smart-friend test: "Write up a two sentence explanation… email it to a smart
friend… If they ask any clarifying questions, you need to revise."

Paul Graham: "When you write in a fancy way to impress people, you're making
them do extra work just so you can seem cool"
([Write simply](https://paulgraham.com/simply.html)). And "Say what you're doing
as soon as possible, preferably in the first sentence", "Better a narrow
description than a vague one"
([How to convince investors](https://paulgraham.com/investors.html)).

YC's design reviews, as their blog posts summarize them: one clear call to
action
([tips for increasing conversions](https://www.ycombinator.com/blog/design-review-tips-for-increasing-conversions)),
copy that's too clever backfires, and get people to a live demo fast
([Aaron and Garry](https://www.ycombinator.com/blog/design-review-watch-aaron-and-garry)).

## How a page is written

**Start with the outline.** Jeff, verbatim: "that's probably good advice for
the skill: start with the outline; what do people need to know? what's the
priority? turn that into an outline." And: "that outline then turns into the
sections of the site." So before any copy, write down what the people the page
is for need to know, most important first. Hale's questions are a good first
draft of the order. That list becomes the page's sections, in the same order,
and each section says only what its item needs. The copy comes from the
outline. A line that answers nothing on it is cut, and a point that belongs to
a later item waits for that section.

**The page answers the outline's questions; it never asks them.** The questions
are for whoever writes the page. Shown mockups whose headings, tabs and index
read "Is it for me?" and "What does it cost?", Jeff, verbatim: "ok so the
mockups are neat. but the questions the site is meant to *answer* are instead
being *asked*. it's backwards". And: ""Is it for me?" should never appear on
the site. that's so dumb". So no heading, tab, index item or label on the
page is a visitor's question. Each states its answer in plain words: "For your
work, a side business or home", "Free for five apps, or $9 a month for more".

**The hero fits on a phone's first screen.** Of a 55-word lead, Jeff,
verbatim: "is way too long", and "that's practically a screen of text on a
phone". The heading, a lead of one short sentence and the button fit on the
first screen of a phone, with room to spare. The lead answers "what is this?"
and nothing else; whatever more it wants to say goes where the outline puts
it.

**Start from the people.** Each venture names who it's for in a design with
its personas (yaks.app's is D-131886, reached through `yaks-app-business`).
Read it before writing a line, and write for one of them: their work, their
problem, the words they'd use for it. The examples on the page should be things
that person would ask for, named the way they'd name them. "A practice planner
for your team" tells a coach the page is about her; "a world you can explore
together" tells her nothing.

**Examples spark ideas; they aren't a menu.** A row of example apps is there
to show how wide the range is and to set off the visitor's own idea, not to
offer a list to choose from. Show a few at a time, moving or rotating, rather
than every one at once in a grid. The full list belongs in the gallery.

**Say what it is first.** The hero's first sentence says what the product
does, in the visitor's terms. Run Hale's copy-paste test and Seibel's
smart-friend test on it before anything else on the page.

**Every heading says what follows.** Visitors skim headings and read little
else, so each one has to stand alone as a statement of what the section holds.
"Keep what people make" sounds like a slogan and leaves them guessing. "It
saves what people add" tells them.

**A term is defined before it's used, or it isn't used.** The words we use
every day ("space", "store", "vocab", "connector") mean nothing to a stranger.
If the page needs one, the sentence that first uses it says what it is.
Otherwise say the plain thing instead.

**The button stays in reach, and little stands before it.** A page has one
thing to press, and the visitor should never have to hunt for it or scroll
past miles of feature detail to get to it. So a feature earns its place only by
helping the right person decide to press it. Ask which few things this audience
would want to know before signing up, say those, and leave the rest to the
pricing page and the guide. "Are we selling all our features?" is answered by
choosing the ones that matter to this person, not by listing them all. Say
each as what the person can do: "Your assistant keeps working on it, right
from the chat" passes; "App Commands over MCP" doesn't. Making a page dynamic
means helping someone understand the product without digging, never motion
for its own sake.

**A marketing sentence is a promise.** Before you write that the product does
something, open the code or the guide page that says it does (M-37958). Leave
out what's planned and what's half true. A number on the page is read from the
code, and a test holds the page to it (yaks.app: `workers/yak/site_test.ts`
against `meter.ts`). A number that nothing pins, such as a fee that is a
setting, either comes from the code at serve time or stays off the page.

**Plain beats clever.** Mannered prose (M-33081) is a heading or a line
arranged for effect: a metaphor, a pun, a pair of short punchy fragments. On a
marketing page it costs the most, because the visitor won't stay to decode it.
Each venture's voice (yaks.app's is "soft and friendly", in
`yaks-app-business`) is in the word choice and warmth, never in vagueness.

## Where to look

- **Who it's for:** the venture's persona design (yaks.app: D-131886).
- **The one-liner:** the venture's own (yaks.app: M-37845, "Build, host and
  share web apps"), used as it stands.
- **What the product does:** the guide pages and the code. For yaks.app that's
  `workers/yak/public/docs`, and the features the home page names are each
  backed there.
- **Who and how much:** `business-model` for audience, pricing and growth; the
  venture's skill for its plans and pages.
- **The docs' voice:** `writing-documentation`. Guide pages are explicit and
  technical; the marketing pages aren't.

When this skill is wrong or missing something, fix it in the same change.
