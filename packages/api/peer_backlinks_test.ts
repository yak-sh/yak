/// <reference lib="deno.ns" />
// Backlink subscriptions see peer-only rows in the same way as stored rows.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { peerPlan, peerTargets } from './peer_query.ts'
import { type Frame, subscriptions } from './subs.ts'

let vocab = loadVocab({
  $defs: {
    run: { component: true, properties: {} },
    tower: {
      component: true,
      properties: { run: { type: 'string', ref: 'run', death: 'keep' } },
    },
    player: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: {
        run: { type: 'string', ref: 'run', death: 'keep' },
        slot: { type: 'number' },
      },
    },
  },
})
let query = '.refs=room&*'
let g = graph({ vocab, storage: ram(vocab) })
g.apply([{ entity: { eid: 'room' }, run: {} }, {
  entity: { eid: 'other-room' },
  run: {},
}, { entity: { eid: 'fort' }, tower: { run: 'room' } }])
let frames: Frame[] = [], other: Frame[] = []
let sink = (f: Frame) => {
  frames.push(f)
}
let otherSink = (f: Frame) => {
  other.push(f)
}
let subs = subscriptions(g)
await subs.open(sink, 'room', query)
await subs.open(otherSink, 'elsewhere', '.refs=other-room&*')
frames.length = 0
other.length = 0

test('a backlink query plans peers without widening durable candidates', () => {
  let plan = peerPlan(parse(query), vocab)
  equal(plan.peers, true)
  equal(peerTargets(parse(query)), ['room'])
  equal(plan.durable, parse(query))
})

test('a backlink subscriber hears a peer-only reference join', async () => {
  await subs.relay(() => {}, [{
    entity: { eid: 'friend' },
    player: { run: 'room', slot: 2 },
  }])
  equal(
    frames.some((f) => f.bundles?.some((b) => b.entity.eid === 'friend')),
    true,
  )
  equal(
    other.some((f) =>
      f.bundles?.some((b) => b.entity.eid === 'friend') ||
      f.relay?.some((b) => b.entity.eid === 'friend')
    ),
    false,
  )
})

let lateFrames: Frame[] = []
let lateSubs = subscriptions(g)
await lateSubs.relay(() => {}, [{
  entity: { eid: 'waiting' },
  player: { run: 'room', slot: 1 },
}])
await lateSubs.open(
  (f) => {
    lateFrames.push(f)
  },
  'late',
  query,
)
test('a late backlink subscriber receives held peer references', () => {
  equal(
    lateFrames.some((f) => f.bundles?.some((b) => b.entity.eid === 'waiting')),
    true,
  )
  equal(
    lateFrames.some((f) => f.bundles?.some((b) => b.entity.eid === 'fort')),
    true,
  )
})

let leavingFrames: Frame[] = []
let leavingSubs = subscriptions(g)
let writer = (_f: Frame) => {}
await leavingSubs.relay(writer, [{
  entity: { eid: 'leaving' },
  player: { run: 'room', slot: 0 },
}])
await leavingSubs.open(
  (f) => {
    leavingFrames.push(f)
  },
  'leaving-room',
  query,
)
leavingFrames.length = 0
test('a backlink subscriber removes a peer when its reference changes rooms', async () => {
  await leavingSubs.relay(writer, [{
    entity: { eid: 'leaving' },
    player: { run: 'other-room', slot: 0 },
  }])
  equal(leavingFrames.some((f) => f.gone?.includes('leaving')), true)
})

let droppingFrames: Frame[] = []
let droppingSubs = subscriptions(g)
let droppingWriter = (_f: Frame) => {}
await droppingSubs.relay(droppingWriter, [{
  entity: { eid: 'closing' },
  player: { run: 'room', slot: 0 },
}])
await droppingSubs.open(
  (f) => {
    droppingFrames.push(f)
  },
  'closing-room',
  query,
)
droppingFrames.length = 0
test('a backlink subscriber removes a connection-only peer when its writer closes', async () => {
  await droppingSubs.drop(droppingWriter)
  equal(droppingFrames.some((f) => f.gone?.includes('closing')), true)
})

let filteredFrames: Frame[] = []
let filteredSubs = subscriptions(g)
await filteredSubs.relay(() => {}, [{
  entity: { eid: 'filtered' },
  player: { run: 'room', slot: 0 },
}])
await filteredSubs.open(
  (f) => {
    filteredFrames.push(f)
  },
  'filtered-room',
  '.refs=room&.player&*',
)
test('a backlink combined with a peer predicate retains its target for matching', () => {
  equal(
    filteredFrames.some((f) =>
      f.bundles?.some((b) => b.entity.eid === 'filtered')
    ),
    true,
  )
  equal(
    filteredFrames.some((f) => f.bundles?.some((b) => b.entity.eid === 'fort')),
    false,
  )
})
