/// <reference lib="deno.ns" />
// A keyed write's receipt, kept in the host's write log on the graph's own
// connection (./receipts.ts).
import { equal, test } from '@yaks/testing'
import { graph, token } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import type { Driver } from '@yaks/sql'
import { api } from './route.ts'
import { shop } from './testing.ts'
import { writes } from './log.ts'
import { receipts } from './receipts.ts'

let vocab = shop
let request = (key: string, text: string, path = '/apply') =>
  new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: text,
  })
let simple = JSON.stringify([{
  entity: { eid: '$one' },
  doc: { title: 'One' },
}])

// A graph over SQLite at `path`, its log on the same connection, and its door
// as `by` writes it.
let opened = async (
  path = ':memory:',
  more: Parameters<typeof graph>[0]['plugins'] = [],
) => {
  let db = open(path)
  let g = graph({
    vocab,
    storage: storage(db, vocab, { number: true }),
    plugins: [receipts(db), ...more],
  })
  await g.install()
  let as = (by?: string) =>
    api({ graph: g, db, authenticate: () => by ? { by } : null })
  return { db, g, door: as(), as }
}
let kept = (db: Driver) => writes(db, undefined, true).length

let text = JSON.stringify([{
  entity: { eid: '$new' },
  doc: { title: 'Only once' },
}, {
  entity: { eid: 'existing' },
  doc: { title: 'Changed' },
  $was: { doc: { title: token('Before') } },
}])
let dir = Deno.makeTempDirSync()
let first = await opened(dir + '/receipts.db')
await first.g.apply([{ entity: { eid: 'existing' }, doc: { title: 'Before' } }])
// The first response is never read by the caller. Close the graph's backing
// connection and all handler state before retrying the outstanding outbox item.
let original = await (await first.door(request('outbox:lost', text))).text()
first.db.close()
let again = await opened(dir + '/receipts.db')
let retried = await again.door(request('outbox:lost', text))
let replay = await retried.text()
let rows = await again.g.read('.doc')
let changed = await again.door(request('outbox:lost', text + ' '))
let unlogged = await api({ graph: again.g })(request('outbox:nolog', simple))
let logged = kept(again.db)
again.db.close()
Deno.removeSync(dir, { recursive: true })

test('keyed apply replays the canonical alias and was answer after SQLite reopen', () => {
  equal([retried.status, replay, rows.length], [200, original, 2])
  equal(
    JSON.parse(replay).some((b: { $alias?: string }) => b.$alias == '$new'),
    true,
  )
})
test('keyed apply binds the exact body, including whitespace', () => {
  equal(changed.status, 400)
})
test('a host with no write log refuses a keyed write', () => {
  equal([unlogged.status, logged], [400, 1])
})

let fail = true
let failing = await opened(':memory:', [{
  name: 'failure after receipt',
  hooks: {
    commit: (b) => {
      if (fail) throw new Error('storage failure')
      return b
    },
  },
}])
let broke = await failing.door(request('outbox:rollback', simple))
await broke.text()
let afterFailure = [await failing.g.read('.doc'), kept(failing.db)]
fail = false
let success = await failing.door(request('outbox:rollback', simple))
let successText = await success.text()
let duplicate = await failing.door(request('outbox:rollback', simple))
let duplicateText = await duplicate.text()
test('a failed transaction retains neither mutation nor receipt and can retry', () => {
  equal(broke.status >= 400, true)
  equal(afterFailure, [[], 0])
  equal([success.status, duplicate.status], [200, 200])
  equal(duplicateText, successText)
})

let shared = await opened()
let concurrent = await Promise.all([
  shared.door(request('outbox:concurrent', simple)),
  shared.door(request('outbox:concurrent', simple)),
])
let concurrentAnswers = await Promise.all(concurrent.map((r) => r.text()))
let docs = await shared.g.read('.doc')
let empty = await shared.door(request('outbox:empty', '[]'))
let emptyAgain = await shared.door(request('outbox:empty', '[]'))
let emptyAnswers = [await empty.json(), await emptyAgain.json()]
test('concurrent keyed requests mutate once and receive the same answer', () => {
  equal(concurrent.map((r) => r.status), [200, 200])
  equal(concurrentAnswers[0], concurrentAnswers[1])
  equal(docs.length, 1)
})
test('an empty keyed batch has a replayable empty answer', () => {
  equal([empty.status, emptyAgain.status], [200, 200])
  equal(emptyAnswers, [[], []])
})

await shared.g.apply([
  { entity: { eid: 'alice' }, doc: { title: 'Alice' } },
  { entity: { eid: 'bob' }, doc: { title: 'Bob' } },
])
let aliceAnswer = await shared.as('alice')(request('outbox:shared', simple))
let bobAnswer = await shared.as('bob')(request('outbox:shared', simple))
let scopedAnswers = [await aliceAnswer.json(), await bobAnswer.json()]
let checked = await shared.door(
  request('outbox:checked', simple, '/apply?check'),
)
await checked.text()
let afterCheck = JSON.stringify([{
  entity: { eid: '$other' },
  doc: { title: 'Other' },
}])
let afterCheckAnswer = await shared.door(request('outbox:checked', afterCheck))
await afterCheckAnswer.text()
test('receipt keys are actor-scoped and dry runs do not consume them', () => {
  equal([
    aliceAnswer.status,
    bobAnswer.status,
    checked.status,
    afterCheckAnswer.status,
  ], [200, 200, 200, 200])
  equal(scopedAnswers[0][0].entity.eid == scopedAnswers[1][0].entity.eid, false)
})
