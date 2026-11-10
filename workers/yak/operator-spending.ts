// What a space's Operator spent, as the admin's Spending page reads it
// (admin.ts `spendingPage`), counted from the rows its store records for
// each model request (@yaks/session): the ask's `using{provider, model}`,
// its `usage` and `cost`, and `context_parts{parts}`, where its tokens went.
// Nothing here is estimated past what those rows say, but for one split
// the store itself makes: a request's fixed part (`fixed`, everything it
// carries before its conversation) is one part of `context_parts`, and it
// is shared among its pieces (the harness's system prompt, each tool, each
// part of the persona) by their sizes in the session's `fixed{parts}`.
//
// It is pure: the host reads the rows (operator-host.ts `spendingOf`) and
// this counts them.
import type { Bundle } from '@yaks/graph'

/** What some model requests came to: dollars, requests, tokens (input
 * sent fresh, read from the provider's cache, and generated), how long they
 * took end to end, and when the first was asked and the last answered. */
export type Usage = {
  cost: number
  turns: number
  unpriced: number
  settled?: number
  held?: number
  unsettled?: number
  input: number
  cached: number
  output: number
  ms: number
  at: string
  until: string
}

/** A session of the Operator's, what it opens on in the admin, what it is
 * called, and what its requests came to. */
export type Ran = Usage & {
  open: string
  title: string
  session?: string
  parent?: string
  status?: string
}

/** A conversation or a task with what it spent, its helpers' included, and
 * each helper on its own. */
export type Run = Ran & { helpers: Ran[] }

/** A piece of what requests carry, over all of them: how many carried it,
 * its tokens as they were paid (read from the provider's cache, written to
 * it, sent fresh, generated), and its dollars for those read from the cache
 * (`cached`), those written to it (`written`), and those sent fresh and
 * generated (`uncached`). */
export type Part = {
  sends: number
  read: number
  write: number
  fresh: number
  generated: number
  cached: number
  written: number
  uncached: number
}

/** Everything the page reads of one space's Operator. */
export type Spending = {
  runs: Run[]
  /** Local request receipts, when an admin asks for an audit. */
  requests?: Bundle[]
  /** All local sessions in the audit, including helpers not yet asking. */
  sessions?: Bundle[]
  owners?: Record<string, string>
  receipts?: Bundle[]
  providers?: Record<string, string>
  /** dollars by day, YYYY-MM-DD, by provider */
  days: Record<string, Record<string, number>>
  /** the pieces of the fixed part every request carries */
  prompt: Record<string, Part>
  /** the rest: what was typed, said, called and returned */
  rest: Record<string, Part>
  /** the first request whose split was recorded, or null for none */
  split: string | null
}

/** The rows `spent` counts, as the host reads them. */
export type Rows = {
  open?: string
  since?: string
  details?: boolean
  /** Calls and entries named by auxiliary sessions' session.source. */
  sources?: Bundle[]
  /** the model requests, each with `ask`, `entry`, `using`, `usage`,
   * `cost`, `context_parts`, `created` and `updated` where it has them */
  asks: Bundle[]
  /** every session, with `spawned`, `fixed` and `created` */
  sessions: Bundle[]
  /** the tasks a session carries on: session eid to task eid */
  tasks: Map<string, string>
  /** what each run and helper is called, by what it opens on */
  titles: Map<string, string>
  /** each model's `price`, by its eid */
  prices: Map<string, Price>
  /** each provider's name, by its eid (`using.provider` names the row) */
  providers?: Map<string, string>
}

type Price = {
  input?: number
  output?: number
  cached?: number
  cache_write?: number
}
type Comp = Record<string, unknown>

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let n = (v: unknown) => Number(v ?? 0) || 0
let stamp = (b: Bundle, name: 'created' | 'updated') =>
  String(comp(b, name)?.at ?? '')

/** Nothing spent yet. */
export let none = (): Usage => ({
  cost: 0,
  turns: 0,
  unpriced: 0,
  input: 0,
  cached: 0,
  output: 0,
  ms: 0,
  at: '',
  until: '',
})
let first = (a: string, b: string) => !a ? b : !b ? a : a < b ? a : b
let last = (a: string, b: string) => a > b ? a : b

// One request, as what it came to.
let one = (ask: Bundle): Usage => {
  let usage = comp(ask, 'usage') ?? {}
  let at = stamp(ask, 'created')
  let until = stamp(ask, 'updated') || at
  let took = Date.parse(until) - Date.parse(at)
  return {
    cost: n(comp(ask, 'cost')?.dollars),
    turns: 1,
    unpriced: comp(ask, 'cost')?.dollars == null ? 1 : 0,
    input: Math.max(0, n(usage.input_tokens) - n(usage.cached_tokens)),
    cached: n(usage.cached_tokens),
    output: n(usage.output_tokens),
    ms: took > 0 ? took : 0,
    at,
    until,
  }
}

/** Two counts as one. */
export let plus = (a: Usage, b: Usage): Usage => ({
  cost: a.cost + b.cost,
  turns: a.turns + b.turns,
  unpriced: a.unpriced + b.unpriced,
  ...a.settled != null || b.settled != null
    ? {
      settled: (a.settled ?? a.cost) + (b.settled ?? b.cost),
      held: n(a.held) + n(b.held),
      unsettled: n(a.unsettled) + n(b.unsettled),
    }
    : {},
  input: a.input + b.input,
  cached: a.cached + b.cached,
  output: a.output + b.output,
  ms: a.ms + b.ms,
  at: first(a.at, b.at),
  until: last(a.until, b.until),
})

let nothing = (): Part => ({
  sends: 0,
  read: 0,
  write: 0,
  fresh: 0,
  generated: 0,
  cached: 0,
  written: 0,
  uncached: 0,
})

/** A piece's tokens, [read, write, fresh, generated], at a model's price. */
export let priced = (
  [read, write, fresh, generated]: number[],
  price: Price | undefined,
): Part => {
  let input = n(price?.input)
  let m = 1e6
  return {
    sends: 1,
    read,
    write,
    fresh,
    generated,
    cached: read * (price?.cached ?? input) / m,
    written: write * (price?.cache_write ?? input) / m,
    uncached: (fresh * input + generated * n(price?.output)) / m,
  }
}

/** Two counts of one piece as one. */
export let joined = (a: Part, b: Part): Part => ({
  sends: a.sends + b.sends,
  read: a.read + b.read,
  write: a.write + b.write,
  fresh: a.fresh + b.fresh,
  generated: a.generated + b.generated,
  cached: a.cached + b.cached,
  written: a.written + b.written,
  uncached: a.uncached + b.uncached,
})

let add = (into: Record<string, Part>, key: string, part: Part) => {
  into[key] = joined(into[key] ?? nothing(), part)
}

// A fixed part's tokens shared among its pieces by their sizes.
let shared = (tokens: number[], pieces: Record<string, number>) => {
  let all = Object.values(pieces).reduce((s, c) => s + c, 0)
  return Object.entries(pieces).map(([piece, size]) =>
    [piece, tokens.map((t) => t * size / all)] as const
  )
}

/**
 * What one space's Operator spent: each conversation and task with its
 * helpers rolled up into it, newest first; the dollars of each day by
 * provider; and what each piece of its requests cost.
 *
 * ```ts
 * import { spent } from './operator-spending.ts'
 * import { equal } from '@yaks/testing'
 *
 * let ask = (eid: string, session: string, at: string, dollars: number) => ({
 *   entity: { eid },
 *   ask: { to: 'm' },
 *   entry: { session },
 *   using: { provider: 'anthropic' },
 *   usage: { input_tokens: 100, cached_tokens: 60, output_tokens: 10 },
 *   cost: { dollars },
 *   context_parts: { parts: { fixed: [60, 0, 20, 0], output: [0, 0, 0, 10] } },
 *   created: { at },
 *   updated: { at: at.replace(':00Z', ':02Z') },
 * })
 * let s = spent({
 *   asks: [
 *     ask('a1', 'root', '2026-11-08T10:00:00Z', 0.5),
 *     ask('a2', 'kid', '2026-11-08T11:00:00Z', 0.25),
 *   ],
 *   sessions: [
 *     { entity: { eid: 'root' }, fixed: { parts: { system: 3, 'tool x': 1 } } },
 *     { entity: { eid: 'kid' }, spawned: { parent: 'root' } },
 *   ],
 *   tasks: new Map(),
 *   titles: new Map([['root', 'Ann'], ['kid', 'Look it up']]),
 *   prices: new Map([['m', { input: 1, cached: 0.1, output: 10 }]]),
 * })
 * equal(s.runs.map((r) => [r.title, r.cost, r.turns, r.helpers.length]), [
 *   ['Ann', 0.75, 2, 1],
 * ])
 * equal(s.runs[0].ms, 4000)
 * equal(s.days, { '2026-11-08': { anthropic: 0.75 } })
 * // The helper's session records no pieces, so its fixed part stays whole.
 * equal([s.prompt.system.read, s.prompt['tool x'].read], [45, 15])
 * equal(s.prompt.fixed.read, 60)
 * equal(s.rest.output.uncached, 0.0002)
 * ```
 */
export let spent = (rows: Rows): Spending => {
  let sessions = new Map(rows.sessions.map((s) => [s.entity.eid, s]))
  let sources = new Map(
    [...rows.asks, ...rows.sources ?? []].map((s) => [s.entity.eid, s]),
  )
  let owner = (eid: string, seen = new Set<string>()): string => {
    let source = comp(sessions.get(eid), 'session')?.source
    let call = source ? sources.get(String(source)) : undefined
    let ask = comp(call, 'call')?.source
    let session = ask
      ? comp(sources.get(String(ask)), 'entry')?.session
      : undefined
    if (!session || seen.has(String(session))) return eid
    seen.add(eid)
    return owner(String(session), seen)
  }
  let parent = (eid: string) =>
    comp(sessions.get(eid), 'spawned')?.parent as string | undefined
  // The session a helper works for, up its `spawned` links, as far as the
  // store still holds them.
  let top = (eid: string, seen = new Set<string>()): string => {
    eid = owner(eid)
    let up = parent(eid)
    if (!up || seen.has(up) || !sessions.has(up)) return eid
    seen.add(eid)
    return top(up, seen)
  }
  let openOf = (session: string) => rows.tasks.get(session) ?? session
  let titleOf = (open: string) => rows.titles.get(open) ?? 'A conversation'
  let lineage = (session: string) => ({
    session,
    ...parent(session) ? { parent: parent(session) } : {},
    ...comp(sessions.get(session), 'session')?.status
      ? { status: String(comp(sessions.get(session), 'session')!.status) }
      : {},
  })

  let runs = new Map<string, Run>()
  let helpers = new Map<string, Ran>()
  let days: Spending['days'] = {}
  let prompt: Record<string, Part> = {}
  let rest: Record<string, Part> = {}
  let split: string | null = null
  let requests: Bundle[] = []
  for (let ask of rows.asks) {
    let session = String(comp(ask, 'entry')?.session ?? '')
    if (!session) continue
    let used = one(ask)
    let root = top(session)
    let open = openOf(root)
    if (rows.open && root != rows.open && open != rows.open) continue
    if (rows.details) {
      requests.push(Object.fromEntries(
        Object.entries(ask).filter(([key]) => key != 'context_parts'),
      ) as Bundle)
    }
    let run = runs.get(open) ??
      { ...none(), ...lineage(root), open, title: titleOf(open), helpers: [] }
    runs.set(open, { ...run, ...plus(run, used) })
    let owned = owner(session)
    if (root != owned) {
      let mine = openOf(owned)
      let helper = helpers.get(mine) ??
        {
          ...none(),
          ...lineage(owned),
          open: mine,
          title: rows.titles.get(mine) ?? `Helper ${owned.slice(0, 8)}`,
        }
      helpers.set(mine, { ...helper, ...plus(helper, used) })
      if (!run.helpers.some((h) => h.open == mine)) {
        runs.get(open)!.helpers.push({ ...none(), open: mine, title: '' })
      }
    }
    if (used.cost) {
      let day = used.at.slice(0, 10)
      let row = String(comp(ask, 'using')?.provider ?? '')
      let provider = rows.providers?.get(row) ?? (row || 'models')
      let on = days[day] ??= {}
      on[provider] = (on[provider] ?? 0) + used.cost
    }
    let parts = comp(ask, 'context_parts')?.parts as
      | Record<string, number[]>
      | undefined
    if (!parts) continue
    split = first(split ?? '', used.at) || null
    let price = rows.prices.get(String(comp(ask, 'ask')?.to ?? ''))
    let pieces = comp(sessions.get(session), 'fixed')?.parts as
      | Record<string, number>
      | undefined
    for (let [name, tokens] of Object.entries(parts)) {
      if (name == 'fixed' && pieces && Object.keys(pieces).length) {
        for (let [piece, t] of shared(tokens, pieces)) {
          add(prompt, piece, priced(t, price))
        }
      } else add(name == 'fixed' ? prompt : rest, name, priced(tokens, price))
    }
  }
  // A started helper counts even if it was stopped before its first request.
  for (let session of rows.sessions) {
    let eid = session.entity.eid
    if (!parent(eid) || rows.since && stamp(session, 'created') < rows.since) {
      continue
    }
    let root = top(eid)
    let run = runs.get(openOf(root))
    let mine = openOf(eid)
    if (!run || root == eid || helpers.has(mine)) continue
    let helper = {
      ...none(),
      ...lineage(eid),
      open: mine,
      title: rows.titles.get(mine) ?? `Helper ${eid.slice(0, 8)}`,
      at: stamp(session, 'created'),
      until: stamp(session, 'updated'),
    }
    helpers.set(mine, helper)
    run.helpers.push(helper)
  }
  let newest = <T extends Usage>(all: T[]) =>
    all.sort((a, b) => b.until.localeCompare(a.until))
  return {
    ...rows.details
      ? {
        requests,
        providers: Object.fromEntries(rows.providers ?? []),
        owners: Object.fromEntries(
          rows.sessions.map((s) => [s.entity.eid, owner(s.entity.eid)]),
        ),
        sessions: rows.sessions.filter((s) =>
          !rows.open || top(s.entity.eid) == rows.open ||
          openOf(top(s.entity.eid)) == rows.open
        ).map((s) =>
          Object.fromEntries(
            Object.entries(s).filter(([key]) => key != 'fixed'),
          ) as Bundle
        ),
      }
      : {},
    runs: newest([...runs.values()].map((r) => ({
      ...r,
      helpers: newest(r.helpers.map((h) => helpers.get(h.open)!)),
    }))),
    days,
    prompt,
    rest,
    split,
  }
}

/** Directory settlements survive an interrupted transcript write. Missing
 * receipts remain unknown; reservations are held budget, not measured cost. */
export let reconciled = (
  spending: Spending,
  receipts: Map<string, Bundle>,
): Spending => {
  let days = structuredClone(spending.days)
  let extra = new Map<
    string,
    { settled: number; held: number; unsettled: number }
  >()
  for (let ask of spending.requests ?? []) {
    if (comp(ask, 'cost')?.dollars != null) continue
    let session = String(comp(ask, 'entry')?.session)
    let owner = spending.owners?.[session] ?? session
    let tally = extra.get(owner) ?? { settled: 0, held: 0, unsettled: 0 }
    let receipt = receipts.get(ask.entity.eid)
    let cost = comp(receipt, 'cost')?.dollars
    if (cost != null) {
      tally.settled += Number(cost)
      let day = stamp(ask, 'created').slice(0, 10)
      let from = String(comp(ask, 'using')?.provider ?? '')
      let provider = spending.providers?.[from] ?? (from || 'models')
      let on = days[day] ??= {}
      on[provider] = n(on[provider]) + Number(cost)
    } else {
      tally.held += n(comp(receipt, 'model_reservation')?.dollars)
      tally.unsettled++
    }
    extra.set(owner, tally)
  }
  let counted = (run: Ran) => ({
    ...run,
    settled: run.cost + n(extra.get(run.session ?? '')?.settled),
    held: n(extra.get(run.session ?? '')?.held),
    unsettled: n(extra.get(run.session ?? '')?.unsettled),
  })
  return {
    ...spending,
    days,
    receipts: [...receipts.values()],
    runs: spending.runs.map((run) => {
      let helpers = run.helpers.map(counted)
      let own = counted(run)
      return {
        ...own,
        settled: own.settled +
          helpers.reduce((sum, h) => sum + h.settled - h.cost, 0),
        held: own.held + helpers.reduce((sum, h) => sum + h.held, 0),
        unsettled: own.unsettled +
          helpers.reduce((sum, h) => sum + h.unsettled, 0),
        helpers,
      }
    }),
  }
}
