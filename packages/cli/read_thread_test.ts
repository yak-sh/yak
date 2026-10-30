// Reader scheduling and teardown through an in-process worker.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { readThread } from './read_thread.ts'
import { readActivity } from './read_activity.ts'

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
    postMessage(
      data: {
        id?: number
        query?: string
        opts?: object
        activity?: SharedArrayBuffer
      },
    ) {
      if (data.activity) {
        readActivity(data.activity).say('waiting in a read operation')
      }
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
    for (let fn of [...overdue]) fn()
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

// One read, `.memory.scope="secret"`, on a reader whose timers fire when its
// clock passes them. Each step is `<ms>` (the clock moves there and the
// checks due run), `<ms> <cpu> <wait>` (the same, with what the worker's
// thread has spent by then, in s), or `answer`. Says what was told.
let watched = async (...steps: string[]) => {
  let { workers, restore } = fakes()
  let clock = 0, spent = { cpu: 0, wait: 0 }
  let due: { at: number; fn: () => void }[] = []
  let reader = readThread('unused.json', {
    now: () => clock,
    measure: () => ({ ...spent }),
    timer: (fn, ms) => {
      let timer = { at: clock + ms, fn }
      due.push(timer)
      return () => due = due.filter((t) => t !== timer)
    },
  })
  let told: string[] = []
  reader.overrun((error) =>
    told.push(`${error.message} (${(error.cause as Error).message})`)
  )
  try {
    let long = Promise.resolve(reader.read('.memory.scope="secret"'))
    long.catch(() => {})
    workers[0].onmessage?.({ data: { thread: '1/task/2' } })
    for (let step of steps) {
      if (step == 'answer') {
        workers[0].answer()
        await long
        continue
      }
      let [ms, cpu, wait] = step.split(' ').map(Number)
      clock = ms
      if (wait != null) spent = { cpu: cpu * 1000, wait: wait * 1000 }
      for (let timer of due.filter((t) => t.at <= clock)) {
        due = due.filter((t) => t !== timer)
        timer.fn()
      }
    }
    return told
  } finally {
    await reader.close()
    restore()
  }
}

// A read whose own time passes `slow` while it runs is told once, by its
// masked query, with how its worker spent the time. Its own time leaves out
// what the box kept its worker waiting for a CPU, and no first look tells,
// since the answer may be waiting behind the main thread that just came free.
test('a read is told when its own time passes slow', async () => {
  let slow = 'a read has run 10 s and is still running: .memory.scope=? '
  let cases: [string[], string[]][] = [
    [['5000', 'answer', '30000'], []],
    [['10000 9 0.5', '11000 9.5 0.5', '30000'], [
      slow + '(in 11.0 s its worker ran 9.5 s on a CPU, waited 0.5 s for one ' +
      'and was off one 1.0 s; worker operation: waiting in a read operation; its worker had not answered a read yet)',
    ]],
    // The main thread came free just before an on-time check; the answer was
    // waiting behind it.
    [['10500 0 0', 'answer', '30000'], []],
    // The main thread was held past the check; the answer was waiting.
    [['15800 0 0', 'answer', '30000'], []],
    [['15800 9 0', '16800 9.5 0'], [
      slow + '(in 16.8 s its worker ran 9.5 s on a CPU, waited 0.0 s for one ' +
      'and was off one 7.3 s; worker operation: waiting in a read operation; its worker had not answered a read yet)',
    ]],
    // The box kept the worker waiting for a CPU: slow only on its own time.
    [['10000 2 7', 'answer', '30000'], []],
    [['10000 2 7', '17000 4 7'], [
      slow + '(in 17.0 s its worker ran 4.0 s on a CPU, waited 7.0 s for one ' +
      'and was off one 6.0 s; worker operation: waiting in a read operation; its worker had not answered a read yet)',
    ]],
  ]
  for (let [steps, told] of cases) assertEquals(await watched(...steps), told)
})
