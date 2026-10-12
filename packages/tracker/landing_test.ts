// Faults containing a landing diagnostic remain literal grouping keys. A
// refusal to land cannot reopen an unrelated, resolved native-library bug.
import { equal, test } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { derived } from './vocab.ts'
import { fixture, vocab } from './fixture_test.ts'
import { capture } from './report.ts'
import { group } from './group.ts'
import { comp } from './model.ts'

for (let platform of ['ram', 'sqlite']) {
  let db = platform == 'sqlite' ? open(':memory:') : undefined
  let g = fixture(
    undefined,
    undefined,
    undefined,
    db ? storage(db, vocab, { derived: derived() }) : undefined,
  )
  let put = async (eid: string, error: Error, commit: string) => {
    await g.apply(
      capture(error, {
        sink: () => {},
        eid,
        at: '2026-10-12T01:40:23Z',
        commit,
        during: { kind: 'call' },
      }),
      { trusted: true },
    )
    await group(g, eid, (row) => row)
  }
  await put(
    'vector',
    new TypeError(
      "Invalid URL: './vector.so' with base 'npm:@sqliteai/sqlite-vector-linux-x86_64@1.1.2'",
    ),
    'a'.repeat(40),
  )
  let [original] = await g.read('.bug *')
  await g.apply([{ entity: original.entity, resolved: {} }], { trusted: true })
  let refusal = new Error(
    'land: refusing — inspect: git diff main...HEAD -- packages/tracker/group.ts; deliberate: land --allow-revert=packages/tracker/group.ts,packages/tracker/fixture_test.ts',
  )
  refusal.name = 'LandError'
  await put('landing', refusal, 'b'.repeat(40))
  let rows = await g.read('.bug *')
  let [vector] = await g.get([original.entity.eid])
  let [landing] = await g.get(['landing'])
  test(`landing refusals cannot regress a native-library bug (${platform})`, () => {
    equal(rows.length, 2)
    equal(comp(vector, 'bug').status, 'resolved')
    equal(comp(vector, 'bug').hits, 1)
    equal(vector.regressed, undefined)
    equal(comp(landing, 'error').bug == original.entity.eid, false)
  })
  db?.close()
}
