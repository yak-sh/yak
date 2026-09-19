// Validating a vocab DOCUMENT — ordinary well-formedness, the checks a store
// runs over a hand-written app manifest, said over JSON Schema instead. Three
// refusals, each naming the file and the fix, because the agent reading it has
// no other source:
//   storable  the shape a table can lower — a top-level object of scalar / ref /
//             enum columns, no nesting, no arrays, no recursive $ref
//   reserved  a name the base vocabulary already owns is refused
//   grow      evolution is ADDITIVE forever — never drop or retype a column, the
//             rows are already written under the old word
//
// This is not a new security story: a hosted store lowers only its own words,
// and these refusals are what a person's agent reads when a deploy is rejected.

import type { Composite, PropSchema, VocabDoc } from './types.ts'
import { composite, type Vocab } from './vocab.ts'
import { lives, SYNC, type Sync } from './lifetime.ts'

let NAME = /^[a-z][a-z0-9_]{0,39}$/

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// One property schema is storable when it names a scalar, a reference, or a
// closed set — nothing a table cannot hold in one column.
let storableProp = (
  comp: string,
  prop: string,
  s: PropSchema,
): string[] => {
  if (!object(s)) return [`${comp}.${prop} is a schema object`]
  if (s.$ref) {
    return [
      `${comp}.${prop} uses $ref — a column cannot lower a recursive reference`,
    ]
  }
  if (s.properties) {
    return [`${comp}.${prop} is nested — a column is a scalar, not an object`]
  }
  if (s.type == 'array' || s.type == 'object') {
    return [`${comp}.${prop} is ${s.type} — a column is a scalar`]
  }
  if (s.ref != null) {
    let words = ['cascade', 'detach', 'release', 'keep']
    return words.includes(s.death ?? '') ? [] : [
      `${comp}.${prop} is a reference without a death word (${
        words.join('|')
      })`,
    ]
  }
  if (s.enum != null) return []
  let ok = ['string', 'number', 'integer', 'boolean']
  return s.type == null || ok.includes(s.type)
    ? []
    : [`${comp}.${prop} has type '${s.type}' — one of ${ok.join(', ')}`]
}

// The composite index lists a component declares, both keywords together. An
// index over a column the component never declares would emit DDL no table can
// take, so the names are checked here where a refusal can still teach.
let composites = (s: PropSchema): { cols: string[]; present?: string[] }[] =>
  [s.unique, s.index].flatMap((v) =>
    Array.isArray(v) ? (v as Composite[]).map(composite) : []
  )

// A default a row can take: a scalar literal, or the clock on a time column.
let storableDefault = (comp: string, prop: string, s: PropSchema): string[] => {
  let d = s.default
  if (d === undefined) return []
  if (typeof d == 'string' || typeof d == 'number' || typeof d == 'boolean') {
    return []
  }
  if (object(d) && (d as { now?: unknown }).now === true) {
    return s.format == 'date-time' ? [] : [
      `${comp}.${prop} defaults to now but is no date-time column`,
    ]
  }
  return [
    `${comp}.${prop} has a default no column can hold (a literal, or {"now": true})`,
  ]
}

// `search` says this column's words are indexed (@yaks/fts cuts the index from
// the declaration). Only PROSE has words: a number, a stamp, a reference and a
// closed set are matched by their value rather than read, and a computed column
// has no row to index — so the keyword is refused anywhere but a stored text
// column, where it would otherwise name an index over nothing.
let WORDLESS = ['date-time', 'uri', 'query', 'json']
let searched = (comp: string, prop: string, s: PropSchema): string[] =>
  s.search !== true ||
    (s.computed !== true && s.ref == null && s.enum == null &&
      (s.type == null || s.type == 'string') &&
      !WORDLESS.includes(s.format ?? ''))
    ? []
    : [
      `${comp}.${prop} is searched but holds no prose — "search": true is for a stored text column`,
    ]

// A component wearing the whole provenance triple is a MARK — `completed`,
// `archived`, `created` — and a mark is SIGNED, never stated: the graph fills
// all three from the batch's clock and actor (@yaks/graph stamp.ts), so a
// wire-writable one is a column anyone may forge and nothing will correct.
// TWO of the three is somebody's own vocabulary — a letter's `at` and the
// address it went `via` — and says nothing about this.
let PROVENANCE = ['at', 'by', 'via']
let signed = (comp: string, s: PropSchema): string[] => {
  let props = s.properties ?? {}
  if (!PROVENANCE.every((c) => props[c])) return []
  return PROVENANCE.filter((c) => !props[c].stamped).map((c) =>
    `${comp}.${c} is wire-writable — a component carrying the whole {at, by, via} is a mark the server signs, so mark every one of them "stamped": true`
  )
}

// What a component says about its own state, checked as a PAIR. Each word is
// legal on its own — the meta-schema already refuses a misspelling — but one
// combination is a contradiction: a relay does not own durable data, so a
// component cannot ask the server to forward a value without keeping it AND to
// keep it forever.
let lived = (comp: string, s: PropSchema): string[] => {
  let errs: string[] = []
  if (s.sync != null && !SYNC.includes(s.sync as Sync)) {
    errs.push(
      `${comp} syncs "${s.sync}" — a component syncs to ${SYNC.join(', ')}`,
    )
  }
  if (s.durable != null && !lives(s.durable)) {
    errs.push(
      `${comp} is durable "${s.durable}" — say "forever", "connection", or a duration such as "5s" or "2m"`,
    )
  }
  if (s.sync == 'peers' && s.durable == 'forever') {
    errs.push(
      `${comp} syncs to peers and is durable forever — a relay hands a value on without owning it, so it has nowhere to keep one; say "connection" or a duration, or sync to the server`,
    )
  }
  return errs
}

// The columns an identity is spelled across, both spellings together — the
// component's list, or the columns that flagged themselves.
let identified = (s: PropSchema): string[] =>
  Array.isArray(s.identity) ? s.identity : Object.entries(s.properties ?? {})
    .filter(([, c]) => object(c) && c.identity === true)
    .map(([prop]) => prop)

// The storable profile over a whole document: every $def is an object schema
// whose properties are storable columns.
export let storable = (doc: VocabDoc): string[] => {
  let errs: string[] = []
  for (let [comp, schema] of Object.entries(doc.$defs ?? {})) {
    if (!NAME.test(comp)) {
      errs.push(`${JSON.stringify(comp)} is not a component name (a-z, 0-9, _)`)
    }
    if (!object(schema)) {
      errs.push(`${comp} is a schema object`)
      continue
    }
    if (schema.type != null && schema.type != 'object') {
      errs.push(`${comp} is an object schema (type 'object')`)
    }
    for (let [prop, s] of Object.entries(schema.properties ?? {})) {
      if (!NAME.test(prop) || prop == 'entity' || prop == 'eid') {
        errs.push(`${comp}.${JSON.stringify(prop)} is not a column name`)
      }
      errs.push(...storableProp(comp, prop, s))
      if (object(s)) errs.push(...storableDefault(comp, prop, s))
      if (object(s)) errs.push(...searched(comp, prop, s))
    }
    errs.push(...signed(comp, schema))
    errs.push(...lived(comp, schema))
    for (let c of composites(schema)) {
      for (let col of [...c.cols, ...(c.present ?? [])]) {
        if (!(schema.properties ?? {})[col]) {
          errs.push(`${comp} indexes ${col}, which is no column of ${comp}`)
        }
      }
    }
    // A required column is one every row holds: it has to be a stored column,
    // and a computed one has no cell to hold anything.
    for (let col of schema.required ?? []) {
      let c = (schema.properties ?? {})[col]
      if (!c) {
        errs.push(`${comp} requires ${col}, which is no column of ${comp}`)
      } else if (c.computed === true) {
        errs.push(`${comp}.${col} is computed — it cannot be required`)
      }
    }
    // An id is derived from what the WRITER states, at the moment the entity is
    // minted: a column nothing writes — computed, or server-owned and stamped
    // after the fact — could never name the entity it identifies.
    for (let col of identified(schema)) {
      let c = (schema.properties ?? {})[col]
      if (!c) {
        errs.push(`${comp} is identified by ${col}, which is no column of it`)
      } else if (c.computed === true || c.stamped) {
        errs.push(
          `${comp}.${col} is ${
            c.stamped ? 'server-owned' : 'computed'
          } — an identity is derived from what the writer states`,
        )
      }
    }
  }
  return errs
}

// Names the base vocabulary already owns are refused — a word means the same
// thing in every store, so an app cannot redeclare one.
export let reserved = (doc: VocabDoc, base: Iterable<string>): string[] => {
  let taken = new Set(base)
  return Object.keys(doc.$defs ?? {})
    .filter((name) => taken.has(name))
    .map((name) =>
      `'${name}' is a word the platform already owns — pick another name`
    )
}

// A column's storage identity: what a retype would change under it. Enum values
// may GROW (widening a closed set is additive); category, scalar and ref kind
// may not move, because the rows were written under the old word.
let identity = (v: Vocab, comp: string, prop: string): string => {
  let c = v.column(comp, prop)!
  return `${c.category}:${c.scalar ?? ''}:${c.ref ?? ''}`
}

// Additive evolution: `was` → `next`. A column that changed its storage identity
// is refused; a column `next` stopped naming is refused (its rows are still
// there); everything genuinely new is reported in `added`.
export let grow = (
  was: Vocab,
  next: Vocab,
): { added: string[]; errors: string[] } => {
  let added: string[] = []
  let errors: string[] = []
  for (let comp of next.all) {
    let hadComp = was.all.includes(comp)
    for (let prop of next.columns(comp)) {
      if (hadComp && was.column(comp, prop)) {
        let before = identity(was, comp, prop)
        let after = identity(next, comp, prop)
        if (before != after) {
          errors.push(
            `${comp}.${prop} was ${before}, now ${after} — a column keeps the type its rows were written under`,
          )
        }
      } else {
        added.push(`${comp}.${prop}`)
      }
    }
  }
  for (let comp of was.all) {
    let dropped = next.all.includes(comp)
      ? was.columns(comp).filter((p) => !next.column(comp, p))
      : was.columns(comp)
    for (let p of dropped) {
      errors.push(
        `${comp}.${p} was dropped — a column only ever arrives, never leaves`,
      )
    }
  }
  return { added, errors }
}
