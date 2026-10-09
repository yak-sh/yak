// Real workerd row counters for cold signed messages with retained catalog outputs.
// The page keeps its watches/attachments; each message gets a new Store instance.
import { Store } from './graph.ts'
import { seedHistory } from './play_cost_fixture.ts'
import { settleWorld, worldBindings } from './play_world_fixture.ts'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { profile, type Summary } from '@yaks/durable-object'
import type { Cost } from './play_cost_fixture.ts'

let empty = (): Cost => ({ read: 0, written: 0, calls: 0 })
export let coldMessages = async (
  storage: Parameters<typeof seedHistory>[1],
  outputs: number,
) => {
  let person = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    app = crypto.randomUUID(),
    hero = crypto.randomUUID()
  let attachment: unknown = { writer: { actor: { by: person } } }
  let frames: Record<string, unknown>[] = []
  let ws = {
    readyState: 1,
    send: (data: string) => frames.push(JSON.parse(data)),
    close: () => {},
    serializeAttachment: (value: unknown) =>
      attachment = structuredClone(value),
    deserializeAttachment: () => structuredClone(attachment),
  }
  let live: typeof ws[] = []
  let context = {
    storage,
    getWebSockets: () => live,
    acceptWebSocket: () => {},
  }
  let binds = worldBindings(app, person), directoryCalls = 0
  let directory = binds.STORE!
  binds.STORE = {
    idFromName: directory.idFromName.bind(directory),
    get: (id) => {
      let stub = directory.get(id)
      return {
        fetch: (request) => {
          directoryCalls++
          return stub.fetch(request)
        },
      }
    },
  }
  let headers = {
    'x-store': 'probe/cold-catalog',
    'x-yak-app': app,
    'x-yak-person': person,
    'x-yak-access': 'private',
    'x-yak-role': 'owner',
  }
  let warm = new Store(context, binds)
  let response = await warm.fetch(
    new Request('http://store/vocab', {
      method: 'POST',
      headers,
      body: JSON.stringify(words),
    }),
  )
  if (!response.ok) throw new Error(await response.text())
  await response.body?.cancel()
  await seedHistory(warm.door.graph, storage, 79_000)
  await seedRetainedOutputs(warm, outputs)
  // Through the Store's own door, as a page's write arrives: its commit is
  // what sets the Store embedding the history seeded behind it.
  let wrote = await warm.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers,
      body: JSON.stringify([{
        entity: { eid: hero },
        player: {},
        doc: { title: 'Hero' },
      }]),
    }),
  )
  if (!wrote.ok) throw new Error(await wrote.text())
  await settleWorld(warm, storage)
  live.push(ws)
  for (
    let [id, subscribe] of [
      '.sfx',
      '.built.current=true&.built.artifact&.built.build.build.variant=main&.fields=built.build.build.for.sfx.name,built.artifact.artifact.address,built.artifact.artifact.media_type',
      '.failed&.build.variant=main&.build.for.spawned.x&.fields=failed.reason,failed.at,build.variant,build.for.spawned.x,build.for.created.by,build.for.doc.body&.order=-failed.at&.limit=40',
    ].entries()
  ) {
    await warm.webSocketMessage(
      ws,
      JSON.stringify({ id: String(id), subscribe }),
    )
  }
  await settleWorld(warm, storage)
  frames.length = 0
  directoryCalls = 0
  let total = empty(), shapes = new Map<string, Cost>(), reports: Summary[] = []
  let p = profile((summary) => reports.push(summary)),
    exec = storage.sql.exec.bind(storage.sql)
  storage.sql.exec = (sql, ...args) => {
    let cursor = exec(sql, ...args), rows = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw new Error('workerd row counters required')
    }
    let cost: Cost = {
      read: cursor.rowsRead,
      written: cursor.rowsWritten,
      calls: 1,
    }
    let current = shapes.get(sql) ?? empty()
    for (let key of ['read', 'written', 'calls'] as const) {
      total[key] += cost[key]
      current[key] += cost[key]
    }
    shapes.set(sql, current)
    p.observe({ shape: sql, rowsRead: cost.read, rowsWritten: cost.written })
    return {
      ...cursor,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  try {
    for (let i = 0; i < 6; i++) {
      await p.run('cold signed message', async () => {
        let cold = new Store(context, binds)
        await cold.webSocketMessage(
          ws,
          JSON.stringify({
            relay: [{
              entity: { eid: hero },
              motion: { gait: 'walk', yaw: i, vx: 1, vy: 0, vz: 0 },
            }],
          }),
        )
        await settleWorld(cold, storage)
      })
    }
    p.flush(Infinity)
    if (frames.some((frame) => frame.refused)) {
      throw new Error(JSON.stringify(frames))
    }
    return {
      outputs,
      messages: 6,
      history: 79000,
      total,
      directoryCalls,
      profile: reports,
      shapes: [...shapes].map(([sql, cost]) => ({ sql, cost })).sort((a, b) =>
        b.cost.read - a.cost.read
      ).slice(0, 12),
    }
  } finally {
    storage.sql.exec = exec
  }
}

export let seedRetainedOutputs = async (store: Store, outputs: number) => {
  let builder = crypto.randomUUID()
  await store.door.graph.storage.tx((tx) =>
    tx.patch([{ entity: { eid: builder }, builder: { query: '.sfx' } }])
  )
  for (let n = 0; n < outputs; n++) {
    let source = crypto.randomUUID(),
      build = crypto.randomUUID(),
      output = crypto.randomUUID(),
      artifact = crypto.randomUUID()
    await store.door.graph.storage.tx((tx) =>
      tx.patch([
        { entity: { eid: source }, sfx: { name: `retained-${n}` } },
        {
          entity: { eid: build },
          build: {
            builder,
            match: JSON.stringify([source]),
            variant: 'main',
            for: source,
          },
        },
        {
          entity: { eid: artifact },
          artifact: {
            address: 'a'.repeat(64),
            media_type: 'audio/wav',
            size: 1,
          },
        },
        {
          entity: { eid: output },
          chosen: {},
          built: { build, slot: 'sound', artifact },
        },
      ])
    )
  }
}
