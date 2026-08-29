// The graph's work lanes: one pure readiness predicate shared by managed
// dispatch and external workers, plus a scoped candidate reader for humans and
// agents choosing work. Dispatch still owns spending, slots, providers, and
// retry policy; this module owns only whether work is eligible and how a bounded
// candidate envelope is assembled from indexed graph reads.
import type { Row } from './client.ts'
import { type Dep, idOf, settled, statusOf } from './types.ts'

export type WorkLane = 'evaluate' | 'build'

export type WorkRead = {
  query: (
    filters: string[],
    opts?: { limit?: number },
  ) => Promise<Row[]>
  get: (ids: string[]) => Promise<Row[]>
  deps: (eids: string[]) => Promise<Dep[]>
}

export type WorkCandidate = {
  id: string
  kind: string
  title: string
  project?: { id: string; title: string }
  domain?: string
  priority?: number
  proposed: boolean
  decision: 'pending' | 'approved' | 'declined' | 'none'
  authorization?: { kind: 'direct' | 'inherited'; from: string[] }
  claim: string | null
  blocked: string | null
  blockers: {
    id: string
    title: string
    status: string
    claim: string | null
  }[]
  execution?: {
    repo?: {
      path?: string
      url?: string
      gate?: string
      base_branch?: string
    }
    spawn?: {
      provider?: string
      model?: string
      effort?: string
      persona?: string
    }
  }
}

// A direct approval is the decided facet unless its explicit verdict says no.
// Rows written before verdict existed remain approved, as dispatch has always
// read them.
export let approved = (r: Row) =>
  !!r.comps.decided && r.comps.decided.verdict != 'declined'

export let pending = (r: Row) => !!r.comps.proposed && !r.comps.decided
export let declined = (r: Row) => r.comps.decided?.verdict == 'declined'

let open = (r?: Row) => !!r?.comps.task && statusOf(r.comps) == 'open'

// Approval inheritance is traced to each approved open root so a worker can
// explain why a descendant is authorized. A per-root seen set terminates
// cycles without erasing a second root's independent authorization.
export let authorizations = (all: Row[], deps: Dep[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let kids = new Map<string, string[]>()
  for (let d of deps) {
    if (d.type != 'requires') continue
    let list = kids.get(d.parent) ?? []
    list.push(d.child)
    kids.set(d.parent, list)
  }
  let out = new Map<string, Set<string>>()
  for (let root of all.filter((r) => open(r) && approved(r))) {
    let seen = new Set<string>()
    let stack = [...kids.get(root.eid) ?? []]
    while (stack.length) {
      let eid = stack.pop()!
      if (seen.has(eid)) continue
      seen.add(eid)
      let row = by.get(eid)
      // An explicit decision boundary stops inheritance at that node. Its
      // descendants wait behind the same boundary rather than being reached
      // through work the owner has held or declined.
      if (row && (pending(row) || declined(row))) continue
      let sources = out.get(eid) ?? new Set<string>()
      sources.add(root.eid)
      out.set(eid, sources)
      stack.push(...kids.get(eid) ?? [])
    }
  }
  return out
}

export let authorized = (all: Row[], deps: Dep[]) =>
  new Set(authorizations(all, deps).keys())

let unresolved = (eid: string, by: Map<string, Row>, deps: Dep[]) =>
  deps.filter((d) =>
    d.type == 'requires' && d.parent == eid &&
    !settled(by.has(d.child) ? statusOf(by.get(d.child)!.comps) : 'open')
  )

// The one build-membership predicate. Recursive authorization may greenlight
// an otherwise undecided descendant, but it never overrides an explicit
// proposal awaiting judgment or a declined decision.
export let buildReady = (
  r: Row,
  by: Map<string, Row>,
  deps: Dep[],
  inherited = false,
) =>
  open(r) && !r.comps.claim && !r.comps.blocked &&
  !unresolved(r.eid, by, deps).length &&
  (approved(r) || (inherited && !pending(r) && !declined(r)))

let born = (r: Row) => {
  let t = Date.parse(String(r.comps.created?.at ?? ''))
  return Number.isNaN(t) ? Infinity : t
}
let rank = (r: Row) =>
  typeof r.comps.task?.priority == 'number' ? r.comps.task.priority : Infinity
let resumeRank = (r: Row) => Number(r.comps.resume?.rank ?? 0)

// Managed retry generations outrank first attempts, then preserve the
// established priority → oldest → number spend order.
export let dispatchOrder = (a: Row, b: Row) =>
  Number(!!b.comps.resume) - Number(!!a.comps.resume) ||
  resumeRank(b) - resumeRank(a) || rank(a) - rank(b) ||
  born(a) - born(b) || a.num - b.num

// Managed dispatch membership and order. External candidates deliberately
// re-order the same members below; spending keeps priority → oldest → number.
export let backlog = (all: Row[], deps: Dep[], recursive = false) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let auth = recursive ? authorized(all, deps) : new Set<string>()
  return all
    .filter((r) => buildReady(r, by, deps, auth.has(r.eid)))
    .sort(dispatchOrder)
}

export let ready = (all: Row[], deps: Dep[]) => backlog(all, deps, false)

export let parkable = (all: Row[], deps: Dep[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  return all
    .filter((r) =>
      open(r) && !r.comps.claim && !r.comps.blocked && approved(r) &&
      unresolved(r.eid, by, deps).length > 0
    )
    .sort((a, b) => rank(a) - rank(b) || born(a) - born(b) || a.num - b.num)
}

let decision = (r: Row): WorkCandidate['decision'] =>
  pending(r)
    ? 'pending'
    : declined(r)
    ? 'declined'
    : approved(r)
    ? 'approved'
    : 'none'

let text = (value: unknown) =>
  typeof value == 'string' && value ? value : undefined
let num = (value: unknown) => typeof value == 'number' ? value : undefined

let execution = (
  r: Row,
  project: Row | undefined,
  named: Map<string, Row>,
): WorkCandidate['execution'] => {
  let repo = project?.comps.repo
  let spawn = r.comps.spawn
  let out = {
    ...(repo
      ? {
        repo: {
          ...(text(repo.path) ? { path: text(repo.path) } : {}),
          ...(text(repo.url) ? { url: text(repo.url) } : {}),
          ...(text(repo.gate) ? { gate: text(repo.gate) } : {}),
          ...(text(repo.base_branch)
            ? { base_branch: text(repo.base_branch) }
            : {}),
        },
      }
      : {}),
    ...(spawn
      ? {
        spawn: {
          ...(text(spawn.provider) ? { provider: text(spawn.provider) } : {}),
          ...(text(spawn.model) ? { model: text(spawn.model) } : {}),
          ...(text(spawn.effort) ? { effort: text(spawn.effort) } : {}),
          ...(text(spawn.persona)
            ? {
              persona: idOf(
                named.get(String(spawn.persona)) ?? {
                  eid: String(spawn.persona),
                  num: 0,
                  kind: 'entity',
                  comps: {},
                },
              ),
            }
            : {}),
        },
      }
      : {}),
  }
  return Object.keys(out).length ? out : undefined
}

let LIMIT = 20
let POOL = 200

export let workFilters = (lane: WorkLane, recursive = false) =>
  lane == 'evaluate' ? ['.proposed!', '.decided='] : [
    '.kind=task',
    '.status=open',
    ...recursive ? [] : ['.decided!'],
    '.claim=',
    '.blocked=',
  ]

let expand = async (
  read: WorkRead,
  seeds: Row[],
  recursive = false,
  cap = POOL * 2,
) => {
  let by = new Map(seeds.map((r) => [r.eid, r]))
  let edges = new Map<string, Dep>()
  let frontier = seeds.map((r) => r.eid)
  while (frontier.length && by.size < cap) {
    let found = (await read.deps(frontier)).filter((d) => d.type == 'requires')
    for (let d of found) edges.set(`${d.type}\0${d.parent}\0${d.child}`, d)
    let ids = [...new Set(found.flatMap((d) => [d.parent, d.child]))]
      .filter((eid) => !by.has(eid)).slice(0, cap - by.size)
    let rows = await read.get(ids)
    frontier = rows.filter((r) => !by.has(r.eid)).map((r) => r.eid)
    for (let r of rows) by.set(r.eid, r)
    if (!recursive) break
  }
  return { by, deps: [...edges.values()] }
}

// Bounded candidate discovery: an indexed membership query, incident-edge
// walks capped to the candidate pool, and keyed expansion of only the projects,
// blockers, sessions, personas, and authorization roots those candidates name.
// No whole-graph snapshot rides this path.
export let workCandidates = async (
  read: WorkRead,
  lane: WorkLane,
  opts: { filters?: string[]; limit?: number; recursive?: boolean } = {},
): Promise<WorkCandidate[]> => {
  let limit = Math.max(1, Math.min(opts.limit ?? LIMIT, 100))
  let pool = Math.min(POOL, Math.max(50, limit * 4))
  let base = workFilters(lane, opts.recursive)
  let hits = await read.query([...base, ...opts.filters ?? []], {
    limit: lane == 'evaluate' ? limit : pool,
  })
  let expanded = await expand(
    read,
    hits,
    lane == 'build' && opts.recursive,
    pool * 2,
  )
  let deps = expanded.deps
  let first = await read.get([
    ...hits.map((r) => String(r.comps.task?.project ?? '')).filter(Boolean),
    ...hits.map((r) => String(r.comps.claim?.session ?? '')).filter(Boolean),
    ...hits.map((r) => String(r.comps.spawn?.persona ?? '')).filter(Boolean),
  ])
  let blockerClaims = [...expanded.by.values(), ...first]
    .map((r) => String(r.comps.claim?.session ?? ''))
    .filter(Boolean)
  let all = [
    ...expanded.by.values(),
    ...first,
    ...await read.get(blockerClaims),
  ]
  let by = new Map(all.map((r) => [r.eid, r]))
  let auth = opts.recursive ? authorizations(all, deps) : new Map()
  let selected = lane == 'evaluate'
    ? hits
    : hits.filter((r) => buildReady(r, by, deps, auth.has(r.eid)))
  selected.sort((a, b) =>
    lane == 'build' ? rank(a) - rank(b) || b.num - a.num : b.num - a.num
  )
  return selected.slice(0, limit).map((r) => {
    let project = by.get(String(r.comps.task?.project ?? ''))
    let roots = approved(r) ? [r.eid] : [...auth.get(r.eid) ?? []]
    let blockers = unresolved(r.eid, by, deps).map((d) => {
      let blocker = by.get(d.child)
      let holder = by.get(String(blocker?.comps.claim?.session ?? ''))
      return {
        id: blocker ? idOf(blocker) : d.child,
        title: String(blocker?.comps.doc?.title ?? ''),
        status: blocker ? statusOf(blocker.comps) : 'missing',
        claim: holder ? idOf(holder) : null,
      }
    })
    let holder = by.get(String(r.comps.claim?.session ?? ''))
    return {
      id: idOf(r),
      kind: r.kind,
      title: String(r.comps.doc?.title ?? ''),
      ...(project
        ? {
          project: {
            id: idOf(project),
            title: String(project.comps.doc?.title ?? ''),
          },
        }
        : {}),
      ...(text(r.comps.task?.domain)
        ? { domain: text(r.comps.task?.domain) }
        : {}),
      ...(num(r.comps.task?.priority) != null
        ? { priority: num(r.comps.task?.priority) }
        : {}),
      proposed: !!r.comps.proposed,
      decision: decision(r),
      ...(roots.length
        ? {
          authorization: {
            kind: approved(r) ? 'direct' as const : 'inherited' as const,
            from: roots.map((eid) => by.get(eid)).filter(Boolean).map((x) =>
              idOf(x!)
            ),
          },
        }
        : {}),
      claim: holder ? idOf(holder) : null,
      blocked: text(r.comps.blocked?.on) ?? null,
      blockers,
      ...(() => {
        let hint = execution(r, project, by)
        return hint ? { execution: hint } : {}
      })(),
    }
  })
}
