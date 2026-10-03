// T-64601's ordinary-admission workload, retained by T-64638 (ed5e921b1).
// The measured work is message/admission/coalescing on a warmed Store with no
// observers. Simulated 100ms turns satisfy presence's pace; fanout is excluded.
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
  let counts: RelayCounts
  const reset = () => {
    counts = { sql: 0, reads: 0, writes: 0, transactions: 0 }
  }
  reset()
  const exec = db.sql.exec.bind(db.sql), tx = db.transactionSync.bind(db)
  db.sql.exec = (q, ...args) => {
    counts.sql++
    if (/^\s*(?:select|with|pragma)\b/i.test(q)) counts.reads++
    if (/^\s*(?:insert|update|delete|replace)\b/i.test(q)) counts.writes++
    return exec(q, ...args)
  }
  db.transactionSync = (fn) => {
    counts.transactions++
    return tx(fn)
  }
  return { db, reset, counts: () => ({ ...counts }) }
}

export type RelayFixture = {
  run(ticks?: number): void
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
  const clock = (fn: () => void) => {
    const date = Date.now
    Date.now = () => now
    try {
      fn()
    } finally {
      Date.now = date
    }
  }
  const batch = (eid: string, x: number) => [{
    entity: { eid },
    presence: { x },
  }]
  let send: (i: number, x: number) => void
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
    send = (i, x) => {
      store.webSocketMessage(
        wires[i],
        JSON.stringify({ relay: batch(eids[i], x) }),
      )
      if (refused) throw new Error('Relay fixture value refused')
    }
    // Warm restored sinks and peer-value caches, then drain the fanout timer.
    const warming: (void | Promise<void>)[] = []
    clock(() => {
      for (let i = 0; i < entities; i++) {
        warming.push(store.webSocketMessage(
          wires[i],
          JSON.stringify({ relay: batch(eids[i], -1) }),
        ))
        now += 100
      }
    })
    await Promise.all(warming)
    // The second value exercises admission with a held peer overlay too.
    warming.length = 0
    clock(() => {
      now += 100
      for (let i = 0; i < entities; i++) {
        warming.push(store.webSocketMessage(
          wires[i],
          JSON.stringify({ relay: batch(eids[i], -2) }),
        ))
      }
    })
    await Promise.all(warming)
    close = async () => {
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
    send = (i, x) => {
      const result = g.apply(
        signed(batch(eids[i], x), { by: ADA, via: VIA }),
        { check: true },
      )
      if (result instanceof Promise) {
        throw new Error('Graph check became asynchronous; update the benchmark')
      }
    }
    close = () => {
      m.db[Symbol.dispose]()
      return Promise.resolve()
    }
  } else throw new Error(`Unknown relay variant: ${variant}`)
  const run = (ticks = 1) => {
    clock(() => {
      for (let tick = 0; tick < ticks; tick++) {
        now += 100
        for (let i = 0; i < entities; i++) send(i, value)
        value++
      }
    })
  }
  m.reset()
  return { run, reset: m.reset, counts: m.counts, close }
}

export async function measureRelayCounts(ticks = RELAY_TICKS) {
  const result: Record<string, RelayCounts> = {}
  for (const entities of RELAY_ENTITIES) {
    const fixture = await relayFixture(entities)
    try {
      fixture.run(ticks)
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
