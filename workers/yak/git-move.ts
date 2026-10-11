// Prepare the directory's clone addresses before commit.repo becomes a ref.
// The mover runs after the directory serves; rehearsal keeps no writes.
import type { Bundle, Comp } from '@yaks/graph'
import { PLATFORM_STORE } from './door.ts'
import { repository } from './gitobj.ts'
import type { Rule } from './mover.ts'

export let repositoryMove = (row: Bundle): Bundle[] => {
  let commit = row.commit as Comp
  if (commit.sha !== row.entity.eid) {
    throw new Error(`commit ${row.entity.eid}: sha differs from its identity`)
  }
  if (commit.repo == null) return []
  if (typeof commit.repo != 'string' || !commit.repo) {
    throw new Error(`commit ${row.entity.eid}: invalid repository`)
  }
  return [repository(commit.repo)]
}

export let repositoryRule: Rule = {
  mark: 'yak/store/git-repositories/1',
  stores: [PLATFORM_STORE],
  find: '.commit&*',
  move: repositoryMove,
}
