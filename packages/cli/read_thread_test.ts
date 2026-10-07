/// <reference lib="deno.ns" />
// The web reader sees committed graph rows through its own connection.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { context, during, peek, record } from '@yaks/trace'
import type { Event } from '@yaks/trace'
import { read } from './config.ts'
import { compose } from './host.ts'
import { readThread } from './read_thread.ts'

test('the web reader sees commits and closes after a refused query', async () => {
  let dir = await Deno.makeTempDir()
  let file = `${dir}/yak.json`
  await Deno.writeTextFile(
    file,
    JSON.stringify({ db: 'yak.db', plugins: ['@yaks/doc', '@yaks/process'] }),
  )
  let host = await compose(read(file), ['graph'], undefined, { install: true })
  let reader = readThread(file)
  try {
    let processes = (await host.graph.read('.process')).length
    await host.graph.apply([{
      entity: { eid: 'one' },
      doc: { title: 'First' },
    }])
    assertEquals(
      (await reader.read('.doc.title=First')).map((b) => b.entity.eid),
      ['one'],
    )
    assertEquals((await host.graph.read('.process')).length, processes)
    await host.graph.apply([{
      entity: { eid: 'two' },
      doc: { title: 'Second' },
    }])
    assertEquals(
      (await reader.read('.doc')).map((b) => b.entity.eid),
      ['one', 'two'],
    )
    assertEquals((await reader.get(['two']))[0].doc, {
      title: 'Second',
      body: null,
    })
    await assertRejects(() => Promise.resolve(reader.read('.unknown')))
  } finally {
    await reader.close()
    await host.close()
    let broken = readThread(`${dir}/missing.json`)
    await assertRejects(() => Promise.resolve(broken.read('.doc')))
    await broken.close()
    await Deno.remove(dir, { recursive: true })
  }
})

test('web reader forwards observed query and refusal trees into the waiting request', async () => {
  let dir = await Deno.makeTempDir()
  let file = `${dir}/yak.json`
  await Deno.writeTextFile(
    file,
    JSON.stringify({ db: 'yak.db', plugins: ['@yaks/doc'] }),
  )
  let host = await compose(read(file), ['graph'], undefined, { install: true })
  let reader = readThread(file)
  try {
    await host.graph.apply([{
      entity: { eid: 'one' },
      doc: { title: 'First' },
    }])
    let request = (name: string, run: () => Promise<unknown>) =>
      record(
        host.graph,
        () =>
          during(
            peek(host.graph)!.begin({ kind: 'request', name }),
            async () => {
              assertEquals(!!context(), true)
              await run()
            },
          ),
        { history: false },
      )
    let [readTree, getTree, refusedTree] = await Promise.all([
      request('query', () => Promise.resolve(reader.read('.doc'))),
      request('get', () => Promise.resolve(reader.get(['one'], ['doc']))),
      request(
        'refused',
        () => assertRejects(() => Promise.resolve(reader.read('.unknown'))),
      ),
    ])
    for (let captured of [readTree, getTree, refusedTree]) {
      let root = captured.spans[0]
      let read = captured.spans[1]
      assertEquals(['query', 'get'].includes(read.kind), true)
      assertEquals(read.parent, root.id)
      let ids = new Set(captured.spans.map((e: Event) => e.id))
      assertEquals(
        captured.spans.slice(1).every((e: Event) => ids.has(e.parent!)),
        true,
      )
    }
    let sql = readTree.spans.filter((e) => e.kind == 'sql')
    assertEquals(sql.length > 0, true)
    assertEquals(readTree.spans[0].counts?.rowsRead! > 0, true)
    assertEquals(
      readTree.spans[0].counts?.rowsRead,
      readTree.spans[1].counts?.rowsRead,
    )
    assertEquals(refusedTree.spans[1].outcome, 'refused')
    // Origin translation keeps remote starts inside the waiting request.
    assertEquals(readTree.spans[1].start! >= readTree.spans[0].start!, true)
  } finally {
    await reader.close()
    await host.close()
    await Deno.remove(dir, { recursive: true })
  }
})
