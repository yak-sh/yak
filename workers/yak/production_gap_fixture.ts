// Local reproduction of a served Vale release that still owns its old
// autonomous calls. Platform deployment alone does not replace app declarations.
import { type State, Store } from './graph.ts'
import { settleWorld, worldBindings } from './play_world_fixture.ts'
import { parseTools } from '@yaks/tools/declared'
import { type Bundle, identityEid } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { driver, profile, type Summary } from '@yaks/durable-object'
import { GIVERS } from '../../apps/vale/quests.ts'
import { eidOf } from '../../apps/vale/villagers.ts'
import words from '../../apps/vale/vocab.json' with { type: 'json' }

const oldThink = {
  tool: true,
  discoverable: false,
  positional: ['villager...'],
  description: 'A retained release lets villagers decide each five minutes.',
  input: { villager: { type: 'string' } },
  required: ['villager'],
  apply: {
    entity: { eid: '$thought' },
    entry: { session: '$villager' },
    content: { body: 'A while passes.' },
    using: {
      model: 'typesafe/jev',
      window: 16,
      instructions:
        'You are one of the people of Mossvale. Decide where to go and how you feel.',
    },
    questions: {
      asked: {
        go: {
          type: 'choice',
          instructions: 'Where do you spend the next while?',
          criteria: {
            home: 'home',
            work: 'work',
            inn: 'inn',
            about: 'about',
            visit: 'visit',
          },
        },
        mood: {
          type: 'choice',
          instructions: 'How do you feel?',
          criteria: {
            glad: 'glad',
            busy: 'busy',
            weary: 'weary',
            worried: 'worried',
          },
        },
      },
    },
  },
}

export let productionGap = async (
  storage: State['storage'],
  history = 79000,
  villagers = 6,
  turns = 16,
) => {
  let person = crypto.randomUUID(), app = crypto.randomUUID()
  let live: ReturnType<typeof wire>[] = []
  let context = {
    storage,
    getWebSockets: () => live,
    acceptWebSocket: () => {},
  }
  let binds = worldBindings(app, person)
  let store = new Store(context, binds)
  let headers = {
    'x-store': 'yourname/vale.f52dc2',
    'x-yak-access': 'private',
    'x-yak-role': 'owner',
    'x-yak-person': person,
    'x-yak-app': app,
  }
  let post = async (path: string, body: unknown) => {
    let r = await store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
    await r.body?.cancel()
  }
  let keptWords = { ...words, $defs: { ...words.$defs, think: oldThink } }
  await post('/vocab', keptWords)
  let g = store.door.graph
  await g.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: person },
      person: {},
      doc: { title: 'Synthetic owner' },
    }, {
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
  let retired = crypto.randomUUID()
  await g.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: retired },
      session: { id: 'history', ended: true, actor: person },
    }])
  )
  let d = driver(storage)
  d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
  for (let n = 0; n < history; n += 500) {
    await g.storage.tx((tx) =>
      tx.patch(
        Array.from({ length: Math.min(500, history - n) }, (_, j): Bundle => ({
          entity: { eid: crypto.randomUUID() },
          entry: { session: retired, seq: n + j + 1 },
          content: { body: 'Synthetic retained transcript' },
          cost: { dollars: 0.001 },
          created: { at: '2026-01-01T00:00:00Z', by: person },
        })),
      )
    )
  }
  let comps = Object.entries(words.$defs).filter(([, def]) =>
    'component' in def && def.component
  ).map(([name]) => name)
  await post(
    '/tools',
    parseTools(keptWords, [
      ...comps,
      'entry',
      'session',
      'call',
      'wake',
      'content',
      'using',
      'questions',
      'notice',
    ]),
  )
  // The GIVERS catalogue determines the real scheduled population; this is
  // parameterized to compare one local region with all retained villagers.
  let people = GIVERS.slice(0, villagers)
  let think = (await import('@yaks/tools')).toolEid('think')
  for (let giver of people) {
    let id = eidOf(giver.id)
    await g.storage.tx((tx) =>
      tx.patch([{
        entity: { eid: id },
        doc: { title: giver.name },
        villager: { id: giver.id, level: giver.level },
        session: { id: `fixture-${giver.id}`, actor: person },
        call: { to: think, args: { villager: id } },
        wake: {
          while: [{
            match: `.player&.position.level=${giver.level}`,
            every: '5m',
          }],
        },
      }])
    )
    // Retained ended replies in each *active* villager session are absent from
    // the earlier fixture. They exercise latest-turn/window/model joins.
    await g.storage.tx((tx) =>
      tx.patch(Array.from({ length: turns }, (_, j): Bundle => ({
        entity: { eid: crypto.randomUUID() },
        entry: { session: id, seq: j + 1 },
        content: { body: 'A synthetic past villager turn.' },
        ...(j % 2 ? { stop: {} } : { notice: {} }),
      })))
    )
  }
  store = new Store(context, binds)
  g = store.door.graph
  await store.alarm()
  await settleWorld(store, storage)
  await storage.deleteAlarm?.()
  let hero = crypto.randomUUID()
  await post('/apply', [{ entity: { eid: hero }, player: {} }])
  await settleWorld(store, storage)
  let ws = wire(person)
  live.push(ws)
  await store.fetch(new Request('http://store/vocab', { headers }))
  let before = await g.read('.wake&?call&?villager')
  let at = Date.now()
  await store.webSocketMessage(
    ws,
    JSON.stringify({
      relay: [{
        entity: { eid: hero },
        position: {
          level: people[0]?.level ?? 'mossvale',
          x: 0,
          y: 0,
          z: 0,
          at,
        },
      }],
    }),
  )
  await settleWorld(store, storage)
  let reports: Summary[] = [],
    shapes = new Map<string, { read: number; written: number; calls: number }>()
  let p = profile((r) => reports.push(r)),
    exec = storage.sql.exec.bind(storage.sql)
  let total = { read: 0, written: 0, calls: 0 }
  storage.sql.exec = (sql, ...args) => {
    let c = exec(sql, ...args), rows = c.toArray()
    if (c.rowsRead == null || c.rowsWritten == null) {
      throw new Error('workerd counters required')
    }
    let cost = { read: c.rowsRead, written: c.rowsWritten, calls: 1 }
    for (let key of ['read', 'written', 'calls'] as const) {
      total[key] += cost[key]
    }
    let shape = shapes.get(sql) ?? { read: 0, written: 0, calls: 0 }
    for (let key of ['read', 'written', 'calls'] as const) {
      shape[key] += cost[key]
    }
    shapes.set(sql, shape)
    p.observe({ shape: sql, rowsRead: c.rowsRead, rowsWritten: c.rowsWritten })
    return {
      rowsRead: c.rowsRead,
      rowsWritten: c.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let now = Date.now
  Date.now = () => at + 301000
  try {
    await p.run('retained release world alarm', async () => {
      await storage.deleteAlarm?.()
      await store.alarm()
      await settleWorld(store, storage)
    })
    p.flush(Infinity)
    storage.sql.exec = exec
    let answers = (await g.read('.answer&?entry')).length
    return {
      answers,
      before,
      history,
      villagers: people.length,
      turns,
      total,
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
let wire = (person: string) => {
  let held: unknown = { writer: { actor: { by: person } } }
  return {
    readyState: 1,
    send: () => {},
    close: () => {},
    serializeAttachment: (v: unknown) => {
      held = v
    },
    deserializeAttachment: () => held,
  }
}
