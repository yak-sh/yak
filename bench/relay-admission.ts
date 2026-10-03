// Ordinary admission at 10 values per second per entity, on a warmed Store.
// Supply a checkout path to compare the same fixture across revisions.
const root = Deno.args[0] ?? new URL('..', import.meta.url).pathname
const { Store } = await import(root + '/workers/yak/graph.ts')
const { durable } = await import(root + '/packages/durable-object/testing.ts')
const { graph, signed } = await import(root + '/packages/graph/mod.ts')
const { loadVocab } = await import(root + '/packages/vocab/mod.ts')
const { storage } = await import(root + '/packages/durable-object/store.ts')
const { memberDoc, memberKeywords, members } = await import(
  root + '/packages/member/mod.ts'
)
const { kernelDoc } = await import(root + '/packages/kernel/mod.ts')
const { admitSchema } = await import(root + '/packages/graph/admit_schema.ts')
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
const N = Number(Deno.args[1] ?? 200)
let now = Date.now()
const date = Date.now
Date.now = () => now
const measured = () => {
  let db = durable(), sql = 0, writes = 0, txs = 0
  const exec = db.sql.exec.bind(db.sql), tx = db.transactionSync.bind(db)
  db.sql.exec = (q: string, ...args: unknown[]) => {
    sql++
    if (/^\s*(?:insert|update|delete|replace)\b/i.test(q)) writes++
    return exec(q, ...args)
  }
  db.transactionSync = (fn: () => unknown) => {
    txs++
    return tx(fn)
  }
  return {
    db,
    reset: () => {
      sql = 0
      writes = 0
      txs = 0
    },
    count: () => ({ sql, writes, txs }),
  }
}
const median = (a: number[]) =>
  a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
const summary = (
  variant: string,
  entities: number,
  samples: number[],
  count: ReturnType<ReturnType<typeof measured>['count']>,
) => ({
  variant,
  entities,
  simulated_seconds: N / 10,
  values: N * entities,
  micros_per_value: +(median(samples) * 1000 / (N * entities)).toFixed(3),
  cpu_ms_per_entity_second: +(median(samples) * 10 / (N * entities)).toFixed(4),
  sql_per_value: count.sql / (N * entities),
  write_stmts_per_value: count.writes / (N * entities),
  transactions_per_value: count.txs / (N * entities),
  note: variant === 'store-relay'
    ? 'synchronous message/admission/coalescing, no observers; fanout timer excluded'
    : 'ordinary graph.apply(check) on durable SQLite + member/schema; rolled back',
})
for (const entities of [1, 10, 100]) {
  const eids = Array.from(
    { length: entities },
    (_, i) => `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  )
  const m = measured(), live: unknown[] = []
  const ctx = {
    storage: m.db,
    acceptWebSocket: (ws: unknown) => {
      live.push(ws)
    },
    getWebSockets: () => live,
  }
  const store = new Store(ctx)
  const post = (path: string, body: unknown) =>
    store.fetch(
      new Request('http://store' + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
  let response = await post('/vocab', schema)
  if (response.status !== 200) throw new Error(await response.text())
  for (let i = 0; i < eids.length; i += 32) {
    response = await post(
      '/apply',
      eids.slice(i, i + 32).map((eid) => ({
        entity: { eid },
        hero: { name: 'Ada' },
      })),
    )
    if (response.status !== 200) throw new Error(await response.text())
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
  // Warm restored sinks and peer-value caches before taking samples.
  for (let i = 0; i < entities; i++) {
    store.webSocketMessage(
      wires[i],
      JSON.stringify({
        relay: [{ entity: { eid: eids[i] }, presence: { x: -1 } }],
      }),
    )
    now += 100
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  const samples: number[] = []
  for (let round = 0; round < 3; round++) {
    m.reset()
    let start = performance.now()
    for (let tick = 0; tick < N; tick++) {
      now += 100
      for (let i = 0; i < entities; i++) {
        store.webSocketMessage(
          wires[i],
          JSON.stringify({
            relay: [{
              entity: { eid: eids[i] },
              presence: { x: round * N + tick },
            }],
          }),
        )
      }
    }
    samples.push(performance.now() - start)
  }
  console.log(
    JSON.stringify({
      ...summary('store-relay', entities, samples, m.count()),
      refused,
    }),
  )
  for (const ws of wires) await store.webSocketClose(ws)
  m.db[Symbol.dispose]()
  const c = measured(),
    vocab = loadVocab([kernelDoc, memberDoc, schema], [memberKeywords]),
    s = storage(c.db, vocab),
    g = graph({ storage: s, vocab })
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
  const checks: number[] = []
  for (let round = 0; round < 3; round++) {
    c.reset()
    const start = performance.now()
    for (let tick = 0; tick < N; tick++) {
      now += 100
      for (let i = 0; i < entities; i++) {
        g.apply(
          signed([{
            entity: { eid: eids[i] },
            presence: { x: round * N + tick },
          }], { by: ADA, via: VIA }),
          { check: true },
        )
      }
    }
    checks.push(performance.now() - start)
  }
  console.log(
    JSON.stringify(summary('graph-full-check', entities, checks, c.count())),
  )
  c.db[Symbol.dispose]()
}
Date.now = date
