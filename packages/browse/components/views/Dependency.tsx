import { type ComponentChildren } from 'preact'
import { reversed } from '@yaks/edge/vocab'
import { type Ent, vocab } from '../../types.ts'
import { block } from '@yaks/ui'
import { Entity } from '../Entity.tsx'

let Sentence = block('div', 'Dependency', {
  Line: 'div',
  Type: 'span',
  Note: 'span',
  Gist: 'div',
})
let { Line, Type, Note, Gist } = Sentence

// How an edge reads from its child's side: the phrase its relation declares
// in the vocabulary (`reversed`, @yaks/edge) — 'contained by', 'required by' —
// or, for a relation that declares none, its own name.
export let up = (type: string): string => reversed(vocab)[type] ?? type

// An entity as one edge row, in two lines: "<verb> <inline>" at the body's
// size, and under it, smaller, what the entity is (its `Gist`: its kind, the
// first line of what it says, when it was made). More than a bare name, less
// than a tile. Never a tab — reached by name, with the verb passed through by
// the parent's edge row. The verb wears its edge's colour (styles.css
// `--requires`, `--reads`, `--contains`). The name is the entity's own Inline
// — chip, a task's status pip (an alert when gated), title, struck when
// settled: the row says whether the edge still binds. A reversed row (the
// view from the child) passes `label`, its relation's `up` phrase, and keeps
// the type for its colour; `note` rides the first line (a similarity's
// score).
export let Dependency = (
  { e, type, label, note }: {
    e: Ent
    type?: unknown
    label?: unknown
    note?: ComponentChildren
  },
) => (
  <Sentence>
    <Line>
      {typeof type == 'string' && (
        <Type mod={type}>{typeof label == 'string' ? label : type}</Type>
      )} <Entity eid={e.eid} view='Inline' />
      {note != null && <Note>{note}</Note>}
    </Line>
    <Gist>
      <Entity eid={e.eid} view='Gist' />
    </Gist>
  </Sentence>
)
