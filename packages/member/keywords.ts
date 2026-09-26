// The registration: the custom JSON Schema keyword @yaks/member adds to a
// component vocabulary, declared in JSON Schema's own extension form, and the
// reading of it. `meta/member.vocab.json` is the authored source; this module
// gives it a name and the shape `loadVocab(docs, [memberKeywords])` expects.
//
// One keyword, `floor`: the least a component asks of whoever writes it. The
// guard's `floors` option says the same thing from outside, for a program
// holding words it did not declare; `floor` is a vocabulary saying it about its
// own, so an app that declares a word also declares who may write it.

import type { Keywords, Vocab, VocabDoc } from '@yaks/vocab'
import doc from './meta/member.vocab.json' with { type: 'json' }
import { floor, type Floors, isFloor } from './words.ts'

/** The URI a vocabulary file declares under `$vocabulary` to use `floor`. */
export let MEMBER_URI = 'https://yak.sh/vocab/member'

/**
 * The `floor` keyword vocabulary, ready to register:
 * `loadVocab(docs, [memberKeywords])` carries each component's declaration onto
 * `v.comp(name).keywords.floor`, which is where {@link floorsIn} reads it.
 */
export let memberKeywords: Keywords = { uri: MEMBER_URI, comp: ['floor'], doc }

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
