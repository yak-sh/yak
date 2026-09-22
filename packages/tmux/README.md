# @yaks/tmux

Defines a graph component for associating a tmux terminal pane with the entity
whose output it displays. Loading the vocabulary lets a graph store that
association; it does not start or control tmux.

- `tmux{of, pane}` — what is running in the terminal, and the target string tmux
  itself accepts (`%42`, or `session:window.pane`).

A session stores a transcript; a process record identifies a running program.
Neither implies that the program has a visible terminal. The separate `tmux`
component records that association only where it exists.

`of` is declared `death: keep`: a pane outlives whatever ran in it.

## Why `tmux{pane}` and not `pane{target}`

Component names share one flat namespace, and [@yaks/canvas](../canvas) already
declares `pane` — a region of a layout, a different idea under the same name.
`loadVocab` rejects a component declared twice, and an application may want a
canvas and a terminal at once. So this package's own name carries the component,
and `pane` stays the name of the thing tmux addresses. See `packages/README.md`,
"Cases that do not split cleanly".

## Declarations only

This package declares a vocabulary and nothing else. Sending keys to a pane and
finding the pane a session is running in are things an application does with
`tmux` on its PATH, and the one caller doing them today drives tmux through a
child process. When a second caller needs the same operations they become this
package's `./tools`; until then, a declared tool nobody calls would be an
interface guessed at rather than one found by use.

## Exports and example

`@yaks/tmux` and `@yaks/tmux/vocab` export `tmuxDoc`, `docs: [tmuxDoc]`, and
`TMUX` (the component name, `'tmux'`). There is no storage implementation.

```ts
import { tmuxDoc } from '@yaks/tmux'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([tmuxDoc])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'running-job' } },
  { entity: { eid: 'terminal' }, tmux: { of: 'running-job', pane: '%42' } },
])
console.log(await g.read('.tmux.of=running-job'))
```

An entity is a record identified by `entity.eid`; a component is a named object
on that record. This example stores the association in memory. The pane `%42` is
illustrative: writing its name does not create it.

## Compatibility

Deno, Node and the browser — a JSON document, with no runtime calls.
