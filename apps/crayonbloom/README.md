# CrayonBloom

A parent’s saved idea, editable story and personal shelf on yaks.app. The source
style library, character reference prompts and age profiles are ported from
`coloring-book-maker` at `2250bce`. Puzzles are seeded pure geometry; Letter
printables are free. A finished print edition is prepared by PrintBound, then
reviewed before its destination quote and single seller checkout.

The app is private. Its Worker serves public guides, blog, RSS, curated theme
art and the studio; customer routes check the platform-vouched person or guest
instrument before reading any book or artifact. Gallery exposure requires both a
reviewed page and its parent’s consent. Marketing suppression and historical
links are kept independently; this code sends no marketing mail.

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
