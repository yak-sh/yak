// The headless client half — what the CLI and the MCP server share. Talks
// to a running tasks server over HTTP (/query to read, /apply
// to write; writes broadcast to every live client), assembles entities
// the same way live.ts does, and owns the dot-param grammar:
//   .title=Hello        routes by prop — title lives only in doc
//   .doc.title=Hello    the explicit spelling, for collisions (pin/camera
//                       geometry) or clarity
// Values that look like numbers become numbers.
import { IdError } from './types.ts'
import { ownsSessionBranch } from './session_worktree.ts'
import {
  byName,
  type Change,
  comps,
  deaths,
  type Dep,
  type Hit,
  kindOf,
  settled,
  shapeOf,
  type Snapshot,
  stamped,
  statuses,
  statusOf,
  uuid,
  verdictName,
} from './types.ts'
import { aliasOf, checkPrefix, idOf, shortId, shortParts } from './types.ts'
import { moves, typeOf } from './edge.ts'
import { fieldOp, parseProp, propAt, refOf } from './props.ts'
import { local } from './time.ts'
import { nearest, offer } from './near.ts'
import { matchQuery, parseQuery, type Pred } from './query.ts'
import { hot } from './warmth.ts'
import { route } from './route.ts'
import { catalog, type Provider, spawnDefault } from './providers.ts'
import { channelEvents, type Event as InboxEvent } from './channel.ts'
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

// The slice of a Row the scope predicates read — eid and comps, never num or
// kind. Widening belongs()/scopeFor()/repoAt() to this lets a server-side
// caller reuse the ONE scope truth over db.ts rowsOf() output (which carries no
// num/kind), instead of hand-rolling a second predicate that could drift.
export type Scoped = { eid: string; comps: Row['comps'] }

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

// The graph as changes — rows() read backwards. A row IS its components, so
// handing each back as the patch that would have minted it lets a selector
// written against the WIRE (channel.ts) read a set assembled from queries,
// not only a snapshot's own flat batch.
let changesOf = (all: Row[]): Change[] =>
  all.flatMap((r) =>
    Object.entries(r.comps).map(([name, comp]) => ({ eid: r.eid, name, comp }))
  )

// One row per eid, oldest first — a snapshot walks the entity table in num
// order, so a set stitched from several queries answers in that same order.
export let uniq = (all: Row[]) =>
  [...new Map(all.map((r) => [r.eid, r])).values()]
    .sort((a, b) => a.num - b.num)

// An entity's birth and its last touch, off the provenance components
// (T-6670): created.at is the birth; updated.at — absent until the first
// edit — else the birth is the last touch. '' when the component is absent.
export let bornAt = (r: Row) => String(r.comps.created?.at ?? '')
export let editedAt = (r: Row) =>
  String(r.comps.updated?.at ?? r.comps.created?.at ?? '')

type Face = { id: string; kind?: string; title?: string }

let faceOf = (all: Row[], eid: unknown): Face | undefined => {
  let r = all.find((r) => r.eid == String(eid))
  if (!r) return eid ? { id: String(eid) } : undefined
  let title = String(r.comps.doc?.title ?? '')
  return { id: idOf(r), kind: r.kind, ...(title ? { title } : {}) }
}

// A provenance instrument's identity, without its transcript or final text.
// This replaces a stamp's opaque via eid at agent-facing JSON doors.
let viaOf = (all: Row[], eid: unknown) => {
  let face = faceOf(all, eid)
  let row = all.find((r) => r.eid == String(eid))
  let s = row?.comps.session
  let persona = s?.persona ? faceOf(all, s.persona) : undefined
  return {
    ...face,
    ...(s?.provider ? { provider: s.provider } : {}),
    ...(s?.serving_model || s?.model
      ? { model: s.serving_model || s.model }
      : {}),
    ...(s?.effort ? { effort: s.effort } : {}),
    ...(persona ? { persona } : {}),
  }
}

// The compact face for task indexes and injected context. Detail remains in
// task_show, but a model must never mistake fleet-authored work for the
// owner's merely because the row was rendered on one line.
export let authoringLine = (all: Row[], row: Row) => {
  let face = (v: unknown) => {
    if (!v || typeof v != 'object') return ''
    let r: { id?: string; title?: string } = v
    return r?.title ? `${r.id} ${r.title}` : r?.id ?? ''
  }
  return ['created', 'proposed', 'decided'].flatMap((name) => {
    let stamp = row.comps[name]
    if (!stamp) return []
    let by = face(faceOf(all, stamp.by))
    let via = stamp.via ? viaOf(all, stamp.via) : undefined
    let viaFace = face(via)
    let agent = [via?.provider, via?.model, via?.effort]
      .filter(Boolean).join('/')
    let persona = face(via?.persona)
    let instrument = [agent, persona ? `persona ${persona}` : '']
      .filter(Boolean).join(', ')
    let source = by ? ` by ${by}` : ''
    if (viaFace && viaFace != by) source += ` via ${viaFace}`
    if (instrument) source += ` (${instrument})`
    return source ? [`${name}${source}`] : []
  }).join(' · ')
}
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

// An entity's slice of the journal — the wire's record, newest first.
export type JournalEntry = {
  id: number // the journal batch id (rowid), the handle `task undo` reverses
  ts: string
  actor: string | null
  via?: string | null
  changes: Change[]
}

// The session's day, told from the wire's own record — no model, no
// recollection, just the journal grouped into sentences. Pure: entries
// arrive newest-first (as the server serves them), `all` only humanizes
// ids; a dead endpoint falls back to a short eid rather than lying.
export let ledger = (entries: JournalEntry[], all: Row[]): string[] => {
  if (!entries.length) return []
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let cut = (s: unknown, n = 72) => {
    let t = String(s ?? '').split('\n')[0].trim()
    return t.length > n ? t.slice(0, n - 1) + '…' : t
  }
  let name = (eid: unknown) => {
    let r = byEid.get(String(eid))
    return r
      ? `${idOf(r)} ${cut(r.comps.doc?.title ?? r.comps.session?.id ?? '', 48)}`
        .trim()
      : shortId(String(eid))
  }
  let lines: string[] = []
  for (let e of [...entries].reverse()) { // oldest first: the day as lived
    let minted = new Set(
      e.changes.filter((c) => c.name == 'entity' && c.comp?.num != null)
        .map((c) => c.eid),
    )
    let seen = new Set<string>() // eids already said this batch
    for (let c of e.changes) {
      if (c.name == 'entity' && c.comp == null) {
        lines.push(`- × deleted ${name(c.eid)}`)
        seen.add(c.eid)
      }
    }
    for (let eid of minted) {
      if (seen.has(eid)) continue
      let comps = Object.fromEntries(
        e.changes.filter((c) => c.eid == eid && c.comp).map(
          (c) => [c.name, c.comp!],
        ),
      )
      if (comps.comment) {
        let first = cut(comps.doc?.body)
        let verdict = verdictName(comps.review?.verdict as string | undefined)
        lines.push(
          `- ${verdict ? '✓' : '💬'} on ${name(comps.comment.target)}${
            verdict ? ` · ${verdict}` : ''
          }${first ? `: ${first}` : ''}`,
        )
      } else {
        lines.push(
          `- + minted ${kindOf(comps)} ${name(eid)}`,
        )
      }
      seen.add(eid)
    }
    for (let { dep, gone } of moves(e.changes)) {
      lines.push(
        `- ∴ ${gone ? 'unlinked' : 'linked'} ${name(dep.parent)} ${dep.type} ${
          name(dep.child)
        }`,
      )
    }
    for (let c of e.changes) {
      if (seen.has(c.eid)) continue
      if (c.name == 'edge' || typeOf[c.name]) continue
      if (c.name == 'claim') {
        lines.push(
          c.comp == null
            ? `- ⚐ released ${name(c.eid)}`
            : `- ⚑ claimed ${name(c.eid)}`,
        )
        seen.add(c.eid)
      } else if (c.name == 'completed' || c.name == 'cancelled') {
        // Status is derived (D-24102): a close is the mark landing, a reopen its
        // removal. A same-batch reason comment tells the why on its own 💬 line.
        let word = c.comp == null
          ? 'reopened'
          : c.name == 'completed'
          ? 'done'
          : 'cancelled'
        lines.push(`- → ${name(c.eid)} ${word}`)
        seen.add(c.eid)
      } else if (c.comp && c.name != 'entity' && c.name != 'journal') {
        let cols = Object.keys(c.comp).filter((k) => k != 'eid').join(' ')
        lines.push(`- · ${c.name}{${cols}} on ${name(c.eid)}`)
        seen.add(c.eid)
      }
    }
  }
  let span = `${local(entries[entries.length - 1].ts)} → ${
    local(entries[0].ts)
  } · ${entries.length} batch(es)`
  return [span, '', ...lines]
}

// ---- dot-params (the WRITE grammar: values are literal; the filter
// grammar with operators/lists/ranges lives in query.ts) ----

export type Param = { comp: string; prop: string; value: unknown }
export type ComponentPatches = Record<
  string,
  Record<string, unknown> | null
>

// '.title=Hello' | '.doc.title=Hello' → {comp, prop, value}; null if the
// argument isn't a dot-param at all (a bare word). Bare props ride
// query.ts route(), so '.assignee=jeff' patches filed.assignee and
// derefParams turns the value into an eid at the door.
// A hyphen is admitted into the NAME so a hyphenated spelling reaches
// route() and earns the same `unknown prop` error as any other unknown.
// No column is hyphenated, so nothing new routes — but before this, a
// name the pattern rejected returned null, and cli.ts's split() files
// every non-param token under `words`: `.blocked-by=T-1` became part of
// a task's TITLE. Silence, not an edge and not an error.
// `read` is the door's value convention (inflate, where there's a filesystem)
// and it runs HERE, before the value is READ: `.body=@edit.json` routes a
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
      // The same teaching the graph doors give (db.ts admitted, query.ts
      // groupsOf): a refusal names the component's columns and their types.
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
    let r = route(a)
    // route()'s any-of ('' comp) serves FILTERS; a write must aim at one
    // component, so demand the explicit spelling.
    if (!r.comp) {
      let owners = Object.keys(comps).filter((c) => r.prop in comps[c])
      throw new Error(
        `.${a} is ambiguous for writes (${
          owners.join(', ')
        }) — use .comp.${r.prop}`,
      )
    }
    p = { ...r, value: raw }
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
// `comp` narrows to the reference's declared target, so a bad `.project=`
// is only ever answered with a project.
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

// The collateral of a delete: the entities db.ts apply() tombstones ALONGSIDE
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

// A task, TYPED: 'P1 .domain=Eng Build a thing\nnotes…' — the first line
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
      ps.push(param(`.priority=${w}`)!)
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
  // writable, so drop any that rode in on the spec (`.status=` on new).
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
  let fragment = shortParts(id)
  if (fragment) {
    let hits = all.filter((r) =>
      r.eid.replaceAll('-', '').startsWith(fragment.hex)
    )
    if (hits.length > 1) {
      throw new IdError(
        `${id} is an ambiguous id — matches ${
          hits.map((r) => `${idOf(r)} (${r.eid})`).join(', ')
        }; use more characters`,
      )
    }
    if (hits.length == 1) {
      checkPrefix(id, hits[0].kind)
      return hits[0]
    }
    return undefined
  }
  if (id.includes('#')) {
    throw new IdError(`${id}: expected [kind]# followed by 6–64 hex characters`)
  }
  let named = all.map((r) => aliasOf(r.comps)).find((a) => a?.name == id)
  return named && all.find((r) => r.eid == named.eid)
}

// The board sort: status column order, then priority, then num.
export let byBoard = (a: Row, b: Row) =>
  (statuses.findIndex((s) => s == taskStatus(a)) -
    statuses.findIndex((s) => s == taskStatus(b))) ||
  (Number(a.comps.filed?.priority ?? 0) -
    Number(b.comps.filed?.priority ?? 0)) ||
  (a.num - b.num)

// A spawn as @yaks/spawn writes it (packages/spawn/tools.ts session_spawn):
// the session, its first entry carrying the instruction and the `using` it
// runs on, and the claim on the task it works. The host reads the entry and
// starts the run; anything it cannot honor shows on the session itself.
export let spawnFrames = (
  session: string,
  body: string,
  using: { provider: string; model?: string; effort?: string },
  task?: string,
): Change[] => {
  let entry = uuid()
  return [
    { eid: session, name: 'session', comp: {} },
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
  // Like sessions.ts owns(): a swept branch is still ours to regrow. Hooks
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

// The operator loop is the session that TRIAGES a project — the only door that
// receives project-wide mail and actor knocks. Every run still participates in
// the graph and hears comments on its claimed work. No session means a
// deliberate preview/bare view, which keeps showing project mail.
export let isOperator = (s?: Record<string, unknown>) =>
  !s ||
  (s.operator == true && !s.requested_task &&
    (String(s.origin ?? '') != 'managed' || !!s.role))

// The notification lifecycle (T-7006), read as pure Row-predicates over
// the stamp components: presence is the fact, absence the earlier state.
// Only `archived` hides an item from the inbox — no automated path can
// drain it; `opened` only marks it read. So the one hiding stamp is a
// deliberate operator act, and the inbox is drain-proof by construction.
export let inInbox = (r: Row) => !r.comps.archived
export let isUnread = (r: Row) => !r.comps.opened

// Who an inbox reads FOR: the session S acting for actor A, standing in
// project P, holding the eids it CLAIMS. Every "addressed to me" test
// below is a pure fact about the graph, so membership can't drift.
export type Reader = {
  session?: string
  actor?: string
  scope?: string
  // Whether this reader is the project's operator loop. Non-operators get no
  // project-wide mail or actor knocks, only direct address and claimed work.
  operator?: boolean
  claims?: Set<string>
  // The addresses this reader answers to (its actor's, plus the actor's own
  // eid, which is how a letter names a recipient before delivery resolves
  // it). A letter reaches a PERSON this way — they stand in no project, so
  // the scope arm below says nothing about them.
  addrs?: Set<string>
  // The entities this actor has a standing instruction about: watch them
  // though nothing is aimed at me, mute them though something is. Absent
  // from both is the default, which is whatever addressed() says.
  watching?: Set<string>
  muting?: Set<string>
}

// What an inbox item is ABOUT — a subscription is aimed at the task or
// the venture, never at the individual letter, so this is the eid the
// watch/mute sets are asked about.
export let aboutOf = (r: Row) =>
  String(
    r.comps.comment?.target ?? r.comps.signal?.target ??
      r.comps.mail?.target ?? r.comps.knock?.target ?? '',
  )

// Every entity this actor has said something about, split by mode.
export let subsOf = (all: Row[], actor?: string) => {
  let watching = new Set<string>(), muting = new Set<string>()
  if (actor) {
    for (let r of all) {
      let sub = r.comps.subscription
      if (!sub || String(sub.actor) != actor) continue
      ;(sub.mode == 'mute' ? muting : watching).add(String(sub.target))
    }
  }
  return { watching, muting }
}

// Addressed to this reader — the four doors an item reaches attention
// through: a comment on work it claims or on the session itself, a knock aimed
// at the session or its actor, or mail that ARRIVED
// (message_id is the inbound mark; sent mail carries none). One predicate,
// so the digest, the TUI, and the web read the SAME inbox.
export let addressed = (who: Reader) => (r: Row): boolean => {
  let c = r.comps.comment
  if (c) {
    let t = String(c.target ?? '')
    // Said TO the actor, not just to one of its sessions: an operator loop
    // outlives the session that happened to be running when someone spoke
    // to the venture, so a comment on P-19 must reach whoever runs P-19 —
    // it was unheard by anyone otherwise. Gated on `operator` exactly like
    // the actor knock below, so a specialist still hears only direct
    // address and its own claimed work.
    return t == who.session || !!who.claims?.has(t) ||
      (who.operator == true && !!who.actor && t == who.actor)
  }
  // A notice reaches the same doors a comment does — claimed work, the
  // session itself, or the actor for an operator loop — but it was emitted,
  // not said (D-13858). Same addressing, different provenance.
  let n = r.comps.signal
  if (n) {
    let t = String(n.target ?? '')
    return t == who.session || !!who.claims?.has(t) ||
      (who.operator == true && !!who.actor && t == who.actor)
  }
  let k = r.comps.knock
  if (k) {
    // WHO the knock is for rides the shared `deliver {to}` facet now.
    let t = String(r.comps.deliver?.to ?? '')
    return !!t &&
      (t == who.session || (who.operator == true && t == who.actor))
  }
  let m = r.comps.mail
  if (m) {
    // An arrival, never a letter still going out — message_id is the
    // inbound mark, and it screens both arms below.
    if (!m.message_id) return false
    // A letter to your SESSION is direct address, so it lands whatever loop
    // you run — the same rule the comment and knock arms above already
    // follow. Sessions are addressable by id (`S-31@<fleet domain>`, resolved
    // in src/mail.ts), and gating that on `operator` would resolve the
    // address perfectly and then tell nobody.
    if (who.session && String(m.target) == who.session) return true
    // Project mail reaches only the operator loop, never a specialist.
    if (who.operator != true) return false
    // Two ways a letter is yours, and the FIRST is what a person has: it
    // was sent to an address you answer to. A person stands in no project,
    // so the scope arm says nothing about them — and a reader with neither
    // arm matches NOTHING rather than the fleet's whole correspondence
    // (1338 arrived letters in a week: the wrong default is a firehose,
    // not an inconvenience).
    return (!!who.addrs?.size && who.addrs.has(String(m.to ?? ''))) ||
      (!!who.scope && String(m.target) == who.scope)
  }
  return false
}

// The inbox: addressed to me and NOT archived. Unread within it is
// isUnread (NOT opened) — the two derived predicates the design names.
//
// A standing instruction OVERRIDES the addressed-to default, on what the
// item is about rather than the item itself. Mute wins even over direct
// address: it is the operator saying a thread is finished, and a rule
// that quietly declines to obey that is worse than one that obeys it
// too well — `--all` is the way back, the same as everywhere else.
export let inboxItem = (who: Reader) => {
  let to = addressed(who)
  return (r: Row) => {
    if (!inInbox(r)) return false
    let about = aboutOf(r)
    if (about && who.muting?.has(about)) return false
    if (about && who.watching?.has(about)) return true
    return to(r)
  }
}

// The reader an inbox reads for, resolved from the graph in one place:
// the session named, the actor it acts for, the project it stands in, and
// the eids it claims — everything addressed() needs.
// Every address an actor answers to: the address book entry it carries,
// and its own eid — a letter names its recipient by reference and only
// resolves to an address at delivery (M-4063), so both forms appear in the
// stored row depending on when you look.
let addrsOf = (all: Row[], actor?: string): Set<string> => {
  let out = new Set<string>()
  if (!actor) return out
  out.add(actor)
  let a = all.find((r) => r.eid == actor)?.comps.email?.address
  if (a) out.add(String(a))
  return out
}

// The reader a WEB client reads for. A browser has no session — its
// identity is the actor its client entity names — and a person browsing
// their own graph IS the loop, which is all `operator` has ever meant.
// No claims: leases belong to sessions, and a person holds none.
export let readerAt = (all: Row[], actor?: string): Reader => ({
  actor,
  operator: true,
  claims: new Set(),
  addrs: addrsOf(all, actor),
  scope: all.find((r) => r.eid == actor)?.comps.project ? actor : undefined,
  ...subsOf(all, actor),
})

export let readerFor = (
  all: Row[],
  session?: string,
  cwd?: string,
  scope?: string,
): Reader => {
  let sess = session
    ? all.find((r) => r.comps.session && String(r.comps.session.id) == session)
    : undefined
  let actor = String(sess?.comps.session?.actor ?? '') || undefined
  return {
    session: sess?.eid,
    actor,
    addrs: addrsOf(all, actor),
    scope: scopeFor(
      all,
      sess,
      cwd ?? String(sess?.comps.session?.cwd ?? ''),
      scope,
    ),
    operator: isOperator(sess?.comps.session),
    claims: new Set(
      all.filter((r) => sess && r.comps.claim?.session == sess.eid)
        .map((r) => r.eid),
    ),
    ...subsOf(all, actor),
  }
}

let cleanPath = (path: string) => path.replace(/\/+$/, '') || '/'

// The deepest directory root containing a path. Boundaries matter:
// /code/app does not contain /code/apple.
export let ancestorAt = (roots: string[], path: string) => {
  let best: string | undefined
  for (let root of roots.map(cleanPath)) {
    if (
      (path == root || path.startsWith(`${root}/`)) &&
      root.length > (best?.length ?? -1)
    ) best = root
  }
  return best
}

// The central fleet layouts carry only a repo basename. The visible root and
// its hidden predecessor both remain readable; ambiguity stays unplaced rather
// than crediting the wrong venture.
export let worktreeAt = (roots: string[], path: string) => {
  let found = roots.map(cleanPath).filter((root) => {
    let name = root.split('/').pop()
    let markers = [`/tasks-worktrees/${name}/`, `/worktrees/${name}/`]
    return name && markers.some((marker) =>
      path.includes(marker) &&
      path.slice(path.indexOf(marker) + marker.length).length > 0
    )
  })
  return found.length == 1 ? found[0] : undefined
}

// The project you stand in: a direct checkout first, then the fleet's linked
// worktree layout. Every caller-aware door derives its scope from here.
export let repoAt = (all: Scoped[], cwd?: string) => {
  if (!cwd) return undefined
  let repos = all.filter((r) => r.comps.repo?.path)
  let roots = repos.map((r) => String(r.comps.repo.path))
  let at = ancestorAt(roots, cwd) ?? worktreeAt(roots, cwd)
  return repos.find((r) => cleanPath(String(r.comps.repo.path)) == at)
}

// The project a caller stands in, resolved by falling priority: an explicit
// scope, the repo whose path prefixes the cwd, the home of the persona the
// session WEARS (identity, not filesystem — a session in a scratch worktree
// still belongs to its operator's project), then the actor when it IS a
// project. Undefined only when nothing places it — then the digest shows a
// hard-capped fleet peek, never a flood.
export let scopeFor = (
  all: Scoped[],
  sess?: Scoped,
  cwd?: string,
  arg?: string,
): string | undefined => {
  if (arg) return arg
  let byPath = repoAt(all, cwd)?.eid
  if (byPath) return byPath
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let worn = byEid.get(String(sess?.comps.session?.persona ?? ''))
  let home = String(worn?.comps.persona?.home ?? '')
  if (home && byEid.get(home)?.comps.project) return home
  let actor = byEid.get(String(sess?.comps.session?.actor ?? ''))
  return actor?.comps.project ? actor.eid : undefined
}

// The send batch: a mail is a document that travels — subject rides
// doc.title, the body doc.body, and WHERE it goes the shared `deliver {to}`.
// `to` stays AS GIVEN (a raw address or a graph reference) — a graph
// reference resolves at the door, a raw @-address is find-or-minted into its
// address-book entity there (db.ts), never here.
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
// near miss is our own inbox (the address the letter was delivered to),
// so a reply that quietly goes to the wrong desk looks sent and isn't.
// An unsigned letter earns a refusal instead; mail it directly.
//
// Answering an arrival RETIRES it: the reply batch also stamps `archived`
// on the inbound row, so the boot digest's pending block stops re-surfacing
// a thread we have already answered (the digest omits archived mail — see
// channel.ts injects). Without this every fresh boot re-presented the same
// unanswered-looking letter and each session replied again (T-35950). A
// LATER inbound message on the thread is a distinct row with its own
// received_at and no archived stamp, so it re-surfaces on its own. Only an
// arrival is retired (message_id) — following up on our own sent letter
// never rang the inbox to begin with, so there is nothing to hide.
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

// The digest's own week window and title clipper, shared by the tail
// tiers below (pulse, onMine, unheard). Older than a week is search's job.
let DAY = 86_400_000
let snip = (s: string, n = 72) => s.length > n ? `${s.slice(0, n)}…` : s
// A scope narrows lately to what BELONGS to the project: its tasks, its
// memories (unscoped memories are principles — they always ride), its
// personas. What can't be classified stays — hiding the unclassifiable
// would make the digest lie by omission.
// Does this row belong to that project? Each kind names its scope its own
// way — a task's project, a memory's scope (absent = the whole fleet, so a
// standing ruling rides every project), a persona's home — and anything with
// no such column belongs everywhere. The `## decided` block and `task
// decided` share it, which is what keeps the section and the listing one
// answer.
export let belongs = (r: Scoped, scope?: string) => {
  if (!scope) return true
  if (r.comps.task) return r.comps.filed?.project == scope
  if (r.comps.memory) {
    return !r.comps.memory.scope || r.comps.memory.scope == scope
  }
  if (r.comps.persona) return r.comps.persona.home == scope
  if (r.comps.project) return r.eid == scope
  return true
}
// A session's brief: the first-class handoff it left (the operator wrote,
// or wrap captured from the final message) — a distinct component from the
// session doc, which is free for the scribe's narrative. Falls back to the
// managed row's final_text for a session that never got a brief comp.
let briefOf = (r: Row) =>
  String(r.comps.brief?.text ?? '') || String(r.comps.session?.final_text ?? '')
// PROJECT layer — the pulse: tasks that MOVED in the scope you stand in,
// newest touch first, selected by filed.project so no foreign entity
// rides in on a catch-all. This reads the same with or without a session,
// which is what lets a bare `task context` in a repo show exactly what that
// project's operator sees. Empty scope means an unplaceable caller: a small
// fleet peek (the hottest open work), never the whole board.
let pulse = (tasks: Row[], now: number, budget: number, scope?: string) => {
  if (budget < 2) return []
  // Recency by string compare against a precomputed ISO cutoff, not a
  // Date.parse per task: graph timestamps are ISO-Z, so lexical order IS
  // chronological order — and `now - parse < 7d` ⟺ `editedAt > cutoff`, with
  // an empty/absent stamp (Date.parse -> NaN, excluded) staying excluded (a
  // stamp < cutoff). Date.parse over every open task was pulse's whole cost.
  let cutoff = new Date(now - 7 * DAY).toISOString()
  let fresh = (r: Row) => editedAt(r) > cutoff
  let mine = scope
    ? tasks.filter((r) => String(r.comps.filed?.project) == scope && fresh(r))
    : tasks.filter((r) => !settled(taskStatus(r))).filter(fresh)
  let hits = mine
    .sort((a, b) => editedAt(b).localeCompare(editedAt(a)))
    .slice(0, Math.min(budget - 1, scope ? 6 : 3))
  if (!hits.length) return []
  return [
    scope ? '## lately' : '## fleet — nowhere placed',
    ...hits.map((r) =>
      `- ${idOf(r)} ${taskStatus(r)} — ${
        snip(String(r.comps.doc?.title ?? ''))
      }`
    ),
  ]
}

// SESSION layer — comments that landed on YOUR claimed tasks, the message a
// missed instant push would have carried. Recognition only: it never moves
// the bus cursor (that stays the sweep's one job) and it never shows in a
// bare preview, since a preview holds no claims to hear about.
let onMine = (
  claims: Row[],
  comments: Row[],
  byEid: Map<string, Row>,
  sess: Row | undefined,
  now: number,
  budget: number,
  skip = new Set<string>(),
) => {
  if (!sess || budget < 1) return []
  let mine = new Set(
    claims.filter((r) => r.comps.claim?.session == sess.eid).map((r) => r.eid),
  )
  if (!mine.size) return []
  let names = aliasNames([...byEid.values()])
  let name = (eid: unknown) => {
    let r = byEid.get(String(eid))
    return String(
      names.get(String(eid)) ?? r?.comps.doc?.title ?? r?.comps.session?.id ??
        'someone',
    )
  }
  let hits = comments
    .filter((r) => {
      let c = r.comps.comment
      return c && !skip.has(r.eid) && r.comps.created?.via != sess.eid &&
        mine.has(String(c.target)) && now - Date.parse(bornAt(r)) < 7 * DAY
    })
    .sort((a, b) => bornAt(b).localeCompare(bornAt(a)))
    .slice(0, budget)
  if (!hits.length) return []
  return [
    '## on your tasks',
    ...hits.map((r) => {
      let c = r.comps.comment
      let body = String(r.comps.doc?.body ?? '').split('\n')[0].slice(0, 96)
      let verdict = verdictName(String(r.comps.review?.verdict ?? ''))
      let words = [verdict ? `[${verdict}]` : '', body].filter(Boolean).join(
        ' ',
      )
      return `- ${idOf(byEid.get(String(c.target))!)} 💬 ${
        name(r.comps.created?.by ?? r.comps.created?.via)
      }: ${words}`
    }),
  ]
}

// SESSION layer — the actor's interrupted work, not the project's heat.
// A parked task wears resume; a live claim held by another one of the actor's
// sessions still belongs in the working set. Current-session claims already
// lead the digest, so repeating them here would hide the next thing to pop.
let resumptions = (
  tasks: Row[],
  claims: Row[],
  sessRows: Row[],
  sess: Row | undefined,
  budget: number,
) => {
  let actor = String(sess?.comps.session?.actor ?? '')
  if (!actor || budget < 2) return []
  let mine = new Set(
    claims.filter((r) => r.comps.claim?.session == sess?.eid).map((r) => r.eid),
  )
  let sessions = new Map(sessRows.map((r) => [r.eid, r] as const))
  let at = (r: Row) =>
    String(r.comps.resume?.at ?? r.comps.claim?.at ?? editedAt(r))
  // The claim arm is a forward deref — task's claim → its session → that
  // session's actor — so it IS the traversal grammar: `.claim.session.actor`.
  // The resume/updated/created fallback has no single ref column, so it stays
  // JS/OR. `deref` is the pred's graph, keyed over the sessions already indexed.
  let mineClaim = parseQuery('.claim.session.actor=' + actor)
  let deref = (eid: string) => sessions.get(eid)?.comps
  let hits = tasks
    .filter((r) => !settled(taskStatus(r)))
    .filter((r) => !mine.has(r.eid))
    .filter((r) => {
      if (r.comps.claim) return matchQuery(r.comps, mineClaim, deref)
      return r.comps.resume?.actor == actor ||
        r.comps.updated?.by == actor || r.comps.created?.by == actor
    })
    .sort((a, b) => {
      let rank = Number(b.comps.resume?.rank ?? 0) -
        Number(a.comps.resume?.rank ?? 0)
      return rank || at(b).localeCompare(at(a))
    })
    .slice(0, budget - 1)
  if (!hits.length) return []
  return [
    '## resume — pop your stack',
    ...hits.map((r) => {
      let holder = sessions.get(String(r.comps.claim?.session ?? ''))
      let held = holder ? ` · ⚑ ${idOf(holder)}` : ''
      return `- ${idOf(r)} ${taskStatus(r)}${held} — ${
        snip(String(r.comps.doc?.title ?? ''))
      }`
    }),
  ]
}

// When a decision was taken — '' for an entity wearing no stamp, which
// sorts last and reads as "nothing settled". The digest and `task decided`
// order by the same string, so the section and the listing agree.
export let decidedAt = (r: Row) => String(r.comps.decided?.at ?? '')

// PROJECT layer — what has been SETTLED in the scope you stand in, newest
// decision first. The `decided` stamp is the only source, so an entity
// without one is absent rather than sorted oddly, and nothing is guessed
// from status or age.
//
// Ordered by decided.at, never by heat: a decision does not become less true
// for going cold, and that divergence is the whole reason the stamp lives
// beside recall instead of inside it. The date leads the line — the point of
// the section is WHEN, and a decision written up from an old letter has a
// date its `created` stamp would misreport.
let decisions = (decided: Row[], budget: number, scope?: string) => {
  if (budget < 2) return []
  let hits = decided
    .filter((r) => belongs(r, scope))
    .sort((a, b) => decidedAt(b).localeCompare(decidedAt(a)))
    .slice(0, budget - 1)
  if (!hits.length) return []
  return [
    '## decided',
    ...hits.map((r) =>
      `- ${decidedAt(r).slice(0, 10)} ${idOf(r)} — ${
        snip(String(r.comps.doc?.title ?? ''))
      }`
    ),
  ]
}

// PROJECT layer — the fleet's shared mind, surfaced: the warmest UNSCOPED
// memories (scoped ones ride their own project), listed for recognition
// under a standing directive to read and adopt. recallIndex ranks and
// formats; a `scope=` (empty = absent) pred keeps it to the principles
// every operator shares. Recognition, not retrieval — the recall bump rides
// deliberate expansion (MCP memory_recall / CLI task show), never this
// listing.
let fleetMemory = (all: Row[], now: number, budget: number) => {
  if (budget < 3) return []
  let global: Pred[] = [{
    comp: 'memory',
    prop: 'scope',
    op: '',
    value: '',
  }]
  let mems = recallIndex(all, global, now, budget - 1)
  if (!mems.length) return []
  return [
    '## from the fleet — read any that fit (MCP memory_recall / CLI task show <id>), adopt what helps',
    ...mems.map((l) => `- ${l}`),
  ]
}

// The governed context inherited by one task. Project rows are roots and ALL
// edge types can explain a route to the work; types become selective only when
// asking what the rooted ancestors say (reads), wait on (requires), or correct
// (supersedes). Each category has a small fixed allowance so one prolific
// ancestor cannot turn a session start into a wall of derived graph state.
export let taskContextBlock = (
  all: Row[],
  deps: Dep[],
  task: Row,
  budget = 6,
  byIx?: Map<string, Row>,
): string[] => {
  if (budget < 1) return []
  let byEid = byIx ?? new Map(all.map((r) => [r.eid, r]))
  let outgoing = new Map<string, Dep[]>()
  let incoming = new Map<string, Dep[]>()
  for (let d of deps) {
    outgoing.set(d.parent, [...(outgoing.get(d.parent) ?? []), d])
    incoming.set(d.child, [...(incoming.get(d.child) ?? []), d])
  }
  let order = (a: string, b: string) => {
    let ar = byEid.get(a), br = byEid.get(b)
    return (ar?.num ?? Infinity) - (br?.num ?? Infinity) || a.localeCompare(b)
  }
  let reverse = new Set([task.eid])
  let back = [task.eid]
  while (back.length) {
    let child = back.shift()!
    for (let d of incoming.get(child) ?? []) {
      if (reverse.has(d.parent)) continue
      reverse.add(d.parent)
      back.push(d.parent)
    }
  }
  let roots = [...reverse]
    .map((eid) => byEid.get(eid))
    .filter((r): r is Row => !!r?.comps.project)
    .sort((a, b) => order(a.eid, b.eid))
  if (!roots.length) return []

  let pathFrom = (root: Row) => {
    let paths = new Map<string, string[]>([[root.eid, [root.eid]]])
    let queue = [root.eid]
    while (queue.length) {
      let parent = queue.shift()!
      if (parent == task.eid) return paths.get(parent)!
      let edges = [...(outgoing.get(parent) ?? [])]
        .filter((d) => reverse.has(d.child))
        .sort((a, b) => order(a.child, b.child))
      for (let d of edges) {
        if (paths.has(d.child)) continue
        paths.set(d.child, [...paths.get(parent)!, d.child])
        queue.push(d.child)
      }
    }
    return []
  }
  let paths = roots.map(pathFrom).filter((p) => p.length)
  let pathText = (path: string[]) => {
    let ids = path.map((eid) => idOf(byEid.get(eid)!))
    if (ids.length > 8) ids = [...ids.slice(0, 4), '…', ...ids.slice(-3)]
    if (ids.includes('…')) return ids.join(' → ')
    let text = ids[0]
    for (let i = 1; i < path.length; i++) {
      let edge = (outgoing.get(path[i - 1]) ?? [])
        .filter((d) => d.child == path[i])
        .sort((a, b) => a.type.localeCompare(b.type))[0]
      text += ` -${edge?.type ?? '?'}→ ${ids[i]}`
    }
    return text
  }
  let shownPaths = paths.slice(0, 3).map(pathText)
  if (paths.length > shownPaths.length) {
    shownPaths.push(`+${paths.length - shownPaths.length} more roots`)
  }
  let lines = [`  - path: ${shownPaths.join('; ')}`]

  // A rooted ancestor is both reachable from a project and able to reach the
  // task. This retains alternate governing branches rather than confusing the
  // single shortest explanatory path with the whole ancestry.
  let forward = new Set<string>()
  let front = roots.map((r) => r.eid)
  for (let eid of front) forward.add(eid)
  while (front.length) {
    let parent = front.shift()!
    for (let d of outgoing.get(parent) ?? []) {
      if (!reverse.has(d.child) || forward.has(d.child)) continue
      forward.add(d.child)
      front.push(d.child)
    }
  }
  let inherited = [...deps]
    .filter((d) => d.type == 'reads' && forward.has(d.parent))
    .sort((a, b) => order(a.child, b.child))
  let inheritedIds = new Set(inherited.map((d) => d.child))
  let face = (r: Row) => {
    let title = snip(String(r.comps.doc?.title ?? ''), 48)
    let body = String(r.comps.doc?.body ?? '').replace(/\s+/g, ' ').trim()
    return `${idOf(r)}${title ? ` — ${title}` : ''}${
      body ? ` · ${snip(body, 64)}` : ''
    }`
  }
  let decisions = inherited
    .map((d) => byEid.get(d.child))
    .filter((r): r is Row => !!r?.comps.decided)
    .filter((r, i, a) => a.findIndex((x) => x.eid == r.eid) == i)
    .slice(0, 2)
    .map((r) =>
      `  - decision [${String(r.comps.decided?.verdict ?? 'approved')}] ${
        face(r)
      }`
    )
  let rootIds = new Set(roots.map((r) => r.eid))
  let memories = inherited
    .map((d) => byEid.get(d.child))
    .filter((r): r is Row =>
      !!r?.comps.memory && rootIds.has(String(r.comps.memory.scope ?? ''))
    )
    .filter((r, i, a) => a.findIndex((x) => x.eid == r.eid) == i)
    .slice(0, 1)
    .map((r) => `  - memory ${face(r)}`)
  let prerequisites = deps
    .filter((d) =>
      d.type == 'requires' && forward.has(d.parent) &&
      d.parent != task.eid && !forward.has(d.child)
    )
    .map((d) => byEid.get(d.child))
    .filter((r): r is Row => !!r?.comps.task && !settled(taskStatus(r)))
    .filter((r, i, a) => a.findIndex((x) => x.eid == r.eid) == i)
    .sort((a, b) => order(a.eid, b.eid))
    .slice(0, 1)
    .map((r) =>
      `  - prerequisite ${idOf(r)} (${taskStatus(r)}) — ${
        snip(String(r.comps.doc?.title ?? ''), 64)
      }`
    )
  let corrections = deps
    .filter((d) =>
      d.type == 'supersedes' &&
      (inheritedIds.has(d.child) || forward.has(d.child))
    )
    .sort((a, b) => order(a.parent, b.parent))
    .slice(0, 1)
    .flatMap((d) => {
      let newer = byEid.get(d.parent), older = byEid.get(d.child)
      if (!newer || !older) return []
      return [
        `  - correction ${idOf(newer)} supersedes ${idOf(older)} — ${
          snip(String(newer.comps.doc?.title ?? ''), 64)
        }`,
      ]
    })
  lines.push(...decisions, ...memories, ...prerequisites, ...corrections)
  return lines.slice(0, budget)
}

// One claimed task, rendered for the digest: its line plus the unresolved
// gates beneath it (each with the status and who holds it). Shared by the
// operator digest's "claimed by you" list and the subagent hook's lone task
// block (cli.ts) — one renderer, so both doors read identically.
export let taskBlock = (
  all: Row[],
  deps: Dep[],
  r: Row,
  byIx?: Map<string, Row>,
): string[] => {
  // A caller already holding the whole-graph index (the digest shows several
  // task blocks a call) passes it: rebuilding it here made every shown row an
  // O(graph) map build.
  let byEid = byIx ?? new Map(all.map((x) => [x.eid, x]))
  let authoring = authoringLine(all, r)
  let out = [
    `- ${idOf(r)} ${taskStatus(r) ?? r.kind} — ${r.comps.doc?.title ?? ''}${
      authoring ? ` · ${authoring}` : ''
    }`,
  ]
  // A claimed PROJECT wants dozens of tasks; the digest is a glance, not a
  // board, so the gates cap at a handful with a count for the rest.
  let gates = deps.filter((d) => d.parent == r.eid).flatMap((d) => {
    let c = byEid.get(d.child)
    if (!c || d.type == 'reads' || settled(taskStatus(c))) return []
    let who = claimant(all, c)
    return [
      `  - ${d.type} → ${idOf(c)} (${taskStatus(c) ?? c.kind}${
        who ? `, ⚑ ${who}` : ''
      })`,
    ]
  })
  out.push(...gates.slice(0, 6))
  if (gates.length > 6) out.push(`  - …and ${gates.length - 6} more open`)
  out.push(...taskContextBlock(all, deps, r, 6, byEid))
  return out
}

// The owner's own words: a user-role message entry of a session a human sat
// at — one with a terminal pane. Not a managed run (its user turns are the
// brief and injected comments), not a subagent (its user turns are the
// parent's prompts), and not a scripted run (a cron sweep's `claude -p` has
// no pane; its one user turn is the launcher's prompt). Within a session the
// `prompt` tag is the mark: ingest puts it on the turns the human typed
// (transcript origin.kind 'human'), and never on what the harness injects as
// the user role — hook feedback, notifications, wrappers, the compaction
// summary. Entries from before the tag existed get it from
// `task backfill prompt`.
export let spoken = (r: Row, s?: Row) =>
  !!r.comps.prompt && r.comps.message?.role == 'user' &&
  !!String(r.comps.content?.body ?? '').trim() &&
  !!s?.comps.session?.pane &&
  s.comps.session.origin != 'managed' && s.comps.session.agent_type == null

let when = (at: string) => at.slice(5, 16).replace('T', ' ')

// Not authorship, though stamped in the owner's name: client state the web
// writes on every gesture (a cursor move, a camera pan, a card opened), and
// storage the server mints beside an edit (a body's content-addressed blob).
let UNSAID = new Set([
  'client',
  'cursor',
  'camera',
  'pin',
  'card',
  'layout',
  'pane',
  'fold',
  'shelf',
  'setting',
  'favorite',
  'subscription',
])

// Reading is not writing: opening, archiving, or being notified of a letter
// stamps `updated` in the reader's name in the same batch as the mark, so an
// `updated` that coincides with a read-state mark is that mark, not an edit.
let READ = ['opened', 'archived', 'notified']
let readAt = (r: Row) =>
  READ.map((name) => String(r.comps[name]?.at ?? '')).filter(Boolean)

// One act of authorship: when, what kind of act, the entity, where it sits,
// and its words (a titled thing leads with its title).
export type Said = {
  at: string
  act: string
  row: Row
  where: string
  text: string
}

let wordsOf = (r: Row) => {
  let title = String(r.comps.doc?.title ?? '').trim()
  let body = String(r.comps.content?.body ?? r.comps.doc?.body ?? '').trim()
  return title && body ? `${title}\n${body}` : title || body
}

// Where an act sits: a turn's session, a comment's target, a letter's
// recipient, a task's project, a memory's scope — named by id when the row
// is at hand, else by the short eid.
let whereOf = (r: Row, byEid: Map<string, Row>) => {
  let ref = String(
    r.comps.entry?.session ?? r.comps.comment?.target ??
      r.comps.deliver?.to ?? r.comps.mail?.target ?? r.comps.filed?.project ??
      r.comps.memory?.scope ?? '',
  )
  if (!ref) return ''
  let at = byEid.get(ref)
  return at ? idOf(at) : shortId(ref)
}

// Everything a person authored, as acts on one timeline: a turn typed at a
// prompt (spoken), and for every other entity the acts its stamps attribute
// to a person — created, a later edit (updated by a person after creation),
// a decision (decided.by), and feedback a memory records from them
// (feedback.by) even when an agent wrote it down. The journal attributes
// every write the same way; these stamps are its latest word per entity, so
// this is a union over what the graph already holds, not new storage. The
// people are the person rows among `rows`, so no name is hardcoded.
export let authored = (rows: Row[], byEid: Map<string, Row>): Said[] => {
  let people = new Set(rows.filter((r) => r.comps.person).map((r) => r.eid))
  let by = (stamp?: Record<string, unknown>) =>
    people.has(String(stamp?.by ?? ''))
  let out: Said[] = []
  for (let r of rows) {
    if (r.comps.entry) {
      let s = byEid.get(String(r.comps.entry.session))
      if (spoken(r, s)) {
        out.push({
          at: bornAt(r),
          act: 'turn',
          row: r,
          where: s ? idOf(s) : '',
          text: wordsOf(r),
        })
      }
      continue
    }
    // Anything with no display kind of its own — a content-addressed blob
    // among them — has nothing to say on a timeline.
    if (UNSAID.has(r.kind) || r.kind == 'entity') continue
    if (r.comps.person) continue
    let { created, updated, decided, feedback } = r.comps
    // No stamp here names a person, so this row authored nothing — settle
    // that on four Set lookups, BEFORE paying to read its words. This walks
    // the whole graph on every digest and almost all of it is other hands;
    // reading every body first made the digest scan the board's prose.
    if (!by(created) && !by(feedback) && !by(updated) && !by(decided)) continue
    let where = whereOf(r, byEid)
    let text = wordsOf(r)
    let born = String(created?.at ?? '')
    if (by(created)) out.push({ at: born, act: r.kind, row: r, where, text })
    else if (by(feedback)) {
      out.push({ at: born, act: 'feedback', row: r, where, text })
    }
    let edited = String(updated?.at ?? '')
    if (by(updated) && edited != born && !readAt(r).includes(edited)) {
      out.push({ at: edited, act: 'edit', row: r, where, text })
    }
    if (by(decided)) {
      out.push({
        at: String(decided?.at ?? ''),
        act: 'decided',
        row: r,
        where: String(decided?.verdict ?? '') || where,
        text,
      })
    }
  }
  return out.filter((s) => s.at).sort((a, b) => a.at.localeCompare(b.at))
}

// What the owner said, in order — the last `n` acts among `rows`, oldest
// first so the newest sits at the bottom. One line each: when, the entity's
// own id (`task show <id>` reads it whole), the act, where, and the first
// line cut to `width`; `full` prints each whole text under its line instead.
// This is the signal every context reads before the fleet's own prose
// (M-31946); the digest carries a few, `task said` the rest.
export let saidLines = (
  rows: Row[],
  byEid: Map<string, Row>,
  n: number,
  width = 120,
  full = false,
) =>
  authored(rows, byEid)
    .slice(-Math.max(0, n))
    .flatMap(({ at, act, row, where, text }) => {
      let lead = `- ${when(at)} ${idOf(row)} ${act}${
        where ? ` ${where}` : ''
      } · `
      return full ? [lead.trimEnd(), text, ''] : [
        snip(
          `${lead}${text.split('\n')[0]}`,
          Math.max(lead.length + 8, width),
        ),
      ]
    })

// The standing goals (M-31946 §5) — fleet-wide ones plus the scope's, by
// num, titles only: what the work is FOR, read right after what the owner
// said. `task show V-3` for the words.
export let goalLines = (rows: Row[], scope?: string, n = 8) =>
  rows
    .filter((r) => r.comps.goal && r.comps.doc)
    .filter((r) => !r.comps.goal!.scope || r.comps.goal!.scope == scope)
    .sort((a, b) => a.num - b.num)
    .slice(0, Math.max(0, n))
    .map((r) => `- ${idOf(r)} ${r.comps.doc?.title ?? ''}`)

// The injection-loop digest: what a session sees at start — its claimed
// work (with unresolved gates and who holds them), or the top of the open
// board when it holds nothing, then the three tail tiers (below). ≤48
// lines by construction: the tracker stays out of the way, it just makes
// the working set — and the recent past — impossible to lose.
// The digest is MARKDOWN, like every body in the graph — and dense on
// purpose: headings and lists interrupt paragraphs (CommonMark), so no
// blank line ever spends a budget line.
// No session = the PREVIEW: the digest a fresh session would boot with
// (open work, the project pulse, fleet memory — nothing claimed, nothing
// acked). Two LAYERS: a PROJECT layer (a pure function of scope — open
// work, pulse, fleet memory, mail) and a SESSION layer that adds to it
// (your claims replace the suggestions, onMine, previously, unheard). So a
// bare `task context` in a repo shows exactly the project layer its
// operator sees, minus the session extras — parity by construction.
// Scope resolves via scopeFor: an explicit arg, else the cwd's repo, else
// the worn persona's home, else the actor-as-project (client.ts scopeFor).
export let contextDigest = (
  snap: Snapshot,
  session?: string,
  now = Date.now(),
  scope?: string,
  skip = new Set<string>(),
) => {
  let all = rows(snap)
  // One pass buckets the graph by the components the digest sections read, so
  // the ~dozen helpers below each scan their own kind rather than re-filtering
  // the whole graph (and rebuilding byEid/sessions maps) apiece — the boot
  // digest runs on every session start, so this is a fleet-wide hot path. The
  // comment index in particular kills unheard's per-session nested O(n) scan.
  let byEid = new Map<string, Row>()
  let tasks: Row[] = []
  let sessions: Row[] = []
  let claims: Row[] = []
  let comments: Row[] = []
  let decided: Row[] = []
  for (let r of all) {
    byEid.set(r.eid, r)
    let c = r.comps
    if (c.task) tasks.push(r)
    if (c.session) sessions.push(r)
    if (c.claim) claims.push(r)
    if (c.comment) comments.push(r)
    if (c.decided) decided.push(r)
  }
  let sess = sessions.find((r) => String(r.comps.session?.id) == session)
  let cwd = String(sess?.comps.session?.cwd ?? '')
  scope = scopeFor(all, sess, cwd, scope)
  let here = scope ? byEid.get(scope) : undefined
  let mine = sess
    ? claims.filter((r) => r.comps.claim?.session == sess.eid)
    : []
  mine.sort((a, b) =>
    String(b.comps.claim?.at ?? '').localeCompare(
      String(a.comps.claim?.at ?? ''),
    )
  )
  let lines = [
    '# ' + (session ? `tasks · session ${session}` : 'tasks · a preview') +
    (here ? ` · ${idOf(here)} ${here.comps.doc?.title ?? ''}` : ''),
  ]
  let show = (r: Row) => lines.push(...taskBlock(all, snap.deps, r, byEid))
  if (mine.length) {
    lines.push('claimed by you:')
    mine.slice(0, 4).forEach(show)
  } else {
    // Suggestions are local when a scope stands (a fleet's worth of
    // open work is task list's job) — an idle project falls back to
    // the fleet rather than suggesting nothing.
    let open = tasks
      .filter((r) => !settled(taskStatus(r)))
      .filter((r) => !r.comps.claim)
    let local = scope ? open.filter((r) => belongs(r, scope)) : open
    if (!local.length) local = open
    lines.push(
      `nothing claimed. open work${here ? ' here' : ''}, board order:`,
    )
    local.sort(byBoard).slice(0, 5).forEach(show)
  }
  // What is waiting rides one line, and the door teaches itself (adoption
  // is structural). The count is the INBOX's own predicate, so this number
  // and `task inbox` can never disagree — it used to screen mail by what
  // the letter was ABOUT rather than who it was TO, which reported zero
  // while hundreds of letters addressed to the venture sat unread, and it
  // pointed at `task mail`, a door that has since been retired.
  let unread = all.filter(inboxItem(readerFor(all, session, cwd, scope)))
    .filter(isUnread)
  // A session is an agent run: its claim, loaded context and entry trace ARE
  // its attention. Only the human preview reports exogenous inbox read-state.
  if (!session && unread.length) {
    lines.push(`## inbox — ${unread.length} unread (task inbox)`)
  }
  // The actor's own interruption stack comes before narrative memory: these
  // are live tasks the operator can claim and pop without reconstructing a
  // yak chain from prose. A bare preview has no actor and therefore no stack.
  lines.push(
    ...resumptions(
      tasks,
      claims,
      sessions,
      sess,
      Math.min(5, 48 - lines.length),
    ),
  )
  // The thread from last time: the newest brief by the SAME operator — the
  // first-class handoff it left (final message wrap captured, or one the
  // operator wrote) — so a session wakes knowing where its predecessor left
  // off. Shown IN FULL, no per-line snip: the brief is the handoff, and a
  // truncated handoff is why briefs were "never seen to work" (D-19459). A
  // generous line budget within the 48-line cap, with a pointer for any tail.
  let actor = String(sess?.comps.session?.actor ?? '') || scope
  // Handoff is operator-to-operator. Now that actor == project (T-19461),
  // every builder spawned here shares the operator's actor, so a builder's
  // captured final_text would shadow the operator's deliberate brief just by
  // being newer. Prefer the newest operator:true session with a brief; fall
  // back to the newest brief of any kind, so a lone preview or first run
  // doesn't lose its only thread.
  let briefed = actor
    ? sessions
      .filter((r) =>
        r.eid != sess?.eid && r.comps.session?.actor == actor && briefOf(r)
      )
      .sort((a, b) => editedAt(b).localeCompare(editedAt(a)))
    : []
  let prev = briefed.find((r) => r.comps.session?.operator) ?? briefed[0]
  if (prev) {
    // A brief-captured session leaves no doc.title; name it by S-num alone
    // rather than trailing an empty title.
    let title = snip(String(prev.comps.doc?.title ?? ''))
    lines.push(`## previously — ${idOf(prev)}${title ? ` ${title}` : ''}`)
    let told = briefOf(prev).split('\n').map((l) => l.trimEnd()).filter(Boolean)
    let budget = 18
    for (let l of told.slice(0, budget)) lines.push(`> ${l}`)
    if (told.length > budget) {
      lines.push(`> … → \`task show ${idOf(prev)}\` for the rest`)
    }
  }
  // The tail, four tiers drawing on the room the 48-line cap leaves:
  // onMine (SESSION layer — comments on your claimed tasks, the backstop
  // under a missed instant push), then the PROJECT pulse (what moved in
  // your scope), what was DECIDED here, then the fleet's shared memory.
  // onMine, decisions and fleetMemory are capped small so the cap always
  // leaves the project tiers more room than their own tiny caps need — that
  // headroom is what makes the project layer render identically with or
  // without a session (parity).
  let room = () => 48 - lines.length
  // The owner's latest words come before the fleet's own noise (M-31946):
  // five lines, newest last, `task said` for the rest.
  let said = saidLines(all, byEid, Math.min(5, room()))
  if (said.length) lines.push('## owner said (task said)', ...said)
  // Then what the work is for: the standing goals, titles only.
  let goals = goalLines(all, scope, Math.min(8, room()))
  if (goals.length) lines.push('## goals (task goals)', ...goals)
  lines.push(
    ...onMine(claims, comments, byEid, sess, now, Math.min(4, room()), skip),
  )
  lines.push(...pulse(tasks, now, room(), scope))
  lines.push(...decisions(decided, Math.min(6, room()), scope))
  lines.push(...fleetMemory(all, now, Math.min(6, room())))
  lines.push(
    `claim: \`task claim <id> ${
      session ?? '<session>'
    }\` · comment: \`task comment <id> "…"\` · release when done or handing off`,
  )
  return lines.slice(0, 48).join('\n')
}

// The comms bus, read side. The Claude channel's own pure filter is reused over
// a set of rows so every provider gets the same recipient and verification
// rules: claimed-work comments, knocks, and verified project mail for an
// operator. This is an agent QUERY, not an
// inbox read: serving it writes no read-state. The result's eids let a caller
// avoid rendering the same row twice inside one response, and its newest clock
// lets a transport compare an accepted wake with later work.
let noticeLine = (ev: InboxEvent, row?: Row) => {
  let from = ev.meta.from ? ` from ${ev.meta.from}` : ''
  let on = ev.meta.on ? ` on ${ev.meta.on}` : ''
  let id = ev.meta.id ?? (row ? idOf(row) : '')
  let ref = id ? ` ${id}` : ''
  let body = ev.content.replace(/\s+/g, ' ').trim()
  let verdict = verdictName(String(row?.comps.review?.verdict ?? ''))
  if (verdict) body = `[${verdict}] ${body}`
  if (body.length > 800) body = `${body.slice(0, 799)}…`
  return `UNTRUSTED ${ev.meta.kind}${ref}${from}${on}: ${body}`
}

// The bus over whatever rows a supplier gathered, for whoever the reader
// says it is. Rows in, not a Snapshot: the whole graph is one supplier
// (noticesFor, below) and a handful of keyed queries is the other (bus), and
// a second implementation of the selection would drift from this one the
// first time either arm moved.
export let noticeEvents = (
  all: Row[],
  who: Reader,
  sent?: (eid: string) => boolean,
): InboxEvent[] => {
  if (!who.session) return []
  let sessEid = who.session
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let events = channelEvents(changesOf(all), {
    sessionEid: sessEid,
    sent,
    actorEid: who.actor,
    homeEid: who.scope,
    claimedEids: who.claims,
    claimedAt: (eid) =>
      String(byEid.get(eid)?.comps.claim?.at ?? '') ||
      undefined,
    idOf: (eid) => {
      let row = byEid.get(eid)
      return row ? idOf(row) : null
    },
    docOf: (eid) => {
      let doc = byEid.get(eid)?.comps.doc
      return doc
        ? { title: String(doc.title ?? ''), body: String(doc.body ?? '') }
        : null
    },
    done: (eid) => {
      let row = byEid.get(eid)
      return !!row?.comps.archived
    },
    // isOperator() already required session.operator of a session that
    // exists, and one does — who.session names it.
    operator: who.operator,
    mode: 'inbox',
    // The clock the recall recency bound reads (T-17487): the whole-snapshot
    // path drops a floater that missed its beat, matching busRows' query bound.
    now: Date.now(),
  })
    // Own-write skip now lives in the shared channelEvents() selector
    // (channel.ts), so the live channel push path inherits it too (T-20163).
    // A TOTAL order: bornAt, then eid. bus() gathers its rows from parallel
    // keyed queries and concatenates them, while noticesFor() reads a whole
    // snapshot — so the two feed notices() in different input orders. bornAt
    // alone ties for every row sharing a created.at (a whole batch) or lacking
    // one, and a tie left to input order makes bus() and noticesFor() disagree
    // and a parallel-gathered bus flake run to run. eid is unique, so tie-broken
    // by eid the order is the same however the rows arrived (T-15463).
    .sort((a, b) =>
      bornAt(byEid.get(a.eid)!).localeCompare(bornAt(byEid.get(b.eid)!)) ||
      a.eid.localeCompare(b.eid)
    )
  // A knock is a nudge to look now; one older than a week is archaeology
  // (a boot digest opened with 77 of them, most weeks stale), so it drops
  // here rather than crowding out what is live. Comments and mail stay.
  let stale = new Date(Date.now() - 7 * 864e5).toISOString()
  events = events.filter((ev) =>
    ev.meta.kind != 'knock' || bornAt(byEid.get(ev.eid)!) >= stale
  )
  return events
}

export let notices = (all: Row[], who: Reader) => {
  let events = noticeEvents(all, who)
  let byEid = new Map(all.map((r) => [r.eid, r]))
  if (!events.length) {
    return { lines: [] as string[], eids: [] as string[], at: '' }
  }
  let served = events.slice(0, 10)
  let lines = served.map((ev) => noticeLine(ev, byEid.get(ev.eid)))
  if (events.length > served.length) {
    lines.push(`…and ${events.length - served.length} more pending`)
  }
  let eids = served.map((ev) => ev.eid)
  let at = served.reduce((latest, ev) => {
    let born = bornAt(byEid.get(ev.eid)!)
    return born > latest ? born : latest
  }, '')
  return { lines, eids, at }
}

// What an index line says about a memory before its title. The retired
// enum printed all four of its values here; three of them said nothing the
// line did not already carry (a scope, or a default), so only feedback
// speaks now — and it speaks because someone's correction is a different
// kind of thing to re-read than a fact. The SOURCE stays off the line: it
// is one word on the row (`.feedback.by`) and naming it here would cost a
// graph lookup in both renderers to repeat what `task show` already says.
// A memory counts once it has been accepted. An agent's memory lands
// proposed (db.ts apply) and stays a suggestion — indexed with a `?`, never
// preloaded — until `decided` lands on it without a declined verdict. A
// memory with no proposed stamp was born accepted.
export let accepted = (r: Row) =>
  !r.comps.proposed ||
  (!!r.comps.decided && r.comps.decided.verdict != 'declined')
export let memoryHead = (r: Row) =>
  `${accepted(r) ? '' : '? '}${r.comps.feedback ? 'feedback: ' : ''}`

// The dream batch (T-12800): a venture's consolidation cursor plus the first
// cadence wake that starts it. `scope` is the project the dream combs; `floor`
// starts a week back so the first run has a window. The wake is UNTARGETED
// (deliver.to = the dream), so replaceWakes keeps one cadence clock and the
// server arms it on apply; its knock hooks dreamComb (dream.ts), which re-arms
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

// The recall INDEX: memories screened by preds, warmest first — one
// line each, no bodies. Expansion (and the recall bump that rides it)
// stays behind the ids door: recognition is not retrieval.
export let recallIndex = (
  all: Row[],
  preds: Pred[],
  now: number,
  limit = 20,
) =>
  all.filter((r) => r.comps.memory)
    .filter((r) => matchQuery(r.comps, preds))
    .map((r) => ({ r, score: hot(r.comps, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score }) => {
      let m = r.comps.memory
      let n = Number(r.comps.recall?.count ?? 0)
      let seen = m.last_confirmed_at
        ? ` · confirmed ${String(m.last_confirmed_at).slice(0, 10)}`
        : ''
      return `${idOf(r)} ${score.toFixed(2)} ${memoryHead(r)}${
        r.comps.doc?.title ?? ''
      }${n ? ` · ${n}×` : ''}${seen}`
    })

export let claimant = (all: Row[], r: Row) => {
  let seid = r.comps.claim?.session
  if (!seid) return undefined
  let s = all.find((x) => x.eid == seid)
  return String(s?.comps.session?.id ?? seid)
}
