// A minute of human-paced Vale traffic through the real Store. The workerd
// probe supplies its SQL cursor counters; setup and subscriptions are separate.
import { AsyncLocalStorage } from 'node:async_hooks'
import { Store } from './graph.ts'
import type { Bundle } from '@yaks/graph'
import {
  type DurableStorage,
  profile,
  type Summary,
} from '@yaks/durable-object'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { seedWorld, settleWorld, worldBindings } from './play_world_fixture.ts'

export type Cost = { read: number; written: number; calls: number }
export type Report = {
  players: number
  history: number
  minutes: number
  profile: Summary[]
  writeShapes: { sql: string; cost: Cost }[]
  openingShapes: { sql: string; cost: Cost }[]
  sources: Record<string, Cost>
  components: Record<string, Cost>
  total: Cost
  opening: Cost
  shapes: { sql: string; cost: Cost }[]
}
const person = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const app = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const eid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const empty = (): Cost => ({ read: 0, written: 0, calls: 0 })
const plus = (a: Cost, b: Cost) => {
  a.read += b.read
  a.written += b.written
  a.calls += b.calls
}

export let playMinute = async (
  db: DurableStorage & {
    sql: DurableStorage['sql'] & { databaseSize: number }
    deleteAll(): Promise<void>
    getAlarm(): Promise<number | null>
    deleteAlarm(): Promise<void>
    setAlarm(at: number): Promise<void>
  },
  players: number,
  history = 79_000,
  minutes = 5,
): Promise<Report> => {
  let source = 'setup', measured = false
  let context = new AsyncLocalStorage<string>()
  let shapes = new Map<string, Cost>()
  let sources: Record<string, Cost> = {}, components: Record<string, Cost> = {}
  let total = empty(), opening = empty()
  let summaries: Summary[] = []
  let profiler = profile((summary) => summaries.push(summary))
  let openingShapes: Report['openingShapes'] = []
  let sql = db.sql.exec.bind(db.sql)
  db.sql.exec = (query, ...bindings) => {
    let cursor = sql(query, ...bindings)
    let rows = cursor.toArray()
    if (measured) {
      if (cursor.rowsRead == null || cursor.rowsWritten == null) {
        throw new Error('This measure requires workerd SQL cursor row counters')
      }
      let cost = {
        read: cursor.rowsRead,
        written: cursor.rowsWritten,
        calls: 1,
      }
      // Exclusive attribution: joined reads belong to their driving SQL table,
      // not every table mentioned (which would double-count). SQLite reports
      // table+index writes together; do not pretend those can be separated.
      let depth = 0, component = 'schema'
      // Attribute the outer table, not a scalar blob subquery in SELECT.
      for (
        let token of query.matchAll(
          /"(?:[^"]|"")*"|'(?:[^']|'')*'|[()]|\b(?:from|into|update)\b/gi,
        )
      ) {
        let word = token[0]
        if (word == '(') depth++
        else if (word == ')') depth--
        else if (depth == 0 && /^(from|into|update)$/i.test(word)) {
          component =
            query.slice(token.index + word.length).match(/^\s+"([^"]+)"/)
              ?.[1] ?? 'schema'
          break
        }
      }
      let kind = component == 'effect'
        ? 'effects'
        : context.getStore() ?? source
      plus(
        shapes.get(query) ?? (shapes.set(query, empty()), shapes.get(query)!),
        cost,
      )
      plus(sources[kind] ??= empty(), cost)
      plus(components[component] ??= empty(), cost)
      plus(total, cost)
      profiler.run(kind, () =>
        profiler.observe({
          shape: query,
          rowsRead: cost.read,
          rowsWritten: cost.written,
        }))
    }
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let live: ReturnType<typeof wire>[] = []
  let store = new Store({
    storage: db,
    getWebSockets: () => live,
    acceptWebSocket: () => {},
  }, worldBindings(app, person))
  let headers = {
    'x-store': 'probe/play-cost',
    'x-yak-access': 'private',
    'x-yak-role': 'owner',
    'x-yak-person': person,
    'x-yak-app': app,
  }
  let post = async (path: string, body: unknown) => {
    let res = await store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          ...(path == '/apply'
            ? { 'idempotency-key': crypto.randomUUID() }
            : {}),
        },
        body: JSON.stringify(body),
      }),
    )
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`)
    await res.body?.cancel()
  }
  await post('/vocab', words)
  let g = store.door.graph
  let read = g.read.bind(g)
  g.read = (q, opts) => {
    let text = typeof q == 'string' ? q : JSON.stringify(q)
    let kind = text.includes('position') && text.includes('30s ago')
      ? 'saves'
      : 'live queries'
    return context.run(kind, () => read(q, opts))
  }
  // Linked retained transcripts are part of Vale's shape. They carry the
  // same computed status/cost pressure as the app without copying live rows.
  await seedHistory(g, db, history)
  await post(
    '/apply',
    Array.from({ length: players }, (_, i) => ({
      entity: { eid: eid(i + 1) },
      player: {},
      doc: { title: `Player ${i}` },
    })),
  )
  // Finish boot/lens/effect work before the active minute. It belongs to the
  // idle task, not an amortization that hides play's cost.
  await store.alarm()
  for (let i = 0; i < 100; i++) {
    let res = await store.fetch(
      new Request('http://store/move', {
        method: 'POST',
        headers: { ...headers, 'x-yak-kernel': '1' },
      }),
    )
    let held = await res.json() as {
      rules: { done?: string; live?: boolean }[]
    }
    if (held.rules.every((r) => !r.live || r.done)) break
    if (i == 99) throw new Error('lens fixture did not settle')
  }
  await settleWorld(store, db)
  if (minutes) {
    await seedWorld(store, post)
    await settleWorld(store, db)
  }
  measured = true
  source = 'live queries'
  for (let i = 0; i < players; i++) {
    let ws = wire()
    live.push(ws)
    let hero = eid(i + 1)
    // The actual world/hero/catalog watches from Vale net.ts, including
    // proximity disjunctions and builder provenance. Empty answers still cost.
    let q = JSON.stringify(hero)
    let queries = [
      `.entity.eid=${q}&?created&*`,
      `.player&.created.by=${person}&?doc&?position`,
      `.item.owner=${q}&?gathered&?crafted`,
      `.slain.by=${q}`,
      ...['used', 'upgraded'].map((name) => `.${name}.by=${q}`),
      ...[
        'journal',
        'equip',
        'learned',
        'respec',
        'fire',
        'explored',
        'visited_region',
      ]
        .map((name) => `.${name}.player=${q}`),
      `.directive.player=${q}&?created&?companion&.order=-created.at&.limit=10`,
      `.teleport_request.player=${q}&?created&?completed&.order=-created.at&.limit=10`,
      '(.place.level=mossvale&.place.ci=-4..4&.place.ck=-4..4|.position.x=-128...160&.position.z=-128...160)&*',
      `(.look.player.position.x=-128...160&.look.player.position.z=-128...160|.look.player=${q})&.look&*`,
      '.fight.level=mossvale&*',
      '.chat.level=mossvale&?doc&?created&.order=-created.at&.limit=60',
      ...[
        'theme_design',
        'building_design',
        'item_design',
        'ability_design',
        'den',
      ]
        .map((name) => `.${name}`),
      '.beast_design&?combat&?loot&?sounds',
      '.alias&.key',
      '.figure !built | .figure .built.current=true .built.build.build.variant=main *',
      '.figure .built.current=true .built.build.build.variant=main .fields=built.current,built.build.build.variant',
      '.built.current=true&.built.slot=kind&.built.build.build.variant=main&.built.build.build.for.spawned.lvl&.fields=built.current,built.slot,built.build.build.variant,built.build.build.for.spawned.lvl',
      '.built.current=true&.built.artifact&.built.build.build.variant=main&.fields=built.build.build.for.sfx.name,built.artifact.artifact.address,built.artifact.artifact.media_type',
    ]
    for (let [j, subscribe] of queries.entries()) {
      await store.webSocketMessage(
        ws,
        JSON.stringify({ subscribe, id: `q${j}` }),
      )
    }
  }
  opening = { ...total }
  openingShapes = [...shapes].map(([sql, cost]) => ({ sql, cost })).sort((
    a,
    b,
  ) => b.cost.read - a.cost.read).slice(0, 20)
  profiler.flush(Infinity)
  shapes.clear()
  sources = {}
  components = {}
  total = empty()
  let now = Date.now,
    set = globalThis.setTimeout,
    clear = globalThis.clearTimeout
  let at = now(),
    timers = new Map<number, { at: number; fn: () => void }>(),
    next = 1
  Date.now = () => at
  globalThis.setTimeout = ((fn: () => void, ms = 0) => {
    let id = next++
    timers.set(id, { at: at + ms, fn })
    return id
  }) as typeof setTimeout
  globalThis.clearTimeout = (id) => {
    timers.delete(Number(id))
  }
  let settle = async <T>(work: Promise<T> | T): Promise<T> => {
    let done = false, value: T | undefined, error: unknown
    Promise.resolve(work).then((v) => {
      done = true
      value = v
    }, (e) => {
      done = true
      error = e
    })
    for (let round = 0; !done && round < 1000; round++) {
      for (let k = 0; k < 20; k++) await Promise.resolve()
      for (let [id, t] of [...timers]) {
        if (t.at <= at + 16) {
          timers.delete(id)
          t.fn()
        }
      }
      if (!done) await new Promise<void>((resolve) => set(resolve, 0))
    }
    if (!done) throw new Error('play operation did not settle')
    if (error) throw error
    return value as T
  }
  try {
    for (let second = 0; second < 60 * minutes; second++) {
      for (let i = 0; i < players; i++) {
        source = 'relays'
        let hero = eid(i + 1)
        await settle(store.webSocketMessage(
          live[i],
          JSON.stringify({
            relay: [{
              entity: { eid: hero },
              position: { level: 'mossvale', x: second, y: 0, z: i, at },
              motion: { gait: 'walk', yaw: 0, vx: 1, vy: 0, vz: 0 },
              fight: { level: 'mossvale', foe: 'wolf-1', swing: second },
            }],
          }),
        ))
        if (second % 15 == 5) {
          source = 'gathering'
          await settle(post('/apply', [{
            entity: { eid: eid(400_000 + i * 1000 + second) },
            item: { owner: hero, kind: 'wood', at },
            gathered: {
              node: `tree-${i}-${second}`,
              life: 0,
              kind: 'tree',
              at,
              xp: 1,
            },
          }]))
        }
        if (second % 20 == 10) {
          source = 'fighting'
          await settle(post('/apply', [{
            entity: { eid: eid(500_000 + i * 1000 + second) },
            slain: { by: hero, creature: 'wolf-1', at, xp: 1, lvl: 1 },
          }]))
        }
        if (second % 60 == 25) {
          source = 'chatting'
          await settle(post('/apply', [{
            entity: { eid: eid(600_000 + i * 1000 + second) },
            chat: { level: 'mossvale', player: hero },
            doc: { body: 'Hello' },
          }]))
        }
        for (let frame of live[i].sent) {
          if (frame.refused) throw new Error(JSON.stringify(frame.refused))
        }
        live[i].sent.length = 0
      }
      at += 1000
      source = 'saves'
      for (let rounds = 0; rounds < 100; rounds++) {
        let due = [...timers].filter(([, t]) => t.at <= at)
        if (!due.length) break
        for (let [id, t] of due) {
          timers.delete(id)
          t.fn()
        }
        for (let k = 0; k < 20; k++) await Promise.resolve()
        if (rounds == 99) throw new Error('timer loop in play fixture')
      }
      source = 'effects'
      let alarm = await db.getAlarm?.()
      if (alarm != null && alarm <= at) {
        await db.deleteAlarm?.()
        await settle(store.alarm())
        await settle(settleWorld(store, db))
      }
      for (let k = 0; k < 20; k++) await Promise.resolve()
    }
    profiler.flush(Infinity)
    return {
      players,
      history,
      minutes,
      profile: summaries,
      openingShapes,
      sources,
      components,
      total,
      opening,
      writeShapes: [...shapes].map(([sql, cost]) => ({ sql, cost })).sort((
        a,
        b,
      ) => b.cost.written - a.cost.written).slice(0, 30),
      shapes: [...shapes].map(([sql, cost]) => ({ sql, cost })).sort((a, b) =>
        b.cost.read + b.cost.written - a.cost.read - a.cost.written
      ).slice(0, 20),
    }
  } finally {
    measured = false
    Date.now = now
    globalThis.setTimeout = set
    globalThis.clearTimeout = clear
    db.sql.exec = sql
  }
}

let wire = () => {
  let held: unknown = { writer: { actor: { by: person } } }
  let sent: { refused?: unknown }[] = []
  return {
    sent,
    readyState: 1,
    send: (data: string) => void sent.push(JSON.parse(data)),
    close: () => {},
    serializeAttachment: (value: unknown) => {
      held = value
    },
    deserializeAttachment: () => held,
  }
}

/** An evicted, idle app: real cursor accounting includes Store construction,
 * its first read-only request, and all microtasks that request starts. */
export let idleWake = async (
  db: Parameters<typeof playMinute>[0],
): Promise<
  {
    total: Cost
    requests: Record<string, Cost>
    alarm: number | null
    loads: Record<string, Cost>
    shapes: { sql: string; cost: Cost }[]
  }
> => {
  let headers = {
    'x-store': 'probe/idle-cost',
    'x-yak-access': 'private',
    'x-yak-role': 'owner',
    'x-yak-person': person,
    'x-yak-app': app,
  }
  let context = {
    storage: db,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }
  let store = new Store(context)
  let post = async (path: string, body: unknown) => {
    let res = await store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`)
    await res.body?.cancel()
  }
  await post('/vocab', words)
  await post('/tools', {
    history: {
      description: 'Read history',
      query: '.doc',
      inputSchema: { type: 'object' },
    },
  })
  let g = store.door.graph
  await seedHistory(g, db, 79_000)
  for (let i = 0; i < 100; i++) {
    await store.alarm()
    let res = await store.fetch(
      new Request('http://store/move', {
        method: 'POST',
        headers: { ...headers, 'x-yak-kernel': '1' },
      }),
    )
    let held = await res.json() as {
      rules: { done?: string; live?: boolean }[]
    }
    if (held.rules.every((r) => !r.live || r.done)) break
    if (i == 99) throw new Error('idle fixture did not settle')
  }
  await db.deleteAlarm()
  let pending = await g.read('.effect.state=pending')
  if (pending.length) {
    throw new Error(`idle fixture holds ${pending.length} pending effects`)
  }
  // No approximations: returned rows are not rows scanned by SQLite.
  let sql = db.sql.exec.bind(db.sql),
    total = empty(),
    shapes = new Map<string, Cost>()
  let requests: Record<string, Cost> = {}, current = empty()
  db.sql.exec = (query, ...bindings) => {
    let cursor = sql(query, ...bindings)
    let rows = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw new Error('idle cost requires SQL driver row counters')
    }
    let cost = { read: cursor.rowsRead, written: cursor.rowsWritten, calls: 1 }
    plus(total, cost)
    plus(current, cost)
    plus(
      shapes.get(query) ?? (shapes.set(query, empty()), shapes.get(query)!),
      cost,
    )
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  try {
    for (let path of ['/tools', '/vocab', 'alarm']) {
      current = requests[path] = empty()
      store = new Store(context)
      if (path == 'alarm') await store.alarm()
      else {
        let res = await store.fetch(
          new Request(`http://store${path}`, { headers }),
        )
        if (!res.ok) throw new Error(`${path}: ${await res.text()}`)
        await res.body?.cancel()
      }
      // Drain the asynchronous pool work started by the request, not just its response.
      for (let i = 0; i < 100; i++) await Promise.resolve()
      if (await db.getAlarm() != null) {
        throw new Error('idle read armed an alarm')
      }
    }
    let loads: Record<string, Cost> = {}
    for (
      let [name, id] of [['session', eid(100_000)], ['call', eid(300_000)]]
    ) {
      current = loads[name] = empty()
      // Cold and warm paths both use the linked production-shaped identities.
      let rows = await store.door.graph.get([id])
      if (!rows[0]?.[name]) throw new Error(`missing ${name} fixture`)
      await store.door.graph.get([id])
    }
    return {
      total,
      requests,
      loads,
      alarm: await db.getAlarm(),
      shapes: [...shapes].map(([sql, cost]) => ({ sql, cost })).sort((a, b) =>
        b.cost.read - a.cost.read
      ).slice(0, 20),
    }
  } finally {
    db.sql.exec = sql
  }
}

// Seed-only storage doors, outside every measured window. Small-table stats
// precede unrelated retained rows: the test must survive stale production plans.
let seedHistory = async (
  g: Store['door']['graph'],
  db: Parameters<typeof playMinute>[0],
  history: number,
) => {
  // Keep the linked transcript/call archetypes that production loads, not
  // just unlinked session markers. Teach small-table statistics before the
  // retained history grows; the indexed-get regression must survive them.
  await g.storage.tx((tx) =>
    tx.patch([
      {
        entity: { eid: person },
        person: {},
        doc: { title: 'A fixture author' },
      },
      {
        entity: { eid: eid(90_000) },
        doc: { body: 'Fixture persona' },
      },
      { entity: { eid: eid(90_002) }, model: { name: 'fixture-model' } },
      {
        entity: { eid: eid(90_001) },
        tool: { name: 'kept', description: 'Kept call target' },
      },
    ])
  )
  for (let n = 0; n < 61; n++) {
    let session = eid(100_000 + n), log = eid(110_000 + n)
    let source = eid(200_000 + n * 100)
    let call = eid(300_000 + n), result = eid(310_000 + n)
    let rows: Bundle[] = [
      {
        entity: { eid: log },
        doc: { title: `fixture-${n}.jsonl` },
      },
      {
        entity: { eid: session },
        session: {
          id: `ended-${n}`,
          ended: true,
          actor: person,
          source,
          persona: eid(90_000),
          log,
        },
      },
      {
        entity: { eid: call },
        call: { to: eid(90_001), id: `kept-${n}`, args: { n }, source },
        execution: { by: person },
        entry: { session, seq: 13 },
      },
      {
        entity: { eid: result },
        result: { call, ms: 1 },
        content: { body: 'Kept result' },
        entry: { session, seq: 14 },
      },
    ]
    for (let j = 0; j < 12; j++) {
      rows.push({
        entity: { eid: eid(200_000 + n * 100 + j) },
        entry: { session, seq: j + 1 },
        content: { body: 'Kept transcript' },
        cost: { dollars: 0.001, reported: true },
        ...(j == 0
          ? { using: { model: eid(90_002) } }
          : j == 11
          ? { stop: {} }
          : { notice: {} }),
      })
    }
    await g.storage.tx((tx) => tx.patch(rows))
  }
  let driver = (await import('@yaks/durable-object')).driver(db)
  driver.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
  // Synthetic item/slain/chat/document mix, never a copy of an app's data.
  for (let start = 0; start < history; start += 500) {
    await g.storage.tx((tx) =>
      tx.patch(
        Array.from({ length: Math.min(500, history - start) }, (_, j) => {
          let n = start + j
          return {
            entity: { eid: eid(n + 100) },
            created: { at: '2026-01-01T00:00:00Z', by: person },
            updated: { at: '2026-01-01T00:00:00Z', by: person },
            ...(n < 40_000
              ? { item: { owner: person, kind: 'wood', at: n } }
              : n < 60_000
              ? {
                slain: {
                  by: person,
                  creature: `wolf-${n % 100}`,
                  at: n,
                  xp: 1,
                },
              }
              : n < 70_000
              ? {
                chat: { level: 'old-land', player: person },
                doc: { body: 'Old chat' },
              }
              : { doc: { title: `History ${n}` } }),
          }
        }),
      )
    )
  }
}
