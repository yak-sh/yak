import { type Ent } from '../../types.ts'

// An entity as one edge sentence: "<verb> <name>". Never a tab — reached by
// name, with the verb passed through by the parent's edge row.
export let Dependency = ({ e, type }: { e: Ent; [x: string]: unknown }) => (
  <span class='Dependency'>
    {typeof type == 'string' ? type : ''}{' '}
    {e.task?.title ?? e.project?.title ?? e.kind}
  </span>
)
