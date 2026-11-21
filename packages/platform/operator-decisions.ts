import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'

/** The request an answered decision leaves for the Operator, shared by every
 * answer door and any retry of the effect. */
export let decisionRequestId = (decision: string) =>
  derivedEid('operator-decision-answer|' + decision)

export let decisionRequest = (
  decision: string,
  space: string,
  person: string,
  body: string,
): Bundle => ({
  entity: { eid: decisionRequestId(decision) },
  operator_request: { channel: 'decision', space, person, about: decision },
  doc: { title: 'Answer to your question', body },
})
