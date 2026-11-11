// The registration: the custom JSON Schema keyword @yaks/member adds to a
// component vocabulary, declared in JSON Schema's own extension form, and the
// reading of it. `meta/member.vocab.json` is the authored source; this module
// gives it a name and the shape `loadVocab(docs, [memberKeywords])` expects.
//
// `floor` is the least a component asks of whoever writes it. The
// guard's `floors` option says the same thing from outside, for a program
// holding words it did not declare; `floor` is a vocabulary saying it about its
// own, so an app that declares a word also declares who may write it.
// `readers` is the same ladder for whoever reads it: an entity wearing the
// component is seen only by readers standing on that floor, whatever the mode;
// an object of floors to queries asks a floor only of the entities it matches.
// `shown` asks a floor of whoever reads the component alone: a reader below it
// reads the entity without the component, as `personal: "entity"` keeps one
// aspect of a person's entity.
// `permit` lets the owner of a stored reference answer with a companion mark,
// without gaining the declaring row or permission to change its request.
// `personal` names the owner of a private entity or private person component.

import type { Keywords, Vocab, VocabDoc } from '@yaks/vocab'
import { marked } from '@yaks/graph/provenance'
import doc from './meta/member.vocab.json' with { type: 'json' }
import { type Asked, askedErrors, askedOf, asking } from './asking.ts'
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
  comp: ['floor', 'readers', 'shown', 'permit', 'personal'],
  doc,
}

// Component → what one keyword of a loaded vocabulary declares of it.
let said = <T>(v: Vocab, keyword: string, read: (said: unknown) => T) =>
  Object.fromEntries(
    v.all.flatMap((c) => {
      let said = v.comp(c)?.keywords[keyword]
      return said === undefined ? [] : [[c, read(said)]]
    }),
  ) as Record<string, T>

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
export let floorsIn = (v: Vocab): Floors => said(v, 'floor', floor)

/**
 * What a loaded vocabulary asks of readers, component → a floor, or the
 * queries that choose one (./asking.ts).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { memberKeywords, readersIn } from '@yaks/member'
 * let v = loadVocab({
 *   $defs: {
 *     signup: { component: true, type: 'object', readers: 'viewer' },
 *     note: { component: true, type: 'object' },
 *   },
 * }, [memberKeywords])
 * assertEquals(readersIn(v), { signup: 'viewer' })
 * ```
 */
export let readersIn = (v: Vocab): Record<string, Asked> =>
  said(v, 'readers', askedOf)

/**
 * The floor each component a loaded vocabulary declares `shown` asks of
 * whoever reads it, component → floor.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { memberKeywords, shownIn } from '@yaks/member'
 * let v = loadVocab({
 *   $defs: {
 *     interests: { component: true, type: 'object', shown: 'editor' },
 *     note: { component: true, type: 'object' },
 *   },
 * }, [memberKeywords])
 * assertEquals(shownIn(v), { interests: 'editor' })
 * ```
 */
export let shownIn = (v: Vocab): Floors => said(v, 'shown', floor)

/**
 * Every `floor`, `readers` or `shown` a document declares that is not a floor, or a
 * `readers` condition that is no query of the component, as sentences, the way
 * @yaks/vocab's `storable` answers.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { floored } from '@yaks/member'
 * assertEquals(floored({ $defs: { line: { floor: 'admin', readers: 'all' } } }), [
 *   'line is floored "admin" — a floor is person, viewer, editor or owner',
 *   'line is read by "all" — readers is person, viewer, editor or owner',
 * ])
 * ```
 */
export let floored = (d: VocabDoc): string[] =>
  Object.entries(d.$defs ?? {}).flatMap(([name, s]) => [
    ...s?.floor === undefined || isFloor(s.floor) ? [] : [
      `${name} is floored "${s.floor}" — a floor is person, viewer, editor ` +
      'or owner',
    ],
    ...s?.readers === undefined ? [] : askedErrors(name, s.readers),
    ...s?.shown === undefined || isFloor(s.shown) ? [] : [
      `${name} is shown to "${s.shown}" — shown is person, viewer, editor ` +
      'or owner',
    ],
  ])

/** The `readers` conditions that name a property the loaded vocabulary does
 * not declare, as sentences: what {@link floored} cannot see in a document
 * alone. */
export let conditioned = (v: Vocab): string[] =>
  Object.entries(readersIn(v)).flatMap(([name, asked]) => {
    try {
      asking(asked, v)
      return []
    } catch (e) {
      return [`${name} is read by conditions that do not apply: ${e}`]
    }
  })

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
