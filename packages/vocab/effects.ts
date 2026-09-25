// Effects a vocabulary declares. A `$defs` entry marked `effect: true` names
// what a commit owes: when a component appears, moves or goes, or a query
// comes true over what was committed, the effect of that name is owed a run.
// Like a tool, it is declared here and implemented elsewhere, by name — a
// plugin's `./effects` (@yaks/effects `handle`) — so every process that loads
// the vocabulary knows what a write owes, and only a process that runs effects
// imports the code that runs them.
//
// It is a name and a few lists of strings, so this loader has no dependencies
// and is exported from `mod.ts`, like `rulesIn`.

import type { VocabDoc } from './types.ts'

/**
 * An effect, as a vocabulary declares it.
 *
 * ```ts
 * import { effectsIn } from '@yaks/vocab'
 *
 * effectsIn({
 *   $defs: {
 *     send_mail: { effect: true, created: ['mail'], sweep: '.mail !sent' },
 *   },
 * })
 * // [{ name: 'send_mail', created: ['mail'], sweep: '.mail !sent' }]
 * ```
 */
export type EffectDecl = {
  /** the entry's own name: what a recorded run names, and what the code that
   * runs it is registered under */
  name: string
  /** the components whose appearance on an entity owes a run */
  created?: string[]
  /** `comp` for any patch to that component, `comp.prop` for a patch that
   * carries that property */
  changed?: string[]
  /** the components whose removal owes a run, by their own deletion or with
   * their entity */
  removed?: string[]
  /** a query over what committed: a run is owed wherever a batch made it hold
   * for an entity the batch touched */
  match?: string
  /** a query selecting the entities still owed a run, asked when a worker
   * starts. Declaring one promises the effect is safe to run twice */
  sweep?: string
  /** the most attempts a run gets before it is left `failed` */
  tries?: number
  /** `false` where running it twice is not the same as running it once */
  idempotent?: boolean
  /** what it does, in one line */
  description?: string
}

let strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((s) => typeof s == 'string') && v.length
    ? v
    : undefined

/**
 * The effect declarations one or more vocabulary documents carry. `loadVocab`
 * skips effect entries; this skips everything else.
 */
export let effectsIn = (input: VocabDoc | VocabDoc[]): EffectDecl[] => {
  let docs = Array.isArray(input) ? input : [input]
  let out: EffectDecl[] = []
  let seen = new Set<string>()
  for (let doc of docs) {
    for (let [name, entry] of Object.entries(doc.$defs ?? {})) {
      if (entry?.effect !== true) continue
      if (seen.has(name)) throw new Error(`effect '${name}' is declared twice`)
      seen.add(name)
      let decl: EffectDecl = { name }
      for (let key of ['created', 'changed', 'removed'] as const) {
        let said = strings(entry[key])
        if (said) decl[key] = said
      }
      for (let key of ['match', 'sweep', 'description'] as const) {
        let said = entry[key]
        if (typeof said == 'string') decl[key] = said
      }
      if (typeof entry.tries == 'number') decl.tries = entry.tries
      if (typeof entry.idempotent == 'boolean') {
        decl.idempotent = entry.idempotent
      }
      if (!decl.created && !decl.changed && !decl.removed && !decl.match) {
        throw new Error(`effect '${name}' is owed by nothing`)
      }
      out.push(decl)
    }
  }
  return out
}
