// Local admission keeps working while the remote outbox is unavailable. The
// spool here is in memory with file.ts's contract (file_test.ts holds the
// files to it): a record is admitted once and leaves only when acknowledged.
import { clock, equal, test, throws, until } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { type Record, service } from './service.ts'
import { capture } from './report.ts'
import { fixture } from './fixture_test.ts'
import { group } from './group.ts'
import { comp } from './model.ts'

let remote = { url: 'https://tracker.example', secret: 'test' }
let memory = () => {
  let held = new Set<{ rows: Bundle[]; admitted: boolean }>()
  return {
    held,
    // Rows cross the spool as JSON, as a file's line does.
    append: (eid: string) =>
      held.add({
        rows: JSON.parse(
          JSON.stringify(capture('broken', { eid, sink: () => {} })),
        ),
        admitted: false,
      }),
    admitted: () => [...held].map((entry) => entry.admitted),
    source: async function* (): AsyncIterable<Record> {
      for (let entry of [...held]) {
        yield {
          rows: entry.rows,
          admitted: entry.admitted,
          admit: () => {
            entry.admitted = true
          },
          ack: () => {
            held.delete(entry)
          },
        }
      }
    },
  }
}

// Each scenario runs once as the file loads, and its test reads what it saw.
let refusal = await (async () => {
  let g = fixture(), spool = memory(), calls = 0
  spool.append('first')
  spool.append('second')
  let down = ((_url: unknown, init?: RequestInit) => {
    if (init?.method != 'POST') return Promise.resolve(Response.json([]))
    calls++
    return Promise.resolve(new Response(null, { status: 503 }))
  }) as typeof fetch
  let refused = () =>
    service({ graph: g }, {
      source: spool.source,
      remote,
      fetch: down,
      notice: async () => {},
    })
      .then(() => false, () => true)
  let hits = async () => comp((await g.read('.bug *'))[0], 'bug').hits
  let first = await refused()
  let errors = (await g.read('.error')).length
  let admitted = spool.admitted()
  for (let eid of ['first', 'second']) await group(g, eid, (row) => row)
  let grouped = await hits()
  // Local retention may remove an occurrence during a remote outage. A
  // durable receipt must keep replay from counting it as another occurrence.
  await g.apply([{ entity: { eid: 'first' }, $delete: true }], {
    trusted: true,
  })
  let again = await refused()
  let retained = (await g.read('.error .entity.eid=first')).length
  let sent: string[] = []
  await service({ graph: g }, {
    source: spool.source,
    remote,
    notice: async () => {},
    fetch: ((_url, init) => {
      if (init?.method != 'POST') return Promise.resolve(Response.json([]))
      sent.push(
        ...JSON.parse(String(init?.body)).map((row: Bundle) => row.entity.eid),
      )
      return Promise.resolve(new Response(null))
    }) as typeof fetch,
  })
  return {
    refused: [first, again],
    errors,
    admitted,
    grouped,
    retained,
    calls,
    sent,
    left: spool.held.size,
    hits: await hits(),
  }
})()
test('remote refusal keeps durable local receipts across restart and retention', () => {
  equal(refusal, {
    refused: [true, true],
    errors: 2,
    admitted: [true, true],
    grouped: 2,
    retained: 0,
    calls: 2,
    sent: ['first', 'second'],
    left: 0,
    hits: 2,
  })
})

let held = await (async () => {
  let stop = new AbortController()
  let release!: () => void
  let sendable = new Promise<void>((resolve) => release = resolve)
  let g = fixture(), spool = memory()
  let fail = false, reports = 0, sending = false
  let graph = {
    ...g,
    apply: async (...args: Parameters<typeof g.apply>) => {
      if (fail) {
        fail = false
        throw Error('temporary local failure')
      }
      return await g.apply(...args)
    },
  }
  spool.append('first')
  let running = service({ graph }, {
    source: spool.source,
    remote,
    notice: async () => {},
    every: 0,
    report: () => reports++,
    fetch: (async (_url, init) => {
      if (init?.method != 'POST') return Response.json([])
      sending = true
      await sendable
      return new Response(null)
    }) as typeof fetch,
  }, stop.signal)
  try {
    await until(() => sending, { poll: 0 })
    fail = true
    spool.append('later')
    await until(async () => (await g.get(['later'])).length > 0, { poll: 0 })
    return {
      reports,
      errors: (await g.read('.error')).length,
      admitted: spool.admitted(),
    }
  } finally {
    stop.abort()
    release()
    await running
  }
})()
test('a held remote send cannot block later local admission or local retries', () => {
  equal(held, { reports: 1, errors: 2, admitted: [true, true] })
})

test('a locally refused record is never sent or acknowledged', async () => {
  let g = fixture(), spool = memory(), calls = 0
  spool.append('refused')
  await throws(() =>
    service({
      graph: {
        ...g,
        apply: () => {
          throw Error('offline')
        },
      },
    }, {
      source: spool.source,
      remote,
      notice: async () => {},
      report: () => {},
      fetch: ((_url, init) => {
        if (init?.method != 'POST') return Promise.resolve(Response.json([]))
        calls++
        return Promise.resolve(new Response(null))
      }) as typeof fetch,
    })
  )
  equal(calls, 0)
  equal(spool.admitted(), [false])
})

// A lock can clear on the next pass; it must neither quarantine the oldest
// record nor delay the later record's local receipt and remote delivery.
let locked = await (async () => {
  let g = fixture(), spool = memory(), unavailable = true
  spool.append('locked')
  spool.append('behind-lock')
  let sent: string[] = []
  let options = {
    source: spool.source,
    remote,
    notice: async () => {},
    report: () => {},
    fetch: ((_url, init) => {
      if (init?.method != 'POST') return Promise.resolve(Response.json([]))
      sent.push(
        ...JSON.parse(String(init?.body)).map((row: Bundle) => row.entity.eid),
      )
      return Promise.resolve(new Response(null))
    }) as typeof fetch,
  }
  let graph = {
    ...g,
    apply: (...args: Parameters<typeof g.apply>) => {
      if (unavailable && args[0].some((row) => row.entity.eid == 'locked')) {
        throw Error('database is locked')
      }
      return g.apply(...args)
    },
  }
  await service({ graph }, options).catch(() => {})
  let first = spool.admitted()
  let later = (await g.get(['behind-lock'])).length
  unavailable = false
  await service({ graph }, options)
  return { first, later, sent, left: spool.held.size }
})()
test('a locked oldest record stays retryable while later records reach remote', () => {
  equal(locked, {
    first: [false],
    later: 1,
    sent: ['behind-lock', 'locked'],
    left: 0,
  })
})

let batched = await (async () => {
  let g = fixture(), spool = memory(), sizes: number[] = []
  for (let n = 0; n < 205; n++) spool.append(`batch-${n}`)
  await service({ graph: g }, {
    source: spool.source,
    remote,
    notice: async () => {},
    fetch: ((_url, init) => {
      if (init?.method != 'POST') return Promise.resolve(Response.json([]))
      sizes.push(JSON.parse(String(init.body)).length)
      return Promise.resolve(new Response(null))
    }) as typeof fetch,
  })
  return { sizes, left: spool.held.size }
})()
test('a flood leaves in bounded intake batches rather than one connection per occurrence', () => {
  equal(batched, { sizes: [100, 100, 5], left: 0 })
})

// A rolling restart aborts the standing read, not the remote tracker.
let cancelled = await (async () => {
  let stop = new AbortController(), g = fixture()
  let entered!: () => void
  let reading = new Promise<void>((done) => entered = done)
  let notices: string[] = [], failure = ''
  let running = service({ graph: g }, {
    source: async function* () {},
    remote,
    notice: (error) => {
      notices.push(error.message)
      return Promise.resolve()
    },
    fetch: ((_url, init) => {
      entered()
      return new Promise<Response>((_done, fail) => {
        init?.signal?.addEventListener(
          'abort',
          () => fail(init.signal?.reason),
          {
            once: true,
          },
        )
      })
    }) as typeof fetch,
  }, stop.signal).catch((error) => {
    failure = String(error)
  })
  await reading
  stop.abort()
  await running
  return { notices, failure }
})()
test('stopping a standing read settles the service without a tracker outage', () => {
  equal(cancelled, { notices: [], failure: '' })
})

// A delivery the tracker cannot answer stops at that batch, and the rest
// waits for the next pass, so a pass ends within a request's minute.
let unanswered = await (async () => {
  let g = fixture(), spool = memory(), calls = 0
  for (let n = 0; n < 205; n++) spool.append(`down-${n}`)
  await service({ graph: g }, {
    source: spool.source,
    remote,
    notice: async () => {},
    fetch: ((_url, init) => {
      if (init?.method != 'POST') return Promise.resolve(Response.json([]))
      calls++
      return Promise.resolve(new Response(null, { status: 503 }))
    }) as typeof fetch,
  }).catch(() => {})
  return { calls, left: spool.held.size }
})()
test('a delivery the tracker cannot answer sends no later batch in that pass', () => {
  equal(unanswered, { calls: 1, left: 205 })
})

// A standing sync whose pass hangs on the box, on a held clock: the graph
// read for the bug the tracker answered never settles, once.
let hung = await (async () => {
  let stop = new AbortController(), g = fixture(), time = clock()
  let eid = '00000000-0000-4000-8000-000000000001'
  let reads = 0, notices: string[] = [], logged: string[] = []
  let entered = Promise.withResolvers<void>()
  let graph = {
    ...g,
    get: (eids: string[]) => {
      if (!eids.includes(eid) || reads++) return g.get(eids)
      entered.resolve()
      return new Promise<never>(() => {})
    },
  }
  let running = service({ graph }, {
    source: async function* () {},
    remote,
    every: 3_600_000,
    reconcileEvery: 0,
    clock: time,
    log: (line) => logged.push(line),
    notice: (error) => {
      notices.push(error.message)
      return Promise.resolve()
    },
    fetch: (() =>
      Promise.resolve(
        Response.json([{ entity: { eid }, bug: { fault: 'hung' } }]),
      )) as typeof fetch,
  }, stop.signal)
  await entered.promise
  await time.advance(300_000)
  await until(() => reads > 2, { poll: 0 })
  stop.abort()
  await running
  return { notices, logged }
})()
test('a standing sync that hangs on the box is told as a hang, once, and the next pass runs', () => {
  equal(hung, {
    notices: [
      'Tracker standing sync failed: A pass has run for 5 minutes without finishing',
    ],
    logged: [],
  })
})

// A service whose remote this side cannot ask: first an address it does not
// send to, then no secret, then fixed, the remote read at each use. Its
// passes run back to back on a held clock that never moves, so a report
// owed only after five minutes never comes.
let misconfigured = await (async () => {
  let stop = new AbortController(), g = fixture(), spool = memory()
  let time = clock(), passes = 0, sent = 0
  let notices: string[] = [], logged: string[] = []
  let remote: { url: string; secret?: string } = {
    url: 'http://tracker.example',
    secret: 'test',
  }
  spool.append('unset')
  let running = service({ graph: g }, {
    source: spool.source,
    remote,
    every: 0,
    reconcileEvery: 0,
    clock: {
      now: time.now,
      after: (ms, run) => (passes++, time.after(ms, run)),
    },
    log: (line) => logged.push(line),
    notice: (error) => (notices.push(error.message), Promise.resolve()),
    fetch: ((_url, init) => {
      if (init?.method == 'POST') sent++
      return Promise.resolve(Response.json([]))
    }) as typeof fetch,
  }, stop.signal)
  let more = (n: number) => {
    let until_ = passes + n
    return until(() => passes > until_, { poll: 0 })
  }
  await more(20)
  remote.url = 'https://tracker.example'
  delete remote.secret
  await more(20)
  remote.secret = 'test'
  await until(() => logged.length == 2 && !spool.held.size, { poll: 0 })
  stop.abort()
  await running
  return { notices: notices.sort(), logged: logged.sort(), sent }
})()
test('a remote this side cannot ask is told at once, once a cause, and recovers when fixed', () => {
  equal(misconfigured, {
    notices: [
      'Tracker delivery sync failed: Remote tracker address is invalid',
      'Tracker delivery sync failed: Remote tracker secret is unavailable',
      'Tracker standing sync failed: Remote tracker address is invalid',
      'Tracker standing sync failed: Remote tracker secret is unavailable',
    ],
    logged: [
      'Tracker delivery sync: Remote tracker is set up again',
      'Tracker standing sync: Remote tracker is set up again',
    ],
    sent: 1,
  })
})

// One pass (an aborted signal) on a held clock, where intake and delivery
// both fail: a new record's admission fails once, and the tracker refuses the
// record already admitted. The standing sync still runs.
let single = await (async () => {
  let g = fixture(), spool = memory(), time = clock()
  let reports: string[] = [], notices: string[] = [], asked: string[] = []
  let failing = true
  let graph = {
    ...g,
    apply: (...args: Parameters<typeof g.apply>) => {
      if (!failing) return g.apply(...args)
      failing = false
      return Promise.reject(Error('temporary local failure'))
    },
  }
  spool.append('new')
  spool.append('old')
  ;[...spool.held][1].admitted = true
  let thrown = await service({ graph }, {
    source: spool.source,
    remote,
    clock: time,
    log: () => {},
    report: (error) => reports.push((error as Error).message),
    notice: (error) => (notices.push(error.message), Promise.resolve()),
    fetch: ((_url, init) => {
      asked.push(init?.method ?? 'GET')
      return Promise.resolve(
        init?.method == 'POST'
          ? new Response(null, { status: 400 })
          : Response.json([]),
      )
    }) as typeof fetch,
  }).then(() => [], (error) => (error.errors ?? [error]).map(String))
  return { thrown, reports, notices, asked, left: spool.held.size }
})()
test('one pass runs every sync though an earlier one fails, each failure told', () => {
  equal(single, {
    thrown: [
      'Error: temporary local failure',
      'Error: Remote tracker refused intake (400)',
    ],
    reports: ['temporary local failure'],
    notices: [
      'Tracker delivery sync failed: Remote tracker refused intake (400)',
    ],
    asked: ['POST', 'GET'],
    left: 2,
  })
})
