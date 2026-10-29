// T-64601's ordinary-admission workload, retained by T-64638 (ed5e921b1).
// A sample submits one value and waits for admission/staging on a warmed Store.
// Simulated 100ms turns satisfy presence's pace; fanout and checked delivery
// to an observer run outside timing. The same fixture accepts a historical root
// whose Store, graph and guard take the clock it gives them. The fixture's time
// is its own: it never replaces the runtime's clock or timers.
import { type Sample, stopwatch } from '@yaks/benchmark'
import { stamps } from './vocabulary.ts'
import type { durable } from '../packages/durable-object/testing.ts'

export { RELAY_ENTITIES } from './names.ts'

const APP = 'a0000000-0000-4000-8000-000000000001'
const ADA = 'b0000000-0000-4000-8000-000000000002'
const VIA = 'd0000000-0000-4000-8000-000000000004'
const schema = {
  $defs: {
    hero: { component: true, properties: { name: { type: 'string' } } },
    presence: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      pace: '100ms',
      properties: { x: { type: 'number' } },
    },
  },
}
const headers = {
  'x-store': 'ada/bench',
  'x-yak-app': APP,
  'x-yak-person': ADA,
  'x-yak-role': 'owner',
  'x-yak-via': VIA,
  'x-yak-access': 'private',
  'x-yak-title': 'Ada',
}
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
export type RelayCounts = {
  sql: number
  reads: number
  writes: number
  transactions: number
}
const measured = (db: ReturnType<typeof durable>) => {
  let counting = false
  let counts: RelayCounts
  const reset = () => {
    counts = { sql: 0, reads: 0, writes: 0, transactions: 0 }
  }
  reset()
  const exec = db.sql.exec.bind(db.sql), tx = db.transactionSync.bind(db)
  db.sql.exec = (q, ...args) => {
    if (counting) counts.sql++
    if (counting && /^\s*(?:select|with|pragma)\b/i.test(q)) counts.reads++
    if (counting && /^\s*(?:insert|update|delete|replace)\b/i.test(q)) {
      counts.writes++
    }
    return exec(q, ...args)
  }
  db.transactionSync = (fn) => {
    if (counting) counts.transactions++
    return tx(fn)
  }
  return {
    db,
    reset,
    counting: (on: boolean) => counting = on,
    counts: () => ({ ...counts }),
  }
}

export type RelayFixture = {
  run(ticks?: number): Promise<Sample & { cpu: number }>
  /** One sample, sent at `at` (default: the fixture's time, 100 ms on each
   * round). */
  next(timing: { start(): void; end(): void }, at?: number): Promise<void>
  reset(): void
  counts(): RelayCounts
  close(): Promise<void>
}

export async function relayFixture(
  entities: number,
  { root = ROOT, variant = 'store-relay' } = {},
): Promise<RelayFixture> {
  const { durable } = await import(root + '/packages/durable-object/testing.ts')
  const m = measured(durable())
  const eids = Array.from(
    { length: entities },
    (_, i) => `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  )
  // The time a sample is sent at, and the fixture's own: 100 ms on each round.
  let round = Date.now(), now = round, value = 0
  const batch = (eid: string, x: number) => [{
    entity: { eid },
    presence: { x },
  }]
  let send: (
    i: number,
    x: number,
    timing: { start(): void; end(): void },
  ) => void | Promise<void>
  let close: () => Promise<void>
  if (variant == 'store-relay') {
    const { Store } = await import(root + '/workers/yak/graph.ts')
    const live: unknown[] = []
    // The Store's clock (graph.ts `Time`): the fixture's time, and the timers
    // a sample sets held by that sample; the others are the runtime's.
    let held: ((fn: () => void, ms: number) => () => void) | undefined
    const store = new Store(
      {
        storage: m.db,
        acceptWebSocket: (ws: unknown) => live.push(ws),
        getWebSockets: () => live,
      },
      {},
      undefined,
      {
        now: () => now,
        timer: (fn: () => void, ms: number) => {
          if (held) return held(fn, ms)
          const t = setTimeout(fn, ms)
          return () => clearTimeout(t)
        },
      },
    )
    const post = async (path: string, body: unknown) => {
      const response = await store.fetch(
        new Request('http://store' + path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      )
      if (response.status !== 200) throw new Error(await response.text())
    }
    await post('/vocab', schema)
    for (let i = 0; i < eids.length; i += 32) {
      await post(
        '/apply',
        eids.slice(i, i + 32).map((eid) => ({
          entity: { eid },
          hero: { name: 'Ada' },
        })),
      )
    }
    let refused = 0
    const wires = eids.map(() => {
      let held = { writer: { actor: { by: ADA, via: VIA } } }
      const ws = {
        readyState: 1,
        send: (s: string) => {
          if (JSON.parse(s).refused) refused++
        },
        close: () => {},
        serializeAttachment: (v: unknown) => {
          held = v as typeof held
        },
        deserializeAttachment: () => held,
      }
      live.push(ws)
      return ws
    })
    const received: { entity: { eid: string }; presence?: { x?: number } }[] =
      []
    let timingValue = false
    const observer = {
      readyState: 1,
      send: (raw: string) => {
        const frame = JSON.parse(raw)
        if (frame.refused) throw new Error(JSON.stringify(frame.refused))
        if (frame.relay && timingValue) {
          throw new Error('Fanout ran inside admission timing')
        }
        received.push(...(frame.relay ?? []))
      },
      close: () => {},
      serializeAttachment: (_value: unknown) => {},
      deserializeAttachment: () => null,
    }
    live.push(observer)
    await store.webSocketMessage(
      observer,
      JSON.stringify({ subscribe: '.hero', id: 'observe' }),
    )
    received.length = 0
    send = async (i, x, timing) => {
      let flush: (() => void) | undefined, cancelled = false, flushing = false
      const delivery: (() => void)[] = []
      const staged = Promise.withResolvers<void>()
      // The sample holds the Store's timers. Registration occurs after
      // admission; its microtask runs after stage has filled the pending batch.
      held = (fn, ms) => {
        if (flushing && ms === 16) {
          delivery.push(fn)
          return () => {}
        }
        if (ms !== 16 || flush) throw new Error(`Unexpected relay timer: ${ms}`)
        flush = fn
        queueMicrotask(() => {
          try {
            timing.end()
            timingValue = false
            staged.resolve()
          } catch (error) {
            staged.reject(error)
          }
        })
        return () => {
          if (!flushing) {
            throw new Error('Relay staging cancelled before fanout')
          }
          cancelled = true
        }
      }
      try {
        const raw = JSON.stringify({ relay: batch(eids[i], x) })
        timingValue = true
        timing.start()
        const done = store.webSocketMessage(wires[i], raw)
        await Promise.race([
          staged.promise,
          done.then(() => {
            throw new Error('Relay finished without staging a value')
          }),
        ])
        flushing = true
        flush!()
        await done
        while (delivery.length) delivery.shift()!()
        if (!cancelled || refused) {
          throw new Error(
            `Relay value was not admitted cancelled=${cancelled} refused=${refused}`,
          )
        }
        const expected = batch(eids[i], x)
        if (JSON.stringify(received) !== JSON.stringify(expected)) {
          throw new Error(
            `Relay delivery mismatch: ${JSON.stringify(received)}`,
          )
        }
        received.length = 0
      } finally {
        timingValue = false
        held = undefined
      }
    }
    close = async () => {
      await store.webSocketClose(observer)
      for (const ws of wires) await store.webSocketClose(ws)
      m.db[Symbol.dispose]()
    }
  } else if (variant == 'graph-full-check') {
    const { graph, signed } = await import(root + '/packages/graph/mod.ts')
    const { loadVocab } = await import(root + '/packages/vocab/mod.ts')
    const { storage } = await import(root + '/packages/durable-object/store.ts')
    const { memberDoc, memberKeywords, members } = await import(
      root + '/packages/member/mod.ts'
    )
    const { kernelDoc } = await import(root + '/packages/kernel/mod.ts')
    const { admitSchema } = await import(
      root + '/packages/graph/admit_schema.ts'
    )
    const { system } = await import(root + '/packages/fp/mod.ts')
    const vocab = loadVocab([
      kernelDoc,
      ...await stamps([kernelDoc], root),
      memberDoc,
      schema,
    ], [
      memberKeywords,
    ])
    const g = graph({
      storage: storage(m.db, vocab),
      vocab,
      // Older graphs take an ISO-producing function; current graphs take Clock.
      clock: Object.assign(() => new Date(now).toISOString(), {
        ...system,
        now: () => now,
      }),
    })
    await g.install()
    await g.apply([{ entity: { eid: APP }, access: { mode: 'private' } }, {
      entity: { eid: ADA },
    }, {
      entity: { eid: 'grant' },
      grant: { app: APP, person: ADA, access: 'owner' },
    }, ...eids.map((eid) => ({ entity: { eid }, hero: { name: 'Ada' } }))], {
      trusted: true,
    })
    g.use(members({ app: APP, vocab, now: () => now }))
    g.use(admitSchema(vocab))
    send = (i, x, timing) => {
      timing.start()
      const result = g.apply(
        signed(batch(eids[i], x), { by: ADA, via: VIA }),
        { check: true },
      )
      if (result instanceof Promise) {
        throw new Error('Graph check became asynchronous; update the benchmark')
      }
      timing.end()
    }
    close = () => {
      m.db[Symbol.dispose]()
      return Promise.resolve()
    }
  } else throw new Error(`Unknown relay variant: ${variant}`)
  let index = 0
  const next = async (timing: { start(): void; end(): void }, at?: number) => {
    if (index === 0) round += 100
    now = at ?? round
    try {
      await send(index, value, {
        start: () => {
          m.counting(true)
          timing.start()
        },
        end: () => {
          timing.end()
          m.counting(false)
        },
      })
    } finally {
      m.counting(false)
    }
    if (++index === entities) {
      index = 0
      value++
    }
  }
  const run = async (ticks = 1) => {
    let value = 0, cpu = 0, took = stopwatch()
    for (let i = 0; i < ticks * entities; i++) {
      await next({
        start: () => took = stopwatch(),
        end: () => {
          let reading = took()
          value += reading.value * 1e6
          cpu += reading.cpu * 1e6
        },
      })
    }
    return { value, cpu }
  }
  await run(2)
  m.reset()
  return { run, next, reset: m.reset, counts: m.counts, close }
}
