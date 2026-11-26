# CrayonBloom

A parent’s saved idea, editable story and personal shelf on yaks.app. The source
style library, character reference prompts and age profiles are ported from
`coloring-book-maker` at `2250bce`. Puzzles are seeded pure geometry; Letter
printables are free. A finished print edition is prepared by PrintBound, then
reviewed before its destination quote and single seller checkout.

Approving the print document is a workflow step (D-467): the "Approve the print
document" builder in `seed.json` matches a book whose `print_review.revision`
(the prepared document's id) is set, and its worker command (`/studio/approval`,
`approval.ts`) writes a decision assigned to the book's owner, marked
`print_approval{book, revision}`. The owner answers it on the book's print card
or in their Updates. Only an approved document is quoted; preparing the book
again asks again. A store is seeded once, so an existing store gets the builder
row by `yak admin apply`.

The app is private. Its Worker serves the home page, public guides, blog, RSS,
curated theme art and the studio; customer routes check the platform-vouched
person or guest instrument before reading any book or artifact. Gallery exposure
requires both a reviewed page and its parent’s consent. Marketing suppression
and historical links are kept independently; this code sends no marketing mail.

## The look

CrayonBloom wears its own design: cream paper, white pages inked round, sticker
buttons, Fredoka over Nunito. It is made of three things under `look/`:

- `crayon.css`, the theme: the crayon box as the kit's custom properties.
- `skin/`, a sheet laid over each `@yaks/ui` part the pages wear.
- `parts/`, the app's own parts (`Hero`, `Sheet`, `Band`, `Mast` and the rest),
  each a `Name.ts` beside its `Name.css`.

`look/links.ts` puts the kit, skin and part styles in the HTML in cascade order
for the public pages and the studio. The linked theme keeps its font URLs
relative to the release, so browsers can reuse the theme and fonts.

The worker draws every public page from those parts (`pages/`: the frame, the
home page, the theme pages from `themes.json`, and the kept prose in `public/`)
and answers it as HTML. The studio is a page script (`studio.html`, `studio.ts`,
`studio/`) drawn in the browser from the same parts.

The fonts (`look/fonts/`) and the home page's art (`art/`) come from the
`coloring-book-maker` repo. Like every picture and font, they are released by
`yak admin push` and not kept in git.

## Running it

`coloring_runtime{preview,font,printer,model,story_model}` configures
deployment. The default preview uses deterministic fixture art and labeled story
suggestions, spending nothing on models. Production requests use platform
transcript jobs, retaining model replies and completed artwork. Page
continuation runs as the bounded `coloring_step` declared command, including
after a page closes.

`bin/print-previews.ts` provisions the separate fixture apps and their licensed
font blobs. Images, fonts and PDF examples are uploaded artifacts, never large
git assets. Account activation, paid physical proofs and each existing domain’s
cutover have separate owner decisions.
