/// <reference lib="deno.ns" />
import { equal, test, until } from '@yaks/testing'
import { parse } from '@yaks/query'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { type Frame, type Sink, subscriptions } from './subs.ts'

let fixture = () => {
  let vocab = loadVocab({
    $defs: {
      hero: { component: true, properties: { name: { type: 'string' } } },
      position: {
        component: true,
        sync: 'peers',
        durable: 'forever',
        save: '.hero !position',
        properties: {
          x: { type: 'number' },
          at: { type: 'string', format: 'date-time' },
        },
      },
      cursor: {
        component: true,
        sync: 'peers',
        durable: '1s',
        properties: { x: { type: 'number' } },
      },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply([
    { entity: { eid: 'one' }, hero: { name: 'One' }, position: { x: 1 } },
    {
      entity: { eid: 'offline' },
      hero: { name: 'Offline' },
      position: { x: 2 },
    },
  ])
  let timers = new Set<() => void>()
  let timer = (fn: () => void) => {
    timers.add(fn)
    return () => void timers.delete(fn)
  }
  let subs = subscriptions(g, { timer })
  let writer: Sink = () => {}
  let move = (x: number) => [{ entity: { eid: 'one' }, position: { x } }]
  return { g, vocab, subs, writer, move, timer, timers }
}

let ids = (rows: Bundle[]) => rows.map((b) => b.entity.eid)

test('live graph reads use held positions while durable reads retain offline saves', async () => {
  let f = fixture(), q = parse('.hero .position')
  equal(await f.subs.read(q), [])
  equal(ids(await f.subs.read(q, { durable: true })), ['one', 'offline'])
  await f.subs.relay(f.writer, f.move(3))
  equal(await f.subs.read(q), [{
    entity: { eid: 'one' },
    hero: { name: 'One' },
    position: { x: 3 },
  }])
  equal((await f.g.get(['one']))[0].position, { x: 1 })
  equal(await f.subs.snapshot('.hero .position .count'), { count: 1 })
  await f.subs.drop(f.writer)
  equal(await f.subs.read(q), [])
})

test('live reads resolve relative time from the supplied moment', async () => {
  let f = fixture()
  let now = Date.parse('2020-01-03T12:00:00Z')
  await f.subs.relay(f.writer, [{
    entity: { eid: 'one' },
    position: { at: '2020-01-03T10:00:00Z' },
  }])
  equal(ids(await f.subs.read('.hero .position.at>=today', { now })), ['one'])
  equal(
    await f.subs.read('.hero .position.at>=today', { now: now + 86400000 }),
    [],
  )
  await f.subs.drop(f.writer)
})

test('peer observers can read and write after serialized registry work releases', async () => {
  let f = fixture()
  let release!: () => void
  let gate = new Promise<void>((done) => release = done)
  let blocked = true
  let g: Graph = {
    ...f.g,
    get: (eids, comps, opts) =>
      blocked
        ? gate.then(() => f.g.get(eids, comps, opts))
        : f.g.get(eids, comps, opts),
  }
  let subs = subscriptions(g, { timer: f.timer })
  let frames: Frame[] = []
  await subs.open((frame) => frames.push(frame), 'positions', '.hero .position')
  let observed: Bundle[][] = []
  let off = subs.observe(async (changes) => {
    observed.push(await subs.snapshot('.hero .position') as Bundle[])
    await g.apply([{
      entity: { eid: 'note' },
      hero: { name: String(changes.length) },
    }])
  })
  let relayed = subs.relay(f.writer, f.move(4))
  await Promise.resolve()
  equal(observed, [])
  blocked = false
  release()
  await relayed
  await until(() => observed.length == 1 && frames.length == 2)
  equal(observed[0][0].position, { x: 4 })
  off()
  await subs.drop(f.writer)
})

test('peer observers see clears, expiry, disconnects and restored saved values', async () => {
  let f = fixture(), heard: Bundle[][] = []
  let off = f.subs.observe((rows) => {
    heard.push(rows)
  })
  await f.subs.relay(f.writer, f.move(3))
  await until(() => heard.length == 1)
  await f.subs.relay(f.writer, [{ entity: { eid: 'one' }, position: null }])
  await until(() => heard.length == 2)
  equal(heard.at(-1)?.[0].position, null)
  await f.subs.relay(f.writer, [{ entity: { eid: 'one' }, cursor: { x: 2 } }])
  await until(() => heard.length == 3)
  for (let expire of [...f.timers]) expire()
  await until(() => heard.length == 4)
  equal(heard.at(-1)?.[0].cursor, null)
  await f.subs.relayed(f.writer, ['one position', 'one cursor'])
  await until(() => heard.length == 5)
  equal(ids(await f.subs.read('.hero .position')), ['one'])
  equal(await f.subs.read('.cursor'), [])
  await f.subs.drop(f.writer)
  await until(() => heard.length == 6)
  equal(await f.subs.read('.hero .position'), [])
  off()
})

test('caller views select live values and refresh when another entity changes a dependency', async () => {
  let f = fixture()
  let old = loadVocab([...f.vocab.docs, {
    $defs: { seen: { component: true, properties: { x: { type: 'number' } } } },
  }])
  f.g.use({
    name: 'caller-view',
    view: (_ctx, original) => ({
      original,
      query: parse('.hero *'),
      vocab: old,
      dependencies: ['position', 'hero'],
      saved: true,
      answer: (rows) => {
        let signal =
          (f.g.get(['signal'], undefined, { native: true }) as Bundle[])[0]
            ?.hero as {
              name?: string
            } | undefined
        return rows.map((row) => {
          let position = row.position as { x: number } | undefined
          return position
            ? {
              ...row,
              seen: { x: position.x + (signal?.name == 'Done' ? 10 : 0) },
            }
            : row
        })
      },
    }),
  })
  let heard: Frame[] = []
  await f.subs.open(
    (frame) => heard.push(frame),
    'old',
    '.entity.eid=one .seen',
  )
  equal(heard.pop()?.bundles?.[0].seen, { x: 1 })
  await f.subs.relay(f.writer, f.move(3))
  equal(heard.pop()?.bundles?.[0].seen, { x: 3 })
  equal((await f.subs.read('.entity.eid=one .seen'))[0].seen, { x: 3 })
  await f.g.apply([{ entity: { eid: 'signal' }, hero: { name: 'Done' } }])
  equal(heard.pop()?.bundles?.[0].seen, { x: 13 })
  equal(await f.subs.snapshot('.seen.x>=10 .count'), { count: 2 })
  await f.subs.drop(f.writer)
})
