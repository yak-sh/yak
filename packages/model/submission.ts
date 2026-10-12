// Submission belongs to the original ask. A host guards it through the graph;
// adapters await that guard at the paid HTTP boundary, then checkpoint the id.
import type { Graph } from '@yaks/graph'
import { type Mark, ModelError, type Request } from './mod.ts'

/** A guarded write, not a read followed by an unguarded decision to purchase. */
export let submitCall = async (
  g: Pick<Graph, 'apply'>,
  call: string,
  at: string,
): Promise<void> => {
  let written = await g.apply([{
    entity: { eid: call },
    submitted: { at },
    $was: { submitted: { at: null } },
  }], { trusted: true })
  if (!written.some((b) => b.entity.eid == call && b.submitted)) {
    throw new ModelError('submitted', 'Submission was not recorded')
  }
}

/** Invoke outside a transport catch: storage failure is not a network retry. */
export let submitted = async (req: Request): Promise<void> => {
  await req.onSubmit?.()
}

/** Provider-owned components keep provider bookkeeping out of the host. */
export let acknowledged = async (req: Request, mark: Mark): Promise<void> => {
  await req.onAck?.(mark)
}
