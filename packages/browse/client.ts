// The headless client half — what the CLI and the MCP server share. Talks
// to a running tasks server over HTTP (/query to read, /apply
// to write; writes broadcast to every live client), assembles entities
// the same way live.ts does, and owns the dot-param grammar:
// `.doc.title=Hello` sets doc.title; a property is always named with its
// component. Values that look like numbers become numbers.
import { IdError } from './types.ts'
import { ownsSessionBranch } from './session_worktree.ts'
import {
  byName,
  type Change,
  comps,
  deaths,
  type Hit,
  kindOf,
  shapeOf,
  stamped,
  statusOf,
  uuid,
  vocab,
} from './types.ts'
import { aliasOf, idOf, shortHex } from './types.ts'
import { fieldOp, parseProp, propAt, refOf } from './props.ts'
import { nearest, offer } from './near.ts'
import { catalog, type Provider, spawnDefault } from './providers.ts'
export { idOf }

export type Row = {
  eid: string
  num: number
  kind: string
  comps: Record<string, Record<string, unknown>>
}

// Task status is DERIVED (D-24102): read it off the comps a row carries. A
// non-task row has no task comp, so this stays undefined the way `.task?.status`
// did — every caller that guarded on truthiness keeps its meaning.
export let taskStatus = (r: { comps: Record<string, unknown> }) =>
  r.comps.task ? statusOf(r.comps) : undefined

// The changes a UI picker sends to set a task to a chosen DERIVED status
// (D-24102): each move retracts conflicting facets before minting its own, so
// cancelled→done and done→wip are real transitions rather than precedence
// accidents. wip is a live claim; open retracts that lease too.
export let statusChanges = (
  eid: string,
  status: string,
  session?: string,
): Change[] =>
  status == 'done'
    ? [
      { eid, name: 'cancelled', comp: null },
      { eid, name: 'completed', comp: {} },
    ]
    : status == 'cancelled'
    ? [
      { eid, name: 'completed', comp: null },
      { eid, name: 'cancelled', comp: {} },
    ]
    : status == 'wip' && session
    ? [
      { eid, name: 'completed', comp: null },
      { eid, name: 'cancelled', comp: null },
      { eid, name: 'claim', comp: { session } },
    ]
    : [
      { eid, name: 'completed', comp: null },
      { eid, name: 'cancelled', comp: null },
      { eid, name: 'claim', comp: null },
    ]

export let rowOf = (r: Record<string, unknown>): Row => {
  let { kind, ...comps } = r
  let entity = comps.entity as Record<string, unknown>
  return {
    eid: String(entity.eid),
    num: Number(entity.num ?? 0),
    kind: kind ? String(kind) : kindOf(comps),
    comps: comps as Row['comps'],
  }
}

// The graph as rows: one per entity, components merged in; kind derived.
// Quarantine is absent unless the caller takes the explicit reveal branch.
export let rows = ({ changes }: { changes: Change[] }, quarantined = false) => {
  let out = new Map<string, Row>()
  for (let { eid, name, comp } of changes) {
    if (!comp) continue
    let row = out.get(eid)
    if (!row) {
      row = { eid, num: 0, kind: 'entity', comps: {} }
      out.set(eid, row)
    }
    if (name == 'entity') {
      if ('num' in comp) row.num = Number(comp.num ?? 0)
      // A presence transition echoes only the derived archetype pointer.
      // Keep the identity stamped earlier in the same batch.
      row.comps.entity = { ...row.comps.entity, ...comp }
    } else row.comps[name] = comp
  }
  for (let r of out.values()) r.kind = kindOf(r.comps)
  let rows = [...out.values()]
  return quarantined ? rows : rows.filter((r) => !r.comps.quarantined)
}

// One row per eid, oldest first — a snapshot walks the entity table in num
// order, so a set stitched from several queries answers in that same order.
export let uniq = (all: Row[]) =>
  [...new Map(all.map((r) => [r.eid, r])).values()]
    .sort((a, b) => a.num - b.num)

export let hitOf = (r: Row): Hit => {
  let rank = r.comps.rank ?? {}
  return {
    eid: r.eid,
    num: r.num,
    kind: r.kind,
    title: String(rank.title ?? r.comps.doc?.title ?? ''),
    title_hit: String(rank.title_hit ?? r.comps.doc?.title ?? ''),
    snip: String(rank.snip ?? ''),
    score: Number(rank.score ?? 0),
    open: String(rank.open ?? r.eid),
    ...(rank.open_id ? { open_id: String(rank.open_id) } : {}),
    ...(rank.retired ? { retired: true } : {}),
  }
}

// The pipe, as a seam. Reading is sync because inflate is, and `taken`
// rides the seam because consumability is a fact about the resource, not
// about the caller — every door that asks for stdin in one command asks
// the same object, so the second ask can be refused instead of served an
// empty string. `taken` holds the TOKEN that drank it, not the prop: the
// refusal names a door the caller can recognize, whichever spelling they
// reached for.
export type Stdin = {
  terminal: () => boolean
  read: () => string
  taken?: string
}

// ---- dot-params (the WRITE grammar: values are literal; the filter
// grammar with operators/lists/ranges lives in query.ts) ----

export type Param = { comp: string; prop: string; value: unknown }
export type ComponentPatches = Record<
  string,
  Record<string, unknown> | null
>

// '.doc.title=Hello' → {comp, prop, value}; null if the argument isn't a
// dot-param at all (a bare word). A property is named with its component, as
// in a query: '.filed.assignee=jeff' patches filed.assignee and derefParams
// turns the value into an eid at the door. A name alone is a component, and a
// property named alone is refused with the forms that name it (@yaks/vocab
// `aim`).
// A hyphen is admitted into the NAME so a hyphenated spelling reaches
// aim() and earns the same `unknown prop` error as any other unknown.
// No column is hyphenated, so nothing new routes — but before this, a
// name the pattern rejected returned null, and cli.ts's split() files
// every non-param token under `words`: `.blocked-by=T-1` became part of
// a task's TITLE. Silence, not an edge and not an error.
// `read` is the door's value convention (inflate, where there's a filesystem)
// and it runs HERE, before the value is READ: `.doc.body=@edit.json` routes a
// $edit operator exactly as `--body=@edit.json` does. Applied after param()
// it only ever saw an already-parsed value, so the file's text landed as prose.
export let param = (
  arg: string,
  read: (p: Param) => Param = (p) => p,
): Param | null => {
  let m = arg.match(/^\.([A-Za-z_-]+)(?:\.([A-Za-z_-]+))?=(.*)$/s)
  if (!m) return null
  let [, a, b, raw] = m
  let p: Param
  if (b) {
    if (!(b in (comps[a] ?? {}))) {
      // The same teaching the query door gives: a refusal names the
      // component's columns and their types.
      throw new Error(
        `no such prop: .${a}.${b}${
          comps[a]
            ? ` — ${shapeOf(a, Object.keys(comps[a]), (col) => comps[a][col])}`
            : ''
        }`,
      )
    }
    p = { comp: a, prop: b, value: raw }
  } else {
    p = { ...vocab.aim(a)[0], value: raw }
  }
  if (!p.prop) {
    // A component name is a presence mark, not a column. Column-bearing marks
    // keep their explicit write spelling; stamped-only marks stay protected.
    // A genuinely empty writable component speaks Boolean presence so the
    // same dot-param compiler can add ({}) or remove (null) it at every door.
    let cols = Object.keys(comps[p.comp] ?? {})
    if (cols.length) {
      throw new Error(
        `.${p.comp} is a mark — write it as .${p.comp}.${
          cols[0]
        }=<value> (e.g. .${p.comp}.${cols[0]}=now)`,
      )
    }
    if (Object.keys(stamped[p.comp] ?? {}).length) {
      throw new Error(
        `.${p.comp} is a server-stamped mark; it isn't set through a dot-param`,
      )
    }
    let present = parseProp(
      { comp: p.comp, prop: '', name: p.comp, type: 'bool' },
      raw,
    )
    return { ...p, value: !!present }
  }
  // The @file / @- doors first: what the door reads is what gets read below.
  let val = String(read({ ...p, value: raw }).value)
  // A `$`-sigil object value is a field OPERATOR, not a literal — the same
  // value graph_apply takes as a comp value, so the update doors speak the one
  // operator too. It rides through untouched (no scalar parse, no deref) for
  // apply() to resolve against the CURRENT stored value; apply() also owns
  // every refusal — an unknown `$op`, a non-text column, a hunk that misses.
  let op = fieldOp(val)
  if (op) return { ...p, value: op }
  let declared = propAt(p.comp, p.prop)!
  p.value = typeof declared.type == 'object' && 'eid' in declared.type
    ? val
    : parseProp(declared, val)
  return p
}

// Reference values at a door: uuids pass through, '' clears, anything
// else must resolve — an alias (jeff), a human id (T-3), a bare num — or
// the door throws, never a silent FK failure later. One resolver for
// every write door (CLI, MCP task_new/update/command, graph_apply).
export let UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The near match, offered only once the handle it prints RESOLVES here —
// find() is the same reading of "what names an entity" the caller just
// failed, so a suggestion can never route somewhere the retry won't.
// `comp` narrows to the reference's declared target, so a bad
// `.filed.project=` is only ever answered with a project.
//
// A title is MATCHED only for the kinds it names (types.ts byName), though
// every title still shows. Untargeted, the pool is the whole graph and a
// common word opens somebody's ticket every time — `tasks` reached T-801
// ("Tasks: add cancelled state…") ahead of the project called Task Graph.
// An alias always rides: it is a typed handle whatever wears it.
export let nearby = (all: Row[]) => (v: string, comp = '') => {
  let names = aliasNames(all)
  let hit = nearest(
    v,
    all.filter((r) => !comp || r.comps[comp]).map((r) => ({
      eid: r.eid,
      id: idOf(r),
      alias: names.get(r.eid),
      title: r.comps.doc?.title as string | undefined,
      named: byName.has(r.kind),
    })),
  )
  if (!hit) return
  return find(all, hit.alias ?? hit.id)?.eid == hit.eid ? offer(hit) : undefined
}
// find(), where a miss is the door's error. One message for every lookup,
// so a mistyped handle teaches at whichever door heard it.
export let need = (all: Row[], id: string, where = '', comp = '') => {
  let hit = find(all, id)
  if (hit) return hit
  let near = nearby(all)(id, comp)
  throw new Error(
    `no entity: ${id}${where}${near ? ` — did you mean ${near}?` : ''}`,
  )
}

// The collateral of a delete: the entities the host tombstones ALONGSIDE
// the target, because they exist ABOUT it — comments aimed at it, cards and
// knocks/wakes viewing it — walked transitively down the same
// `deaths('cascade')` worklist the reaper uses, so a delete guard names
// exactly what the wire would take. The target itself is never in the list:
// it's the thing you asked to delete; this is what rides along.
//
// Two doors read this: a PURE pass over rows already in hand (the palette
// verb, which is wire-free), and an async pass that QUERIES the live graph
// (the CLI, whose reader diet is bounded and so can't see every comment on an
// arbitrary target). Same closure, two sources.
export let cascade = (all: Row[], eid: string): Row[] => {
  let aimed = deaths('cascade')
  let doomed = [eid]
  for (let i = 0; i < doomed.length; i++) {
    for (let [comp, col] of aimed) {
      for (let r of all) {
        if (r.comps[comp]?.[col] == doomed[i] && !doomed.includes(r.eid)) {
          doomed.push(r.eid)
        }
      }
    }
  }
  return doomed.slice(1).flatMap((d) => all.find((r) => r.eid == d) ?? [])
}

export let deref = (all: Row[], v: string, where = '', comp = '') =>
  !v || UUID.test(v) ? v : need(all, v, where, comp).eid
// Deref a change batch through a resolver — one core, two sources. `resolve`
// turns a human id (or an eid) into the eid it names, throwing the door's
// error on a miss; a uuid/empty passes through untouched (its callers own that
// short-circuit). rows-backed derefChanges reads a materialized Row[]; the
// db-backed command executor hands a resolver keyed off the live graph, so a
// verb's output resolves its refs without a whole-graph corpus (M-21143).
export let derefWith = (
  resolve: (v: string, where?: string, comp?: string) => string,
  changes: Change[],
) =>
  changes.map((c) => ({
    ...c,
    eid: resolve(c.eid, ' (eid)'),
    comp: c.comp == null ? c.comp : Object.fromEntries(
      Object.entries(c.comp).map(([prop, value]) => {
        let target = refOf(c.name, prop)
        return [
          prop,
          target != null &&
            (typeof value == 'string' || typeof value == 'number')
            ? resolve(String(value), ` (.${prop})`, target)
            : value,
        ]
      }),
    ),
  }))

export let derefChanges = (all: Row[], changes: Change[]) =>
  derefWith((v, where, comp) => deref(all, v, where, comp), changes)

// Group routed params into per-component patches.
export let patches = (params: Param[]): ComponentPatches => {
  let out: ComponentPatches = {}
  for (let { comp, prop, value } of params) {
    if (!prop) {
      out[comp] = value ? {} : null
      continue
    }
    ;(out[comp] ??= {})[prop] = value
  }
  return out
}

// A task, TYPED: 'P1 .filed.domain=Eng Build a thing\nnotes…' — the first line
// is setters + title, every later line is body. Dot-params parse
// anywhere in the line (their syntax can't be prose); the P1 shorthand
// only parses while it LEADS, so a title like 'Fix the P2 endpoint'
// keeps its words. One parser for every door that takes a typed task —
// the board's quick-add, :new, whatever comes next. A malformed
// dot-param stays a word rather than throwing: mid-typing is not an
// error, and Enter files what the preview showed. `read` is the door's
// value convention (inflate, where there's a filesystem) — it runs
// OUTSIDE the not-a-param catch, so a missing @file is an error and
// never a word swallowed into the title.
export let spec = (text: string, read: (p: Param) => Param = (p) => p) => {
  let [line, ...rest] = text.split('\n')
  let words: string[] = []
  let ps: Param[] = []
  let leading = true
  for (let w of line.trim().split(/\s+/).filter(Boolean)) {
    let priority = leading &&
      /^[Pp][+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(w)
    if (priority) {
      ps.push(param(`.filed.priority=${w}`)!)
      continue
    }
    if (w.startsWith('.')) {
      let d: Param | null = null
      try {
        d = param(w)
      } catch { /* not a real prop: a word after all */ }
      // A param, so parse it again through the door's value convention —
      // OUTSIDE the catch, so a missing @file is an error and never a word
      // swallowed into the title.
      if (d) {
        ps.push(param(w, read)!)
        continue
      }
    }
    leading = false
    words.push(w)
  }
  return {
    title: words.join(' '),
    body: rest.join('\n').trim(),
    grouped: patches(ps),
  }
}

// The standard task-create batch: a doc face, workflow state, then any
// other grouped components verbatim. Callers put title/body into
// grouped.doc first.
export let taskChanges = (
  eid: string,
  grouped: ComponentPatches,
  number = false,
): Change[] => [
  {
    eid,
    name: 'doc',
    comp: { body: '', ...(grouped.doc ?? {}) },
    ...(number ? { $num: true } : {}),
  },
  // A new task is born open — no mark (D-24102). status is derived, not
  // writable, so drop any that rode in on the spec (`.task.status=` on new).
  {
    eid,
    name: 'task',
    comp: (({ status: _drop, ...task }) => task)(grouped.task ?? {}),
  },
  ...Object.entries(grouped)
    .filter(([n]) => n != 'doc' && n != 'task')
    .map(([name, comp]) => ({ eid, name, comp })),
]

// Each entity's alias among these rows, from the alias keys that name it.
export let aliasNames = (all: Row[]) =>
  new Map(all.flatMap((r) => {
    let a = aliasOf(r.comps)
    return a ? [[a.eid, a.name] as const] : []
  }))

// Resolve 'T-3' / a bare num / a full eid / a SHORT-eid handle / an alias to a
// row among these. Num first, then exact eid, then a sigilled hex prefix
// (unique or it throws), then an alias key's name.
export let find = (all: Row[], id: string) => {
  let m = id.match(/^[A-Za-z]+-(\d+)$/) ?? id.match(/^(\d+)$/)
  if (m) return all.find((r) => r.num == +m![1])
  let exact = all.find((r) => r.eid == id.toLowerCase())
  if (exact) return exact
  let hex = shortHex(id)
  if (hex) {
    let hits = all.filter((r) => r.eid.replaceAll('-', '').startsWith(hex))
    if (hits.length > 1) {
      throw new IdError(
        `${id} is an ambiguous id — matches ${
          hits.map((r) => `${idOf(r)} (${r.eid})`).join(', ')
        }; use more characters`,
      )
    }
    return hits[0]
  }
  if (id.includes('#')) {
    throw new IdError(`${id}: expected # followed by 6–64 hex characters`)
  }
  let named = all.map((r) => aliasOf(r.comps)).find((a) => a?.name == id)
  return named && all.find((r) => r.eid == named.eid)
}

// A spawn as @yaks/spawn writes it (packages/spawn/tools.ts session_spawn):
// the session, its first entry carrying the instruction and the `using` it
// runs on, and the claim on the task it works. The host reads the entry and
// starts the run; anything it cannot honor shows on the session itself.
export let sessionFrames = (
  session: string,
  body: string,
  using: { provider: string; model?: string; effort?: string },
  opening: { operator: boolean; task?: string },
): Change[] => {
  let { operator, task } = opening
  let entry = uuid()
  return [
    { eid: session, name: 'session', comp: { operator } },
    { eid: entry, name: 'entry', comp: { session } },
    { eid: entry, name: 'content', comp: { body } },
    { eid: entry, name: 'using', comp: using },
    ...(task ? [{ eid: task, name: 'claim', comp: { session } }] : []),
  ]
}

// Find-or-mint the session entity for an external session id: its eid
// plus the change that creates or refreshes it. cwd is where it runs; pid
// is the provider process it runs IN (the SessionStart hook walks /proc for
// it) — liveness for every provider, and the anchor that lets Claude's
// channel follow a /clear rotation under the same process.
export let sessionFor = (
  all: Row[],
  session: string,
  cwd?: string,
  pid?: number,
  self?: {
    agent_type?: string
    source?: string
    transcript?: string
    operator?: boolean
    actor?: string
    pane?: string | null
    turn?: string
    role?: string
    parent?: string
  },
) => {
  let s = all.find((r) => r.comps.session && r.comps.session.id == session)
  let eid = s?.eid ?? uuid()
  let comp: Record<string, unknown> = s ? {} : { id: session }
  // A swept branch is still ours to regrow. Hooks
  // may refresh a provider pid, but never relocate a tree the server cut.
  let tree = s?.comps.worktree
  let owned = s?.comps.session.origin == 'managed' && tree &&
    ownsSessionBranch(s.eid, tree.branch, s.num)
  if (cwd && !owned && s?.comps.session.cwd != cwd) comp.cwd = cwd
  if (pid && s?.comps.session.pid != pid) comp.pid = pid
  for (let k of ['agent_type', 'source', 'transcript', 'turn'] as const) {
    if (self?.[k] && s?.comps.session[k] != self[k]) comp[k] = self[k]
  }
  if (self?.role && s?.comps.session.role != self.role) {
    comp.role = self.role
  }
  if (self?.pane !== undefined && s?.comps.session.pane != self.pane) {
    comp.pane = self.pane
  }
  if (
    self?.operator != undefined &&
    (s?.comps.session.operator == null ||
      !!s.comps.session.operator != self.operator)
  ) {
    comp.operator = Number(self.operator)
  }
  // A tool-only session has no cwd to place it. Its first task interaction
  // anchors it to that venture; an identity it already wears always wins.
  if (self?.actor && !s?.comps.session.actor) {
    comp.actor = self.actor
  }
  // Who spawned this run — set once, at birth: lineage is history, not a
  // field a later reify should relabel.
  if (self?.parent && !s?.comps.session.parent) {
    comp.parent = self.parent
  }
  let changes: Change[] = Object.keys(comp).length
    ? [{ eid, name: 'session', comp }]
    : []
  return { eid, changes }
}

let taskActor = (all: Row[], target: string) =>
  String(all.find((r) => r.eid == target)?.comps.filed?.project ?? '') ||
  undefined

// The claim pointing at a session entity — one batch, atomic on the server.
// Set or clear this actor's standing instruction about one entity. A
// subscription needs its own entity because MANY actors subscribe to one
// target — unlike a claim, which is a comp on the task itself. Reusing
// the existing row's eid is what makes saying it twice idempotent, and
// what makes watch→mute a change of mind rather than a second opinion.
export let subChanges = (
  all: Row[],
  actor: string,
  target: string,
  mode: 'watch' | 'mute' | null,
): Change[] => {
  let had = all.find((r) =>
    r.comps.subscription &&
    String(r.comps.subscription.actor) == actor &&
    String(r.comps.subscription.target) == target
  )
  if (!mode) {
    return had ? [{ eid: had.eid, name: 'entity', comp: null }] : []
  }
  return [{
    eid: had?.eid ?? uuid(),
    name: 'subscription',
    comp: { actor: actor, target: target, mode },
  }]
}

// One launch spec: a provider and model by name, and an effort.
export type SpawnAsk = {
  provider?: string
  model?: string
  effort?: string
}

// THE precedence every spawn door shares, so the browser and the TUI never
// resolve a launch differently: the explicit ask (a :fix dot-param, the Run
// form), then the provider table's own default, model→provider inference and
// readiness both. An explicit model without a provider leaves the transport
// to readiness. Effort falls to the chosen model's own default, then medium
// when the model has the axis at all.
export let spawnPlan = (
  ps: Provider[],
  ask: SpawnAsk = {},
  blocked?: (name: string) => boolean,
): SpawnAsk => {
  let d = spawnDefault(ps, ask, blocked)
  let provider = ask.provider ?? d.provider
  let model = ask.model ?? d.model
  let axis = catalog(ps).find((p) => p.model == model)?.efforts ?? []
  return {
    provider,
    model,
    effort: ask.effort ??
      (model
        ? ps.find((p) => p.name == provider)?.defaults?.[model]
        : undefined) ??
      (axis.length
        ? (axis.includes('medium') ? 'medium' : axis[0])
        : undefined),
  }
}

// A comment: a doc aimed at the target. The session reification lets the
// server stamp its instrument; `event` marks machinery speaking (M-4062)
// so the mail relay skips it. A verdict adds review judgment to the same
// entity — rationale, aim, and authorship stay the comment's.
export let commentChanges = (
  all: Row[],
  target: string,
  body: string,
  session?: string,
  mark: { verdict?: string } = {},
): Change[] => {
  let s = session
    ? sessionFor(all, session, undefined, undefined, {
      actor: taskActor(all, target),
    })
    : undefined
  let eid = uuid()
  return [
    ...(s?.changes ?? []),
    { eid, name: 'doc', comp: { title: '', body } },
    {
      eid,
      name: 'comment',
      comp: { target: target },
    },
    ...(mark.verdict == null
      ? []
      : [{ eid, name: 'review', comp: { verdict: mark.verdict } }]),
  ]
}

// A commit message's first line — what a compact row shows of it.
export let subject = (message: unknown) => String(message ?? '').split('\n')[0]

// The send batch: a mail is a document that travels — subject rides
// doc.title, the body doc.body, and WHERE it goes the shared `deliver {to}`.
// `to` stays AS GIVEN (a raw address or a graph reference) — a graph
// reference resolves at the door, a raw @-address is find-or-minted into its
// address-book entity there, never here.
export let mailChanges = (m: {
  to: string
  subject: string
  body?: string
  replyTo?: string
}) => {
  let eid = uuid()
  let changes: Change[] = [
    { eid, name: 'doc', comp: { title: m.subject, body: m.body ?? '' } },
    { eid, name: 'deliver', comp: { to: m.to } },
    {
      eid,
      name: 'mail',
      comp: m.replyTo ? { reply_to: m.replyTo } : {},
    },
  ]
  return { eid, changes }
}

// Re: derivation — shed however many Re:/Fwd: layers already piled up.
export let reSubject = (s: string) =>
  `Re: ${s.replace(/^(\s*(re|fwd?):\s*)+/i, '').trim()}`

// The reply batch: answer goes to the far side — an inbound row's
// sender, your own sent row's recipient — subject prefilled Re: …, and
// reply_to records the thread at authoring (delivery resolves it).
// Whom a reply is FOR: the sender of a letter that arrived, the same
// recipient for one we sent. Never a fallback BETWEEN those two — the
// near miss is our own address (the one the letter was delivered to), so a
// reply that quietly goes to the wrong desk looks sent and isn't.
// An unsigned letter earns a refusal instead; mail it directly.
//
// Answering an arrival RETIRES it: the reply batch also stamps `archived`
// on the inbound row, so a thread we have already answered stops showing as
// unanswered and each session replied again (T-35950). A
// LATER inbound message on the thread is a distinct row with its own
// received_at and no archived stamp, so it re-surfaces on its own. Only an
// arrival is retired (message_id) — following up on our own sent letter
// never arrived here to begin with, so there is nothing to hide.
export let replyChanges = (row: Row, body: string) => {
  let m = row.comps.mail ?? {}
  // The far side: an arrival's sender (m.from), our own sent letter's
  // recipient (the shared deliver.to). Never a fallback between the two.
  let to = String((m.message_id ? m.from : row.comps.deliver?.to) ?? '')
  if (!to) {
    throw new Error(
      'cannot reply: that letter carries no sender — send a fresh mail',
    )
  }
  let made = mailChanges({
    to,
    subject: reSubject(String(row.comps.doc?.title ?? '')),
    body,
    replyTo: row.eid,
  })
  // Append (never insert): callers read made.changes[1] for the destination.
  if (m.message_id && !row.comps.archived) {
    made.changes.push({ eid: row.eid, name: 'archived', comp: {} })
  }
  return made
}

// The dream batch (T-12800): a venture's consolidation cursor plus the first
// cadence wake that starts it. `scope` is the project the dream combs; `floor`
// starts a week back so the first run has a window. The wake is UNTARGETED
// (deliver.to = the dream), so replaceWakes keeps one cadence clock and the
// server arms it on apply; its knock hooks dreamComb, which re-arms
// the next at each run's end. One dream per venture — a second on the same
// project is refused, so `task dream` is safe to run twice.
export let dreamChanges = (
  all: Row[],
  d: { project: string; floor?: string },
) => {
  let project = find(all, d.project)
  if (!project?.comps.project) throw new Error(`not a project: ${d.project}`)
  let had = all.find((r) => r.comps.dream?.scope == project.eid)
  if (had) throw new Error(`${idOf(had)} already dreams ${idOf(project)}`)
  let eid = uuid()
  let w = uuid()
  let floor = d.floor ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
  let changes: Change[] = [
    { eid, name: 'dream', comp: { scope: project.eid, floor } },
    {
      eid: w,
      name: 'wake',
      comp: { at: new Date(Date.now() + 1000).toISOString() },
    },
    { eid: w, name: 'deliver', comp: { to: eid } },
  ]
  return { eid, changes }
}
