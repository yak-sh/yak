import { equal, test, throws } from '@yaks/testing'
import { repositoryMove } from './git-move.ts'

test('repository preparation preserves a clone address and refuses a conflicting sha', async () => {
  let row = {
    entity: { eid: 'abc' },
    commit: {
      sha: 'abc',
      repo: 'https://ada.yaks.app/notes.git',
      message: 'Ship',
    },
  }
  equal(repositoryMove(row), [{
    entity: { eid: row.commit.repo },
    repository: { origin: row.commit.repo },
  }])
  equal(repositoryMove({ ...row, commit: { sha: 'abc' } }), [])
  await throws(() =>
    repositoryMove({ ...row, commit: { ...row.commit, sha: 'def' } })
  )
  equal(row.commit.sha, 'abc')
})
