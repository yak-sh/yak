// File intake replays immutable reporter eids; acknowledgement belongs to the
// commit, never to reading or to a failed write.

import { equal, ok, test, throws } from '@yaks/testing'
import { capture, spool } from './report.ts'
import { files } from './file.ts'
import { intake, service } from './service.ts'
import { fixture } from './fixture_test.ts'
import { comp } from './model.ts'

let record = (eid: string) =>
  capture('broken', {
    sink: () => {},
    eid,
    actor: { by: 'person', via: 'session' },
  })
let left = async (dir: string) =>
  (await Array.fromAsync(Deno.readDir(dir))).map((e) => e.name)

test('a file spool survives reopening, preserves concurrent appends and actors', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Promise.all(
      Array.from(
        { length: 20 },
        (_, i) =>
          Promise.resolve().then(() =>
            spool(files(dir).append)(record(`error-${i}`))
          ),
      ),
    )
    let g = fixture()
    await service({ graph: g }, { spool: dir })
    let rows = await g.read('.error ?created')
    equal(rows.length, 20)
    ok(
      rows.every((row) =>
        comp(row, 'created').by == 'person' &&
        comp(row, 'created').via == 'session'
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

test('partial unpublished records remain while later complete appends drain', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(`${dir}/partial.jsonl`, '[{"entity":')
    await spool(files(dir).append)(record('after-partial'))
    let g = fixture()
    await intake(g, files(dir).source)
    equal((await g.read('.error')).length, 1)
    equal(await Deno.readTextFile(`${dir}/partial.jsonl`), '[{"entity":')
    equal(await left(dir), ['partial.jsonl'])
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
