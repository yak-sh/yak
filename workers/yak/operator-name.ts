// What each space's Operator is called (T-137432): `operator{name}` on the
// space, the directory's copy of its persona's name. A space is given one when
// it is made (directory.ts `mint`), and the store mover gave every space from
// before the word one (`operatorNameRule`). Its people change it on its
// settings page. The names and how one is chosen are @yaks/persona's.
import type { Bundle, Comp } from '@yaks/graph'
import { christened, pick } from '@yaks/persona'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

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
