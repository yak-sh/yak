/** @jsxImportSource preact */
import { DecisionForm } from '@yaks/task/form'
import { showing, shown } from '@yaks/task'
import type { Bundle } from '@yaks/graph'
import { type Ent, vocab } from '../types.ts'
import { apply, ent } from '../live.ts'
import { useQueryResult } from './useQuery.ts'
import { drafts } from '@yaks/draft/input'
import { bundle } from './registry.ts'
import { useReference } from './subscriptions.ts'
import { Entity } from './Entity.tsx'

/** The decision domain's form bound to this page's graph and drafts; what a
 * choice shows is drawn by its components (Entity.tsx's `Shown`). */
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
  let shows = useQueryResult(
    e.decision && vocab.comp('shows') ? showing(e.eid) : '',
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
      shown={shown(shows.eids.map((eid) => bundle(ent(eid))))}
      show={(eid) => <Entity eid={eid} view='Decision.Shown' />}
      blocking={waiting.ready ? waiting.eids.length > 0 : undefined}
      caret={caret}
    />
  )
}
