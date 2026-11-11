/**
 * The tools: `spend_show` reports a span of days from their tallies,
 * `spend_tally` tallies days again from the requests the graph holds, and
 * `spend_backfill` measures past requests (@yaks/session, @yaks/spawn
 * `recounted`) first. `shared` reads each topic's share of
 * the week against what its sessions used (./use.ts).
 *
 * @module
 */
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { shares } from '@yaks/topic/share'
import { lineage, recompute } from './day.ts'
import { merged, ranked, type Spend, spendOf } from './tally.ts'
import { type Line, said, type Use, uses } from './use.ts'
import {
  accountNames,
  after,
  current,
  dayOf,
  type Limit,
  limitsOf,
  paceOf,
  rates,
  span,
  weekOf,
} from './window.ts'
import { dollars, label, percent, tokens } from './words.ts'

export type { Billed, Use } from './use.ts'

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
  let { limits, accounts } = await plans(g)
  let [from, to] = span(limits, now, since, until)
  // A week's rates are read from the days its week began, which can be
  // before the span.
  let all = await tallies(g, after(from, -7), to)
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

// The plan limits, and what each account is called.
let plans = async (g: Graph) => {
  let providers = await names(g, 'provider')
  let accounts = accountNames(await g.read('.account *'), providers)
  let limits = limitsOf(
    await g.read('.rate_limit *'),
    new Map([...await names(g, 'model'), ...providers, ...accounts]),
  )
  return { limits, accounts }
}

// The tallies of the days from one to another, in order.
let tallies = async (g: Graph, from: string, to: string): Promise<Spend[]> =>
  (await g.read(
    `.spend .spend.day>=${JSON.stringify(from)} .spend.day<=${
      JSON.stringify(to)
    } *`,
  )).map(spendOf).filter((s): s is Spend => !!s)
    .sort((a, b) => a.day < b.day ? -1 : 1)

/** Each topic's share of the week against what its sessions, and every
 * session they started, used of each plan's running week: a topic before the
 * topics below it, then the work no share covers ({@link uses}). Read from
 * the tallies at `now`; where no topic has a share, nothing is read. */
export let shared = async (
  g: Graph,
  now: number = Date.now(),
): Promise<Use[]> => {
  let given = await shares(g)
  if (!given.share.size) return []
  let { limits } = await plans(g)
  let from = limits.flatMap((l) => weekOf(l, now) ?? []).sort()[0]
  let days = from ? await tallies(g, from, dayOf(now)) : []
  let sessions = days.flatMap((d) =>
    Object.values(d.plans).flatMap((p) => Object.keys(p.sessions))
  )
  let rows = await lineage(g, sessions, ['session'])
  let ref = (b: Bundle, comp: string, prop: string): Eid | undefined => {
    let v = (b[comp] as Record<string, unknown> | undefined)?.[prop]
    return v ? String(v) : undefined
  }
  let lines = new Map<Eid, Line>(
    [...rows].map(([eid, b]) => [eid, {
      topic: ref(b, 'session', 'topic'),
      parent: ref(b, 'spawned', 'parent'),
    }]),
  )
  return uses({ shares: given, lines, limits, days, now })
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
  o: {
    since?: string
    until?: string
    top?: number
    now?: number
    plans?: boolean
  } = {},
): Promise<string> => {
  let { spend: s, limits, rate, accounts, from, to } = await read(
    g,
    o.since,
    o.until,
    o.now,
  )
  let now = o.now ?? Date.now()
  let paced = limits.filter((l) => current(l, now)).map((l) => {
    let pace = paceOf(l, now)
    return `${l.name} ${l.window == 10080 ? 'week' : 'five hours'}: ${
      Math.round(l.used)
    }% used, ${Math.round(pace * 100)}% of it gone${
      l.resets ? `, resets ${l.resets.slice(0, 16).replace('T', ' ')} UTC` : ''
    }`
  })
  if (o.plans) return paced.join('\n') || 'No plan limit has been read.'
  let given = await shared(g, now)
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
    ].map(([k]) => k).concat(given.flatMap((u) => u.topic ?? [])),
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
    ...paced,
    ...given.length
      ? [
        '',
        "Shares of each plan's week (a topic's sessions and all they started):",
        ...given.map((u) =>
          `${'  '.repeat(u.depth + 1)}${
            said(u, name.get(u.topic ?? '') ?? u.topic)
          }`
        ),
      ]
      : [],
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
  return `measured ${read} requests from transcripts and the graph's ` +
    `sessions and ${runs} from managed runs; ${await tallied(g, since, now)}`
}

/** Tally each day from `since` to today again from the requests the graph
 * holds, measuring nothing: what a changed price or plan needs to show
 * before the duty's next pass. Says what it tallied. */
export let tallied = async (
  g: Graph,
  since: string,
  now: number = Date.now(),
): Promise<string> => {
  let days: Spend[] = []
  for (let d = since; d <= dayOf(now); d = after(d)) {
    days.push(await recompute(g, d))
  }
  let all = merged(days)
  return `tallied ${days.length} days from ${since}: ${all.requests} ` +
    `requests, ${dollars(all.dollars)}`
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
        plans: a.plans === true,
      }),
    )
  },
  spend_tally: async (call, graph) =>
    answer(
      call,
      await tallied(graph, dayArg(argsOf(call).since) ?? dayOf(Date.now())),
    ),
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
