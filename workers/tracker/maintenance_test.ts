import { equal, ok, test } from '@yaks/testing'
import { insert } from '@yaks/sql'
import { bounded, storage } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { options, platform, vocab } from './core.ts'
import { type State, Tracker } from './object.ts'

let file = durable()
let initial = storage(file, vocab, options)
initial.install()
initial.raise(['doc'])
for (let from = 1; from <= 1024; from += 256) {
  file.beneath(
    insert(
      'entity',
      ...Array.from(
        { length: 256 },
        (_, i) => ({ id: from + i, eid: `legacy-${from + i}` }),
      ),
    ),
  )
  file.beneath(
    insert(
      'doc',
      ...Array.from(
        { length: 256 },
        (_, i) => ({ entity: from + i, title: `legacy-${from + i}` }),
      ),
    ),
  )
}
file.sql.exec('drop index entity_archetype')
file.sql.exec("delete from server_meta where k='schema'")
let now = Date.parse('2026-11-12T00:00:00Z')
let state: State = {
  id: { name: platform },
  storage: file,
  getWebSockets: () => [],
  acceptWebSocket: () => {},
}
let make = () => new Tracker(state, {}, () => now)
let object = make()
await object.boot()
let missing = () =>
  Number(
    file.sql.exec('select count(*) as n from entity where archetype is null')
      .toArray()[0].n,
  )
let before = missing(), first = await file.getAlarm()

test('a tracker opens before its rows are classified and arms its own maintenance alarm', () => {
  ok(before > 0)
  equal(first, now + 1000)
})

test('tracker alarms wait for a write window, resume after eviction and finish the pointer index', async () => {
  bounded(file).count({
    shape: () => 'foreground writes',
    rowsRead: 0,
    rowsWritten: 49_000,
    returned: 0,
  })
  await file.deleteAlarm()
  await object.alarm()
  equal(missing(), before)
  equal(await file.getAlarm(), now + 60_000)
  now += 60_000
  object = make()
  for (let n = 0; n < 20; n++) {
    await file.deleteAlarm()
    await object.alarm()
    let next = await file.getAlarm()
    if (next == null) break
    now = next
    object = make()
  }
  equal(missing(), 0)
  equal(
    file.sql.exec(
      "select name from sqlite_schema where name='entity_archetype'",
    ).toArray().length,
    1,
  )
  equal(
    file.sql.exec(
      "select v from server_meta where k='archetype:pending' or k like 'owed:index:%'",
    ).toArray(),
    [],
  )
  equal((await object.tracker!.graph.read('.doc.title=legacy-1024'))[0].doc, {
    title: 'legacy-1024',
  })
})
