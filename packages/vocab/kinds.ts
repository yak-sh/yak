// A kind is a named shape: the components that make an entity that kind of
// thing (`is`), and what a whole one also carries (`with`). A document declares
// its kinds beside `$defs`, under `kinds`; a component marked `kind: true`, or
// declaring the `prefix` its ids are numbered in, is the kind of its own name,
// as every vocabulary written before the section was.
//
// This module reads both forms into one table and orders it. The order is
// kindOrder's, with one more constraint read off the shapes: a kind sorts
// before every kind whose `is` its own `is` and `with` contain, so a decision
// (`task` + `decision`) is named before a task.

import type { PropSchema, VocabDoc } from './types.ts'
import { kindOrder } from './order.ts'

/** What a component in a kind's `with` is: `true` when the writer supplies
 * it, or the values a rule gives it when an entity of the kind lacks it. A
 * `boolean`, as a JSON document's `true` is typed; the meta-schema refuses
 * `false`. */
export type With = boolean | Record<string, unknown>

/** A kind, as a document declares it under `kinds`. */
export type KindDecl = {
  title?: string
  description?: string
  /** the components an entity carries to be this kind; left out, the
   * component of the kind's own name */
  is?: string[]
  /** what a whole one also carries, by component */
  with?: Record<string, With>
  /** kinds this kind sorts before, where containment does not settle it */
  before?: string[]
  /** the letter its human ids use (@yaks/id) */
  prefix?: string
  /** whole bundles of one */
  examples?: Record<string, unknown>[]
}

/** A kind, loaded. */
export type Kind = {
  name: string
  title?: string
  description?: string
  is: string[]
  with: Record<string, With>
  before: string[]
  prefix?: string
  examples: Record<string, unknown>[]
  /** the package whose document declared it, where one says */
  package?: string
}

// A component that loads as the kind of its own name.
let named = (def: PropSchema) => def.kind === true || def.prefix != null

// The kind a component declares of its own name.
let fromComp = (name: string, def: PropSchema, pkg?: string): Kind => ({
  name,
  ...(def.title ? { title: def.title as string } : {}),
  ...(def.description ? { description: def.description } : {}),
  is: [name],
  with: {},
  before: def.before ?? [],
  ...(def.prefix != null ? { prefix: def.prefix as string } : {}),
  examples: [],
  ...(pkg ? { package: pkg } : {}),
})

let fromDecl = (name: string, d: KindDecl, pkg?: string): Kind => {
  let is = d.is ?? [name]
  if (!Array.isArray(is) || !is.length) {
    throw new Error(`kind '${name}' says no component it is`)
  }
  return {
    name,
    ...(d.title ? { title: d.title } : {}),
    ...(d.description ? { description: d.description } : {}),
    is,
    with: d.with ?? {},
    before: d.before ?? [],
    ...(d.prefix != null ? { prefix: d.prefix } : {}),
    examples: d.examples ?? [],
    ...(pkg ? { package: pkg } : {}),
  }
}

/** Every kind the documents declare, under `kinds` or as a component of the
 * kind's name, by name. A name declared twice throws, as a component does. */
export let kindsIn = (
  docs: VocabDoc[],
  defs: Record<string, PropSchema>,
  from: Record<string, string>,
): Map<string, Kind> => {
  let out = new Map<string, Kind>()
  let add = (k: Kind) => {
    if (out.has(k.name)) throw new Error(`kind '${k.name}' is declared twice`)
    out.set(k.name, k)
  }
  for (let name of Object.keys(defs).sort()) {
    if (named(defs[name])) add(fromComp(name, defs[name], from[name]))
  }
  for (let doc of docs) {
    let kinds = (doc.kinds ?? {}) as Record<string, KindDecl>
    for (let [name, d] of Object.entries(kinds)) {
      add(fromDecl(name, d, doc.package))
    }
  }
  return out
}

/** The kinds in the order they name an entity: alphabetical, adjusted by
 * `before`, by containment, and with marks after every kind they do not sort
 * before. `mark` says whether a component is one; a kind is a mark when all it
 * is are marks. */
export let orderKinds = (
  kinds: Map<string, Kind>,
  mark: (comp: string) => boolean,
): string[] => {
  let all = [...kinds.values()]
  let carries = new Map(
    all.map((k) => [k.name, new Set([...k.is, ...Object.keys(k.with)])]),
  )
  let contained = (k: Kind) =>
    all.filter((o) =>
      o.name != k.name && o.is.every((c) => carries.get(k.name)!.has(c))
    ).map((o) => o.name)
  let before = new Map(
    all.map((k) => [k.name, [...k.before, ...contained(k)]]),
  )
  return kindOrder(
    [...kinds.keys()],
    (k) => before.get(k) ?? [],
    (k) => kinds.get(k)!.is.every(mark),
  )
}
