import { DecisionForm } from '@yaks/task/views'
import type { Bundle } from '@yaks/graph'
import { type Ent, vocab } from '../types.ts'
import { apply } from '../live.ts'
import { useQueryResult } from './useQuery.ts'
import { drafts } from '@yaks/draft/input'
import { bundle } from './registry.ts'
import { useReference } from './subscriptions.ts'
import { Entity } from './Entity.tsx'

/** The decision domain's form bound to this page's graph and drafts. */
export let Decision = ({ e, caret }: { e: Ent; caret?: number }) => {
  let waiting = useQueryResult(
    e.decision &&
      ['task', 'completed', 'cancelled', 'requires'].every((name) =>
        vocab.comp(name)
      )
      ? `.task !completed !cancelled .requires[<=1]->${e.eid}&.limit=1`
      : '',
    !!e.decision,
    true,
  )
  useReference(e.decided?.by)
  // apply reports refusals in the page; the button has no promise consumer.
  let send = (bundles: Bundle[]) => void apply(bundles).catch(() => {})
  return (
    <DecisionForm
      e={bundle(e)}
      drafts={drafts}
      apply={send}
      name={(eid) => <Entity eid={eid} view='Decision.Author.Inline' />}
      blocking={waiting.ready ? waiting.eids.length > 0 : undefined}
      caret={caret}
    />
  )
}
