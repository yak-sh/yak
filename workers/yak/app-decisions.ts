// A person's step in an app's workflow (D-467): a decision row in the app's
// store, written by a step (a builder's output) or by the app's own code, is
// asked in its person's Updates, and their answer is written back on that
// row as `decided{choice}`, which the next step's query matches.
//
// Updates are read in the space's Operator store, so the question is asked
// there: the app store's `decision_ask` effect posts it to the Operator
// (build.ts `/operator/app-decision`), which keeps it as a decision of its
// own, assigned to the person and carrying `app_decision{app, row}`. Their
// answer runs the Operator store's `app_decision_answer` effect, which
// writes it on the app's row as theirs. The person asked is the row's
// `filed.assignee`, or else whoever wrote the builder whose output it is:
// the person who set the workflow up.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { appStore, directoryOf } from './directory.ts'
import { builderOf, SPACE } from './build-door.ts'
import type { Stored } from './graph.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'

/** A question of an app's, as the Operator is asked it. */
export type AppAsking = {
  /** the person asked */
  to: string
  app: string
  /** the decision row in the app's store */
  row: string
  title: string
  decision: Comp
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/**
 * The Operator store's decision for an app's question, assigned to the
 * person. Named for the app's row, so asking again asks nothing new.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let q = appDecision({
 *   to: 'p', app: 'a', row: 'r', title: 'Send it?',
 *   decision: { question: 'Send the letter?' },
 * })
 * assertEquals([q.filed, q.app_decision], [{ assignee: 'p' }, { app: 'a', row: 'r' }])
 * ```
 */
export let appDecision = (asking: AppAsking): Bundle => ({
  entity: { eid: derivedEid(`app-decision|${asking.app}|${asking.row}`) },
  task: {},
  doc: { title: asking.title },
  decision: asking.decision,
  filed: { assignee: asking.to },
  app_decision: { app: asking.app, row: asking.row },
})

/** The app store's `decision_ask` effect: decision `eid`, unanswered, asked
 * of its person through the space's Operator. */
export let asking = async (at: Stored, eid: string) => {
  let { STORE } = at.env
  if (!STORE || !at.app || at.context) return
  let [row] = await at.graph.read(line`.entity.eid=${eid}&*`)
  let decision = comp(row, 'decision')
  // An app that declared its own `decision` before the platform did keeps
  // it (vocab.ts `unsaid`), and its rows ask nothing.
  if (typeof decision?.question != 'string' || row.decided || row.cancelled) {
    return
  }
  let to = comp(row, 'filed')?.assignee ?? await stepper(at.graph, row)
  if (!to) {
    throw new Error(
      `decision ${eid} has nobody to ask: give it filed.assignee, or write it from a builder a person wrote`,
    )
  }
  let found = await directoryOf(STORE).appAt(at.app)
  if (!found) return
  let asked: AppAsking = {
    to: String(to),
    app: at.app,
    row: eid,
    title: String(comp(row, 'doc')?.title ?? decision.question),
    decision,
  }
  let env = at.env as unknown as Env
  let res = await builderOf(env, found.space.eid)(() =>
    new Request('https://builder/operator/app-decision', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: found.space.eid,
      },
      body: JSON.stringify(asked),
    })
  )
  if (!res.ok) throw new Error(`the Operator was not asked (${res.status})`)
  await res.body?.cancel()
}

// Whoever wrote the builder a row is an output of.
let stepper = async (g: Graph, row: Bundle) => {
  let build = comp(row, 'built')?.build
  if (!build) return undefined
  let [made] = await g.read(line`.entity.eid=${String(build)}&.build`)
  let builder = comp(made, 'build')?.builder
  if (!builder) return undefined
  let [b] = await g.read(line`.entity.eid=${String(builder)}&.created`)
  return comp(b, 'created')?.by
}

/** The Operator store's `app_decision_answer` effect: the person answered
 * question `eid`, so their answer is written on the app's row as theirs. */
export let answered = async (env: Env, g: Graph, eid: string) => {
  let [row] = await g.get([eid])
  let link = comp(row, 'app_decision')
  let person = comp(row, 'filed')?.assignee
  let answer = comp(row, 'decided')
  if (!link || !person || answer?.by != person || !answer.choice) return
  let found = await directoryOf(env.STORE).appAt(String(link.app))
  if (!found) return
  await metaOf(appStore(env.STORE, found.space, found.app, env)).apply([{
    entity: { eid: String(link.row) },
    decided: { choice: answer.choice },
  }], { ...KERNEL, 'x-yak-person': String(person) })
}
