import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { Entity } from '../Entity.tsx'

let Sentence = block('span', 'Dependency', { Type: 'span' })
let { Type } = Sentence

// An entity as one edge sentence: "<verb> <inline>". Never a tab — reached
// by name, with the verb passed through by the parent's edge row. The verb
// wears its edge color: requires red, reads blue, contains yellow. The rest
// is the entity's own Inline — chip, a task's status pip (red when gated),
// truncated title, struck when settled: the sentence says whether the edge
// still binds. A reversed sentence (the view from the child) passes `label`
// — 'part of', 'required by' — and keeps the type for its color.
export let Dependency = (
  { e, type, label }: { e: Ent; [x: string]: unknown },
) => (
  <Sentence>
    {typeof type == 'string' && (
      <Type mod={type}>{typeof label == 'string' ? label : type}</Type>
    )} <Entity eid={e.eid} view='Inline' />
  </Sentence>
)
