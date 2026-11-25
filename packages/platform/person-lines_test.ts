import { equal, test } from '@yaks/testing'
import { ACCOUNT, FRIENDS } from './account-rows.ts'
import { appDrafted } from './app-canvas.ts'
import { connectionsMoved } from './connections-page.ts'
import { allowancesLine, planLine } from './payment-rows.ts'
import { personChanges } from './person-lines.ts'
import { SIDE_SPACES, sideApps } from './side-rows.ts'
import { spaceApps } from './space-apps.ts'
import { UPDATE_WAITING } from './update-waiting.ts'

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

test("model spending refreshes only the paying space's payment views", () => {
  let changes = personChanges([
    { entity: { eid: 'call' }, model_reservation: null, cost: { dollars: 1 } },
    {
      entity: { eid: 'one' },
      meter: { models: 2 },
      credit: { spent: 1 },
      trend: {},
    },
  ])
  let allowances = allowancesLine('one'), plan = planLine('one')
  let watching = [
    ...lines,
    FRIENDS,
    UPDATE_WAITING,
    allowances,
    plan,
    allowancesLine('two'),
    planLine('two'),
  ]
  equal(watching.filter((line) => changes.affects(line, new Set())), [
    allowances,
    plan,
  ])
})
