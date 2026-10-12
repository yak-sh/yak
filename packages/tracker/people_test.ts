// A bug reads whom its occurrences reached, in memory and over SQLite alike: a
// customer's bug apart from a probe's, whoever wrote the occurrences.
import { equal, test } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { derived } from './vocab.ts'
import { fixture, vocab } from './fixture_test.ts'
import { capture } from './report.ts'
import { group } from './group.ts'
import { comp } from './model.ts'

let reach = async (platform: string, ...seen: Record<string, string>[]) => {
  let db = platform == 'sqlite' ? open(':memory:') : undefined
  let g = fixture(
    undefined,
    undefined,
    undefined,
    db ? storage(db, vocab, { derived: derived() }) : undefined,
  )
  for (let [i, tags] of seen.entries()) {
    let eid = `seen-${i}`
    await g.apply(
      capture(new TypeError('missing row 42'), {
        sink: () => {},
        eid,
        at: '2026-10-12T17:00:00Z',
        commit: 'a'.repeat(40),
        during: { kind: 'call' },
        tags,
      }),
      { trusted: true },
    )
    await group(g, eid, (row) => row)
  }
  let [bug] = await g.read('.bug *')
  db?.close()
  return comp(bug, 'bug')
}

for (let platform of ['ram', 'sqlite']) {
  let customer = await reach(
    platform,
    { user_id: 'jill', account: 'person', space: 'jill' },
    { user_id: 'jill', account: 'person', space: 'jill' },
    { user_id: 'graham', account: 'person', space: 'jill' },
  )
  let probe = await reach(platform, { user_id: 't1', account: 'test' })
  let anonymous = await reach(platform, { account: 'person', space: 'jill' })
  let box = await reach(platform, { source: 'box' })
  test(`a bug counts the people it reached and their kind (${platform})`, () => {
    equal([customer.people, customer.account], [2, 'person'])
    equal([probe.people, probe.account], [1, 'test'])
    equal([anonymous.people, anonymous.account], [0, 'person'])
    equal([box.people, box.account ?? null], [0, null])
  })
}
