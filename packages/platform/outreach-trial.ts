/**
 * Sending an outreach trial and reading it back (./outreach.ts, T-1712): the
 * same machinery the Operator's letters between visits will be sent with,
 * with sending off.
 *
 * An admin writes `outreach_trial{changelog}` in the directory. `write` sends
 * its batch to the model the Operator answers with: the one the trial names,
 * else the one the Operator's base persona names (./operator-model.ts), else
 * the host's. Each space's letter is kept as it is asked for, with its stage
 * and what its Operator was told of it, and the trial keeps the prefix every
 * request shared. Each firing of the trial's wake runs `collect`: until the
 * batch has ended the trial wakes again, and once it has, its answers fill the
 * letters and the trial wears `outreach_written`. What it cost is weighed at
 * the model row's price, at batch prices. Nothing is sent to anyone.
 */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { listPrice } from '@yaks/model'
import type { Batches } from '@yaks/model/batch'
import {
  asked,
  asking,
  type Facts,
  letters,
  prefix,
  stageOf,
} from './outreach.ts'
import { BASE, type Choice, listingOf, namedBy } from './operator-model.ts'

/** How long a trial waits before reading its batch again. */
export let AGAIN = 5 * 60_000

/** What a trial is sent and read with. */
export type Trials = {
  graph: Pick<Graph, 'get' | 'apply'>
  /** every space a letter is written for, as the directory holds it now */
  facts: (now: Date) => Promise<Facts[]>
  /** each provider's batches, by the provider's name */
  batches: Record<string, Batches>
  /** the model where neither the trial nor the base persona names one */
  fallback: Choice
}

let str = (v: unknown) => typeof v == 'string' ? v : ''
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

let wake = (trial: string, now: number): Bundle => ({
  entity: { eid: trial },
  wake: {
    at: new Date(now + AGAIN).toISOString(),
    target: trial,
    note: "Read this trial's letters once its batch has ended",
  },
})

let batchesFor = (t: Trials, provider: string) => {
  let api = t.batches[provider]
  if (!api) throw new Error(`outreach trials have no batches of ${provider}`)
  return api
}

/** Sends a trial's batch: one request per space, after the prefix all of them
 * share. A trial already sent is left alone. */
export let write = async (
  t: Trials,
  trial: string,
  now = Date.now(),
): Promise<void> => {
  let [row] = await t.graph.get([trial])
  let asks = comp(row, 'outreach_trial')
  if (!asks || row.outreach_batch) return
  let named = str(asks.provider) && str(asks.model)
    ? { provider: str(asks.provider), model: str(asks.model) }
    : undefined
  let choice = named ?? await namedBy(t.graph, BASE) ?? t.fallback
  let [base] = await t.graph.get([BASE])
  let shared = prefix(str(comp(base, 'doc')?.body), str(asks.changelog))
  let all = await t.facts(new Date(now))
  let sent = all.map((f) => asked(choice.model, shared, f, now, trial))
  let id = await batchesFor(t, choice.provider).submit(sent)
  await t.graph.apply([
    ...asking(trial, sent, new Map(all.map((f) => [f.space, stageOf(f, now)]))),
    {
      ...wake(trial, now),
      outreach_trial: choice,
      outreach_batch: {
        id,
        at: new Date(now).toISOString(),
        spaces: sent.length,
        shared,
      },
    },
  ])
}

/** Reads a trial's batch at its wake: its letters once it has ended, else
 * another wake. */
export let collect = async (
  t: Trials,
  trial: string,
  now = Date.now(),
): Promise<void> => {
  let [row] = await t.graph.get([trial])
  let id = str(comp(row, 'outreach_batch')?.id)
  if (!id || row.outreach_written) return
  let { provider, model } = comp(row, 'outreach_trial') as Choice
  let api = batchesFor(t, provider)
  if (!await api.ended(id)) {
    await t.graph.apply([wake(trial, now)])
    return
  }
  let price = (await listingOf(t.graph, model))?.price ?? listPrice(model)
  let made = letters(trial, price, await api.results(id))
  await t.graph.apply([...made.rows, {
    entity: { eid: trial },
    outreach_written: {
      at: new Date(now).toISOString(),
      letters: made.rows.length,
      dollars: made.dollars,
    },
  }])
}
