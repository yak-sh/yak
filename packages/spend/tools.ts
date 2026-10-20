/**
 * The tools: `spend_show` reports a span of days from their tallies, and
 * `spend_backfill` measures past requests (@yaks/session, @yaks/spawn
 * `recounted`) and tallies their days.
 *
 * @module
 */
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { after, dayOf, recompute } from './day.ts'
import { merged, ranked, type Spend, spendOf } from './tally.ts'
import { current, type Limit, limitsOf, paceOf, span } from './window.ts'
import { dollars, label, tokens } from './words.ts'

let answer = (call: Bundle, body: string): Bundle[] => [{
  entity: { eid: '$said' },
  content: { body },
  output: { source: call.entity.eid },
}]

let DAY = /^\d{4}-\d{2}-\d{2}$/

let dayArg = (v: unknown, name: string): string | undefined => {
  if (v == null || v === '') return undefined
  if (!DAY.test(String(v))) {
    throw new Refused(`${name} is a UTC day, like 2026-10-13`)
  }
  return String(v)
}

// The tally of a span of days, and the plan limits beside it.
export let read = async (
  g: Graph,
  since?: string,
  until?: string,
  now: number = Date.now(),
): Promise<{ spend: Spend; limits: Limit[]; from: string; to: string }> => {
  let limits = limitsOf(
    await g.read('.rate_limit *'),
    await names(g, 'provider'),
  )
  let [from, to] = span(limits, now, since, until)
  let rows = await g.read(
    `.spend .spend.day>=${JSON.stringify(from)} .spend.day<=${
      JSON.stringify(to)
    } *`,
  )
  let days = rows.map(spendOf).filter((s): s is Spend => !!s)
    .sort((a, b) => a.day < b.day ? -1 : 1)
  return { spend: merged(days), limits, from, to }
}

// Each row of a kind, by eid, named.
let names = async (g: Graph, comp: string): Promise<Map<Eid, string>> =>
  new Map(
    (await g.read(`.${comp} *`)).map((b) => [
      b.entity.eid,
      String((b[comp] as { name?: unknown }).name ?? b.entity.eid),
    ]),
  )

// The rows a report names, read once.
let named = async (g: Graph, eids: Eid[]) => {
  let id = human(g.vocab)
  let rows = await g.get([...new Set(eids)])
  return new Map(
    rows.filter((r) => r).map((r) => [r!.entity.eid, label(r!, id(r!))]),
  )
}

/** A span's report, as text. */
export let report = async (
  g: Graph,
  o: { since?: string; until?: string; top?: number; now?: number } = {},
): Promise<string> => {
  let { spend: s, limits, from, to } = await read(
    g,
    o.since,
    o.until,
    o.now,
  )
  let top = o.top ?? 10
  let pick = (m: Record<string, number[]>, at: number) =>
    ranked(m, at).slice(0, top)
  let sessions = pick(s.sessions, 1), tasks = pick(s.tasks, 1)
  let models = pick(s.models, 4), entries = pick(s.entries, 1)
  let name = await named(
    g,
    [
      ...sessions,
      ...tasks,
      ...models,
      ...entries,
    ].map(([k]) => k),
  )
  let line = (k: string, ns: number[], at: number, toks: number) =>
    `  ${dollars(ns[at]).padStart(10)}  ${tokens(toks).padStart(7)}  ${
      name.get(k) ?? k
    }`
  let sum = (ns: number[]) => ns.slice(0, 4).reduce((a, b) => a + b, 0)
  return [
    `${from} to ${to}: ${dollars(s.dollars)}, ${s.requests} requests, ${
      tokens(sum(s.tokens))
    } tokens (${tokens(s.tokens[0])} read from cache, ${
      tokens(s.tokens[1])
    } written to it, ${tokens(s.tokens[2])} fresh, ${
      tokens(s.tokens[3])
    } generated)`,
    ...limits.filter((l) => current(l, o.now ?? Date.now())).map((l) => {
      let pace = paceOf(l, o.now ?? Date.now())
      return `${l.provider} ${l.window == 10080 ? 'week' : 'five hours'}: ${
        Math.round(l.used)
      }% used, ${Math.round(pace * 100)}% of it gone${
        l.resets
          ? `, resets ${l.resets.slice(0, 16).replace('T', ' ')} UTC`
          : ''
      }`
    }),
    '',
    'Parts of the context:',
    ...pick(s.parts, 4).map(([k, ns]) => line(k, ns, 4, sum(ns))),
    '',
    'Sessions:',
    ...sessions.map(([k, ns]) => line(k, ns, 1, ns[0])),
    '',
    'Tasks (a session split across the tasks it worked on):',
    ...tasks.map(([k, ns]) => line(k, ns, 1, ns[0])),
    '',
    'Models:',
    ...models.map(([k, ns]) => line(k, ns, 4, sum(ns))),
    '',
    'Entries carried most:',
    ...entries.map(([k, ns]) => line(k, ns, 1, ns[0])),
  ].join('\n')
}

/** Measure what was written since `since` again, then tally each day. */
export let backfill = async (
  g: Graph,
  since: string,
  now: number = Date.now(),
): Promise<string> => {
  let session = await import('@yaks/session/service')
  let spawn = await import('@yaks/spawn')
  let read = await session.recounted(g, since)
  let runs = await spawn.recounted(g, since)
  let days = 0
  for (let d = since; d <= dayOf(now); d = after(d)) {
    await recompute(g, d)
    days++
  }
  return `measured ${read} requests from transcripts and the graph's ` +
    `sessions and ${runs} from managed runs; tallied ${days} days from ${since}`
}

/** The tools this package runs. */
export let runs = (): Runs => ({
  spend_show: async (call, graph) => {
    let a = argsOf(call)
    return answer(
      call,
      await report(graph, {
        since: dayArg(a.since, 'since'),
        until: dayArg(a.until, 'until'),
        top: a.top == null ? undefined : Number(a.top),
      }),
    )
  },
  spend_backfill: async (call, graph) => {
    let since = dayArg(argsOf(call).since, 'since')
    if (!since) throw new Refused('say since, the first UTC day to measure')
    return answer(call, await backfill(graph, since))
  },
})
