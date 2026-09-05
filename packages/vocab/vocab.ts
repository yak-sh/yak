// The runtime. `loadVocab(docs)` reads one or more JSON Schema vocab documents
// into an in-memory `Vocab` and exposes the interrogation + routing API a binder
// (@yaks/sql) consumes: what a column IS, how a dotted path routes to
// {comp, prop} hops, the derived kindOrder and the kind an entity carries, and
// whether an instance is well-formed. The same questions a hand-generated set
// of types answers over one hardcoded vocabulary, answered here over a LOADED
// instance instead — parameterized, not hardcoded.
//
// A vocab ships zero components: your components are an instance it loads, and a
// small app is a smaller instance in the same format.

import type {
  Assoc,
  Column,
  CompInfo,
  Death,
  Hop,
  PropSchema,
  Scalar,
  VocabDoc,
} from './types.ts'
import type { Keywords } from './keywords.ts'
import { kindOrder as deriveKindOrder } from './order.ts'

// The extension keywords a registration admits, picked off a schema verbatim.
// A keyword the caller did not register is invisible: the loader carries what
// somebody asked for and nothing else.
let carried = (
  s: PropSchema,
  names: Set<string>,
): Record<string, unknown> => {
  let out: Record<string, unknown> = {}
  for (let n of names) if (s[n] !== undefined) out[n] = s[n]
  return out
}

// One property schema → the column it describes. The scalar spelling is
// reconstructed from native JSON Schema (`type` + `format`), so a vocab
// authored in plain JSON Schema round-trips to this compact type set.
let scalarOf = (s: PropSchema): Scalar => {
  if (s.type == 'boolean') return 'bool'
  if (s.type == 'number' || s.type == 'integer') {
    return s.format == 'priority' ? 'priority' : 'number'
  }
  if (s.format == 'date-time') return 'time'
  if (s.format == 'uri') return 'url'
  if (s.format == 'query') return 'query'
  return 'text'
}

let affinityOf = (
  category: Column['category'],
  scalar: Scalar | undefined,
): Column['affinity'] =>
  category == 'ref' || scalar == 'bool'
    ? 'integer'
    : scalar == 'number' || scalar == 'priority'
    ? 'real'
    : 'text'

// A death word, narrowed honestly — anything outside the four is undefined
// here and refused by the storable check.
let deathOf = (s?: string): Death | undefined =>
  s == 'cascade' || s == 'detach' || s == 'release' || s == 'keep'
    ? s
    : undefined

let columnOf = (
  comp: string,
  prop: string,
  s: PropSchema,
  extra: Set<string>,
): Column => {
  let category: Column['category'] = s.ref != null
    ? 'ref'
    : s.enum != null
    ? 'enum'
    : 'scalar'
  let scalar = category == 'scalar' ? scalarOf(s) : undefined
  let death = deathOf(s.death)
  return {
    comp,
    prop,
    category,
    scalar,
    values: s.enum ? [...s.enum] : undefined,
    aliases: s.aliases,
    ref: s.ref,
    death,
    stamped: !!s.stamped,
    persist: s.persist !== false,
    affinity: affinityOf(category, scalar),
    // A reference carries an FK to entity(id) unless its death is 'keep' — a
    // kept ref outlives its target's tombstone, so it stays FK-free (ddl.ts).
    fk: category == 'ref' && death != 'keep',
    keywords: carried(s, extra),
  }
}

// The interrogation surface. Every method answers over the loaded instance;
// none reads a global.
export type Vocab = {
  docs: VocabDoc[]
  keywords: Keywords[] // the extension vocabularies this load registered
  comps: string[] // wire-writable component names, alphabetical
  all: string[] // every declared component name, alphabetical
  kinds: string[] // kindOrder: alphabetical, refined by `before`, topo-sorted
  comp: (name: string) => CompInfo | undefined
  columns: (comp: string) => string[] // readable columns (writable ∪ stamped)
  column: (comp: string, prop: string) => Column | undefined
  route: (prop: string) => { comp: string; prop: string }
  /** A dotted path → the hops it names. `facet` says the predicate is the bare
   * presence form (`.name!`), where a single segment naming a COMPONENT is that
   * component's facet even if a same-named column would otherwise claim the
   * bare spelling. */
  aim: (path: string, facet?: boolean) => Hop[]
  assoc: (name: string) => Assoc | undefined
  kindOf: (has: Record<string, unknown>) => string
  deaths: (word: Death) => [string, string][]
  refCols: () => [string, string][]
  check: (
    comp: string,
    value: Record<string, unknown>,
    opts?: { stamped?: boolean },
  ) => string[]
}

// The spine, and the identity column no vocabulary authors. A document declares
// what `entity` STORES beside it (the number a store mints); the `eid` is the
// model's — every entity has one — so the loader ROUTES it (`.eid=`,
// `.entity.eid=`) rather than making each vocabulary re-declare it. It stays
// out of `columns()` on purpose: identity is not prose and has no row of its
// own, so it never reaches a text index, an embedding, or a component's DDL.
let SPINE = 'entity'
let EID = 'eid'

// A component's whole shape in one line, for a refusal that teaches: `doc has
// title (text), body (body)`. A refusal naming only what it failed to parse
// teaches nothing.
let shapeOf = (v: Vocab, comp: string): string => {
  let cols = v.columns(comp)
  if (!cols.length) return `${comp} has no columns`
  let said = cols.map((p) => {
    let c = v.column(comp, p)!
    let t = c.category == 'enum'
      ? c.values!.join('|')
      : c.category == 'ref'
      ? 'eid'
      : c.scalar
    return `${p} (${t})`
  })
  return `${comp} has ${said.join(', ')}`
}

export let loadVocab = (
  input: VocabDoc | VocabDoc[],
  keywords: Keywords[] = [],
): Vocab => {
  let docs = Array.isArray(input) ? input : [input]
  let compWords = new Set(keywords.flatMap((k) => k.comp ?? []))
  let colWords = new Set(keywords.flatMap((k) => k.column ?? []))
  // Merge every doc's $defs into one component table; a name declared twice is a
  // conflict (a word has one home).
  let defs: Record<string, PropSchema> = {}
  for (let doc of docs) {
    for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
      if (name in defs) throw new Error(`component '${name}' is declared twice`)
      defs[name] = schema
    }
  }

  let props = (name: string): Record<string, PropSchema> =>
    defs[name]?.properties ?? {}
  let cols = new Map<string, Column>() // `${comp}.${prop}` → Column
  let colFor = (comp: string, prop: string): Column | undefined => {
    let key = `${comp}.${prop}`
    if (cols.has(key)) return cols.get(key)
    let s = props(comp)[prop]
    if (!s) return undefined
    let c = columnOf(comp, prop, s, colWords)
    cols.set(key, c)
    return c
  }

  let names = Object.keys(defs).sort()
  let wire = (name: string) => defs[name].wire !== false
  let compNames = names.filter(wire)

  let infoOf = (name: string): CompInfo | undefined => {
    let d = defs[name]
    if (!d) return undefined
    let entries = Object.keys(props(name))
    return {
      name,
      wire: d.wire !== false,
      kind: !!d.kind,
      before: d.before ?? [],
      // A computed column (persist: false) is readable, never writable — like a
      // stamped one, but with no storage either.
      writable: entries.filter((p) => {
        let s = props(name)[p]
        return !s.stamped && s.persist !== false
      }),
      stamped: entries.filter((p) => props(name)[p].stamped),
      keywords: carried(d, compWords),
    }
  }

  // The readable routing table: every component to its readable columns. A tag
  // component routes with an empty list (`.about!` is a presence test).
  let routes = new Map<string, string[]>()
  for (let name of names) routes.set(name, Object.keys(props(name)))

  // Reverse index: a bare prop to the components that declare it. A column (or
  // whole component) marked `bare: false` never claims a bare spelling — it is
  // reached qualified only — so it stays out of this index entirely.
  let owners = new Map<string, string[]>()
  for (let [comp, ps] of routes) {
    if (defs[comp].bare === false) continue
    for (let p of ps) {
      if (props(comp)[p].bare === false) continue
      owners.set(p, [...(owners.get(p) ?? []), comp])
    }
  }

  // A plural that is a NAME, not English: uniqueness is the goal, so 'shelf' →
  // 'shelfs' is fine and 'series' → 'series' stays put.
  let plural = (s: string) =>
    s.endsWith('y') ? `${s.slice(0, -1)}ies` : s.endsWith('s') ? s : `${s}s`

  // The reverse associations, DERIVED from the reference columns and never hand
  // listed, so a new reference column earns its reverse name for free. A
  // component with one reference is named by its plural (`review.book` →
  // `.reviews`); several references disambiguate with the column (`loan.book`,
  // `loan.member` → `.loans_book`, `.loans_member`). A name a real column or
  // component already routes is left alone — the forward spelling always wins —
  // and where two components pluralize alike the alphabetically first keeps it.
  let assocs = new Map<string, Assoc>()
  for (let comp of names) {
    let refs = Object.keys(props(comp))
      .filter((p) => colFor(comp, p)!.category == 'ref')
    for (let prop of refs) {
      let name = refs.length == 1 ? plural(comp) : `${plural(comp)}_${prop}`
      if (owners.has(name) || routes.has(name) || assocs.has(name)) continue
      assocs.set(name, { comp, prop })
    }
  }

  let kinds = deriveKindOrder(
    names.filter((n) => defs[n].kind),
    (k) => defs[k].before ?? [],
  )

  let v: Vocab = {
    docs,
    keywords,
    comps: compNames,
    all: names,
    kinds,
    comp: infoOf,
    columns: (comp) => routes.get(comp) ?? [],
    column: colFor,
    // Bare prop → its owning component. A stamped lifecycle column never steals
    // a bare spelling from a live one (`.status` stays the task's even though
    // sessions carry a stamped status), so non-stamped owners are preferred
    // first. A unique owner wins; several owners that are all references are one
    // read concept (comp '' — the filter scans every owner); any other collision
    // is ambiguous and names the candidates. A bare word that is itself a
    // component name routes as that facet (presence).
    route: (prop) => {
      let own = owners.get(prop) ?? []
      if (own.length > 1) {
        let live = own.filter((c) => !colFor(c, prop)!.stamped)
        if (live.length) own = live
      }
      if (own.length == 1) return { comp: own[0], prop }
      if (own.length > 1) {
        if (own.every((c) => colFor(c, prop)?.category == 'ref')) {
          return { comp: '', prop }
        }
        throw new Error(
          `.${prop} is ambiguous (${own.join(', ')}) — use .${own[0]}.${prop}`,
        )
      }
      if (routes.has(prop)) return { comp: prop, prop: '' }
      if (prop == EID && routes.has(SPINE)) return { comp: SPINE, prop: EID }
      throw new Error(`unknown prop: .${prop}`)
    },
    // A dotted path → the hops it names, one rule per step: a segment naming a
    // COMPONENT with another segment behind it is the explicit `comp.prop`
    // spelling and eats two; anything else is a bare prop routed by name and
    // eats one. Every non-final hop must be a reference for the deref to stand.
    //
    // `facet` is the one exception, and it belongs to the PRESENCE form alone
    // (`.name!`): a bare bang completes a component sentence, so the component
    // wins over a same-named column. It has to — a facet has no other spelling,
    // while the column keeps its qualified one (`.camera.canvas!`). Without it
    // `.canvas!` asks about camera's canvas reference and answers the wrong
    // entities, or none.
    aim: (path, facet) => {
      let segs = path.split('.')
      if (facet && segs.length == 1 && routes.has(segs[0])) {
        return [{ comp: segs[0], prop: '' }]
      }
      let out: Hop[] = []
      for (let i = 0; i < segs.length;) {
        let own = routes.get(segs[i])
        if (own && i + 1 < segs.length) {
          let [a, b] = [segs[i], segs[i + 1]]
          if (!own.includes(b) && !(a == SPINE && b == EID)) {
            throw new Error(`no such prop: .${a}.${b} — ${shapeOf(v, a)}`)
          }
          out.push({ comp: a, prop: b })
          i += 2
        } else {
          out.push(v.route(segs[i]))
          i += 1
        }
      }
      return out
    },
    // A plural name → the reverse association it names, or undefined when the
    // name is no association (a caller then reads the word its own way).
    assoc: (name) => assocs.get(name),
    // The most specific kind an entity carries names it — first present in
    // kindOrder, else the bare spine.
    kindOf: (has) => kinds.find((k) => has[k]) ?? 'entity',
    // The reaper's worklist: every WIRE-WRITABLE reference wearing a death word,
    // as (comp, col) pairs. Stamped refs stay out — server rows die by server
    // code, not the wire's cascade (types.ts deaths()).
    deaths: (word) =>
      compNames.flatMap((comp) =>
        infoOf(comp)!.writable.flatMap((p) => {
          let c = colFor(comp, p)!
          return c.category == 'ref' && c.death == word
            ? [[comp, p] as [string, string]]
            : []
        })
      ),
    // Every reference column, wire-writable OR stamped — index derivation and
    // reverse-hop grammar key off this one list.
    refCols: () =>
      names.flatMap((comp) =>
        Object.keys(props(comp)).flatMap((p) => {
          let c = colFor(comp, p)!
          return c.category == 'ref' ? [[comp, p] as [string, string]] : []
        })
      ),
    // Ordinary well-formedness of an instance: a known component, an object of
    // known columns (wire-writable unless stamped is allowed), each value a
    // scalar the column can hold — no nesting or arrays a table cannot lower.
    check: (comp, value, opts) => {
      let errs: string[] = []
      let info = infoOf(comp)
      if (!info) return [`unknown component '${comp}'`]
      if (value == null || typeof value != 'object' || Array.isArray(value)) {
        return [`${comp} is an object of columns`]
      }
      let allowed = new Set(opts?.stamped ? v.columns(comp) : info.writable)
      for (let [k, val] of Object.entries(value)) {
        if (!allowed.has(k)) {
          errs.push(`no such column ${comp}.${k} — ${shapeOf(v, comp)}`)
          continue
        }
        if (val == null) continue // a null clears the column
        let c = colFor(comp, k)!
        if (typeof val == 'object') {
          errs.push(
            `${comp}.${k} is a scalar, not ${
              Array.isArray(val) ? 'an array' : 'an object'
            }`,
          )
          continue
        }
        if (
          c.category == 'enum' && !c.values!.includes(String(val)) &&
          !(String(val) in (c.aliases ?? {}))
        ) {
          errs.push(`${comp}.${k} is one of ${c.values!.join(', ')}`)
        } else if (
          c.category == 'scalar' &&
          (c.scalar == 'number' || c.scalar == 'priority') &&
          typeof val != 'number'
        ) {
          errs.push(`${comp}.${k} is a number`)
        } else if (
          c.category == 'scalar' && c.scalar == 'bool' &&
          typeof val != 'boolean' && val !== 0 && val !== 1
        ) {
          errs.push(`${comp}.${k} is a bool`)
        }
      }
      return errs
    },
  }
  return v
}
