// File intake replays immutable reporter eids; acknowledgement belongs to the
// commit, never to reading or to a failed write.

import { equal, ok, test, throws } from '@yaks/testing'
import { capture, spool } from './report.ts'
import { files } from './file.ts'
import { intake, service } from './service.ts'
import { fixture } from './fixture_test.ts'
import { comp } from './model.ts'

let person = '00000000-0000-4000-8000-000000000001'
let session = '00000000-0000-4000-8000-000000000002'
let record = (eid: string) =>
  capture('broken', {
    sink: () => {},
    eid,
    actor: { by: person, via: session },
  })
let left = async (dir: string) =>
  (await Array.fromAsync(Deno.readDir(dir))).map((e) => e.name)

// Reopen and drain the concurrent spool once, then inspect the admitted rows
// and acknowledgement outcome without repeating durable writes per assertion.
let concurrent = await Deno.makeTempDir()
await Promise.all(
  Array.from(
    { length: 20 },
    (_, i) =>
      Promise.resolve().then(() =>
        spool(files(concurrent).append)(record(`error-${i}`))
      ),
  ),
)
let concurrentGraph = fixture()
await service({ graph: concurrentGraph }, { spool: concurrent })
test('a file spool survives reopening, preserves concurrent appends and actors', async () => {
  let dir = concurrent
  let g = concurrentGraph
  try {
    let rows = await g.read('.error ?created')
    equal(rows.length, 20)
    ok(
      rows.every((row) =>
        comp(row, 'created').by == person &&
        comp(row, 'created').via == session
      ),
    )
    equal(await left(dir), [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('failed admission leaves the spool for restart; commit before ack replays once', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await spool(files(dir).append)(record('error'))
    let g = fixture()
    let failed = {
      ...g,
      apply: () => {
        throw new Error('database offline')
      },
    }
    await throws(() => intake(failed, files(dir).source))
    equal((await left(dir)).length, 1)
    // A consumer died after its commit but before checkpointing.
    for await (let entry of files(dir).source()) {
      await g.apply(entry.rows, { trusted: true })
    }
    await intake(g, files(dir).source)
    equal((await g.read('.error')).length, 1)
    equal(await left(dir), [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('a service told to stop takes no more records, and leaves the rest spooled', async () => {
  let dir = await Deno.makeTempDir()
  try {
    for (let i = 0; i < 3; i++) await spool(files(dir).append)(record(`e${i}`))
    let g = fixture()
    let up = new AbortController()
    let stopping = {
      ...g,
      apply: async (...args: Parameters<typeof g.apply>) => {
        let out = await g.apply(...args)
        up.abort()
        return out
      },
    }
    await service({ graph: stopping }, { spool: dir }, up.signal)
    equal((await g.read('.error')).length, 1)
    equal((await left(dir)).length, 2)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// Admit a record, reopen the spool and acknowledge it once, then inspect what
// each reader saw. The receipt is the file's own name, so it outlives a reader.
let receipts = await Deno.makeTempDir()
await spool(files(receipts).append)(record('kept'))
for await (let entry of files(receipts).source()) await entry.admit?.()
let reopened = await Array.fromAsync(files(receipts).source())
for (let entry of reopened) await entry.ack()
let acked = await left(receipts)
await Deno.remove(receipts, { recursive: true })
test('an admitted record stays admitted across reopening until acknowledged', () => {
  equal(
    reopened.map((entry) => [entry.rows[0].entity.eid, entry.admitted]),
    [['kept', true]],
  )
  equal(acked, [])
})

// Prepare the spool's partial and complete segments once, then inspect the
// intake outcome and the files it retained.
let partial = await Deno.makeTempDir()
await Deno.writeTextFile(`${partial}/0-partial.jsonl`, '[{"entity":')
await spool(files(partial).append)(record('after-partial'))
let partialGraph = fixture()
await intake(partialGraph, files(partial).source)
test('partial unpublished records remain while later complete appends drain', async () => {
  let dir = partial
  try {
    equal((await partialGraph.read('.error')).length, 1)
    equal(await Deno.readTextFile(`${dir}/0-partial.jsonl`), '[{"entity":')
    equal(await left(dir), ['0-partial.jsonl'])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('concurrent intake acknowledges records listed by another reader without losing later appends', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(
      `${dir}/1.jsonl`,
      JSON.stringify(record('first')) + '\n',
    )
    await Deno.writeTextFile(
      `${dir}/2.jsonl`,
      JSON.stringify(record('second')) + '\n',
    )
    let first = files(dir).source()[Symbol.asyncIterator]()
    let held = ok((await first.next()).value)
    let other = files(dir).source()[Symbol.asyncIterator]()
    let same = ok((await other.next()).value)
    await same.ack()
    await held.ack()
    let next = ok((await other.next()).value)
    await next.ack()
    equal((await first.next()).done, true)
    await spool(files(dir).append)(record('later'))
    let g = fixture()
    await intake(g, files(dir).source)
    equal((await g.read('.error'))[0].entity.eid, 'later')
    equal(await left(dir), [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// A record the graph refuses is set aside, kept; the ones behind it still land.
let poisoned = await Deno.makeTempDir()
let poison = files(poisoned).append
await poison(
  JSON.stringify([{ entity: { eid: 'bad' }, nonesuch: { x: 1 } }]) + '\n',
)
await spool(poison)(record('good'))
let poisonedGraph = fixture()
let poisonedError = await service({ graph: poisonedGraph }, { spool: poisoned })
  .then(() => undefined, (error) => String(error))
test('a refused spool record never holds back the records behind it', async () => {
  try {
    equal((await poisonedGraph.read('.error')).length, 1)
    let kept = await left(poisoned)
    equal(kept.length, 1)
    ok(kept[0].endsWith('.refused'))
    ok(poisonedError)
  } finally {
    await Deno.remove(poisoned, { recursive: true })
  }
})
