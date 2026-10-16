// T-64601's ordinary-admission workload, retained by T-64638 (ed5e921b1).
// A sample submits one value and waits for admission/staging on a warmed Store.
// Simulated 100ms turns satisfy presence's pace; fanout and checked delivery
// to an observer run outside timing. The same fixture accepts a historical root.
import type { durable } from '../packages/durable-object/testing.ts'

import { RELAY_ENTITIES, RELAY_TICKS, relayBenchmarkName } from './names.ts'
export {
  RELAY_ENTITIES,
  RELAY_TICKS,
  relayBenchmarkName,
  relayBenchmarkNames,
} from './names.ts'

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
  run(ticks?: number): Promise<number>
  next(timing: { start(): void; end(): void }): Promise<void>
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
  let now = Date.now(), value = 0
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
    const store = new Store({
      storage: m.db,
      acceptWebSocket: (ws: unknown) => live.push(ws),
      getWebSockets: () => live,
    })
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
      const set = globalThis.setTimeout, clear = globalThis.clearTimeout
      let flush: (() => void) | undefined, cancelled = false, flushing = false
      const delivery: (() => void)[] = []
      const staged = Promise.withResolvers<void>()
      // This isolated benchmark owns its timers. Registration occurs after
      // admission; its microtask runs after stage has filled the pending batch.
      globalThis.setTimeout = ((fn: () => void, ms?: number) => {
        if (flushing && ms === 16) {
          delivery.push(fn)
          return -2
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
        return -1
      }) as typeof setTimeout
      globalThis.clearTimeout = ((id?: number) => {
        if (id === -2) return
        if (id !== -1) return clear(id)
        if (!flushing) throw new Error('Relay staging cancelled before fanout')
        cancelled = true
      }) as typeof clearTimeout
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
        globalThis.setTimeout = set
        globalThis.clearTimeout = clear
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
    const vocab = loadVocab([kernelDoc, memberDoc, schema], [memberKeywords])
    const g = graph({ storage: storage(m.db, vocab), vocab })
    await g.install()
    await g.apply([{ entity: { eid: APP }, access: { mode: 'private' } }, {
      entity: { eid: ADA },
    }, {
      entity: { eid: 'grant' },
      grant: { app: APP, person: ADA, access: 'owner' },
    }, ...eids.map((eid) => ({ entity: { eid }, hero: { name: 'Ada' } }))], {
      trusted: true,
    })
    g.use(members({ app: APP, vocab }))
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
  const next = async (timing: { start(): void; end(): void }) => {
    const date = Date.now
    if (index === 0) now += 100
    Date.now = () => now
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
      Date.now = date
    }
    if (++index === entities) {
      index = 0
      value++
    }
  }
  const run = async (ticks = 1) => {
    let ns = 0, start = 0
    for (let i = 0; i < ticks * entities; i++) {
      await next({
        start: () => start = performance.now(),
        end: () => ns += (performance.now() - start) * 1e6,
      })
    }
    return ns
  }
  await run(2)
  m.reset()
  return { run, next, reset: m.reset, counts: m.counts, close }
}

export async function measureRelayCounts(ticks = RELAY_TICKS) {
  const result: Record<string, RelayCounts> = {}
  for (const entities of RELAY_ENTITIES) {
    const fixture = await relayFixture(entities)
    try {
      await fixture.run(ticks)
      result[relayBenchmarkName(entities)] = Object.fromEntries(
        Object.entries(fixture.counts()).map(([key, n]) => [
          key,
          n / (ticks * entities),
        ]),
      ) as RelayCounts
    } finally {
      await fixture.close()
    }
  }
  return result
}

if (import.meta.main) {
  if (Deno.args[0] != '--counts') throw new Error('Expected --counts')
  console.log(JSON.stringify(await measureRelayCounts()))
}
