// The graph plugin this package contributes, at `@yaks/markdown/graph`: prose
// stored as it names entities (@yaks/graph `Prose`). A person types `T-12`, a
// model writes back the `#a3f19c024b` it was shown, and the store keeps the
// eid each names, so the text names the entity in any store and under any
// number, and is drawn short for its reader (./structural.ts `drawn`).
//
// Finding the ids is this package's grammar (./structural.ts `typed`): a
// human id or a handle written bare or as a link's target, never one in code.
// Which entity each names is the graph's one read of them all. What is left is
// being sure the id was meant: a human id's letter must be one the entity it
// names prints with or carries, so `K-12` in a sentence about schools is not
// taken for whatever entity holds the number 12.
//
// A store composes it or does not. An app's store does not, since an app's
// code reads its own text as it wrote it.

import type { Bundle, Eid, Plugin, Prose, ReadTx } from '@yaks/graph'
import { human, parse, prefixes } from '@yaks/id'
import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { stored, typed } from './structural.ts'

/** Every letter an entity answers to: the one it prints with and each its
 * components declare. */
let letters = (vocab: Vocab) => {
  let id = human(vocab)
  let declared = prefixes(vocab)
  return (b: Bundle): Set<string> =>
    new Set([
      id(b).split('-')[0],
      ...Object.keys(b).flatMap((c) => declared[c] ?? []),
    ])
}

/**
 * How prose names entities in a store with this vocabulary.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { idKeywords } from '@yaks/id'
 * let vocab = loadVocab({
 *   $defs: {
 *     task: { component: true, kind: true, prefix: 'T', properties: {} },
 *   },
 * }, [idKeywords])
 * let eid = '0e513227-de00-4000-8000-000000000001'
 * let tx = { get: () => [{ entity: { eid, num: 12 }, task: {} }] }
 * let at = new Map([['T-12', eid], ['K-12', eid]])
 * assertEquals(
 *   await prose(vocab).stored(['T-12, not K-12 or `T-12`'], at, tx as never),
 *   [`${eid}, not K-12 or \`T-12\``],
 * )
 * ```
 */
export let prose = (vocab: Vocab): Prose => {
  let answers = letters(vocab)
  return {
    typed,
    stored: (texts: string[], at: Map<string, Eid>, tx: ReadTx) => {
      let lettered = [...at].filter(([id]) => parse(id)?.prefix)
      let eids = [...new Set(lettered.map(([, eid]) => eid))]
      return after(eids.length ? tx.get(eids) : [], (rows: Bundle[]) => {
        let live = new Map(
          rows.filter((b) => !b.tombstone).map((b) => [b.entity.eid, b]),
        )
        let meant = (id: string): Eid | undefined => {
          let eid = at.get(id)
          let letter = parse(id)?.prefix
          if (!eid || !letter) return eid
          let b = live.get(eid)
          return b && answers(b).has(letter) ? eid : undefined
        }
        return texts.map((text) => stored(text, meant))
      })
    },
  }
}

/** Prose stored as it names entities, as a graph plugin. */
export let plugins = (host: { vocab: Vocab }): Plugin[] => [
  { name: '@yaks/markdown', prose: prose(host.vocab) },
]
