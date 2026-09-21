# @yaks/tmux

A terminal somebody can watch, as an entity. Loading this vocabulary is what
enabling tmux support consists of.

- `tmux{of, pane}` — what is running in the terminal, and the target string tmux
  itself accepts (`%42`, or `session:window.pane`).

A session is a transcript and a process is a pid; the terminal is what a person
is looking at while both happen. That is a third fact, so it is a third
component — and most processes have no pane at all.

`of` is declared `death: keep`: a pane outlives whatever ran in it.

## Why `tmux{pane}` and not `pane{target}`

Component names share one flat namespace, and [@yaks/canvas](../canvas) already
declares `pane` — a region of a layout, a different idea under the same name.
`loadVocab` rejects a component declared twice, and an application may want a
canvas and a terminal at once. So this package's own name carries the component,
and `pane` stays the name of the thing tmux addresses. See `packages/README.md`,
"Facets that do not split cleanly".

## Declarations only

This package declares a vocabulary and nothing else. Sending keys to a pane and
finding the pane a session is running in are things an application does with
`tmux` on its PATH, and the one caller doing them today drives tmux through a
child process. When a second caller needs the same operations they become this
package's `./tools`; until then, a declared tool nobody calls would be an
interface guessed at rather than one found by use.

## Compatibility

Deno, Node and the browser — a JSON document, with no runtime calls.
