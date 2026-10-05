// Vale's actual five-minute villager turn, with only the outside AI answer
// scripted. The Store's wakes, calls, transcript runner and effect pool run.
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeEid } from '@yaks/edge'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import { platformVocab } from './vocab.ts'
import { type Bindings, type State, Store } from './graph.ts'
import { profile, type Summary } from '../../packages/durable-object/profile.ts'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { born } from '../../apps/vale/villagers.ts'
import { GIVERS } from '../../apps/vale/quests.ts'

export let worldBindings = (app: string, person: string): Bindings => {
  let vocab = platformVocab()
  let directory = graph({ vocab, storage: ram(vocab) })
  let space = crypto.randomUUID()
  directory.apply([
    { entity: { eid: person }, person: {} },
    { entity: { eid: space }, space: { slug: 'world-cost' } },
    { entity: { eid: app }, app: { space, slug: 'vale', access: 'private' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space, role: 'owner' },
    },
  ])
  return {
    STORE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (req: Request) => {
          let url = new URL(req.url)
          if (url.pathname == '/query') {
            return Response.json(
              await directory.read(url.searchParams.get('q')!),
            )
          }
          let body = await req.json() as { entities?: Bundle[] } | Bundle[]
          return Response.json(
            await directory.apply(Array.isArray(body) ? body : body.entities!),
          )
        },
      }),
    },
    AI: {
      gateway: () => ({ getUrl: () => Promise.resolve('') }),
      run: () =>
        Promise.resolve({
          answers: {
            go: { type: 'choice', choice: 'home', confidence: 1 },
            mood: { type: 'choice', choice: 'glad', confidence: 1 },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as Bindings['AI'],
    MODEL_FETCH: () =>
      Promise.resolve(
        new Response(
          'Context Window | 100,000 tokens\nUnit Pricing | $0.15 per M input tokens, $0.5 per M output tokens, $0.03 per M cached input tokens',
        ),
      ),
  }
}

export let seedWorld = async (
  store: Store,
  post: (path: string, body: unknown) => Promise<unknown>,
) => {
  await store.door.graph.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: identityEid('model', ['typesafe/jev']) },
      model: { name: 'typesafe/jev', offered: true },
      price: { input: 0.15, output: 0.5 },
    }, {
      entity: {
        eid: edgeEid(
          identityEid('provider', ['workers-ai']),
          'serves',
          identityEid('model', ['typesafe/jev']),
        ),
      },
      edge: {
        from: identityEid('provider', ['workers-ai']),
        to: identityEid('model', ['typesafe/jev']),
      },
      serves: { name: 'typesafe/jev' },
    }])
  )
  let components = Object.entries(words.$defs).filter(([, d]) =>
    'component' in d && d.component
  ).map(([key]) => key)
  await post(
    '/tools',
    parseTools(words, [
      ...components,
      'session',
      'call',
      'wake',
      'entry',
      'content',
      'using',
      'questions',
      'notice',
    ]),
  )
  let villagers = GIVERS.filter((giver) => giver.level == 'mossvale').map((
    giver,
  ) => born(giver, toolEid('think')))
  await post('/apply', villagers)
  return villagers.map((row) => row.entity.eid)
}

// A firing starts deferred effects. Wait for the real queue to settle rather
// than calling alarm() a second time and accidentally counting another tick.
export let settleWorld = async (store: Store) => {
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < 100; i++) await Promise.resolve()
    let pending = await store.door.graph.read(
      '.effect.state=pending,running&.fields=entity.eid',
    )
    if (!pending.length) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('world effects did not settle')
}

export let worldTick = async (storage: State['storage'], history = 79_000) => {
  let person = crypto.randomUUID(), app = crypto.randomUUID()
  let wire = {
    readyState: 1,
    send: () => {},
    close: () => {},
    serializeAttachment: () => {},
    deserializeAttachment: () => ({ writer: { actor: { by: person } } }),
  }
  let store = new Store({
    storage,
    getWebSockets: () => [wire],
    acceptWebSocket: () => {},
  }, worldBindings(app, person))
  let headers = {
    'x-store': 'yourname/vale.f52dc2',
    'x-yak-access': 'private',
    'x-yak-role': 'owner',
    'x-yak-person': person,
    'x-yak-app': app,
  }
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
  let g = store.door.graph
  // Link the history that the transcript/identity joins actually encounter.
  let oldSession = crypto.randomUUID()
  await g.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: oldSession },
      session: { ended: true, actor: person, id: 'history' },
    }])
  )
  for (let n = 0; n < history; n += 500) {
    await g.storage.tx((tx) =>
      tx.patch(Array.from({ length: Math.min(500, history - n) }, (_, j) => ({
        entity: { eid: crypto.randomUUID() },
        entry: { session: oldSession, seq: n + j + 1 },
        content: { body: 'Retained world history' },
        created: { by: person, at: '2026-01-01T00:00:00Z' },
        updated: { by: person, at: '2026-01-01T00:00:00Z' },
        ...(j % 2 ? { cost: { dollars: 0.001 } } : { notice: {} }),
      })))
    )
  }
  await store.alarm()
  await settleWorld(store)
  await storage.deleteAlarm?.()
  let hero = crypto.randomUUID()
  await post('/apply', [{ entity: { eid: hero }, player: {} }])
  let villagers = await seedWorld(store, post)
  await settleWorld(store)
  let at = Date.now()
  await store.webSocketMessage(
    wire,
    JSON.stringify({
      relay: [{
        entity: { eid: hero },
        position: { level: 'mossvale', x: 0, y: 0, z: 0, at },
      }],
    }),
  )
  await settleWorld(store)
  // Take the alarm's instant from the schedules rouse actually armed.
  let due = NaN
  for (let round = 0; round < 1000; round++) {
    let wakes = await g.read('.villager&?wake')
    let ats = wakes.map((b) =>
      Date.parse(String((b.wake as { at: string }).at))
    )
    if (ats.length == villagers.length && ats.every(Number.isFinite)) {
      due = Math.max(...ats)
      break
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  if (!Number.isFinite(due)) throw new Error('world did not arm')
  let reports: Summary[] = [], rows = profile((s) => reports.push(s))
  let cascade = { read: 0, written: 0, calls: 0 }
  let shapes = new Map<
    string,
    { read: number; written: number; calls: number }
  >()
  let exec = storage.sql.exec.bind(storage.sql)
  storage.sql.exec = (sql, ...args) => {
    let cursor = exec(sql, ...args), result = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw new Error('workerd row counters required')
    }
    if (sql.startsWith('with recursive')) {
      cascade.read += cursor.rowsRead
      cascade.written += cursor.rowsWritten
      cascade.calls++
    }
    rows.observe({
      shape: sql,
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
    })
    let cost = shapes.get(sql) ?? { read: 0, written: 0, calls: 0 }
    cost.read += cursor.rowsRead
    cost.written += cursor.rowsWritten
    cost.calls++
    shapes.set(sql, cost)
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => result,
      [Symbol.iterator]: () => result.values(),
    }
  }
  let now = Date.now
  Date.now = () => due
  try {
    await rows.run('world alarm', async () => {
      await storage.deleteAlarm?.()
      await store.alarm()
      await settleWorld(store)
    })
    rows.flush(Infinity)
    let total = reports.reduce(
      (a, r) => ({
        read: a.read + r.total.rowsRead,
        written: a.written + r.total.rowsWritten,
        calls: a.calls + r.total.calls,
      }),
      { read: 0, written: 0, calls: 0 },
    )
    storage.sql.exec = exec
    let answers = await g.read('.answer&?entry')
    return {
      history,
      villagers: villagers.length,
      answers: answers.length,
      failures: await g.read('.exception|.refusal|.error *'),
      total,
      cascade,
      profile: reports,
      shapes: [...shapes].map(([sql, cost]) => ({ sql, cost })).sort((a, b) =>
        b.cost.read - a.cost.read
      ).slice(0, 20),
    }
  } finally {
    Date.now = now
    storage.sql.exec = exec
  }
}
