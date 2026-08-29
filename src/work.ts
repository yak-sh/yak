// The graph's work lanes: one pure readiness predicate shared by managed
// dispatch and external workers, plus a scoped candidate reader for humans and
// agents choosing work. Dispatch still owns spending, slots, providers, and
// retry policy; this module owns only whether work is eligible and how a bounded
// candidate envelope is assembled from indexed graph reads.
import type { QueryOpts, Row, WorkProjection } from './client.ts'
import { type Dep, idOf, settled, statusOf } from './types.ts'

export type WorkLane = 'evaluate' | 'build'

export type WorkRead = {
  query: (
    filters: string[],
    opts?: QueryOpts,
  ) => Promise<Row[]>
  get: (ids: string[]) => Promise<Row[]>
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
  for (
    let root of all.filter((r) =>
      open(r) && approved(r) && !r.comps.quarantined
    )
  ) {
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
      if (!row || row.comps.quarantined || pending(row) || declined(row)) {
        continue
      }
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
  let persona = spawn?.persona ? named.get(String(spawn.persona)) : undefined
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
          ...(persona ? { persona: idOf(persona) } : {}),
        },
      }
      : {}),
  }
  return Object.keys(out).length ? out : undefined
}

let LIMIT = 20

export let workFilters = (lane: WorkLane, recursive = false) =>
  lane == 'evaluate' ? ['.proposed!', '.decided='] : [
    '.kind=task',
    '.status=open',
    ...recursive ? [] : ['.decided!'],
    '.claim=',
    '.blocked=',
  ]

// Candidate discovery is a bounded indexed query. Build readiness, recursive
// authorization, filters, and priority/newest order settle in the database
// before LIMIT and return bounded auth/blocker projections with each row. This
// layer only assembles the human-addressed envelope and its keyed project/spawn
// hints. No client traversal, recent-window approximation, or graph snapshot
// rides this path.
export let workCandidates = async (
  read: WorkRead,
  lane: WorkLane,
  opts: { filters?: string[]; limit?: number; recursive?: boolean } = {},
): Promise<WorkCandidate[]> => {
  let limit = Math.max(1, Math.min(opts.limit ?? LIMIT, 100))
  let base = workFilters(lane, opts.recursive)
  let hits = await read.query([...base, ...opts.filters ?? []], {
    limit,
    work: lane,
    recursive: !!opts.recursive,
  })
  let first = await read.get([
    ...hits.map((r) => String(r.comps.task?.project ?? '')).filter(Boolean),
    ...hits.map((r) => String(r.comps.claim?.session ?? '')).filter(Boolean),
    ...hits.map((r) => String(r.comps.spawn?.persona ?? '')).filter(Boolean),
  ])
  let all = [
    ...hits,
    ...first,
  ]
  let by = new Map(all.map((r) => [r.eid, r]))
  return hits.slice(0, limit).map((r) => {
    let project = by.get(String(r.comps.task?.project ?? ''))
    let projection = r.comps.work as unknown as WorkProjection | undefined
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
      ...(projection?.authorization
        ? { authorization: projection.authorization }
        : {}),
      claim: holder ? idOf(holder) : null,
      blocked: text(r.comps.blocked?.on) ?? null,
      blockers: projection?.blockers ?? { items: [], truncated: false },
      ...(() => {
        let hint = execution(r, project, by)
        return hint ? { execution: hint } : {}
      })(),
    }
  })
}
