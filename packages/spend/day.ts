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
import type { Price } from '@yaks/model'
import { claudeProjects, codexSessions } from '@yaks/session/files'
import { absolute } from '@yaks/file/local'
import { after } from './window.ts'
import { type Known, type Spend, tally } from './tally.ts'

/** The row that keeps a day's tally. */
export let dayEid = (day: string): Eid => identityEid('spend', [day])

let PAGE = 2000
let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp
let str = (v: unknown) => v == null ? '' : String(v)
let quoted = (s: string) => JSON.stringify(s)

let provider = (name: string) => identityEid('provider', [name])

/** Which plan each provider that serves models bills against, by the name of
 * the provider whose limits measure it (`rate_limit`): the Claude and Codex
 * CLIs their own subscriptions, and OpenAI's API the ChatGPT sign-in's, which
 * is Codex's, unless an API key pays for it by the token (the harness takes a
 * key first). Any other provider bills no plan. */
export let PLANS = (key = false): Map<Eid, Eid> =>
  new Map(
    Object.entries({
      claude: 'claude',
      codex: 'codex',
      'codex-cli': 'codex',
      ...key ? {} : { openai: 'codex' },
    }).map(([from, to]) => [provider(from), provider(to)]),
  )

/**
 * The provider whose plan a request billed against: by the provider that
 * served it, as the native harness records it in `using`, else by the CLI
 * whose transcript it was read from, which `paths` says where each file of
 * this computer is. A request that billed no plan was paid by the token.
 *
 * ```ts
 * import { planOf, PLANS } from './day.ts'
 * import { claudeProjects } from '@yaks/session/files'
 * import { identityEid } from '@yaks/graph/identity'
 * import { equal } from '@yaks/testing'
 *
 * let p = (name: string) => identityEid('provider', [name])
 * let paths = new Map([['f', `${claudeProjects()}/p/s.jsonl`]])
 * let plan = planOf(PLANS(), paths)
 * let r = { entity: { eid: 'r' } }
 * equal(plan({ ...r, lines: { file: 'f', start: 3 } }), p('claude'))
 * equal(plan({ ...r, using: { provider: p('openai') } }), p('codex'))
 * equal(planOf(PLANS(true))({ ...r, using: { provider: p('openai') } }), undefined)
 * equal(plan({ ...r, using: { provider: p('openrouter') } }), undefined)
 * ```
 */
export let planOf = (
  plans: Map<Eid, Eid>,
  paths: Map<Eid, string> = new Map(),
) =>
(b: Bundle): Eid | undefined => {
  let served = str(comp(b, 'using').provider)
  if (served) return plans.get(served)
  let source = paths.get(str(comp(b, 'lines').file)) ?? ''
  let cli =
    ([['claude', claudeProjects()], ['codex', codexSessions()]] as const)
      .find(([, root]) => root && source.startsWith(`${root}/`))?.[0]
  return cli && provider(cli)
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

// Each session's root: the session that started it, and that one's, up.
let roots = async (g: Graph, sessions: Eid[]) => {
  let parent = new Map<Eid, Eid>()
  let fixed = new Map<Eid, Record<string, number>>()
  let ask = sessions
  for (let depth = 0; ask.length && depth < 5; depth++) {
    let rows = await g.get(ask, ['spawned', 'fixed'])
    ask = []
    for (let r of rows) {
      if (!r) continue
      let parts = comp(r, 'fixed').parts as Record<string, number> | undefined
      if (parts) fixed.set(r.entity.eid, parts)
      let up = str(comp(r, 'spawned').parent)
      if (up && !parent.has(r.entity.eid)) {
        parent.set(r.entity.eid, up)
        ask.push(up)
      }
    }
  }
  let root = (s: Eid) => {
    for (let i = 0; parent.has(s) && i < 5; i++) s = parent.get(s)!
    return s
  }
  return { root, parent, fixed }
}

// The tasks a subagent was started on: those its brief, the first thing its
// transcript says, names. Its writes are its parent's, so they cannot say.
let briefed = async (
  g: Graph,
  subagents: Eid[],
): Promise<Map<Eid, Eid[]>> => {
  let named = new Map<Eid, string[]>()
  for (let s of subagents) {
    let [first] = await g.rows(
      `.entry.session=${s} .content .order=entry.seq .limit=1 .fields=content.body`,
    ) as Record<string, unknown>[]
    let ids = str(first?.['content.body']).match(/\bT-\d+\b/g) ?? []
    if (ids.length) named.set(s, [...new Set(ids)])
  }
  // A brief can name a task that is gone or never was: it names nothing.
  let at = new Map<string, Eid>()
  for (let id of new Set([...named.values()].flat())) {
    let found = await Promise.resolve()
      .then(() => g.address([id]))
      .catch(() => undefined)
    if (found?.get(id)) at.set(id, found.get(id)!)
  }
  return new Map(
    [...named].map((
      [s, ns],
    ) => [s, ns.map((n) => at.get(n)).filter((e): e is Eid => !!e)]),
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
    for (let at: Eid | undefined = s, i = 0; at && i < 6; i++) {
      if (brief.get(at)?.length) return brief.get(at)!
      at = parent.get(at)
    }
    return byRoot.get(root(s)) ?? []
  }
  let tasks = new Map(sessions.map((s) => [s, of(s)]))
  let plan = planOf(
    PLANS(!!globalThis.Deno?.env.get('OPENAI_API_KEY')),
    await located(g, rows),
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

/** Tally a day from the graph and keep it on its row. */
export let recompute = async (g: Graph, day: string): Promise<Spend> => {
  let rows = await requests(g, day)
  let spend = tally(day, rows, await known(g, day, rows))
  await g.apply([{ entity: { eid: dayEid(day) }, spend }], { trusted: true })
  return spend
}
