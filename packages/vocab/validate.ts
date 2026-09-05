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

import type { PropSchema, VocabDoc } from './types.ts'
import type { Vocab } from './vocab.ts'

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
let composites = (s: PropSchema): string[][] =>
  [s.unique, s.index].flatMap((v) => Array.isArray(v) ? v as string[][] : [])

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
    }
    for (let cols of composites(schema)) {
      for (let col of cols) {
        if (!(schema.properties ?? {})[col]) {
          errs.push(`${comp} indexes ${col}, which is no column of ${comp}`)
        }
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
