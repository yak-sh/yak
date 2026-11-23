import { same } from '@yaks/fp'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'

type AppDecision = { app: string; row: string }

/** A question from the app store for its person's Updates: `to` asked, or,
 * when `to` is no person here (the Operator, as its space, wrote the step's
 * builder), the person whose Operator session `via` wrote it. */
export type AppAsking = AppDecision & {
  to: string
  via?: string
  title: string
  decision: Comp
}

/** The answer held on the app's decision. */
export type AppAnswer = AppDecision & { decided: Comp }

let eidOf = ({ app, row }: AppDecision) =>
  derivedEid(`app-decision|${app}|${row}`)

/** The same question has the same identity every time the app asks. */
export let appDecision = (asking: AppAsking): Bundle => ({
  entity: { eid: eidOf(asking) },
  task: {},
  doc: { title: asking.title },
  decision: asking.decision,
  filed: { assignee: asking.to },
  app_decision: { app: asking.app, row: asking.row },
})

/** Keep the question in the Operator store `g`, asked of its person: a
 * workflow the Operator set up asks the person it set it up for. */
export let askAppDecision = async (g: Graph, asking: AppAsking) => {
  let [to] = await g.get([asking.to], ['person'])
  let [via] = !to?.person && asking.via
    ? await g.get([asking.via], ['operator_session'])
    : []
  let person = (via?.operator_session as Comp | undefined)?.person
  await g.apply([
    appDecision({ ...asking, to: person ? String(person) : asking.to }),
  ], { trusted: true })
}

/** Close an existing question with the app's answer and its provenance. */
export let keepAppAnswer = async (g: Graph, answer: AppAnswer) => {
  let eid = eidOf(answer)
  let [row] = await g.get([eid], ['app_decision', 'decided'])
  if (!row?.app_decision || same(row.decided, answer.decided)) return
  await g.apply([{
    entity: { eid },
    decided: {
      by: null,
      via: null,
      choice: null,
      verdict: null,
      ...answer.decided,
    },
  }], { trusted: true })
}
