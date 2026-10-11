// Re-admit the directory's platform rows through the package's declarations.
// Entity ids and property values stay fixed, including kept deploy pointers.
import { type Comp, token } from '@yaks/graph'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

let words = [
  'space',
  'app',
  'published',
  'installed',
  'meter',
  'signin',
  'report',
]

export let platformRule: Rule = {
  mark: 'yak/store/platform-words/1',
  stores: [PLATFORM_STORE],
  find: words.map((word) => `.${word}`).join('|'),
  move: (row) => {
    let comps = Object.fromEntries(
      words.flatMap((word) => row[word] ? [[word, row[word] as Comp]] : []),
    )
    return [{
      entity: { eid: row.entity.eid },
      ...comps,
      $was: Object.fromEntries(
        Object.entries(comps).map(([word, comp]) => [
          word,
          Object.fromEntries(
            Object.entries(comp).map(([prop, value]) => [
              prop,
              token(value),
            ]),
          ),
        ]),
      ),
    }]
  },
}
