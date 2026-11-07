// What each space's Operator is called (T-137432): `operator{name}` on the
// space, which is its Operator's entity. A space is given one when it is made
// (directory.ts `mint`), and the store mover gave every space from before the
// word one (`operatorNameRule`). Its people change it on its settings page.
import type { Bundle, Comp } from '@yaks/graph'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'
import { CallError } from '@yaks/tools/errors'

/** The names a new Operator is given: short, warm and plain to say aloud. */
export let NAMES = [
  'Ada',
  'Agnes',
  'Alder',
  'Alma',
  'Arden',
  'Aster',
  'Basil',
  'Bea',
  'Bertie',
  'Birch',
  'Bram',
  'Briar',
  'Brook',
  'Calla',
  'Cass',
  'Cedar',
  'Clem',
  'Clover',
  'Cora',
  'Cove',
  'Dahlia',
  'Daisy',
  'Dell',
  'Eden',
  'Effie',
  'Elm',
  'Elsie',
  'Ember',
  'Etta',
  'Ezra',
  'Faye',
  'Fern',
  'Finch',
  'Flora',
  'Gus',
  'Gwen',
  'Hattie',
  'Hazel',
  'Heath',
  'Holly',
  'Ines',
  'Iris',
  'Ivy',
  'Jasper',
  'Jay',
  'June',
  'Juniper',
  'Kip',
  'Kit',
  'Lark',
  'Laurel',
  'Lena',
  'Linden',
  'Lottie',
  'Lou',
  'Mabel',
  'Mae',
  'Maple',
  'Marigold',
  'Meadow',
  'Mira',
  'Moss',
  'Nell',
  'Nora',
  'Olive',
  'Ollie',
  'Opal',
  'Otto',
  'Pearl',
  'Penn',
  'Percy',
  'Pip',
  'Poppy',
  'Quill',
  'Quinn',
  'Reed',
  'Robin',
  'Rosa',
  'Rosie',
  'Rowan',
  'Ruby',
  'Sadie',
  'Sage',
  'Sorrel',
  'Sparrow',
  'Tansy',
  'Teal',
  'Tess',
  'Thea',
  'Theo',
  'Thistle',
  'Tilly',
  'Vera',
  'Wally',
  'Willa',
  'Willow',
  'Winnie',
  'Wren',
  'Yarrow',
  'Zinnia',
]

// FNV-1a over the eid: where in the list a space starts looking.
let start = (eid: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < eid.length; i++) {
    h = Math.imul(h ^ eid.charCodeAt(i), 0x01000193)
  }
  return (h >>> 0) % NAMES.length
}

/** The first name from `eid`'s place in {@link NAMES} that `taken` does not
 * hold; the place's own name when every one is taken. */
export let pick = (eid: string, taken: Set<string> = new Set()) => {
  let at = start(eid)
  for (let i = 0; i < NAMES.length; i++) {
    let name = NAMES[(at + i) % NAMES.length]
    if (!taken.has(name)) return name
  }
  return NAMES[at]
}

/** A new name for the Operator of `eid`, clear of the Operators its people
 * already reach (`others`). An unnamed one among them that sorts first picks
 * first, so spaces named in one pass, which cannot read each other's names,
 * still choose apart.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { christened, pick } from './operator-name.ts'
 * let mine = pick('b')
 * equal(christened('b', []), mine)
 * equal(christened('b', [{ eid: 'z', name: mine }]) != mine, true)
 * equal(christened('b', [{ eid: 'a' }]) != pick('a'), true)
 * ```
 */
export let christened = (
  eid: string,
  others: { eid: string; name?: string | null }[],
) => {
  let taken = new Set(others.flatMap((o) => o.name ? [o.name] : []))
  for (
    let o of others.filter((o) => !o.name && o.eid < eid)
      .sort((a, b) => a.eid.localeCompare(b.eid))
  ) taken.add(pick(o.eid, taken))
  return pick(eid, taken)
}

/** A name a person gave: its spaces closed up, up to 40 characters. */
export let given = (said: string) => {
  let name = said.replace(/\s+/g, ' ').trim()
  if (!name) throw new CallError('arguments', 'Give the Operator a name.')
  if (name.length > 40) {
    throw new CallError(
      'arguments',
      'An Operator’s name is up to 40 characters.',
    )
  }
  return name
}

/** What a space's Operator is called: its `operator{name}`, or the name the
 * store mover gives a space it has not reached yet. */
export let calledOf = (row: Bundle) =>
  String((row.operator as Comp | undefined)?.name || pick(row.entity.eid))

// Every space from before the word is named, clear of the Operators its
// people reach: the spaces they hold seats in.
export let operatorNameRule: Rule = {
  mark: 'yak/store/operator-name/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.space&!operator&*',
  move: (row, read) => {
    if (!read) throw new Error("an Operator's name is read off its people's")
    let eid = row.entity.eid
    let people = read(`.member.space=${eid}`)
      .map((b) => String((b.member as Comp).person))
    let seats = people.length
      ? read(`.member.person=${[...new Set(people)].join(',')}`)
        .map((b) => String((b.member as Comp).space))
        .filter((s) => s != eid)
      : []
    let others = seats.length
      ? read(`.entity.eid=${[...new Set(seats)].join(',')}&.space&?operator`)
        .map((b) => ({
          eid: b.entity.eid,
          name: (b.operator as Comp | undefined)?.name as string | undefined,
        }))
      : []
    return [{ entity: { eid }, operator: { name: christened(eid, others) } }]
  },
}
