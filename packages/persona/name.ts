// What a persona is called: its `doc{title}`, the name alone. A new one is
// given one of NAMES, clear of the names of those its people already reach
// (`christened`), and a person may give it another (`given`), or give it one
// of their own as it is made (`named`).
import { CallError } from '@yaks/tools/errors'

/** The names a new persona is given: short, plain to say aloud, mostly trees
 * and creatures. */
export let NAMES = [
  'Acorn',
  'Alder',
  'Amos',
  'Arden',
  'Ash',
  'Aspen',
  'Badger',
  'Barley',
  'Bear',
  'Birch',
  'Bison',
  'Boulder',
  'Bracken',
  'Bram',
  'Bramble',
  'Briar',
  'Burr',
  'Cedar',
  'Chestnut',
  'Cinder',
  'Clove',
  'Clover',
  'Copper',
  'Cove',
  'Cypress',
  'Dell',
  'Elm',
  'Ember',
  'Ezra',
  'Felix',
  'Fern',
  'Finch',
  'Flint',
  'Ford',
  'Granite',
  'Hawthorn',
  'Hickory',
  'Jasper',
  'Juniper',
  'Kestrel',
  'Kip',
  'Kit',
  'Larch',
  'Lark',
  'Levi',
  'Linden',
  'Maple',
  'Milo',
  'Moose',
  'Moss',
  'Oak',
  'Ollie',
  'Otto',
  'Pine',
  'Pip',
  'Quill',
  'Reed',
  'Ridge',
  'Rook',
  'Rowan',
  'Rusty',
  'Rye',
  'Sage',
  'Scout',
  'Slate',
  'Sparrow',
  'Spruce',
  'Teal',
  'Tern',
  'Thatch',
  'Theo',
  'Thistle',
  'Tiller',
  'Timber',
  'Walnut',
  'Willow',
  'Yarrow',
]

// FNV-1a over the eid: where in the list an entity starts looking.
let start = (eid: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < eid.length; i++) {
    h = Math.imul(h ^ eid.charCodeAt(i), 0x01000193)
  }
  return (h >>> 0) % NAMES.length
}

/** The first name from `eid`'s place in {@link NAMES} that `taken` does not
 * hold; the place's own name when every one is taken. */
export let pick = (eid: string, taken: Set<string> = new Set()): string => {
  let at = start(eid)
  for (let i = 0; i < NAMES.length; i++) {
    let name = NAMES[(at + i) % NAMES.length]
    if (!taken.has(name)) return name
  }
  return NAMES[at]
}

/** A new name for `eid`, clear of the names `others` go by: those its people
 * already reach. An unnamed one among them that sorts first picks first, so
 * names given in one pass, which cannot read each other, still choose apart.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { christened, pick } from './name.ts'
 * let mine = pick('b')
 * equal(christened('b', []), mine)
 * equal(christened('b', [{ eid: 'z', name: mine }]) != mine, true)
 * equal(christened('b', [{ eid: 'a' }]) != pick('a'), true)
 * ```
 */
export let christened = (
  eid: string,
  others: { eid: string; name?: string | null }[],
): string => {
  let taken = new Set(others.flatMap((o) => o.name ? [o.name] : []))
  for (
    let o of others.filter((o) => !o.name && o.eid < eid)
      .sort((a, b) => a.eid.localeCompare(b.eid))
  ) taken.add(pick(o.eid, taken))
  return pick(eid, taken)
}

/** The most characters a name is. */
export let LONGEST = 40

/** A name a person gave: its spaces closed up, up to {@link LONGEST}
 * characters.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { assertThrows } from '@std/assert'
 * import { given } from './name.ts'
 * equal(given('  Ada   Lovelace '), 'Ada Lovelace')
 * assertThrows(() => given(' '), Error, 'Give it a name.')
 * assertThrows(() => given('a'.repeat(41)), Error, 'up to 40 characters')
 * ```
 */
export let given = (said: string): string => {
  let name = said.replace(/\s+/g, ' ').trim()
  if (!name) throw new CallError('arguments', 'Give it a name.')
  if (name.length > LONGEST) {
    throw new CallError('arguments', `A name is up to ${LONGEST} characters.`)
  }
  return name
}

/** A name `said` for a new persona, as {@link given} takes it, refused when
 * one of `others` (those its people already reach) goes by it, in any case.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { assertThrows } from '@std/assert'
 * import { named, pick } from './name.ts'
 * equal(named(' Menno ', [{ eid: 'a', name: 'Cedar' }]), 'Menno')
 * assertThrows(() => named('cedar', [{ eid: 'a', name: 'Cedar' }]), Error)
 * assertThrows(() => named(pick('a'), [{ eid: 'a' }]), Error)
 * ```
 */
export let named = (
  said: string,
  others: { eid: string; name?: string | null }[],
): string => {
  let name = given(said)
  let fold = name.toLowerCase()
  if (others.some((o) => (o.name || pick(o.eid)).toLowerCase() == fold)) {
    throw new CallError(
      'conflict',
      `Another of their Operators is called ${name}. Give another name, or ` +
        'leave it out and one is picked.',
    )
  }
  return name
}
