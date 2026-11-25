import { equal, test } from '@yaks/testing'
import { ACCOUNT } from './account-rows.ts'
import { appDrafted } from './app-canvas.ts'
import { connectionsMoved } from './connections-page.ts'
import { personChanges } from './person-lines.ts'
import { SIDE_SPACES, sideApps } from './side-rows.ts'
import { spaceApps } from './space-apps.ts'

let lines = [
  ACCOUNT,
  SIDE_SPACES,
  sideApps('one'),
  sideApps('two'),
  spaceApps('one'),
  spaceApps('two'),
  connectionsMoved('one'),
  connectionsMoved('two'),
  appDrafted('this'),
  appDrafted('that'),
]

test('a release refreshes the changed app and the listings of its space', () => {
  let change = personChanges([
    {
      entity: { eid: 'this' },
      app: { source: 'second', version: 2, fence: null },
      last_deploy: {},
    },
    { entity: { eid: 'version' }, deploy: { version: 2 } },
  ])
  equal(change.releases, ['this'])
  equal(lines.filter((line) => change.affects(line, new Set(['one']))), [
    sideApps('one'),
    spaceApps('one'),
    connectionsMoved('one'),
    appDrafted('this'),
  ])
})

test('moving an app refreshes the views that depended on its old address', () => {
  let change = personChanges([
    { entity: { eid: 'this' }, app: { space: 'two', source: 'second' } },
  ])
  equal(change.releases, [])
  equal(
    lines.filter((line) => change.affects(line, new Set())),
    lines.slice(0, -1),
  )
})
