// Validating a vocabulary document — ordinary well-formedness, the checks a
// store runs over a hand-written app manifest, expressed over JSON Schema.
// Three kinds of error, each naming the offending entry and the fix, because
// the agent reading it has no other source:
//   storable  the shape a table can lower — a top-level object of typed
//             scalar / ref / enum / JSON properties, no recursive $ref
//   reserved  a name the base vocabulary already owns is rejected
//   grow      evolution is additive forever — never drop or retype a property,
//             the rows are already written under the old type
//
// This is not a new security story: a hosted store only creates tables for
// components it declares, and these errors are what a person's agent reads
// when a deploy is rejected.

import type { Composite, PropSchema, VocabDoc } from './types.ts'
import { composite, jsonb, TYPES, typesOf, type Vocab } from './vocab.ts'
import { lives, SYNC, type Sync } from './lifetime.ts'

let NAME = /^[a-z][a-z0-9_]{0,39}$/

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// One property schema is storable when it names a scalar, a reference, a
// closed set, or a JSON value — an object, an array, or a union of types,
// which a table holds in one column as binary JSON. Every property says its
// type. A JSON property may declare its structure (`properties`, `items`);
// nothing validates that structure yet.
let storableProp = (
  comp: string,
  prop: string,
  s: PropSchema,
): string[] => {
  if (!object(s)) return [`${comp}.${prop} is a schema object`]
  if (s.$ref) {
    return [
      `${comp}.${prop} uses $ref — a property cannot lower a recursive reference`,
    ]
  }
  let said = typesOf(s)
  if (!said.length) {
    return [
      `${comp}.${prop} declares no type — say "type": "string" (or ${
        TYPES.slice(1).join(', ')
      })`,
    ]
  }
  let known = Array.isArray(s.type) ? [...TYPES, 'null'] : TYPES
  let odd = said.filter((t) => !known.includes(t))
  if (odd.length) {
    return [`${comp}.${prop} has type '${odd[0]}' — one of ${TYPES.join(', ')}`]
  }
  if (s.properties && !said.includes('object')) {
    return [`${comp}.${prop} has properties — say "type": "object"`]
  }
  if (s.items !== undefined && !said.includes('array')) {
    return [`${comp}.${prop} has items — say "type": "array"`]
  }
  if ((s.ref != null || s.enum != null) && s.type != 'string') {
    return [
      `${comp}.${prop} is ${
        s.ref != null ? 'a reference' : 'a closed set'
      } — its type is "string"`,
    ]
  }
  if (s.ref != null) {
    let words = ['cascade', 'detach', 'release', 'keep']
    return words.includes(s.death ?? '') ? [] : [
      `${comp}.${prop} is a reference without a death word (${
        words.join('|')
      })`,
    ]
  }
  return []
}

// The composite index lists a component declares, both keywords together. An
// index over a property the component never declares would emit DDL no table
// can take, so the names are checked here where an error can still teach.
let composites = (s: PropSchema): { props: string[]; present?: string[] }[] =>
  [s.unique, s.index].flatMap((v) =>
    Array.isArray(v) ? (v as Composite[]).map(composite) : []
  )

// A default a row can take: a scalar literal, or the clock on a time property.
let storableDefault = (comp: string, prop: string, s: PropSchema): string[] => {
  let d = s.default
  if (d === undefined) return []
  if (jsonb(s)) return [`${comp}.${prop} holds JSON and takes no default`]
  if (typeof d == 'string' || typeof d == 'number' || typeof d == 'boolean') {
    return []
  }
  if (object(d) && (d as { now?: unknown }).now === true) {
    return s.format == 'date-time' ? [] : [
      `${comp}.${prop} defaults to now but is no date-time property`,
    ]
  }
  return [
    `${comp}.${prop} has a default no property can hold (a literal, or {"now": true})`,
  ]
}

// `search` declares that this property is full-text indexed (@yaks/fts builds
// the index from the declaration). Only prose has words to index: a number, a
// stamp, a reference and a closed set are matched by their value rather than
// read, and a computed property has no stored value to index — so the keyword
// is rejected anywhere but a stored text property, where it would otherwise
// declare an index over nothing.
let WORDLESS = ['date-time', 'uri', 'query', 'json']
let searched = (comp: string, prop: string, s: PropSchema): string[] =>
  s.search !== true ||
    (s.computed !== true && s.ref == null && s.enum == null &&
      s.type == 'string' &&
      !WORDLESS.includes(s.format ?? ''))
    ? []
    : [
      `${comp}.${prop} is searched but holds no prose — "search": true is for a stored text property`,
    ]

// A component carrying the whole provenance triple is a mark — `completed`,
// `archived`, `created` — and the server writes a mark, never a client: the
// graph fills all three from the batch's clock and actor (@yaks/graph
// stamp.ts), so a client-writable one is a property anyone may forge and
// nothing will correct. Two of the three is somebody's own vocabulary — a
// letter's `at` and the address it went `via` — and means nothing here.
let PROVENANCE = ['at', 'by', 'via']
let signed = (comp: string, s: PropSchema): string[] => {
  let props = s.properties ?? {}
  if (!PROVENANCE.every((c) => props[c])) return []
  return PROVENANCE.filter((c) => !props[c].stamped).map((c) =>
    `${comp}.${c} is wire-writable — a component carrying the whole {at, by, via} is a mark the server signs, so mark every one of them "stamped": true`
  )
}

// What a component declares about its own state, checked as a pair. Each
// keyword is legal on its own — the meta-schema already rejects an unknown
// value — but one combination is a contradiction: a relay does not own durable
// data, so a component cannot ask the server both to forward a value without
// storing it and to keep it forever.
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

// The properties an identity spans, both forms together — the component's list,
// or the properties that flagged themselves.
let identified = (s: PropSchema): string[] =>
  Array.isArray(s.identity) ? s.identity : Object.entries(s.properties ?? {})
    .filter(([, c]) => object(c) && c.identity === true)
    .map(([prop]) => prop)

// The storable profile over a whole document: every component entry is an
// object schema whose properties are all storable.
export let storable = (doc: VocabDoc): string[] => {
  let errs: string[] = []
  for (let [comp, schema] of Object.entries(doc.$defs ?? {})) {
    // Each $defs entry declares what it is (vocab.ts `loadVocab`): a tool
    // declaration is checked as a tool, an ordinary subschema is not checked at
    // all, and only a marked component is checked as a table. An entry with
    // properties and no marker is a forgotten marker, reported here so a deploy
    // fails where the message can still teach.
    if (!object(schema) || schema.tool === true || schema.rule === true) {
      continue
    }
    if (schema.component !== true) {
      if (schema.properties || schema.type == 'object') {
        errs.push(
          `${comp} has properties but says no "component": true — mark it a ` +
            'component, or it is an ordinary subschema and no table',
        )
      }
      continue
    }
    if (!NAME.test(comp)) {
      errs.push(`${JSON.stringify(comp)} is not a component name (a-z, 0-9, _)`)
    }
    if (schema.type != null && schema.type != 'object') {
      errs.push(`${comp} is an object schema (type 'object')`)
    }
    for (let [prop, s] of Object.entries(schema.properties ?? {})) {
      if (!NAME.test(prop) || prop == 'entity' || prop == 'eid') {
        errs.push(`${comp}.${JSON.stringify(prop)} is not a property name`)
      }
      errs.push(...storableProp(comp, prop, s))
      if (object(s)) errs.push(...storableDefault(comp, prop, s))
      if (object(s)) errs.push(...searched(comp, prop, s))
    }
    errs.push(...signed(comp, schema))
    errs.push(...lived(comp, schema))
    for (let c of composites(schema)) {
      for (let prop of [...c.props, ...(c.present ?? [])]) {
        if (!(schema.properties ?? {})[prop]) {
          errs.push(`${comp} indexes ${prop}, which is no property of ${comp}`)
        }
      }
    }
    // A required property is one every row holds: it has to be a stored
    // property, and a computed one has no cell to hold anything.
    for (let prop of schema.required ?? []) {
      let c = (schema.properties ?? {})[prop]
      if (!c) {
        errs.push(`${comp} requires ${prop}, which is no property of ${comp}`)
      } else if (c.computed === true) {
        errs.push(`${comp}.${prop} is computed — it cannot be required`)
      }
    }
    // An id is derived from what the writer states, at the moment the entity is
    // minted: a property nothing writes — computed, or server-owned and stamped
    // after the fact — could never name the entity it identifies.
    for (let prop of identified(schema)) {
      let c = (schema.properties ?? {})[prop]
      if (!c) {
        errs.push(
          `${comp} is identified by ${prop}, which is no property of it`,
        )
      } else if (c.computed === true || c.stamped) {
        errs.push(
          `${comp}.${prop} is ${
            c.stamped ? 'server-owned' : 'computed'
          } — an identity is derived from what the writer states`,
        )
      }
    }
  }
  return errs
}

// Names the base vocabulary already owns are rejected — a component name means
// the same thing in every store, so an app cannot redeclare one.
export let reserved = (doc: VocabDoc, base: Iterable<string>): string[] => {
  let taken = new Set(base)
  return Object.keys(doc.$defs ?? {})
    .filter((name) => taken.has(name))
    .map((name) =>
      `'${name}' is a word the platform already owns — pick another name`
    )
}

// A property's storage identity: what a retype would change under it. Enum
// values may grow (widening a closed set is additive); category, scalar and ref
// kind may not move, because the rows were written under the old type.
let identity = (v: Vocab, comp: string, prop: string): string => {
  let c = v.prop(comp, prop)!
  return `${c.category}:${c.scalar ?? ''}:${c.ref ?? ''}`
}

// Additive evolution: `was` → `next`. A property that changed its storage
// identity is rejected; a property `next` no longer declares is rejected (its
// rows are still there); everything genuinely new is reported in `added`.
export let grow = (
  was: Vocab,
  next: Vocab,
): { added: string[]; errors: string[] } => {
  let added: string[] = []
  let errors: string[] = []
  for (let comp of next.all) {
    let hadComp = was.all.includes(comp)
    for (let prop of next.props(comp)) {
      if (hadComp && was.prop(comp, prop)) {
        let before = identity(was, comp, prop)
        let after = identity(next, comp, prop)
        if (before != after) {
          errors.push(
            `${comp}.${prop} was ${before}, now ${after} — a property keeps the type its rows were written under`,
          )
        }
      } else {
        added.push(`${comp}.${prop}`)
      }
    }
  }
  for (let comp of was.all) {
    let dropped = next.all.includes(comp)
      ? was.props(comp).filter((p) => !next.prop(comp, p))
      : was.props(comp)
    for (let p of dropped) {
      errors.push(
        `${comp}.${p} was dropped — a property only ever arrives, never leaves`,
      )
    }
  }
  return { added, errors }
}
