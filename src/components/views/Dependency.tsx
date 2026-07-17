import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { linkProps } from '../nav.tsx'

let Sentence = block('span', 'Dependency', { Type: 'span', Name: 'a' })
let { Type, Name } = Sentence

// An entity as one edge sentence: "<verb> <name>". Never a tab — reached by
// name, with the verb passed through by the parent's edge row. The verb
// wears its edge color: requires red, reads blue, contains yellow. The
// name is an internal link (nav.tsx linkProps): click follows, modifiers
// and the native menu do new-tab forms, dragging it makes a card.
export let Dependency = ({ e, type }: { e: Ent; [x: string]: unknown }) => (
  <Sentence>
    {typeof type == 'string' && <Type mod={type}>{type}</Type>}{' '}
    <Name {...linkProps(e)}>{e.doc?.title ?? e.kind}</Name>
  </Sentence>
)
