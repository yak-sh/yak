import { env } from '@yaks/process/env'
/**
 * A day's tally, read from the graph and kept as its `spend` row: the
 * requests whose entries were written that UTC day (an imported entry is
 * dated when its line was written), the prices, the sessions' fixed parts,
 * and the tasks each session worked on: the ones it claims, or commented on,
 * filed or finished from that day to the next. A subagent writes as the
 * session that started it, so its tasks are the ones its brief names, else
 * that session's.
 *
 * @module
 */
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { parse } from '@yaks/id'
import { accountEid, listPrice, type Price } from '@yaks/model'
import { type Home, home } from '@yaks/session/files'
import { absolute } from '@yaks/file/local'
import { after, dayEid } from './window.ts'
import { type Known, type Spend, tally } from './tally.ts'

/** The row that keeps a day's tally. */

let PAGE = 2000
let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp
let str = (v: unknown) => v == null ? '' : String(v)
let quoted = (s: string) => JSON.stringify(s)

let provider = (name: string) => identityEid('provider', [name])

type Runner = Home['runner']

/** Which CLI's plan each provider that serves models bills against: the
 * Claude and Codex CLIs their own subscriptions, and OpenAI's API the ChatGPT
 * sign-in's, which is Codex's, unless an API key pays for it by the token (the
 * harness takes a key first). Any other provider bills no plan. */
export let PLANS = (key = false): Map<Eid, Runner> => {
  let plans: Record<string, Runner> = {
    claude: 'claude',
    codex: 'codex',
    'codex-cli': 'codex',
    ...key ? {} : { openai: 'codex' },
  }
  return new Map(
    Object.entries(plans).map(([from, to]) => [provider(from), to]),
  )
}

/**
 * The account whose plan a request billed against: the account its
 * transcript is in, which `paths` says where each file of this computer is
 * and `homes` where each account keeps its own; else, for one the native
 * harness sent, the account the CLI of its `using` provider signs in with
 * here. A request that billed no plan was paid by the token.
 *
 * ```ts
 * import { planOf, PLANS } from './day.ts'
 * import { home, type Home } from '@yaks/session/files'
 * import { accountEid } from '@yaks/model'
 * import { identityEid } from '@yaks/graph/identity'
 * import { equal } from '@yaks/testing'
 *
 * let p = (name: string) => identityEid('provider', [name])
 * let paths = new Map([['f', '/u/.claude-work/projects/p/s.jsonl']])
 * let homes = new Map([['/u/.claude-work', 'w']])
 * let plan = planOf(PLANS(), paths, homes)
 * let r = { entity: { eid: 'r' } }
 * equal(plan({ ...r, lines: { file: 'f', start: 3 } }), 'w')
 * equal(plan({ ...r, using: { provider: p('openai') } }), accountEid(home('codex')!))
 * equal(planOf(PLANS(true))({ ...r, using: { provider: p('openai') } }), undefined)
 * equal(plan({ ...r, using: { provider: p('openrouter') } }), undefined)
 * ```
 */
export let planOf = (
  plans: Map<Eid, Runner>,
  paths: Map<Eid, string> = new Map(),
  homes: Map<string, Eid> = new Map(),
) =>
(b: Bundle): Eid | undefined => {
  let served = str(comp(b, 'using').provider)
  if (served) {
    let dir = plans.has(served) ? home(plans.get(served)!) : undefined
    return dir && accountEid(dir)
  }
  let source = paths.get(str(comp(b, 'lines').file)) ?? ''
  return [...homes].find(([dir]) => source.startsWith(`${dir}/`))?.[1]
}

// Where each transcript the rows were read from is on this computer's disks.
let located = async (g: Graph, rows: Bundle[]): Promise<Map<Eid, string>> => {
  let files = [
    ...new Set(rows.map((b) => str(comp(b, 'lines').file)).filter(Boolean)),
  ]
  let found = await Promise.all(
    (files.length ? await g.get(files, ['file']) : []).map(async (f) =>
      [f.entity.eid, await absolute(g, f)] as const
    ),
  )
  return new Map(found.flatMap(([eid, path]) => path ? [[eid, path]] : []))
}

// Every row a query finds, a page at a time.
let every = async (g: Graph, q: string): Promise<Bundle[]> => {
  let out: Bundle[] = []
  let last: Eid | undefined
  for (;;) {
    let page = await g.read(
      `${q} .order=entity.eid .limit=${PAGE}${last ? ` .after=${last}` : ''} *`,
    )
    out.push(...page)
    if (page.length < PAGE) return out
    last = page.at(-1)!.entity.eid
  }
}

/** The row of each of these sessions and of every session above it by
 * `spawned.parent`, however long its line, with `spawned` and these
 * components. */
export let lineage = async (
  g: Graph,
  sessions: Eid[],
  comps: string[],
): Promise<Map<Eid, Bundle>> => {
  let rows = new Map<Eid, Bundle>()
  for (let ask = [...new Set(sessions)]; ask.length;) {
    let got = await g.get(ask, ['spawned', ...comps])
    ask = []
    for (let r of got) {
      if (!r || rows.has(r.entity.eid)) continue
      rows.set(r.entity.eid, r)
      ask.push(str(comp(r, 'spawned').parent))
    }
    ask = [...new Set(ask)].filter((s) => s && !rows.has(s))
  }
  return rows
}

// Each session's root: the session that started it, and that one's, up.
let roots = async (g: Graph, sessions: Eid[]) => {
  let parent = new Map<Eid, Eid>()
  let fixed = new Map<Eid, Record<string, number>>()
  for (let [eid, r] of await lineage(g, sessions, ['fixed'])) {
    let parts = comp(r, 'fixed').parts as Record<string, number> | undefined
    if (parts) fixed.set(eid, parts)
    let up = str(comp(r, 'spawned').parent)
    if (up) parent.set(eid, up)
  }
  let root = (s: Eid) => {
    for (let seen = new Set<Eid>(); parent.has(s) && !seen.has(s);) {
      seen.add(s)
      s = parent.get(s)!
    }
    return s
  }
  return { root, parent, fixed }
}

// The tasks a subagent was started on: those its brief, the first thing its
// transcript says, names. Its writes are its parent's, so they cannot say. An
// id is its number, whatever its letter, and it names a task when the entity
// carrying that number is one; a number nothing carries names nothing.
let briefed = async (
  g: Graph,
  subagents: Eid[],
): Promise<Map<Eid, Eid[]>> => {
  let named = new Map<Eid, number[]>()
  for (let s of subagents) {
    let [first] = await g.rows(
      `.entry.session=${s} .content .order=entry.seq .limit=1 .fields=content.body`,
    ) as Record<string, unknown>[]
    let nums = (str(first?.['content.body']).match(/\b[A-Z]-\d+\b/g) ?? [])
      .map((id) => parse(id)?.num).filter((n): n is number => n != null)
    if (nums.length) named.set(s, [...new Set(nums)])
  }
  let all = [...new Set([...named.values()].flat())]
  let tasks = new Map<number, Eid>()
  if (all.length) {
    let found = await g.read(
      `.task .entity.num=${all.join(',')} .fields=entity.num`,
    )
    for (let b of found) tasks.set(Number(b.entity.num), b.entity.eid)
  }
  return new Map(
    [...named].map((
      [s, ns],
    ) => [s, ns.map((n) => tasks.get(n)).filter((e): e is Eid => !!e)]),
  )
}

// The tasks each root session worked on from `day` to the next.
let worked = async (
  g: Graph,
  day: string,
  root: (s: Eid) => Eid,
): Promise<Map<Eid, Eid[]>> => {
  let from = quoted(day), to = quoted(after(day, 2))
  let links: [Eid, Eid][] = [] // session, entity
  let rows = async (q: string, of: string, by: string) => {
    for (let r of await g.rows(q) as Record<string, unknown>[]) {
      if (r[of] && r[by]) links.push([str(r[by]), str(r[of])])
    }
  }
  await rows('.claim .fields=entity.eid,claim.session', 'eid', 'claim.session')
  await rows(
    `.comment .created.at>=${from} .created.at<${to} .fields=comment.target,created.via`,
    'comment.target',
    'created.via',
  )
  await rows(
    `.task .created.at>=${from} .created.at<${to} .fields=entity.eid,created.via`,
    'eid',
    'created.via',
  )
  await rows(
    `.task .completed.at>=${from} .completed.at<${to} .fields=entity.eid,completed.via`,
    'eid',
    'completed.via',
  )
  let named = [...new Set(links.map(([, e]) => e))]
  let tasks = new Set(
    (await g.get(named, ['task'])).filter((r) => r?.task).map((r) =>
      r!.entity.eid
    ),
  )
  let out = new Map<Eid, Set<Eid>>()
  for (let [s, e] of links) {
    if (!tasks.has(e)) continue
    let at = out.get(root(s)) ?? out.set(root(s), new Set()).get(root(s))!
    at.add(e)
  }
  return new Map([...out].map(([s, ts]) => [s, [...ts]]))
}

/** What a day's tally reads beside its requests. */
export let known = async (
  g: Graph,
  day: string,
  rows: Bundle[],
): Promise<Known> => {
  let prices = new Map(
    (await g.read('.price *')).map((b) => [b.entity.eid, b.price as Price]),
  )
  let sessions = [
    ...new Set(rows.map((b) => str(comp(b, 'entry').session)).filter(Boolean)),
  ]
  let { root, parent, fixed } = await roots(g, sessions)
  let byRoot = await worked(g, day, root)
  let brief = await briefed(g, [...parent.keys()])
  // A subagent's tasks are its brief's, else the nearest brief up its line,
  // else what the session at its root worked on.
  let of = (s: Eid): Eid[] => {
    let seen = new Set<Eid>()
    for (let at: Eid | undefined = s; at && !seen.has(at);) {
      if (brief.get(at)?.length) return brief.get(at)!
      seen.add(at)
      at = parent.get(at)
    }
    return byRoot.get(root(s)) ?? []
  }
  let tasks = new Map(sessions.map((s) => [s, of(s)]))
  let homes = new Map(
    (await g.read('.account *')).map((b) => [
      str(comp(b, 'account').home),
      b.entity.eid,
    ]),
  )
  let plan = planOf(
    PLANS(!!env.get('OPENAI_API_KEY')),
    await located(g, rows),
    homes,
  )
  let plans = new Map(
    rows.flatMap((b): [Eid, Eid][] => {
      let at = plan(b)
      return at ? [[b.entity.eid, at]] : []
    }),
  )
  return { prices, fixed, tasks, plans }
}

/** A day's requests: every entry with usage that asked a model. */
export let requests = (g: Graph, day: string): Promise<Bundle[]> =>
  every(
    g,
    `.ask .usage .created.at>=${quoted(day)} .created.at<${quoted(after(day))}`,
  )

/** Give each of these models its list price on its row, where the table
 * holds its name: a row made before the table knew it, or by a writer that
 * names a model by its row. Says whether any took one. */
let listed = async (g: Graph, models: Eid[]): Promise<boolean> => {
  let prices = (await g.get(models.filter(Boolean), ['model'])).flatMap(
    (b): Bundle[] => {
      let price = listPrice(str(comp(b, 'model').name))
      return price ? [{ entity: { eid: b.entity.eid }, price }] : []
    },
  )
  if (prices.length) await g.apply(prices, { trusted: true })
  return prices.length > 0
}

/** Tally a day from the graph and keep it on its row. A model it meets with
 * no price takes its list price first, so only a model the table lacks is
 * left unpriced. */
export let recompute = async (g: Graph, day: string): Promise<Spend> => {
  let rows = await requests(g, day)
  let spend = tally(day, rows, await known(g, day, rows))
  if (await listed(g, spend.unpriced)) {
    spend = tally(day, rows, await known(g, day, rows))
  }
  await g.apply([{ entity: { eid: dayEid(day) }, spend }], { trusted: true })
  return spend
}
