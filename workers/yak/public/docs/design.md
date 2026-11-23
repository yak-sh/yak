---
doc:
  title: Visual Design
guide:
  slug: design
  brief: layout, type, color, motion, wording and the look of a page that was made by default
  description: >-
    How a yaks app's pages should look and read. Settling on a subject,
    audience and main job first, then choosing colors, typefaces and
    layout before any code. Type scale and line length, color palettes,
    where emphasis goes, motion that answers an action, responsive layout at
    390 and 1280 pixels, focus and reduced motion, and interface wording:
    buttons, errors and empty states. The defaults that make a page look
    generated, and checking the result with app_preview.
---

# Visual Design

A yaks app is something a person opens on their phone every day, so how it looks
and reads is part of whether it works. This page covers the visual and written
side of an app's pages. The data, files and deploy steps are in the map at
<https://yaks.app/docs.md> (`guide` with no page) and their own pages.

When the person has said how the app should look (a color, a style, a site to
match), do what they said, even where it is one of the defaults listed below.
Everything here applies where they have left it to you.

Work as a designer whose client has already turned down proposals that looked
templated: make deliberate choices of color, type and layout that belong to this
person and this subject, and would look out of place on anyone else's app.

## Start from the subject

Before writing a page, settle three things and use them for every choice that
follows:

1. **The subject**: what the app is about, in the person's own words.
2. **Who uses it**: the person, their family, their customers, the public.
3. **The main job**: the one thing a visitor comes to do on the first screen.

Take visual cues from the subject itself and the things people already use for
it: its printed forms, its signs, the places it happens. A choice that would fit
any app equally well is a default, not a decision.

## Plan before code

Write a short plan before the first page, and check it against the three answers
above:

- four to six colors, each named for its role (background, surface, text, muted
  text, accent, danger) with its hex value;
- one typeface, or two that are clearly different, and what each is used for;
- the layout of the first screen at 390 and at 1280 pixels wide, drawn as a
  small text wireframe;
- what the first screen shows first, and the one thing on it that is memorable.

Then review the plan against the request. Picture the app you would make for a
similar request from someone else (a different sport, a different bread): any
part of the plan that would be the same there is a default, so replace it with a
choice made for this one. Put the colors and sizes in CSS custom properties at
the top of the stylesheet (`--bg`, `--text`, `--accent`, `--step-1`), so every
page shares them and a later change is one line.

## The first screen

Open with the thing the app is for: the list of recipes, today's workout, the
form to sign up. A visitor should be able to do the main job without scrolling
on a phone. A large hero, a headline about the app or a row of statistics
belongs only on a page whose job is to explain something to a stranger.

Put emphasis in one place per screen: one large element, one accent color on the
main action. Spend the design's boldness there and keep everything around it
quiet. When a screen feels busy, take something away before adding anything.

Include a piece of text only when it tells the person something they need, helps
them act, or is content they asked for. A heading that names what is plainly
below it, a subtitle restating the title, a badge or a number that decorates
nothing: leave them out.

## Type

- Choose typefaces on purpose. The system stack (`system-ui, sans-serif`) is a
  fine choice for a tool; a typeface with character suits a page whose voice
  matters. Where type is the page's main visual, treat it as part of the design
  (its weight, width and spacing), not only as a carrier for the words. A web
  font is a request to another server on every first visit, so use at most two
  families and `font-display: swap`.
- Set a type scale of a few steps (for example 0.875, 1, 1.25, 1.6 and 2.25 rem)
  and use only those sizes. Body text is at least 16 px on a phone.
- Keep lines of body text under about 75 characters (`max-width: 65ch`), with a
  line height around 1.5; a serif face wants a little more.
- Write headings in sentence case. Labels in capitals, a single accented word in
  a headline, and a small label above every heading add noise without
  information.

## Color

- Choose a palette that fits the subject, and check every text and background
  pair for contrast (4.5:1 for body text, 3:1 for large text and controls).
  `app_preview` reports the pairs that fail.
- Use the accent for what can be pressed or what needs attention, not for
  decoration.
- Support a dark theme with `prefers-color-scheme` when the app is used at night
  or for long sessions, by giving the custom properties a second set of values.

## Layout

- Build for the phone first, then let the layout widen at 1280 pixels: a second
  column, a wider list, the same content. Check both with
  `app_preview(app, width: 390)` and `app_preview(app, width: 1280)`.
- Make every control at least 44 by 44 pixels to press, with space between
  neighbors.
- Use borders, numbers, dividers and labels only where they carry information:
  numbered steps for a sequence, a divider between groups that differ.
- Keep CSS specific enough that a rule for one part does not undo another's
  spacing: a class for each component, and spacing set in one place.

## Pictures

Where the subject has pictures (a dish, a place, a product, a person), show real
ones: the person's own photos, pictures from their site, or one made with a
picture model. A picture says more than a hand-drawn SVG illustration of it, so
keep SVG for icons, diagrams and what the person asked to have drawn.

## Motion

Motion that answers what the person did is useful: a row that slides away when
deleted, a panel that opens where it was pressed, a check mark when something
saved. Motion nobody asked for (every section fading in on scroll, every card
lifting on hover) slows the page and says nothing. Wrap animation in
`@media (prefers-reduced-motion: no-preference)` so a person who turned motion
off sees none.

## Accessibility

Every page meets these without being asked:

- each control is reachable and usable from the keyboard, with a visible focus
  ring (`:focus-visible`);
- each image has `alt` text, and each input a `<label>`;
- headings go in order, and the page has one `<h1>`;
- the page works at 200% zoom.

`app_preview` runs a WCAG 2.1 AA check and lists each problem with its fix (the
[files](https://yaks.app/docs/files.md) page). Fix every one before
`app_deploy`.

## Words

The words on a page are part of its design. They go in `copy.json`
([copy](https://yaks.app/docs/copy.md)), where the person can change them.

- Write from the visitor's side, in plain words: "Your recipes", not "Recipe
  management".
- A button says what it does: "Save recipe", not "Submit". The message after it
  uses the same word: "Recipe saved".
- An error says what went wrong and what to do next, without apologizing: "That
  email is already signed up. Sign in instead?"
- An empty list invites the first action: "No recipes yet. Add your first one."
- When the person gave no text, write real text for their subject, never lorem
  ipsum.

## What a default page looks like

These are the choices a model makes when nobody chose, and a visitor recognizes
them. Use one only when the person asked for it or the subject calls for it:

- a cream background with a serif heading and a terracotta or orange accent;
- a near-black background with one bright green or red accent;
- a purple-to-blue gradient behind the hero or the buttons;
- a grid of identical rounded cards with the same soft shadow;
- a small label in spaced capitals above every heading;
- an arrow (→) after every link and button label;
- a big number with a small caption and a row of statistics under it;
- small monospace text for dates and counts;
- details joined with middle dots (`Ginger · Classic · Meadow`), or a label
  written `WORD — fragment`;
- an off-black such as `#111` standing in for black;
- hairline rules, square corners and dense columns, like a newspaper;
- one border radius on everything, whatever its place in the hierarchy;
- emoji as icons for every item.

An app's icon has the same aim: something from the subject, drawn simply, as the
overview's `icon.svg` paragraph says.

## Check the result

Look at the screenshots `app_preview` returns at both widths before deploying,
as the person who asked would: does the first screen do what they asked for,
with their own content; does anything look like the list above; is any text hard
to read. Then take one thing away. Fix what you find, preview again, then
`app_deploy`.
