# Literal homepage directions

Three reviewable openings share one explanation and interactive equipment app:

- `publish.html`: hosting first — “Your agent built it. Put it online.”
- `timeline.html`: linear walkthrough beside a sticky iframe.
- `bring.html`: start with something already made in an assistant.

Serve this directory with `python3 -m http.server 4178`, then open
`http://localhost:4178/`. No build, dependencies, model calls, or database are
required. There are no third-party assets. This directory is not in the
production Worker's public assets; landing these files does not replace or
deploy the homepage. The existing CRT direction is untouched.

## What to review

The primary job is publishing AND continuing to update something through the
same assistant. It should not sound like a one-time upload followed by a
developer workflow. The next benefit is richer applications: stored records,
realtime updates, and an agent that can operate on that data. No integrations
are advertised as shipped. We avoid a numeric publishing-speed promise in these
prototypes.

A visitor should be able to explain the service before reaching the ideas
prompt. Ask without explaining first:

1. What does Yaks do? What would you do first?
2. What happens when you want to change the published site next week?
3. Which parts of the equipment example need an app rather than another chat?
4. Is this something you already have, or do you need help finding an idea?

Compare the three openings with the same people/tasks. They deliberately share
most of the page; this tests positioning before spending time on three designs.

## Demonstration boundaries

This is a **scripted interactive example**, visibly labelled. It does not
pretend to call a live agent or publish to Yaks. Reservations and checkboxes
persist in localStorage. The example link opens the same local app in a new tab.
Two tabs on the same origin update through browser storage events; that is not a
substitute for a test of Yaks's network realtime implementation. The “neighbor”
button is explicitly simulated. The answer is computed from current
reservations, not canned text claiming to be model reasoning. Only the checklist
applies to the projector; reservations survive the interface change. Reset
clears only this demo's key.

This example requires persistent shared records and an independent interface:
neighbors reserve scarce items and check returns without each needing an AI
assistant. It is illustrative, not a claimed customer story.

On mobile the demo precedes the steps rather than becoming a tiny fixed screen.
Steps never advance state on scroll; actions are explicit buttons. Users can
read at their own pace, open the example separately, and use normal keyboard
navigation. Reduced-motion users receive no transitions.

## Real-user gallery

No unverified apps, fictional testimonials, or invented activity are included.
The gallery section is an invitation using the existing public `hello@yaks.app`
contact, with editorial permission requested before featuring work. This does
not mean a submission workflow or research program has launched.

Start with a small cohort of actual users. Help each find an ongoing, personal
problem and ship a first usable app. Ask for a public link (if appropriate), who
uses it, what doesn't fit off-the-shelf tools, and a short before/after example.
Only feature explicit opt-ins; private apps can be described with approved
redacted screenshots instead. Do not seed a “real apps” gallery with this demo.

The ideas textarea is **new draft wording**: the existing effective app-ideas
prompt was not found in checked-in public homepage files. Replace it with the
owner's existing prompt when supplied. It comes after the product explanation
and can be selected manually if clipboard permission is unavailable.

## Validation

`deno test --allow-read state_test.ts` checks state transitions and preview
links. `browser-test.mjs` exercises all three routes through a temporary Chrome
CDP profile against the local server; see its header for invocation. It covers
reservations, duplicate prevention, persistence, checklist state, computed
answers, second-tab updates, mobile overflow, script-free input safety, and
reduced motion. No production site, customer data, or real publication is
involved.

## Additional audience evidence

The owner supplied a Reddit discussion where someone had already made a website
in Claude and wanted both publishing and later edits. This reinforces the
publish-and-keep-updating job; it is not a testimonial or proof that competitors
don't exist. No quotes or user identities are used in the preview.

The owner also described a sister turning more than 40 previously discussed
ice-cream recipes, including photos, into an app through her existing assistant.
That is a promising case-study candidate because accumulated personal context is
the advantage, not generic recipe generation. Obtain permission and approved
materials before publishing the story, a name, screenshots, or recipe contents.
The previews therefore explain accessible existing context without presenting
that private example as an approved customer story.
