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
import { recompute } from './day.ts'
import { after, dayOf } from './window.ts'
import { merged, ranked, type Spend, spendOf } from './tally.ts'
import {
  accountNames,
  current,
  type Limit,
  limitsOf,
  paceOf,
  rates,
  span,
} from './window.ts'
import { dollars, label, percent, tokens } from './words.ts'

let answer = (call: Bundle, body: string): Bundle[] => [{
  entity: { eid: '$said' },
  content: { body },
  output: { source: call.entity.eid },
}]

// A day the door already read (`format: date`), or none.
let dayArg = (v: unknown): string | undefined => v ? String(v) : undefined

// The tally of a span of days, and the plan limits beside it.
export let read = async (
  g: Graph,
  since?: string,
  until?: string,
  now: number = Date.now(),
): Promise<
  {
    spend: Spend
    limits: Limit[]
    rate: Map<Eid, number>
    accounts: Map<Eid, string>
    from: string
    to: string
  }
> => {
  let providers = await names(g, 'provider')
  let accounts = accountNames(await g.read('.account *'), providers)
  let limits = limitsOf(
    await g.read('.rate_limit *'),
    new Map([...providers, ...accounts]),
  )
  let [from, to] = span(limits, now, since, until)
  // A week's rates are read from the days its week began, which can be
  // before the span.
  let rows = await g.read(
    `.spend .spend.day>=${JSON.stringify(after(from, -7))} .spend.day<=${
      JSON.stringify(to)
    } *`,
  )
  let all = rows.map(spendOf).filter((s): s is Spend => !!s)
    .sort((a, b) => a.day < b.day ? -1 : 1)
  let days = all.filter((d) => d.day >= from)
  return {
    spend: merged(days),
    limits,
    rate: rates(limits, all, now),
    accounts,
    from,
    to,
  }
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
  let { spend: s, limits, rate, accounts, from, to } = await read(
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
      return `${l.name} ${l.window == 10080 ? 'week' : 'five hours'}: ${
        Math.round(l.used)
      }% used, ${Math.round(pace * 100)}% of it gone${
        l.resets
          ? `, resets ${l.resets.slice(0, 16).replace('T', ' ')} UTC`
          : ''
      }`
    }),
    ...Object.keys(s.plans).length
      ? [
        '',
        'Accounts:',
        ...ranked(
          Object.fromEntries(
            Object.entries(s.plans).map(([k, p]) => [k, [p.dollars]]),
          ),
          0,
        ).map(([k, [d]]) =>
          `  ${dollars(d).padStart(10)}  ${
            (rate.has(k) ? percent(d * rate.get(k)!) : 'no reading')
              .padStart(7)
          }  ${accounts.get(k) ?? k}`
        ),
      ]
      : [],
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

/** Read in each transcript written since `since` that the graph has not
 * read to its end, measure what was written since then again, then tally
 * each day. What `person` typed is signed with them. */
export let backfill = async (
  g: Graph,
  since: string,
  now: number = Date.now(),
  person?: Eid,
): Promise<string> => {
  let session = await import('@yaks/session/service')
  let spawn = await import('@yaks/spawn')
  let read = await session.recounted(g, since, { person, now })
  let runs = await spawn.recounted(g, since)
  let days = 0
  for (let d = since; d <= dayOf(now); d = after(d)) {
    await recompute(g, d)
    days++
  }
  return `measured ${read} requests from transcripts and the graph's ` +
    `sessions and ${runs} from managed runs; tallied ${days} days from ${since}`
}

/** The tools this package runs; a transcript read in is signed with the
 * config's `person`. */
export let runs = (host?: { config?: { person?: string } }): Runs => ({
  spend_show: async (call, graph) => {
    let a = argsOf(call)
    return answer(
      call,
      await report(graph, {
        since: dayArg(a.since),
        until: dayArg(a.until),
        top: a.top == null ? undefined : Number(a.top),
      }),
    )
  },
  spend_backfill: async (call, graph) => {
    let since = dayArg(argsOf(call).since)
    if (!since) throw new Refused('say since, the first UTC day to measure')
    let said = host?.config?.person
    let person = said && ((await graph.address([said])).get(said) ?? said)
    return answer(
      call,
      await backfill(graph, since, Date.now(), person || undefined),
    )
  },
})
