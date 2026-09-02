// The graph's work lanes: one pure readiness predicate shared by managed
// dispatch and external workers, plus a scoped candidate reader for humans and
// agents choosing work. Dispatch still owns spending, slots, providers, and
// retry policy; this module owns only whether work is eligible and how a bounded
// candidate envelope is assembled from indexed graph reads.
import type {
  QueryOpts,
  Row,
  VerificationProjection,
  WorkProjection,
} from './client.ts'
import { sentences } from './edge.ts'
import { leafOf, parseQuery, type Pred } from './query.ts'
import { type Dep, idOf, settled, statusOf } from './types.ts'

export type WorkLane = 'evaluate' | 'build' | 'verify'

// Work lanes are a public execution surface, never a moderation surface. A
// quarantine predicate normally opts a graph query into hidden rows; reject it
// here (including a far path leaf) so no worker transport can turn that reveal
// switch on accidentally or deliberately.
export let workPredicates = (preds: Pred[]) => {
  if (
    preds.some((p) =>
      p.comp == 'quarantined' || leafOf(p).comp == 'quarantined'
    )
  ) {
    throw new Error('work filters never reveal quarantined entities')
  }
  return preds
}

export type WorkRead = {
  query: (
    filters: string[],
    opts?: QueryOpts,
  ) => Promise<Row[]>
  get: (ids: string[]) => Promise<Row[]>
  candidates?: (
    lane: WorkLane,
    opts: WorkOptions,
  ) => Promise<WorkCandidate[]>
}

export type WorkOptions = {
  filters?: string[]
  limit?: number
  recursive?: boolean
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
  accept?: VerificationProjection['accept']
  completed?: VerificationProjection['completed']
  review?: VerificationProjection['review']
  verifier?: VerificationProjection['verifier']
}

// A direct approval is the decided facet unless its explicit verdict says no.
// Rows written before verdict existed remain approved, as dispatch has always
// read them.
export let approved = (r: Row) =>
  !!r.comps.decided && r.comps.decided.verdict != 'declined'

export let pending = (r: Row) => !!r.comps.proposed && !r.comps.decided
export let declined = (r: Row) => r.comps.decided?.verdict == 'declined'

let open = (r?: Row) =>
  !!r?.comps.task && !r.comps.quarantined && statusOf(r.comps) == 'open'

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

// The SQL half of buildReady(). Query selection and the writer's guarded
// claim both compose these fragments, so discovering work and taking it cannot
// drift. The candidate CTE always has (origin, entity); recursive callers add
// lineage + approved_root, while a direct-only caller needs neither.
export let workLineageSql = (seed: string) =>
  `lineage(origin, entity) as (
     select origin, entity from ${seed}
     union
     select lineage.origin, dependency.parent
       from lineage
       join entity current on current.id = lineage.entity
       left join tombstone current_dead on current_dead.entity = current.id
       left join proposed on proposed.entity = current.id
       left join decided choice on choice.entity = current.id
       left join quarantined hidden on hidden.entity = current.id
       join (${sentences('requires')}) dependency
         on dependency.child = current.id
       join entity parent on parent.id = dependency.parent
       left join tombstone parent_dead on parent_dead.entity = parent.id
      where not (proposed.entity is not null and choice.entity is null)
        and coalesce(choice.verdict, '') != 'declined'
        and hidden.entity is null
        and current_dead.entity is null
        and parent_dead.entity is null
   )`

export let workRootsSql = `approved_root(entity, num) as (
  select root.id, root.num
    from entity root
    join task root_task on root_task.entity = root.id
    join decided approval on approval.entity = root.id
    left join completed on completed.entity = root.id
    left join cancelled on cancelled.entity = root.id
    left join claim on claim.entity = root.id
    left join quarantined on quarantined.entity = root.id
    left join tombstone root_dead on root_dead.entity = root.id
   where coalesce(approval.verdict, 'approved') != 'declined'
     and completed.entity is null
     and cancelled.entity is null
     and claim.entity is null
     and quarantined.entity is null
     and root_dead.entity is null
)`

export let workAuthorizationSql = (recursive: boolean) =>
  recursive
    ? `exists (
         select 1
           from lineage l
           join approved_root root on root.entity = l.entity
          where l.origin = entity.id
       )`
    : `choice.entity is not null and
       coalesce(choice.verdict, 'approved') != 'declined'`

export let workReadyJoinsSql = `
         join task on task.entity = entity.id
         left join proposed on proposed.entity = entity.id
         left join decided choice on choice.entity = entity.id
         left join completed on completed.entity = entity.id
         left join cancelled on cancelled.entity = entity.id
         left join claim on claim.entity = entity.id
         left join blocked on blocked.entity = entity.id
         left join quarantined on quarantined.entity = entity.id
         left join tombstone dead on dead.entity = entity.id`

export let workReadyWhereSql = (authorization: string) => `
          completed.entity is null
          and cancelled.entity is null
          and claim.entity is null
          and blocked.entity is null
          and quarantined.entity is null
          and dead.entity is null
          and not (
            proposed.entity is not null and choice.entity is null
          )
          and coalesce(choice.verdict, '') != 'declined'
          and not exists (
            select 1
              from (${sentences('requires')}) needed
              left join entity endpoint on endpoint.id = needed.child
              left join tombstone endpoint_dead on endpoint_dead.entity = endpoint.id
              left join completed endpoint_completed
                on endpoint_completed.entity = endpoint.id
              left join cancelled endpoint_cancelled
                on endpoint_cancelled.entity = endpoint.id
             where needed.parent = entity.id
               and (
                 endpoint.id is null
                 or endpoint_dead.entity is not null
                 or (
                   endpoint_completed.entity is null
                   and endpoint_cancelled.entity is null
                 )
               )
          )
          and (${authorization})`

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
  lane == 'evaluate'
    ? ['.proposed!', '.decided=']
    : lane == 'verify'
    ? ['.kind=task']
    : [
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
  opts: WorkOptions = {},
): Promise<WorkCandidate[]> => {
  let limit = Math.max(1, Math.min(opts.limit ?? LIMIT, 100))
  let base = workFilters(lane, opts.recursive)
  let filters = [...base, ...opts.filters ?? []]
  workPredicates(parseQuery(filters.join('&')))
  if (read.candidates) {
    return read.candidates(lane, { ...opts, limit })
  }
  let hits = await read.query(filters, {
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
  // Work envelopes may name a reference, but they never reveal a quarantined
  // reference's identity or content. Membership already excludes quarantined
  // candidates in the database; this closes the same boundary around the
  // bounded project/claim/persona hydration.
  let by = new Map(
    all.filter((r) => !r.comps.quarantined).map((r) => [r.eid, r]),
  )
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
      ...(projection?.verification
        ? {
          accept: projection.verification.accept,
          completed: projection.verification.completed,
          ...(projection.verification.review
            ? { review: projection.verification.review }
            : {}),
          ...(projection.verification.verifier
            ? { verifier: projection.verification.verifier }
            : {}),
        }
        : {}),
      ...(() => {
        let hint = execution(r, project, by)
        return hint ? { execution: hint } : {}
      })(),
    }
  })
}
