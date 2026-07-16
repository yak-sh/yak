import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'

let Sentence = block('span', 'Dependency', { Type: 'span' })
let { Type } = Sentence

// An entity as one edge sentence: "<verb> <name>". Never a tab — reached by
// name, with the verb passed through by the parent's edge row. The verb
// wears its edge color: requires red, reads blue, contains yellow.
export let Dependency = ({ e, type }: { e: Ent; [x: string]: unknown }) => (
  <Sentence>
    {typeof type == 'string' && <Type mod={type}>{type}</Type>}{' '}
    {e.doc?.title ?? e.kind}
  </Sentence>
)
