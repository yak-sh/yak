import { type Ent } from '../../types.ts'
import { el } from '../ui.tsx'

let Sentence = el('span', 'Dependency')
let Verb = el('span', 'Dependency_Type')

// An entity as one edge sentence: "<verb> <name>". Never a tab — reached by
// name, with the verb passed through by the parent's edge row. The verb
// wears its edge color: requires red, reads blue, contains yellow.
export let Dependency = ({ e, type }: { e: Ent; [x: string]: unknown }) => (
  <Sentence>
    {typeof type == 'string' && <Verb mod={type}>{type}</Verb>}{' '}
    {e.task?.title ?? e.project?.title ?? e.kind}
  </Sentence>
)
