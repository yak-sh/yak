// Verify the directory's canonical commits before shedding their duplicate sha.
// Repository targets were prepared by yak/store/git-repositories/1.
import type { Comp } from '@yaks/graph'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

export let commitRule: Rule = {
  mark: 'yak/store/git-commit/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.commit&*',
  move: (row, read) => {
    let repo = (row.commit as Comp).repo
    if (repo != null) {
      if (!read) throw new Error('commit verification needs its repository')
      let [target] = read(`.entity.eid=${repo}&?repository`)
      if (!target?.repository) {
        throw new Error(
          `commit ${row.entity.eid}: repository ${repo} is missing`,
        )
      }
    }
    return []
  },
  drop: ['commit.sha'],
}
