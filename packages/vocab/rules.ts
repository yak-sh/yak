// Rules a vocabulary declares. A `$defs` entry marked `rule: true` is a query
// the graph runs over every batch of changes — and that is the whole
// declaration. There is no implementation to join it to, which is what makes it
// different from a tool: a tool declaration names the tool and a module
// implements it, while a rule's `match` is the implementation. An app ships one
// in its vocab.json and the graph runs it; nobody writes any code.
//
// It has the same shape as `toolsIn` and a fraction of the weight: reading a
// tool declaration means validating its argument schemas, which means ajv,
// which is why that loader is its own entry point. A rule is a name and a
// string, so this loader has no dependencies and is exported from `mod.ts`.

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
  /** the phase it runs in. `rules` — the default — is the declarative half of
   * `apply()`, running before anything is persisted. `effect` is a rule
   * nothing in `apply()` runs: it is a pattern to register a post-commit
   * handler on (@yaks/effects `on`), or to run once as a sweep — @yaks/tools
   * declares two of those, which select the calls that still need running. */
  phase?: string
  /** what it is for, in one line */
  description?: string
}

/**
 * The rule declarations one or more vocabulary documents carry. `loadVocab`
 * skips rule entries; this skips everything else, so a document is read once
 * for its components and once for its rules and neither reading knows about
 * the other.
 */
export let rulesIn = (input: VocabDoc | VocabDoc[]): RuleDecl[] => {
  let docs = Array.isArray(input) ? input : [input]
  let out: RuleDecl[] = []
  let seen = new Set<string>()
  for (let doc of docs) {
    for (let [name, entry] of Object.entries(doc.$defs ?? {})) {
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
        ...(typeof entry.phase == 'string' ? { phase: entry.phase } : {}),
        ...(typeof entry.description == 'string'
          ? { description: entry.description }
          : {}),
      })
    }
  }
  return out
}
