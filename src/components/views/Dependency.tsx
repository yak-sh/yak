import { type Ent } from '../../types.ts'
import { gated, settled } from '../../live.ts'
import { block } from '../ui.tsx'
import { linkProps } from '../nav.tsx'
import { Dot } from '../Dot.tsx'
import { View } from '../View.tsx'

let Sentence = block('span', 'Dependency', { Type: 'span', Name: 'a' })
let { Type, Name } = Sentence

// An entity as one edge sentence: "<verb> <id> <dot?> <name>". Never a
// tab — reached by name, with the verb passed through by the parent's
// edge row. The verb wears its edge color: requires red, reads blue,
// contains yellow. The id chip is the universal link chip; a task brings
// its status pip (red when gated, as everywhere), and a settled one —
// done or cancelled — is struck through: the sentence says whether the
// edge still binds. A reversed sentence (the view from the child) passes
// `label` — 'part of', 'required by' — and keeps the type for its color.
// The name is an internal link (nav.tsx linkProps): click follows,
// modifiers and the native menu do new-tab forms, dragging it makes a
// card.
export let Dependency = (
  { e, type, label }: { e: Ent; [x: string]: unknown },
) => (
  <Sentence>
    {typeof type == 'string' && (
      <Type mod={type}>{typeof label == 'string' ? label : type}</Type>
    )} <View eid={e.eid} view='Id' /> {e.task && (
      <>
        <Dot status={e.task.status} gated={gated(e)} />
        {' '}
      </>
    )}
    <Name mod={settled(e.task?.status) && 'settled'} {...linkProps(e)}>
      {e.doc?.title ?? e.kind}
    </Name>
  </Sentence>
)
