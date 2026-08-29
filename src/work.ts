// The graph's work lanes: one pure readiness predicate shared by managed
// dispatch and external workers, plus a scoped candidate reader for humans and
// agents choosing work. Dispatch still owns spending, slots, providers, and
// retry policy; this module owns only whether work is eligible and how a bounded
// candidate envelope is assembled from indexed graph reads.
import type { QueryOpts, Row, WorkBlockerSet } from './client.ts'
import { type Dep, idOf, settled, statusOf } from './types.ts'

export type WorkLane = 'evaluate' | 'build'

export type WorkRead = {
  query: (
    filters: string[],
    opts?: QueryOpts,
  ) => Promise<Row[]>
  get: (ids: string[]) => Promise<Row[]>
  deps: (eids: string[]) => Promise<Dep[]>
  blockers: (eids: string[], limit: number) => Promise<WorkBlockerSet[]>
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
  authorization?: {
    kind: 'direct' | 'inherited'
    from: string[]
    truncated: boolean
  }
  claim: string | null
  blocked: string | null
  blockers: {
    items: {
      id: string
      title: string
      status: string
      claim: string | null
    }[]
    truncated: boolean
  }
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
      if (!row || pending(row) || declined(row)) continue
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
export let WORK_REFS_LIMIT = 20

export let workFilters = (lane: WorkLane, recursive = false) =>
  lane == 'evaluate' ? ['.proposed!', '.decided='] : [
    '.kind=task',
    '.status=open',
    ...recursive ? [] : ['.decided!'],
    '.claim=',
    '.blocked=',
  ]

// Only the ancestry of selected candidates is needed to explain inherited
// authorization. Walk requires child→parent through indexed incident reads;
// pending, declined, and unknown rows are boundaries. Direct outgoing requires
// are retained too, and every one is hydrated for the pure readiness recheck.
let buildContext = async (
  read: WorkRead,
  seeds: Row[],
  recursive: boolean,
) => {
  let by = new Map(seeds.map((r) => [r.eid, r]))
  let edges = new Map<string, Dep>()
  let seed = new Set(seeds.map((r) => r.eid))
  let frontier = seeds.map((r) => r.eid)
  let walked = new Set<string>()
  while (frontier.length) {
    frontier = frontier.filter((eid) => {
      let row = by.get(eid)
      return !walked.has(eid) && !!row && !pending(row) && !declined(row)
    })
    if (!frontier.length) break
    frontier.forEach((eid) => walked.add(eid))
    let found = (await read.deps(frontier)).filter((d) => d.type == 'requires')
    let active = new Set(frontier)
    let kept = found.filter((d) =>
      seed.has(d.parent) || (recursive && active.has(d.child))
    )
    for (let d of kept) edges.set(`${d.type}\0${d.parent}\0${d.child}`, d)
    let ids = [...new Set(kept.flatMap((d) => [d.parent, d.child]))]
      .filter((eid) => !by.has(eid))
    let rows = await read.get(ids)
    for (let r of rows) by.set(r.eid, r)
    frontier = recursive
      ? kept.filter((d) => active.has(d.child)).map((d) => d.parent)
      : []
  }
  return { by, deps: [...edges.values()] }
}

// Candidate discovery is a bounded indexed query. Build readiness, recursive
// authorization, filters, and priority/newest order settle in the database
// before LIMIT; this pure layer rechecks the same predicate and assembles the
// human-addressed envelope from keyed rows. No recent-window approximation or
// whole-graph snapshot rides this path.
export let workCandidates = async (
  read: WorkRead,
  lane: WorkLane,
  opts: { filters?: string[]; limit?: number; recursive?: boolean } = {},
): Promise<WorkCandidate[]> => {
  let limit = Math.max(1, Math.min(opts.limit ?? LIMIT, 100))
  let base = workFilters(lane, opts.recursive)
  let hits = await read.query([...base, ...opts.filters ?? []], {
    limit,
    ...(lane == 'build'
      ? { work: 'build' as const, recursive: !!opts.recursive }
      : {}),
  })
  let expanded = lane == 'build'
    ? await buildContext(read, hits, !!opts.recursive)
    : { by: new Map(hits.map((r) => [r.eid, r])), deps: [] }
  let blockerSets = lane == 'evaluate'
    ? await read.blockers(hits.map((r) => r.eid), WORK_REFS_LIMIT)
    : hits.map((r) => ({ parent: r.eid, items: [], truncated: false }))
  let blockerBy = new Map(blockerSets.map((set) => [set.parent, set]))
  for (let set of blockerSets) {
    for (let row of set.items) expanded.by.set(row.eid, row)
  }
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
  if (lane == 'evaluate') selected.sort((a, b) => b.num - a.num)
  return selected.slice(0, limit).map((r) => {
    let project = by.get(String(r.comps.task?.project ?? ''))
    let summary = blockerBy.get(r.eid) ?? {
      parent: r.eid,
      items: [],
      truncated: false,
    }
    let blockers = summary.items.map((blocker) => {
      let holder = by.get(String(blocker?.comps.claim?.session ?? ''))
      return {
        id: idOf(blocker),
        title: String(blocker?.comps.doc?.title ?? ''),
        status: statusOf(blocker.comps),
        claim: holder ? idOf(holder) : null,
      }
    })
    let roots = (approved(r) ? [r] : [...auth.get(r.eid) ?? []]
      .map((eid) => by.get(eid)).filter((x): x is Row => !!x))
      .sort((a, b) => b.num - a.num)
    let source = roots.slice(0, WORK_REFS_LIMIT)
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
      ...(source.length
        ? {
          authorization: {
            kind: approved(r) ? 'direct' as const : 'inherited' as const,
            from: source.map(idOf),
            truncated: roots.length > source.length,
          },
        }
        : {}),
      claim: holder ? idOf(holder) : null,
      blocked: text(r.comps.blocked?.on) ?? null,
      blockers: {
        items: blockers,
        truncated: summary.truncated,
      },
      ...(() => {
        let hint = execution(r, project, by)
        return hint ? { execution: hint } : {}
      })(),
    }
  })
}
