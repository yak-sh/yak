/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { graph, token } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { ram } from '@yaks/ram'
import { api } from './route.ts'
import { apiDoc } from './vocab.ts'
import { shop } from './testing.ts'

let vocab = loadVocab([...shop.docs, apiDoc])
let request = (key: string, text: string, path = '/apply') =>
  new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: text,
  })
let text = JSON.stringify([{
  entity: { eid: '$new' },
  doc: { title: 'Only once' },
}, {
  entity: { eid: 'existing' },
  doc: { title: 'Changed' },
  $was: { doc: { title: token('Before') } },
}])
let dbPath = Deno.makeTempDirSync() + '/receipts.db'
let db = open(dbPath)
let g = graph({ vocab, storage: storage(db, vocab, { number: true }) })
await g.install()
await g.apply([{ entity: { eid: 'existing' }, doc: { title: 'Before' } }])
// The first response is never read by the caller. Close the graph's backing
// connection and all handler state before retrying the outstanding outbox item.
let lost = await api({ graph: g })(request('outbox:lost', text))
let original = await lost.text()
db.close()
let reopened = open(dbPath)
let resumed = graph({
  vocab,
  storage: storage(reopened, vocab, { number: true }),
})
await resumed.install()
let retried = await api({ graph: resumed })(request('outbox:lost', text))
let replay = await retried.text()
let rows = await resumed.read('.doc')
let changed = await api({ graph: resumed })(request('outbox:lost', text + ' '))
reopened.close()
Deno.removeSync(dbPath.slice(0, dbPath.lastIndexOf('/')), { recursive: true })

test('keyed apply replays the canonical alias and was answer after SQLite reopen', () => {
  equal(lost.status, 200)
  equal(retried.status, 200)
  equal(replay, original)
  equal(rows.length, 2)
  equal(
    JSON.parse(replay).find((b: { $alias?: string }) => b.$alias == '$new') !=
      null,
    true,
  )
})
test('keyed apply binds the exact body, including whitespace', () => {
  equal(changed.status, 400)
})

let rollbackGraph = graph({ vocab, storage: ram(vocab) })
let fail = true
rollbackGraph.use({
  name: 'failure after receipt',
  hooks: {
    commit: (b) => {
      if (fail) throw new Error('storage failure')
      return b
    },
  },
})
// Register receipts before the failing hook, as the box composes them.
let { receipts } = await import('./receipts.ts')
rollbackGraph.plugins.unshift(receipts())
let endpoint = api({ graph: rollbackGraph })
let simple = JSON.stringify([{
  entity: { eid: '$one' },
  doc: { title: 'One' },
}])
// Avoid reporting this deliberately induced server failure through HTTP.
let { received } = await import('./receipts.ts')
let refused = false
try {
  await received(
    rollbackGraph,
    'outbox:rollback',
    simple,
    null,
    JSON.parse(simple),
    {},
  )
} catch {
  refused = true
}
let afterFailure = await rollbackGraph.read('.doc|.apply_receipt')
fail = false
let success = await endpoint(request('outbox:rollback', simple))
let successText = await success.text()
let duplicate = await endpoint(request('outbox:rollback', simple))
let duplicateText = await duplicate.text()
test('a failed transaction retains neither mutation nor receipt and can retry', () => {
  equal(refused, true)
  equal(afterFailure, [])
  equal(success.status, 200)
  equal(duplicate.status, 200)
  equal(duplicateText, successText)
})

let privateStore = ram(vocab)
let privateGraph = graph({
  vocab,
  storage: privateStore,
  plugins: [receipts()],
})
let privateDoor = api({ graph: privateGraph })
let concurrent = await Promise.all([
  privateDoor(request('outbox:concurrent', simple)),
  privateDoor(request('outbox:concurrent', simple)),
])
let concurrentAnswers = await Promise.all(concurrent.map((r) => r.text()))
let privateRows = await privateStore.read('.apply_receipt')
let receipt = privateRows[0]
let byId = await privateDoor(
  new Request(
    `http://local/query?q=${
      encodeURIComponent(`.entity.eid=${receipt.entity.eid}&*`)
    }`,
  ),
)
let selected = await privateDoor(
  new Request('http://local/query?q=.apply_receipt'),
)
let count = await privateDoor(
  new Request('http://local/query?q=.apply_receipt%26.count'),
)
let forged = await privateDoor(
  new Request('http://local/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: receipt.entity, apply_receipt: null }]),
  }),
)
let deleted = await privateDoor(
  new Request('http://local/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: receipt.entity, $delete: true }]),
  }),
)
let reads = [await byId.json(), await selected.json(), await count.json()]
let empty = await privateDoor(request('outbox:empty', '[]'))
let emptyAgain = await privateDoor(request('outbox:empty', '[]'))
let emptyAnswers = [await empty.json(), await emptyAgain.json()]

test('concurrent keyed requests mutate once and receive the same answer', () => {
  equal(concurrent.map((r) => r.status), [200, 200])
  equal(concurrentAnswers[0], concurrentAnswers[1])
  equal(privateRows.length, 1)
})
test('receipt digests and answers are hidden from direct queries and aggregates', () => {
  equal(reads, [[], [], { count: 0 }])
  equal(
    (receipt.apply_receipt as Record<string, unknown>).digest,
    token(simple),
  )
  equal('body' in (receipt.apply_receipt as object), false)
  equal([forged.status, deleted.status], [400, 400])
})
test('an empty keyed batch has a replayable empty answer', () => {
  equal([empty.status, emptyAgain.status], [200, 200])
  equal(emptyAnswers, [[], []])
})

await privateGraph.apply([
  { entity: { eid: 'alice' }, doc: { title: 'Alice' } },
  { entity: { eid: 'bob' }, doc: { title: 'Bob' } },
])
let alice = api({ graph: privateGraph, authenticate: () => ({ by: 'alice' }) })
let bob = api({ graph: privateGraph, authenticate: () => ({ by: 'bob' }) })
let aliceAnswer = await alice(request('outbox:shared', simple))
let bobAnswer = await bob(request('outbox:shared', simple))
let scopedAnswers = [await aliceAnswer.json(), await bobAnswer.json()]
let checked = await privateDoor(
  request('outbox:checked', simple, '/apply?check'),
)
await checked.text()
let afterCheck = JSON.stringify([{
  entity: { eid: '$other' },
  doc: { title: 'Other' },
}])
let afterCheckAnswer = await privateDoor(request('outbox:checked', afterCheck))
await afterCheckAnswer.text()
let { subscriptions } = await import('./subs.ts')
let frames: unknown[] = []
await subscriptions(privateGraph).open(
  (f) => frames.push(f),
  'receipts',
  '.apply_receipt',
  { person: null },
)

test('receipt keys are actor-scoped and dry runs do not consume them', () => {
  equal([
    aliceAnswer.status,
    bobAnswer.status,
    checked.status,
    afterCheckAnswer.status,
  ], [200, 200, 200, 200])
  equal(scopedAnswers[0][0].entity.eid == scopedAnswers[1][0].entity.eid, false)
})
test('receipt subscriptions contain no receipt body or answer', () => {
  equal(JSON.stringify(frames).includes('digest'), false)
  equal(JSON.stringify(frames).includes('Only once'), false)
  equal(JSON.stringify(frames).includes('"answer"'), false)
})
