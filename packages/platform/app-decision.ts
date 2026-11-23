import { same } from '@yaks/fp'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'

type AppDecision = { app: string; row: string }

/** A question from the app store for its person's Updates. */
export type AppAsking = AppDecision & {
  to: string
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
