// An edge's identity, and the two changes that say one (D-23820). An edge
// entity is content-addressed from its SENTENCE, the way a blob's eid is its
// bytes' hash and a commit's is its sha: writing the same sentence twice finds
// one entity, and an unlink names it with no lookup. This is THE derivation —
// every door, client and reader computes it here and nowhere else.
import { sha } from './sha.ts'
import type { Change, Dep, Edge } from './types.ts'
import { edges } from './types.ts'

// eid = the leading 16 bytes of sha256(`${from}|${nature}|${to}`), worn as a
// UUID: version nibble 8 (RFC 9562's custom-derivation version) and the
// variant bits stamped, so it passes every uuid door and can never collide
// with a minted v4. Direction is part of the sentence: `a requires b` and
// `b requires a` are two edges.
export let edgeEid = (from: string, nature: string, to: string): string => {
  let h = sha(`${from}|${nature}|${to}`).slice(0, 32)
  let variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  let s = `${h.slice(0, 12)}8${h.slice(13, 16)}${variant}${h.slice(17)}`
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${
    s.slice(16, 20)
  }-${s.slice(20)}`
}

// A relation has two spellings and they are not interchangeable: the TYPE is
// what every read and every query says (`referenced`), the NATURE is the comp
// the edge entity wears (`references`, present tense for a live relationship).
// `recalled` keeps its past tense because it is the one nature that is an
// EVENT: the edge wears `recalled{at}` — the case D-23820 names, a relation
// with a time carried by the sentence rather than forced onto either end
// (T-32471).
export let natureOf: Record<string, string> = Object.fromEntries(
  edges.map((t) => [t, t == 'referenced' ? 'references' : t]),
)
export let typeOf: Record<string, string> = Object.fromEntries(
  Object.entries(natureOf).map(([t, n]) => [n, t]),
)
export let natures = Object.values(natureOf)

// The eid a BUNDLE derives from what it says. A `$alias` means the door
// chooses the eid; for a content-addressed entity choosing IS deriving, so an
// edge bundle — `edge{from, to}` beside its nature tag — resolves to the
// sentence's own eid, and the alias map reports it (T-33622). `ends` answers
// what an endpoint names, since a bundle may spell one as another alias, a
// nested bundle, or a human id. An incomplete sentence derives nothing and
// falls back to a minted eid, where apply() says exactly what it lacks.
//
// A blob and a commit are content-addressed too, and neither can be derived
// here: their content never enters the graph (`blob{bytes}` is a LENGTH, the
// bytes live beside the db), so those writers name the hash they already hold
// and the bundle door mints at it (client.ts `coined`).
export let saidEid = (
  comps: Record<string, Record<string, unknown> | null>,
  ends: (target: unknown) => string,
): string | undefined => {
  let said = comps.edge
  if (!said) return undefined
  let nature = Object.keys(comps).find((n) => comps[n] && typeOf[n])
  if (!nature || said.from == null || said.to == null) return undefined
  return edgeEid(ends(said.from), nature, ends(said.to))
}

let verbOf = (type: string) => {
  let nature = natureOf[type]
  if (!nature) throw new Error(`unknown edge type: ${type}`)
  return nature
}

// SAYING a sentence: the edge entity's two ends, and the nature tag that is its
// verb. This is the only way to write an edge — there is no edge row and no
// component that names a triple, so a writer says the entity the sentence
// derives. `ord` is PATCH-shaped: naming it sets the listing order, omitting it
// leaves the stored one alone.
export let link = (
  from: string,
  type: Edge | string,
  to: string,
  ord?: number,
): Change[] => {
  let nature = verbOf(type)
  let eid = edgeEid(from, nature, to)
  return [
    {
      eid,
      name: 'edge',
      comp: ord === undefined ? { from, to } : { from, to, ord },
    },
    {
      eid,
      name: nature,
      // Every nature is a bare tag but `recalled`, which is an event: the edge
      // carries the recall's clock (D-23820, T-32471). Now IS the recalling
      // entry's birth — recall.ts mints the entry and its links in one batch.
      comp: nature == 'recalled' ? { at: new Date().toISOString() } : {},
    },
  ]
}

// Unlinking is not a DEATH. The sentence is no longer said, and the same
// sentence may be said again tomorrow — so its COMPS go and the spine stays.
// An entity wearing nothing is invisible to every reader; deleting the entity
// instead would tombstone an eid that is DERIVED from the sentence, and a
// tombstone is forever, so `A requires B` could never be said again (T-23824).
// An endpoint's death still reaps the whole entity through edge's own cascades:
// that sentence cannot become true again, because one of its ends is gone.
export let unlink = (
  from: string,
  type: Edge | string,
  to: string,
): Change[] => {
  let nature = verbOf(type)
  let eid = edgeEid(from, nature, to)
  return [{ eid, name: nature, comp: null }, { eid, name: 'edge', comp: null }]
}

// The sentences a BATCH says or unsays, read back out of its edge writes — the
// one reader for every consumer that used to scan the batch for edge rows
// (live caches, the subscription riders, the comms bus).
//
// A link names its whole triple: `edge{from, to}` beside the nature tag. An
// unlink names only the edge's EID — its ends have left the batch and the graph
// — so whoever HELD the sentence answers for it, which every such consumer can
// do because holding it is what makes the loss news.
export type Move = { dep: Dep; gone: boolean }
type Told = { from?: string; to?: string; type?: Edge; ord?: number }
export let moves = (
  changes: Change[],
  held: (eid: string) => Dep | undefined = () => undefined,
): Move[] => {
  // One record per edge entity, folded IN ORDER: the last thing a change says
  // about a sentence is what the batch says. A catch-up stream that mints an
  // edge and then reaps it must read as a loss, not as the link it opened with.
  let told = new Map<string, Told & { gone: boolean }>()
  let order: string[] = []
  let at = (eid: string) => {
    let t = told.get(eid)
    if (!t) {
      told.set(eid, t = { gone: false })
      order.push(eid)
    }
    return t
  }
  for (let { eid, name, comp } of changes) {
    let nature = typeOf[name]
    if (name == 'edge') {
      let t = at(eid)
      if (comp == null) t.gone = true
      else if (comp.from != null && comp.to != null) {
        t.gone = false
        t.from = String(comp.from)
        t.to = String(comp.to)
        if (comp.ord != null) t.ord = Number(comp.ord)
      }
    } else if (nature) {
      let t = at(eid)
      t.gone = comp == null
      if (comp != null) t.type = nature as Edge
    } else if (name == 'entity' && comp == null) at(eid).gone = true
  }
  let out: Move[] = []
  for (let eid of order) {
    // What the batch did not name, whoever HELD the sentence answers for.
    let was = held(eid)
    let t = told.get(eid)!
    let parent = t.from ?? was?.parent
    let child = t.to ?? was?.child
    let type = t.type ?? was?.type
    if (!parent || !child || !type) continue
    let ord = t.ord ?? was?.ord
    out.push({
      dep: { parent, type, child, ...(ord == null ? {} : { ord }) },
      gone: t.gone,
    })
  }
  return out
}

// The sentence store as SQL, read from the edge ENTITIES (T-23824). `edge`
// names the two ends and its listing order; the nature comp names the verb. The
// projected columns — parent, type, child, ord — are the read shape every
// client has always spoken, and `type` is the read's spelling (`referenced`,
// never `references`). The nature list is the vocabulary's, so a new nature
// joins every reader here with no further edit.
//
// `only` is a WHERE over the EDGE's own columns (`g."from"`, `g."to"`,
// `g.entity`), and it belongs INSIDE: a narrowing left to the caller's outer
// query is applied only after the whole store is built, which measured 26ms
// against 1.4ms for one entity's edges on the live graph.
//
// Three shapes, because sqlite answers them differently:
//   - a NAMED nature is its own table, so the join IS the type test — no union,
//     and no `+d.type` trick needed to stop the planner preferring the type
//     over the endpoint it should be seeking.
//   - NARROWED and untyped: seek `edge` once and ask each nature table for the
//     verb — twelve primary-key probes over the few rows found (0.2ms).
//   - WHOLE and untyped: one branch per nature, unioned, so each nature table
//     is walked once (56ms) instead of 125k rows being probed twelve times
//     over (265ms).
// The same store read WITHOUT the verb, for a walk that only asks whether one
// entity links to another (projectReachability's rooted closure, and the Rust
// mirror in rooted.rs). Naming a nature there is not just unused, it is
// expensive: the twelve-branch union is re-walked at EVERY step of the
// recursion, which measured 81ms against 7ms for the bare `edge` table on the
// live graph — the whole of the closure's regression against the row store.
// The ends are the edge's own columns, so this is one indexed table.
export let links = `select g."from" as parent, g."to" as child from edge g`

export let sentences = (type?: string, only = '') => {
  let head = (verb: string) =>
    `select g."from" as parent, ${verb} as type,` +
    ` g."to" as child, g.ord as ord from edge g`
  let where = only ? ` where ${only}` : ''
  if (type) {
    return `${head(`'${type}'`)}` +
      ` join "${natureOf[type]}" n on n.entity = g.entity${where}`
  }
  if (!only) {
    return natures.map((n) =>
      `${head(`'${typeOf[n]}'`)} join "${n}" n on n.entity = g.entity`
    ).join(' union all ')
  }
  // An `edge` row always wears a nature — every door writes both or neither —
  // so a null verb is an anomaly, and it leaves here rather than reaching a
  // reader as a sentence with no word in the middle.
  let verb = `(case ${
    natures.map((n) =>
      `when exists (select 1 from "${n}" x where x.entity = g.entity)` +
      ` then '${typeOf[n]}'`
    ).join(' ')
  } end)`
  return `select parent, type, child, ord from (${head(verb)}${where})` +
    ` where type is not null`
}
