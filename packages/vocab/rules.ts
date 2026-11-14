// Rules a vocabulary declares. A `$defs` entry marked `rule: true` is a query
// the graph runs over every batch of bundles — and that is the whole
// declaration. There is no implementation to join it to, which is what makes it
// different from a tool: a tool declaration names the tool and a module
// implements it, while a rule's `match` is the implementation. An app ships one
// in its vocab.json and the graph runs it; nobody writes any code.
//
// It has the same shape as `toolsIn` and a fraction of the weight: reading a
// tool declaration means validating its argument schemas, which means a JSON
// Schema validator, which is why that loader is its own entry point. A rule is a name and a
// string, so this loader has no dependencies and is exported from `mod.ts`.
//
// A kind's `with` declares rules too (./kinds.ts): an entry that carries values
// is what a rule gives an entity of the kind that lacks the component, so it
// reads as one, `.design, +!proposed`, named for the kind and the component.

import type { KindDecl } from './kinds.ts'
import type { VocabDoc } from './types.ts'

/**
 * A rule, as a vocabulary declares it.
 *
 * ```ts
 * import { rulesIn } from '@yaks/vocab'
 *
 * rulesIn({
 *   $defs: {
 *     settle: { rule: true, match: '$c .call, results=; +result.call=$c' },
 *   },
 * })
 * // [{ name: 'settle', match: '$c .call, results=; +result.call=$c' }]
 * ```
 */
export type RuleDecl = {
  /** the entry's own name — half the key a rule fires once per, and the name
   * an error message reports */
  name: string
  /** the query: one or more ordinary query patterns separated by `;` */
  match: string
  /** what this rule runs before, so order is declared and never incidental */
  before?: string[]
  /** a page runs it on its own copy as it writes, before its server has */
  optimistic?: boolean
  /** what it is for, in one line */
  description?: string
}

// A value as a query literal: quoted where the grammar would read it as
// structure, as @yaks/query's printer does. A rule writes a scalar; a `$` or `#`
// would read as a binding or a resource, so neither starts a literal.
let SPECIAL = /[\s&|()"',;]|\.\.|^[=<>~!-]|^$/
let literal = (kind: string, at: string, v: unknown): string => {
  let raw = typeof v == 'string' ? v : String(v)
  if (
    !['string', 'number', 'boolean'].includes(typeof v) || /^[$#]/.test(raw)
  ) {
    throw new Error(`kind '${kind}' gives ${at} a value no rule can write`)
  }
  return SPECIAL.test(raw) ? `"${raw.replace(/["'\\]/g, '\\$&')}"` : raw
}

// The rules a kind's `with` declares: one per component given values.
let completing = (kind: string, d: KindDecl): RuleDecl[] => {
  let is = (d.is ?? [kind]).map((c) => `.${c}`).join(', ')
  return Object.entries(d.with ?? {}).flatMap(([comp, w]) => {
    if (w === true || !w || typeof w != 'object') return []
    let sets = Object.entries(w).map(([prop, v]) =>
      `+${comp}.${prop}=${literal(kind, `${comp}.${prop}`, v)}`
    )
    return [{
      name: `${kind}.${comp}`,
      match: [is, `+!${comp}`, ...sets].join(', '),
      description: `a ${kind} carries ${comp}`,
    }]
  })
}

/**
 * The rule declarations one or more vocabulary documents carry: each `$defs`
 * entry marked `rule: true`, and each `with` entry of a kind that carries
 * values. `loadVocab` skips rule entries; this skips everything else, so a
 * document is read once for its components and once for its rules and neither
 * reading knows about the other.
 *
 * ```ts
 * import { rulesIn } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   rulesIn({
 *     kinds: { product: { with: { doc: true, shelf: { aisle: 'Z' } } } },
 *   }),
 *   [{
 *     name: 'product.shelf',
 *     match: '.product, +!shelf, +shelf.aisle=Z',
 *     description: 'a product carries shelf',
 *   }],
 * )
 * ```
 */
export let rulesIn = (input: VocabDoc | VocabDoc[]): RuleDecl[] => {
  let docs = Array.isArray(input) ? input : [input]
  let out: RuleDecl[] = []
  let seen = new Set<string>()
  for (let doc of docs) {
    let defs = doc.$defs ?? {}
    for (let name of Object.keys(defs)) {
      let entry = defs[name]
      if (entry?.rule !== true) continue
      if (seen.has(name)) throw new Error(`rule '${name}' is declared twice`)
      seen.add(name)
      let match = entry.match
      if (typeof match != 'string' || !match.trim()) {
        throw new Error(`rule '${name}' declares no match`)
      }
      out.push({
        name,
        match,
        ...(Array.isArray(entry.before) ? { before: entry.before } : {}),
        ...(entry.optimistic === true ? { optimistic: true } : {}),
        ...(typeof entry.description == 'string'
          ? { description: entry.description }
          : {}),
      })
    }
    let kinds = (doc.kinds ?? {}) as Record<string, KindDecl>
    for (let [kind, d] of Object.entries(kinds)) {
      for (let r of completing(kind, d)) {
        if (seen.has(r.name)) {
          throw new Error(`rule '${r.name}' is declared twice`)
        }
        seen.add(r.name)
        out.push(r)
      }
    }
  }
  return out
}
