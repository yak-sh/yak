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

// A fake worker: it records each read posted to it and answers the latest
// when told, as a worker returning from synchronous SQL would.
let fakes = () => {
  let workers: Fake[] = []
  class Fake {
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
  let Original = globalThis.Worker
  globalThis.Worker = Fake as unknown as typeof Worker
  return { workers, restore: () => globalThis.Worker = Original }
}
let abandoned = (reader: ReturnType<typeof readThread>, query: string) => {
  let abort = new AbortController()
  let refused = assertRejects(
    () => Promise.resolve(reader.read(query, { signal: abort.signal })),
    DOMException,
    'aborted',
  )
  return { abort: () => abort.abort(), refused }
}

// A synchronous query occupies its worker until it returns. Independent reads
// bypass a slow one. A cancelled read is refused at once, and its worker,
// kept, takes the next read when that SQL returns: Deno keeps part of every
// worker that ends, so a cancel never ends one.
test('independent reads bypass slow SQL and cancelled reads keep their workers', async () => {
  let { workers, restore } = fakes()
  let reader = readThread('unused.json')
  try {
    let slow = reader.read('.slow')
    let fast = reader.read('.fast')
    assertEquals(workers.length, 2)
    workers[1].answer()
    assertEquals(await fast, [])
    workers[0].answer()
    await slow
    let clicks = Array.from({ length: 4 }, () => abandoned(reader, '.old'))
    for (let click of clicks) click.abort()
    await Promise.all(clicks.map((c) => c.refused))
    let latest = reader.read('.latest')
    // The first worker back from its cancelled read answers the latest one.
    workers[1].answer()
    assertEquals(workers[1].jobs.at(-1)?.query, '.latest')
    assertEquals(workers[1].jobs.at(-1)?.opts, {})
    workers[1].answer()
    assertEquals(await latest, [])
    workers[0].answer()
    let next = reader.read('.next')
    assertEquals(workers[0].jobs.at(-1)?.query, '.next')
    workers[0].answer()
    assertEquals(await next, [])
    assertEquals(workers.map((w) => w.ended), [false, false])
  } finally {
    await reader.close()
    restore()
  }
})

// A cancelled read still running past its grace is a runaway: its worker is
// let go, and the reads waiting behind it go on in a new one.
test('a cancelled read past its grace gives up its worker', async () => {
  let { workers, restore } = fakes()
  let overdue: (() => void)[] = []
  let reader = readThread('unused.json', {
    timer: (fn) => {
      overdue.push(fn)
      return () => {}
    },
  })
  try {
    let runaway = abandoned(reader, '.runaway')
    let busy = reader.read('.busy')
    let queued = reader.read('.queued')
    runaway.abort()
    await runaway.refused
    for (let fn of overdue) fn()
    assertEquals(workers[0].ended, true)
    assertEquals(workers[2].jobs.at(-1)?.query, '.queued')
    workers[1].answer()
    workers[2].answer()
    assertEquals(await Promise.all([busy, queued]), [[], []])
  } finally {
    await reader.close()
    restore()
  }
})

// A read still running past `slow` is told once, by its masked query, and its
// cause says what it waited on; one answered in time is not told.
test('a read that runs past slow is told with its masked query', async () => {
  let { workers, restore } = fakes()
  let due = new Map<number, () => void>()
  let next = 0
  let reader = readThread('unused.json', {
    timer: (fn) => {
      let key = next++
      due.set(key, fn)
      return () => due.delete(key)
    },
  })
  let told: string[] = []
  reader.overrun((error) =>
    told.push(
      `${error.name}: ${error.message} (${(error.cause as Error).message})`,
    )
  )
  try {
    let quick = reader.read('.quick')
    workers[0].answer()
    await quick
    let long = reader.read('.memory.scope="secret"')
    for (let fn of [...due.values()]) fn()
    workers[0].answer()
    await long
    for (let fn of [...due.values()]) fn()
    assertEquals(told, [
      'SlowRead: a read has run 10 s and is still running: .memory.scope=? ' +
      '(the main thread ran this check on time)',
    ])
  } finally {
    await reader.close()
    restore()
  }
})
