// The registration: the custom JSON Schema keyword @yaks/member adds to a
// component vocabulary, declared in JSON Schema's own extension form, and the
// reading of it. `meta/member.vocab.json` is the authored source; this module
// gives it a name and the shape `loadVocab(docs, [memberKeywords])` expects.
//
// `floor` is the least a component asks of whoever writes it. The
// guard's `floors` option says the same thing from outside, for a program
// holding words it did not declare; `floor` is a vocabulary saying it about its
// own, so an app that declares a word also declares who may write it.
// `permit` lets the owner of a stored reference answer with a companion mark,
// without gaining the declaring row or permission to change its request.

import type { Keywords, Vocab, VocabDoc } from '@yaks/vocab'
import { marked } from '@yaks/graph'
import doc from './meta/member.vocab.json' with { type: 'json' }
import { floor, type Floors, isFloor } from './words.ts'

/** The URI a vocabulary file declares under `$vocabulary` to use member keywords. */
export let MEMBER_URI = 'https://yak.sh/vocab/member'

/**
 * The member keyword vocabulary, ready to register:
 * `loadVocab(docs, [memberKeywords])` carries each component's declaration onto
 * `v.comp(name).keywords.floor`, which is where {@link floorsIn} reads it.
 */
export let memberKeywords: Keywords = {
  uri: MEMBER_URI,
  comp: ['floor', 'permit'],
  doc,
}

/**
 * The floors a loaded vocabulary declares, component → floor.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { floorsIn, memberKeywords } from '@yaks/member'
 * let v = loadVocab({
 *   $defs: {
 *     line: { component: true, type: 'object', floor: 'person' },
 *     note: { component: true, type: 'object' },
 *   },
 * }, [memberKeywords])
 * assertEquals(floorsIn(v), { line: 'person' })
 * ```
 */
export let floorsIn = (v: Vocab): Floors =>
  Object.fromEntries(
    v.all.flatMap((c) => {
      let said = v.comp(c)?.keywords.floor
      return said === undefined ? [] : [[c, floor(said)]]
    }),
  )

/**
 * Every `floor` a document declares that is not one, as sentences, the way
 * @yaks/vocab's `storable` answers.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { floored } from '@yaks/member'
 * assertEquals(floored({ $defs: { line: { floor: 'admin' } } }), [
 *   'line is floored "admin" — a floor is person, viewer, editor or owner',
 * ])
 * ```
 */
export let floored = (d: VocabDoc): string[] =>
  Object.entries(d.$defs ?? {}).flatMap(([name, s]) =>
    s?.floor === undefined || isFloor(s.floor) ? [] : [
      `${name} is floored "${s.floor}" — a floor is person, viewer, editor ` +
      'or owner',
    ]
  )

/** Declaring component → companion mark → its local reference property. */
export type Permits = Record<string, Record<string, string>>

let named = (v: unknown): v is string =>
  typeof v == 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(v)

/** Errors in `permit` declarations, checked against the whole loaded vocabulary. */
export let permitted = (v: Vocab): string[] =>
  v.all.flatMap((name) => {
    let said = v.comp(name)?.keywords.permit
    if (said === undefined) return []
    if (!said || typeof said != 'object' || Array.isArray(said)) {
      return [
        `${name}.permit maps companion marks to local reference properties`,
      ]
    }
    return Object.entries(said).flatMap(([comp, prop]) => {
      let errors: string[] = []
      let mark = v.comp(comp)
      if (
        !named(comp) || !mark?.wire || !marked(v, comp) ||
        comp == 'tombstone' ||
        v.props(comp).some((p) => !v.prop(comp, p)?.stamped)
      ) {
        errors.push(`${name}.permit ${comp} is no stamp-only companion mark`)
      }
      let ref = named(prop) ? v.prop(name, prop) : undefined
      if (!ref?.ref || ref.computed || !v.comp(ref.ref)) {
        errors.push(
          `${name}.permit ${String(prop)} is no stored reference property`,
        )
      }
      return errors
    })
  })

/** Read valid companion permissions; a malformed declaration never grants writes. */
export let permitsIn = (v: Vocab): Permits => {
  let errors = permitted(v)
  if (errors.length) throw new Error(errors.join('; '))
  return Object.fromEntries(v.all.flatMap((name) => {
    let said = v.comp(name)?.keywords.permit
    return said === undefined ? [] : [[name, said as Record<string, string>]]
  }))
}
