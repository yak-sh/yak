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
  let host = await compose(read(file), ['graph'], undefined)
  let reader = readThread(file)
  try {
    await reader.ready()
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
    })
    await assertRejects(() => Promise.resolve(reader.read('.unknown')))
  } finally {
    await reader.close()
    await host.close()
    let broken = readThread(`${dir}/missing.json`)
    await assertRejects(() => broken.ready())
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
  let host = await compose(read(file), ['graph'], undefined)
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

// A worker stuck in synchronous SQL cannot service the close message. No
// writes live in this worker, so closing must terminate it without a reply.
test('closing a busy web reader terminates it and rejects its waiting reads', async () => {
  let Original = globalThis.Worker
  let terminated = 0
  class Busy {
    onmessage = null
    onerror = null
    postMessage() {}
    terminate() {
      terminated++
    }
  }
  globalThis.Worker = Busy as unknown as typeof Worker
  try {
    let reader = readThread('unused.json')
    let waiting = assertRejects(() => Promise.resolve(reader.read('.doc')))
    let closed = false
    let closing = reader.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    assertEquals(terminated, 1)
    assertEquals(closed, true)
    await waiting
    await closing
    await reader.close()
    assertEquals(terminated, 1)
    await assertRejects(() => Promise.resolve(reader.read('.doc')))
  } finally {
    globalThis.Worker = Original
  }
})

// Readiness must exercise the reader's query path, not an empty identity seek.
test('reader readiness waits for a bounded read and propagates its refusal', async () => {
  let Original = globalThis.Worker
  let answer: (failed: boolean) => void = () => {}
  class Reader {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror = null
    postMessage(data: { id?: number; op?: string }) {
      if (!data.id) return
      if (data.op == 'get') {
        this.onmessage?.({ data: { id: data.id, value: [] } })
      } else {
        answer = (failed) =>
          this.onmessage?.({
            data: failed
              ? {
                id: data.id,
                error: {
                  name: 'Refused',
                  message: 'query failed',
                  details: {},
                },
              }
              : { id: data.id, value: [] },
          })
      }
    }
    terminate() {}
  }
  globalThis.Worker = Reader as unknown as typeof Worker
  let reader = readThread('unused.json')
  try {
    let settled = false
    let waiting = reader.ready().then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    assertEquals(settled, false)
    answer(false)
    await waiting
    assertEquals(settled, true)
    let failed = assertRejects(() => reader.ready(), Error, 'query failed')
    answer(true)
    await failed
  } finally {
    await reader.close()
    globalThis.Worker = Original
  }
})

// A synchronous query occupies its worker until it returns or its owner aborts.
// Independent reads and the latest remaining click keep their own progress.
test('independent reads bypass slow SQL and abandoned clicks release every lane', async () => {
  let Original = globalThis.Worker
  let workers: Reader[] = []
  class Reader {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror = null
    jobs: { id: number; query?: string; opts?: object }[] = []
    ended = false
    constructor() {
      workers.push(this)
    }
    postMessage(data: { id?: number; query?: string; opts?: object }) {
      if (data.id) this.jobs.push({ ...data, id: data.id })
    }
    terminate() {
      this.ended = true
    }
    answer() {
      let job = this.jobs.at(-1)!
      this.onmessage?.({ data: { id: job.id, value: [] } })
    }
  }
  globalThis.Worker = Reader as unknown as typeof Worker
  let reader = readThread('unused.json')
  try {
    let slow = reader.read('.slow')
    let fast = reader.read('.fast')
    assertEquals(workers.length, 2)
    workers[1].answer()
    assertEquals(await fast, [])
    workers[0].answer()
    await slow
    let pending: Promise<unknown>[] = []
    let aborts = Array.from({ length: 4 }, () => new AbortController())
    for (let abort of aborts) {
      pending.push(assertRejects(
        () =>
          Promise.resolve(
            reader.read('.abandoned', { signal: abort.signal }),
          ),
        DOMException,
        'aborted',
      ))
    }
    // Only the two admitted reads were posted; the others wait outside workers.
    assertEquals(workers.filter((w) => !w.ended).length, 2)
    for (let abort of aborts) abort.abort()
    await Promise.all(pending)
    let latest = reader.read('.latest')
    let alive = workers.filter((w) => !w.ended)
    assertEquals(alive.length, 1)
    assertEquals(workers.length, 3)
    assertEquals(alive[0].jobs.at(-1)?.query, '.latest')
    assertEquals(alive[0].jobs.at(-1)?.opts, {})
    alive[0].answer()
    assertEquals(await latest, [])
  } finally {
    await reader.close()
    globalThis.Worker = Original
  }
})
