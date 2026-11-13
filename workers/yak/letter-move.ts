// The directory's and the git store's numbers, copied under their letters
// (D-164344 item 10, T-164365). These stores once numbered every entity by one
// count, and each number printed with its kind's letter: the one a component
// declares, else the kind's initial. A number someone was given (a break's
// `E-12` in a letter, a memory's `M-40`) keeps opening what it opened once its
// row holds that letter, and then no row answers to its number under any
// letter. New entities are numbered only by a declared prefix (vocab.ts
// `numbered`).
import type { Bundle } from '@yaks/graph'
import { prefixes } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { GIT_STORE } from './door.ts'
import type { Rule } from './mover.ts'

/** The letter a row numbered before series had letters printed with. */
export let printed = (v: Vocab, row: Bundle): string => {
  let kind = v.kindOf(row)
  return prefixes(v)[kind] ?? kind[0].toUpperCase()
}

export let letterRule: Rule = {
  mark: 'yak/store/number-letter/1',
  stores: [PLATFORM_STORE, GIT_STORE],
  find: '.entity.num&!entity.prefix&*',
  live: 'all',
  move: (row, _read, words) => {
    if (!words) throw new Error('a number takes its letter from the words')
    return [{ entity: { eid: row.entity.eid, prefix: printed(words, row) } }]
  },
}
