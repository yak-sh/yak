/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { type Bundle, type Graph, graph, type ReadOpts } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { type Frame, type Sink, subscriptions } from './subs.ts'

let vocab = loadVocab({
  $defs: {
    hero: { component: true, properties: {} },
    look: {
      component: true,
      properties: {
        player: { type: 'string', ref: 'hero' },
        name: { type: 'string' },
      },
    },
    position: {
      component: true,
      sync: 'peers',
      durable: 'forever',
      properties: { x: { type: 'number' } },
    },
  },
})
let ids = (rows: Bundle[]) => rows.map((b) => b.entity.eid)
let query = (x: number) =>
  `(.look.player.position.x=${x}..${x + 10}|.look.player=one)&.look&*`
let fixture = (withRevision = false, gate?: Promise<void>) => {
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply([
    { entity: { eid: 'one' }, hero: {} },
    { entity: { eid: 'two' }, hero: {} },
    { entity: { eid: 'own' }, look: { player: 'one', name: 'One' } },
    { entity: { eid: 'other' }, look: { player: 'two', name: 'Two' } },
  ])
  let reads = 0, revision = 0
  let spy: Graph = {
    ...g,
    read: (q, o) => {
      reads++
      return gate ? gate.then(() => g.read(q, o)) : g.read(q, o)
    },
  }
  let frames: Frame[] = []
  let sink: Sink = (f) => void frames.push(f)
  let subs = subscriptions(spy, {
    ...withRevision ? { revision: () => revision } : {},
  })
  let open = async (x: number, opts?: ReadOpts) => {
    frames.length = 0
    await subs.open(sink, 'area', query(x), opts)
    return frames.flatMap((f) => f.bundles ?? [])
  }
  return {
    g,
    subs,
    sink,
    open,
    frames,
    reads: () => reads,
    revise: () => revision++,
  }
}
let walking = fixture()
equal(ids(await walking.open(0)), ['own'])
let first = walking.reads()
test('moving peer watches share their unchanged durable candidates', async () => {
  equal(ids(await walking.open(10)), ['own'])
  equal(walking.reads(), first)
})
let moving = fixture()
await moving.open(0)
await moving.subs.relay(moving.sink, [{
  entity: { eid: 'two' },
  position: { x: 15 },
}])
let nearby = await moving.open(11), reads = moving.reads()
test('shared durable candidates keep moving watch membership distinct', async () => {
  equal(ids(nearby), ['own', 'other'])
  equal(ids(await moving.open(30)), ['own'])
  equal(moving.reads(), reads)
})

let changed = Array.from({ length: 4 }, () => fixture())
for (let f of changed) {
  await f.open(0)
  await f.subs.close(f.sink, 'area')
}
test('retained peer candidates see new durable matches', async () => {
  let f = changed[0]
  await f.g.apply([{
    entity: { eid: 'new' },
    look: { player: 'one', name: 'New' },
  }])
  equal(ids(await f.open(10)), ['own', 'new'])
})
test('retained peer candidates see edits to durable matches', async () => {
  let f = changed[1]
  await f.g.apply([{ entity: { eid: 'own' }, look: { name: 'Renamed' } }])
  equal((await f.open(20))[0]?.look, { player: 'one', name: 'Renamed' })
})
test('retained peer candidates see component removal', async () => {
  let f = changed[2]
  await f.g.apply([{ entity: { eid: 'own' }, look: null }])
  equal(ids(await f.open(30)), [])
})
test('retained peer candidates see deletion', async () => {
  let f = changed[3]
  await f.g.apply([{ entity: { eid: 'own' }, $delete: true }])
  equal(ids(await f.open(40)), [])
})

let scoped = fixture()
test('peer candidate sharing keeps caller visibility separate', async () => {
  let f = scoped
  let own = { visibility: { entity: '.entity.eid=own,one' } }
  let other = { visibility: { entity: '.entity.eid=other,two' } }
  equal(ids(await f.open(0, own)), ['own'])
  equal(ids(await f.open(10, other)), [])
  equal(ids(await f.open(20, own)), ['own'])
})

let revised = fixture(true)
test('peer candidates let go after an external revision', async () => {
  let f = revised
  await f.open(0)
  await f.subs.close(f.sink, 'area')
  f.g.storage.tx((tx) => tx.patch([{ entity: { eid: 'own' }, look: null }]))
  f.revise()
  equal(ids(await f.open(10)), [])
})

let release!: () => void
let pending = fixture(false, new Promise<void>((done) => release = done))
test('concurrent peer reads share pending durable candidates', async () => {
  let first = pending.subs.read(query(0))
  let second = pending.subs.read(query(10))
  equal(pending.reads(), 1)
  release()
  equal(ids(await first), ['own'])
  equal(ids(await second), ['own'])
})
