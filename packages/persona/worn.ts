// What a persona holds, read out of the graph: the `contains` and `reads`
// edges off it, resolved to the docs at their far ends, in the order they were
// authored in. The other half of the act — {@link voice} renders what this
// gathers, and neither knows how the other does its job.
//
// TWO RELATIONS, BORROWED, NOT COINED. `contains` is @yaks/task's word and
// `reads` is @yaks/kernel's, and both already say what a tier means: this
// persona contains that document, this persona reads that one. A relation a
// composed vocabulary does not declare contributes nothing rather than
// throwing — a graph with no @yaks/task in it has no `contains`, and a persona
// there carries nothing, which is a fair reading of that graph and not a
// misconfiguration this package is entitled to refuse.
//
// It reads the EDGES rather than walking them (@yaks/edge `walk` answers far
// ends, and a far end has lost its `ord`) — the one fact the authored order
// depends on.
//
// A CARRIED PERSONA FOLDS IN: its voice is carried like any other document,
// and what IT holds joins what this one holds, which is how a base persona
// reaches every voice worn on top of it without anybody copying its text. A
// NAMED persona is only named: you said where it is, not that it speaks here.
// Levels, not recursion, so an embedded store answers the whole gather without
// a promise and a remote one turns it into exactly one chain (@yaks/edge's
// `reach` walks the same way).

import { and, eq, type Input, list, present } from '@yaks/query'
import {
  type Bundle,
  detached,
  each,
  type Eid,
  type Storage,
  then,
} from '@yaks/graph'
import { EDGE, relations } from '@yaks/edge'
import { DOC } from '@yaks/doc'
import type { Vocab } from '@yaks/vocab'
import { PERSONA } from './comp.ts'
import type { Worn } from './voice.ts'

/** The relation whose far end rides in full. */
export let CARRIES = 'contains'

/** The relation whose far end is named and no more. */
export let READS = 'reads'

// How deep a persona may be folded into a persona. A base under a base under a
// base is a graph somebody drew by hand; past this it is a cycle, and a cycle
// is what the `seen` set already stops.
let DEPTH = 8

let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

let far = (b: Bundle): Eid => {
  let to = (b[EDGE] as { to?: unknown } | undefined)?.to
  return typeof to == 'string' ? to : ''
}

// The links of one relation out of a whole level, in the order they were
// authored: an edge's own `ord` where its author gave it one, then the end it
// points at, so two unordered siblings never trade places between reads.
let links = (storage: Storage, from: Eid[], tag: string | undefined) =>
  !tag || !from.length ? [] : then(
    storage.read(and(eq(`${EDGE}.from`, value(from)), present(tag))),
    (found) =>
      found
        .map((b) => ({
          to: far(b),
          ord: Number(
            (b[EDGE] as { ord?: unknown })?.ord ?? Number.MAX_SAFE_INTEGER,
          ),
        }))
        .filter((l) => !!l.to)
        .sort((a, b) => a.ord - b.ord || a.to.localeCompare(b.to))
        .map((l) => l.to),
  )

/**
 * What one persona wears, gathered from a storage. Answers `undefined` where
 * the eid is nothing, or is something that is not a persona — the caller says
 * what to do about that, since a door refuses and a report might not.
 *
 * ```ts
 * let worn = await wear(storage, vocab)('N-1')
 * if (worn) console.log(voice(vocab)(worn))
 * ```
 *
 * Sync in, sync out: over an embedded database this answers immediately, and
 * over a storage that returns promises it answers one.
 */
export let wear = (
  storage: Storage,
  vocab: Vocab,
): (eid: Eid) => Worn | undefined | Promise<Worn | undefined> => {
  let tags = relations(vocab)
  let tx = detached(storage)
  return (eid) =>
    then(tx.get([eid]), (found) => {
      let persona = found[0]
      if (!persona?.[PERSONA]) return undefined
      let carries = new Map<Eid, Bundle>()
      let names = new Map<Eid, Bundle>()
      let seen = new Set<Eid>([eid])
      let level = [eid]
      return then(
        each(Array.from({ length: DEPTH }, (_, i) => i), null, () => {
          if (!level.length) return null
          return then(links(storage, level, tags[CARRIES]), (held) =>
            then(links(storage, level, tags[READS]), (said) =>
              then(
                tx.get([...new Set([...held, ...said])]),
                (docs) => {
                  let by = new Map(docs.map((b) => [b.entity.eid, b]))
                  let next: Eid[] = []
                  for (let id of held) {
                    let b = by.get(id)
                    // `seen` holds the persona itself, so a ring of personas
                    // never says the voice it started from a second time.
                    if (!b?.[DOC] || seen.has(id)) {
                      continue
                    }
                    seen.add(id)
                    carries.set(id, b)
                    // A persona's voice is carried like any other document;
                    // what IT holds is gathered on the next level.
                    if (b[PERSONA]) {
                      next.push(id)
                    }
                  }
                  for (let id of said) {
                    let b = by.get(id)
                    if (b?.[DOC] && !names.has(id)) {
                      names.set(id, b)
                    }
                  }
                  level = next
                  return null
                },
              )))
        }),
        () => {
          // Carried wins: a document named somewhere and carried somewhere
          // else is carried once, and never said twice. The persona itself is
          // neither — it is the voice the document opens with.
          for (let id of carries.keys()) {
            names.delete(id)
          }
          names.delete(eid)
          return {
            persona,
            carries: [...carries.values()],
            names: [...names.values()],
          }
        },
      )
    })
}
