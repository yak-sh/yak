// A REPL's rows in its space's Operator store (@yaks/code-mode/vocab): the
// `repl{app, until}` code_mode starts with `repl: "new"`, and a
// `cell{repl, script, answer}` for each script run in it. What the cells keep
// (their top-level values, `storage`) lives in the REPL's own object
// (repl-object.ts), which drops it at `until`.
import { type Bundle, mint } from '@yaks/graph'
import { line } from '@yaks/query'
import type { Answer } from '@yaks/code-mode'
import { builderOf } from './build-door.ts'
import type { Env } from './env.ts'
import { GRAPH, type Graphed } from './operator-graph.ts'
import { refuse } from './tool.ts'

/** How long a REPL lasts after its last cell. */
export let LASTS = 60 * 60_000

/** A space's Operator store, as the kernel reads and writes it. */
export type Operator = {
  read(q: string): Promise<Bundle[]>
  apply(bundles: Bundle[], by: string): Promise<unknown>
}

export let operatorOf = (env: Env, space: string): Operator => {
  let ask = async (asked: Graphed) => {
    let r = await builderOf(env, space)(
      () =>
        new Request(`https://builder${GRAPH}`, {
          method: 'POST',
          headers: {
            'x-yak-kernel': '1',
            'content-type': 'application/json',
          },
          body: JSON.stringify(asked),
        }),
      { replayable: !asked.bundles },
    )
    if (!r.ok) throw new Error(`operator graph ${r.status}: ${await r.text()}`)
    return await r.json()
  }
  return {
    read: async (q) => await ask({ q }) as Bundle[],
    apply: (bundles, by) => ask({ bundles, by }),
  }
}

let until = (now: number) => new Date(now + LASTS).toISOString()

/** The REPL a cell runs in: a new one for `"new"`, else the one named, while
 * it lasts. */
export let opened = async (
  operator: Operator,
  asked: string,
  { person, app, now }: { person: string; app?: string; now: number },
): Promise<string> => {
  if (asked == 'new') {
    let eid = mint()
    await operator.apply([{
      entity: { eid },
      repl: { ...app ? { app } : {}, until: until(now) },
    }], person)
    return eid
  }
  let [row] = await operator.read(line`.entity.eid=${asked}&.repl`)
  let ends = (row?.repl as { until?: string } | undefined)?.until
  if (!ends) {
    throw refuse('missing', `no REPL is ${asked}; start one with repl: "new"`)
  }
  if (Date.parse(ends) <= now) {
    throw refuse(
      'expired',
      `REPL ${asked} ended at ${ends}, an hour after its last cell, and its ` +
        'values and storage are gone; start another with repl: "new"',
    )
  }
  return asked
}

// The most of an answer a cell keeps; a larger one keeps its receipts and
// error, and in place of its value, the answer's length (`unkept`).
let KEPT = 64 * 1024

/** A cell and its answer, and the REPL lasting an hour past it. */
export let ran = async (
  operator: Operator,
  repl: string,
  script: string,
  answer: Answer,
  { person, now }: { person: string; now: number },
) => {
  let whole = JSON.stringify(answer)
  let kept = new TextEncoder().encode(whole).length <= KEPT
    ? answer
    : { ...answer, value: null, unkept: whole.length }
  await operator.apply([
    { entity: { eid: mint() }, cell: { repl, script, answer: kept } },
    { entity: { eid: repl }, repl: { until: until(now) } },
  ], person)
}
