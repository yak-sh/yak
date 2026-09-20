# @yaks/tmux

A terminal somebody can watch, as an entity. Loading these words is what
enabling tmux support IS.

- `tmux{of, pane}` — what is showing in the terminal, and the target tmux
  answers to (`%42`, or `session:window.pane`).

A session is a transcript and a process is a pid; the terminal is what a person
is looking at while both happen. That is a third fact, so it is a third
component — and most processes have no pane at all.

`of` is `death: keep`: a pane outlives what ran in it.

## Why `tmux{pane}` and not `pane{target}`

Component names are one flat namespace and [@yaks/canvas](../canvas) already
says `pane` — a region of a layout, a different idea wearing the same word.
`loadVocab` refuses a word declared twice, and a host may want a canvas and a
terminal at once. So the package's own word carries the component and `pane`
stays the name of the thing tmux addresses. See `packages/README.md`, "Facets
that do not split cleanly".

## Words only

This package declares a vocabulary and nothing else. Sending keys to a pane and
finding the pane a session is in are things a host does with `tmux` on its PATH,
and the one caller doing them today drives tmux through a child process. When a
second caller wants the same gestures they become this package's `./tools`;
until then, a declared tool nobody runs would be a shape guessed rather than
found.

## Compatibility

Deno, Node and the browser — a JSON document, no runtime calls.
