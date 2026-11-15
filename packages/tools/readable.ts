// A tool's answer as its reader reads it. The graph keeps prose as it was
// stored, and a model, a printout and `--json` read it drawn: each eid it holds
// as the entity's id or short handle, never a whole uuid.

import type { Bundle, Comp } from '@yaks/graph'
import { human } from '@yaks/id'
import type { Held } from '@yaks/id/graph'
import { drawn, eids, type Ids } from '@yaks/markdown/structural'
import type { Vocab } from '@yaks/vocab'

export type { Ids }

/**
 * The answer with every prose property (@yaks/vocab `prose`) drawn
 * (@yaks/markdown `drawn`): an eid it holds reads as the id the answer itself
 * gives that entity, whatever its kind, or as the id `ids` holds (the small
 * series a host keeps in memory, @yaks/id/graph `held`), else as its short
 * handle. A bundle with nothing to draw is the same bundle. A door drawing
 * from a store uses {@link drawing}, which asks `ids` about every eid named.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { idKeywords } from '@yaks/id'
 * let vocab = loadVocab({
 *   $defs: {
 *     doc: {
 *       component: true,
 *       properties: { body: { type: 'string', prose: true } },
 *     },
 *     task: { component: true, kind: true, prefix: 'T', properties: {} },
 *   },
 * }, [idKeywords])
 * let eid = '0e513227-de00-4000-8000-000000000001'
 * let task = { entity: { eid, num: 12, prefix: 'T' }, task: {}, doc: { body: 'Me.' } }
 * let note = { entity: { eid: 'n1' }, doc: { body: `See ${eid}.` } }
 * assertEquals(readable(vocab)([task, note])[1].doc, { body: 'See T-12.' })
 * assertEquals(readable(vocab)([note])[0].doc, { body: 'See #0e513227de.' })
 * ```
 */
export let readable = (
  vocab: Vocab,
  ids?: Ids,
): (answer: Bundle[]) => Bundle[] => {
  let id = human(vocab)
  let each = rewriting(vocab)
  return (answer: Bundle[]): Bundle[] => {
    let own = new Map(
      answer.filter((b) => b.entity.num).map((b) => [b.entity.eid, id(b)]),
    )
    let named: Ids = (eid) => own.get(eid) ?? ids?.(eid)
    return answer.map((b) => each(b, (v) => drawn(v, named)))
  }
}

/**
 * The answer drawn as {@link readable} draws it, with every eid its prose
 * names asked of `held` (@yaks/id/graph), so one outside the small series, a
 * task a comment names, reads as its id too.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * let vocab = loadVocab({
 *   $defs: {
 *     doc: {
 *       component: true,
 *       properties: { body: { type: 'string', prose: true } },
 *     },
 *   },
 * })
 * let eid = '0e513227-de00-4000-8000-000000000001'
 * let note = { entity: { eid: 'n1' }, doc: { body: `See ${eid}.` } }
 * let held = async (eids?: Iterable<string>) => {
 *   let asked = new Set(eids)
 *   return (e: string) => asked.has(e) ? 'T-12' : undefined
 * }
 * assertEquals((await drawing(vocab, held)([note]))[0].doc, { body: 'See T-12.' })
 * ```
 */
export let drawing = (
  vocab: Vocab,
  held: Held,
): (answer: Bundle[]) => Promise<Bundle[]> => {
  let each = rewriting(vocab)
  return async (answer: Bundle[]): Promise<Bundle[]> => {
    let own = new Set(
      answer.filter((b) => b.entity.num).map((b) => b.entity.eid),
    )
    let named = new Set<string>()
    for (let b of answer) {
      each(b, (v) => (eids(v).forEach((e) => own.has(e) || named.add(e)), v))
    }
    return readable(vocab, await held(named))(answer)
  }
}

/** A bundle with each prose property (@yaks/vocab `prose`) given to `rewrite`,
 * the same bundle where nothing changed. */
let rewriting = (vocab: Vocab) => {
  let prose = (comp: string, prop: string) => !!vocab.prop(comp, prop)?.prose
  let read = (comp: string, held: Comp, rewrite: (v: string) => string) => {
    let out: Comp | undefined
    for (let [prop, v] of Object.entries(held)) {
      if (typeof v != 'string' || !prose(comp, prop)) continue
      let said = rewrite(v)
      if (said != v) (out ??= { ...held })[prop] = said
    }
    return out ?? held
  }
  return (b: Bundle, rewrite: (v: string) => string): Bundle => {
    let out: Bundle | undefined
    for (let [comp, held] of Object.entries(b)) {
      if (comp[0] == '$' || !held || typeof held != 'object') continue
      let drew = read(comp, held as Comp, rewrite)
      if (drew != held) (out ??= { ...b })[comp] = drew
    }
    return out ?? b
  }
}
