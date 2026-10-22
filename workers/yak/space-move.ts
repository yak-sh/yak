// Every space from before its handle (D-131924) gets one: the slug it lives
// at, which is where its bytes already are, since no space had ever moved when
// the word arrived. Nothing in the bucket moves. Until a row is reached,
// directory.ts `spaceOf` reads the same slug, and a rename writes it down
// first (`rename`), so a space reached late is still rooted where it was.
import type { Comp } from '@yaks/graph'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

export let spaceStoreRule: Rule = {
  mark: 'yak/store/space-store/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.space !space.store *',
  move: (row) => [{
    entity: { eid: row.entity.eid },
    space: { store: (row.space as Comp).slug },
  }],
}
