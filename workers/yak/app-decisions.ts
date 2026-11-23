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
// writes it on the app's row as theirs. An answer on the app row closes
// that same copy. The person asked is the row's
// `filed.assignee`, or else whoever wrote the builder whose output it is:
// the person who set the workflow up.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import {
  type AppAnswer,
  type AppAsking,
  keepAppAnswer,
} from '@yaks/platform/app-decision'
import { appStore, directoryOf } from './directory.ts'
import { builderOf, SPACE } from './build-door.ts'
import type { Stored } from './graph.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let telling = (env: Env, space: string) => {
  let builder = builderOf(env, space)
  return async (message: AppAsking | AppAnswer) => {
    let answer = 'decided' in message
    let path = answer
      ? '/operator/app-decision/answer'
      : '/operator/app-decision'
    let res = await builder(() =>
      new Request('https://builder' + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...KERNEL,
          [SPACE]: space,
        },
        body: JSON.stringify(message),
      })
    )
    await res.body?.cancel()
    if (res.ok) return
    let error = new Error(`the Operator could not take ${path} (${res.status})`)
    // A Builder still on the previous deploy may have no answer route yet.
    throw answer && res.status == 404
      ? Object.assign(error, { retry: { after: 300_000 } })
      : error
  }
}

let tellAnswer = async (
  g: Graph,
  app: string,
  eid: string,
  tell: ReturnType<typeof telling>,
) => {
  let [row] = await g.get([eid], ['decision', 'decided', 'cancelled'])
  let decided = comp(row, 'decided')
  if (
    !decided || row.cancelled ||
    typeof comp(row, 'decision')?.question != 'string'
  ) return
  await tell({ app, row: eid, decided })
}

/** The app store's `decision_ask` effect keeps the decision in Updates. */
export let syncing = async (at: Stored, eid: string) => {
  let { STORE } = at.env
  if (!STORE || !at.app || at.context) return
  let [row] = await at.graph.get([eid])
  let decision = comp(row, 'decision')
  // An app that declared its own `decision` before the platform did keeps
  // it (vocab.ts `unsaid`), and its rows ask nothing.
  if (typeof decision?.question != 'string' || row.cancelled) {
    return
  }
  let found = await directoryOf(STORE).appAt(at.app)
  if (!found) return
  let tell = telling(at.env as unknown as Env, found.space.eid)
  let decided = comp(row, 'decided')
  if (decided) {
    await tell({ app: at.app, row: eid, decided })
    return
  }
  let to = comp(row, 'filed')?.assignee ?? await stepper(at.graph, row)
  if (!to) {
    throw new Error(
      `decision ${eid} has nobody to ask: give it filed.assignee, or write it from a builder a person wrote`,
    )
  }
  await tell({
    to: String(to),
    app: at.app,
    row: eid,
    title: String(comp(row, 'doc')?.title ?? decision.question),
    decision,
  })
  // An answer may have reached the Operator while the question was in flight.
  await tellAnswer(at.graph, at.app, eid, tell)
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
  let app = String(link.app), eidInApp = String(link.row)
  let found = await directoryOf(env.STORE).appAt(app)
  if (!found) return
  try {
    await metaOf(appStore(env.STORE, found.space, found.app, env)).apply([{
      entity: { eid: eidInApp },
      decided: answer,
      $was: { decided: { '': null } },
    }], { ...KERNEL, 'x-yak-person': String(person) })
  } catch (e) {
    // A copied answer or a concurrent reply in the app keeps the app's mark.
    if (!(e instanceof Stale) || e.comp != 'decided') throw e
    await keepAppAnswer(g, { app, row: eidInApp, decided: e.current as Comp })
  }
}
