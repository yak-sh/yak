# Spellbound — the PrintBound design system

> The brand a parent meets when they turn the AI storybook they made into a
> real, printed keepsake. Implemented as CSS custom properties in
> [`web/styles.css`](./styles.css) (`:root` token block) and self-hosted fonts
> in [`web/fonts.css`](./fonts.css).

## Mood & principles

**Storybook wonder, made premium.** Midnight-dusk skies lit by moonlight gold
and firefly sparks, grounded on warm parchment so words stay easy to read. The
feeling is enchanting but _crafted_ — a keepsake worth $35–50, not a cheap
novelty.

- **Restraint over glitter.** One sparkle, not a confetti cannon. A little glow
  goes far.
- **Dark for drama, light for reading.** Night surfaces carry the emotional
  moments (the hero, the call to action, the footer); parchment carries
  everything you actually read.
- **Never childish.** No primary-colour cartoon, no clip art, no comic fonts.
  Tasteful, literary, the end of the spectrum where an indie children's
  publisher lives.
- **The product is the hero.** The real cover and printed pages do the selling;
  the system frames them like art on a gallery wall.

## Typography

A bookish serif pairing — the soul of a company that makes _books_. Both faces
are variable, OFL-licensed, and self-hosted as subset woff2 (no Google CDN call,
no visitor-IP leak). See `web/fonts.css` for the `@font-face` + `unicode-range`
setup.

| Role               | Face                            | Why                                                                                                                                                        | License     |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Display / headline | **Fraunces** (`--font-display`) | Soft "old-style" serif with optical sizing and gentle wonk — warm and characterful without tipping into cute. Carries the storybook wonder at large sizes. | SIL OFL 1.1 |
| Body / UI          | **Newsreader** (`--font-body`)  | A screen-tuned bookish serif built for long reading. Keeps the literary feel down into FAQ and legal prose while staying highly legible.                   | SIL OFL 1.1 |

Headlines set `font-optical-sizing: auto` so Fraunces opens up at display sizes.
`text-wrap: balance` on titles, `text-wrap: pretty` on body lede.

**Type scale** (fluid via `clamp`):

| Token / use       | Size                                                         |
| ----------------- | ------------------------------------------------------------ |
| Hero title        | `clamp(2.5rem, 6vw, 4.25rem)` / line-height 1.03 / `-0.02em` |
| Section title     | `clamp(1.85rem, 4.4vw, 2.85rem)` / 1.08 / `-0.015em`         |
| Lede              | `1.15rem`                                                    |
| Body              | `1.075rem` / line-height 1.65                                |
| Step / card title | `1.24–1.3rem`                                                |
| Eyebrow           | `0.8rem`, `letter-spacing .2em`, uppercase, leading `✦`      |
| Small / fine      | `0.84–0.96rem`                                               |

## Color

Anchored to the sample cover (_Maya & the Moon Garden_): a midnight sky, a
glowing gold hand-lettered title, blue moonflowers, a warm yellow raincoat and
red boots. All text/background pairs pass **WCAG AA** (verified — see "Contrast"
below).

### Night (the dusk sky)

| Token         | Hex       | Use                             |
| ------------- | --------- | ------------------------------- |
| `--night-900` | `#0d1330` | Hero / footer / CTA base        |
| `--night-800` | `#131a3c` | Dusk panel, price card          |
| `--night-700` | `#1e2750` | Raised surface on night         |
| `--night-600` | `#2b3768` | Hairline / lifted edge on night |

### Parchment (warm light surfaces)

| Token           | Hex       | Use                      |
| --------------- | --------- | ------------------------ |
| `--parchment`   | `#f6f0e4` | Primary page surface     |
| `--parchment-2` | `#ece2cf` | Deeper alternating panel |
| `--cream-card`  | `#fdfaf2` | Raised cards             |

### Ink (text)

| Token          | Hex                     | Use                                 |
| -------------- | ----------------------- | ----------------------------------- |
| `--ink`        | `#1c2033`               | Text on light (14.2:1 on parchment) |
| `--ink-soft`   | `#54586b`               | Secondary text on light (6.2:1)     |
| `--moon`       | `#f5f1e7`               | Text on night (16.2:1 on night-900) |
| `--moon-soft`  | `rgba(245,241,231,.74)` | Secondary text on night             |
| `--moon-faint` | `rgba(245,241,231,.55)` | Tertiary text on night              |

### Accents

| Token           | Hex       | Use                                                   |
| --------------- | --------- | ----------------------------------------------------- |
| `--gold`        | `#ecc079` | Moonlight gold — accent on dark, button fill          |
| `--gold-bright` | `#f6d79a` | Firefly highlight, hover glow                         |
| `--gold-ink`    | `#8a5a16` | Gold-toned text that passes AA on parchment (5.2:1)   |
| `--indigo`      | `#3a3f8f` | Moonflower indigo — eyebrows & links on light (8.1:1) |
| `--indigo-lift` | `#565cc0` | Link hover                                            |
| `--moonflower`  | `#8ea4ec` | Periwinkle — accent on dark                           |
| `--coral`       | `#d8552f` | Warm spark (the red boots) — sparing decorative       |
| `--coral-ink`   | `#b5482a` | Coral text that passes AA on parchment (4.7:1)        |

### Contrast

Every foreground/background pair used for text clears AA (≥4.5:1 body, ≥3:1
large/bold). The deliberate rule: **gold is an accent on dark, never body text
on light** — for gold-toned text on parchment use `--gold-ink`; for accent
text/links on parchment use `--indigo`.

## Space · radius · shadow · motion

- **Layout:** `--maxw: 1120px`; section padding `clamp(3.75rem, 8vw, 6.5rem)`;
  gutter `--pad: clamp(1.25rem, 4vw, 2.5rem)`.
- **Radius:** `--r-sm 9px`, `--r 16px`, `--r-lg 24px`, `--r-pill 999px` (buttons
  & inputs are pills — soft, friendly, premium).
- **Elevation:** `--shadow-sm` / `--shadow` / `--shadow-lg` (cool blue-cast
  shadows that read as depth on parchment) plus `--glow-gold` for the lit-button
  hover and book halo.
- **Motion:** `--ease: cubic-bezier(.22,.61,.36,1)`, `--t-fast .14s`,
  `--t .28s`. Lifts on hover (cards/buttons/pages), a slow book tilt-back. The
  hero/CTA **starfield** is a static layered radial-gradient (no animation) so
  it costs nothing and respects everyone; any motion lives behind
  `@media (prefers-reduced-motion: no-preference)`.

## Components

- **Buttons** — `.btn` pills. `.btn--primary` is the glowing moonlight button
  (gold gradient, dark ink text, gold-glow on hover) and works on light _and_
  dark. `.btn--ghost` (on light) and `.btn--ghost-invert` (on night) are the
  quiet secondary.
- **Eyebrow** — small-caps Fraunces with a leading `✦`; indigo on light, gold on
  night (`.eyebrow--invert`).
- **Cards** (`.card`) — cream on parchment, hairline rule, sparkle-bulleted
  title, lift + gold-edge on hover.
- **Steps** (`.step`) — same card shell with a gold numbered token.
- **Hero book** (`.bookshot`) — the real cover as a tilted hardcover with a
  stacked fore-edge, contact shadow, and a moonlight halo behind it; tilts back
  on hover.
- **Pricing card** (`.price-card`) — a night card with periwinkle glow, gold
  cents, on parchment.
- **Nav / header** — translucent parchment, blurred, sparkle wordmark (`Print`
  ink + `Bound` gold-ink).
- **Footer** — full night surface, sparkle wordmark in gold.
- **Forms** (`.waitlist-form`) — pill inputs on night with gold focus ring;
  visible labels (visually-hidden but present), `aria-live` status.
- **Badges / chips** — the trust `.strip` (cream band) and `✦` list bullets.
- **Decorative** — the `✦` four-point sparkle and the `.starfield`
  layered-gradient star field; favicon is a crescent moon + sparkle on a night
  tile.

### Imagery / illustration direction

Soft **watercolour / painted storybook** art (as in the sample), warm light
sources (lanterns, fireflies, moonglow) against cool dusk. Frame product imagery
generously with soft shadow on parchment, or let it glow on a night surface. No
flat vector cartoon, no stock photography, no hard drop-shadows.

---

## Applying Spellbound to product surfaces (doc-only — follow-on task)

The web system above should extend to the two surfaces a customer meets _after_
the site. These are **not** changed in this task; this is the brief for a
follow-on.

### Printed book — `render/` WeasyPrint templates

The interior layout is its own typographic system (the picture-book pages carry
their own painted text), but the **chrome** PrintBound controls should speak
Spellbound:

- **Title page / colophon:** set the book title in **Fraunces** display,
  captions and the colophon in **Newsreader**; reuse the `--ink` / parchment
  relationship (dark text on a warm off-white, not pure `#000` on `#fff`).
- **Captions under full-bleed art:** Newsreader, `--ink-soft` equivalent,
  generous leading.
- **Back-cover / colophon mark:** the sparkle wordmark + "Made in the USA, one
  book at a time."
- Keep CMYK-safe equivalents of the palette (gold and indigo shift in print —
  proof them). _Do not_ put `--gold` as small text; use the dark ink for body,
  gold only as an accent rule.

### Transactional emails

- **Header:** parchment background, sparkle wordmark (gold-ink on light), thin
  gold rule.
- **Type:** Fraunces for the one headline (with a web-safe Georgia fallback for
  mail clients that strip webfonts), system/Newsreader-fallback serif for body.
- **Primary button:** the gold pill (`--gold` → dark ink text) —
  bulletproof-button HTML for Outlook.
- **Palette:** `--ink` on parchment for body; `--night-900` footer block with
  `--moon` text and gold links; `--indigo` for inline links.
- Keep it warm and reassuring (order confirmed, on its way, delivered) — the
  same "keepsake, handled with care" tone as the site.
