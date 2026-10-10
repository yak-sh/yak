// Independent stored clocks, through graph apply with an explicit instant.
// No entity stamps are needed: a component's clock is its own fact.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import {
  type Actor,
  type Bundle,
  graph,
  signed,
  type Storage,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { memberDoc } from './comp.ts'
import { Paced, pacesIn, pacing } from './pace.ts'

let vocab = loadVocab([memberDoc, {
  $defs: {
    position: {
      component: true,
      pace: '1s',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        settings: { type: 'object' },
      },
    },
    volume: {
      component: true,
      pace: '1s',
      properties: { level: { type: 'number' } },
    },
    note: { component: true, properties: { text: { type: 'string' } } },
    created: {
      component: true,
      properties: {
        at: { type: 'string', stamped: true },
        by: { type: 'string', stamped: true },
        via: { type: 'string', stamped: true },
      },
    },
    updated: {
      component: true,
      properties: {
        at: { type: 'string', stamped: true },
        by: { type: 'string', stamped: true },
        via: { type: 'string', stamped: true },
      },
    },
  },
}])

let fixture = (storage: Storage = ram(vocab)) => {
  let now = 0
  let paces = pacesIn(vocab)
  let g = graph({
    storage,
    vocab,
    plugins: [{
      name: 'pacing',
      hooks: { precondition: (b, tx) => pacing(paces, tx, b, now) },
    }],
  })
  return {
    storage,
    at: (time: number, actor: Actor | null, ...bundles: Bundle[]) => {
      now = time
      return g.apply(signed(bundles, actor), {
        now: new Date(time).toISOString(),
      })
    },
  }
}

// Admission cases persist their returned patches in RAM. The graph cases
// above and below cover applying them through the graph's write pipeline.
let admission = () => {
  let storage = ram(vocab)
  let paces = pacesIn(vocab)
  return {
    storage,
    at: (time: number, actor: Actor | null, ...bundles: Bundle[]) =>
      storage.tx((tx) => {
        let admitted = pacing(paces, tx, signed(bundles, actor), time)
        assert(Array.isArray(admitted))
        tx.patch(admitted)
      }),
  }
}

let position = (eid: string, x = 0): Bundle => ({
  entity: { eid },
  position: { x },
})
let volume = (eid: string, level = 0): Bundle => ({
  entity: { eid },
  volume: { level },
})
let browser = { via: 'browser' }
let refused = (fn: () => unknown) => assertThrows(fn, Paced) as Paced

test('one instrument writes distinct entities together and apart', () => {
  let f = admission()
  f.at(0, browser, position('a'), position('b'))
  f.at(100, browser, position('c'))
  let e = refused(() => f.at(100, browser, position('a', 1)))
  assertEquals([e.actor, e.entity, e.comp, e.wait], [
    'browser',
    'a',
    'position',
    900,
  ])
})

test('components on the same entity hold independent clocks', () => {
  let f = admission()
  f.at(0, browser, position('a'))
  f.at(100, browser, volume('a'))
  f.at(900, browser, { entity: { eid: 'a' }, note: { text: 'unpaced' } })
  f.at(1000, browser, position('a', 1))
  assertEquals(refused(() => f.at(1000, browser, volume('a', 1))).wait, 100)
  f.at(1100, browser, volume('a', 1))
})

test('by does not split a via clock, and alternating vias preserve each clock', () => {
  let f = admission()
  f.at(0, { by: 'one', via: 'a' }, position('shared'))
  refused(() => f.at(100, { by: 'two', via: 'a' }, position('shared', 1)))
  f.at(100, { by: 'one', via: 'b' }, position('shared', 1))
  assertEquals(
    refused(() => f.at(200, { by: 'one', via: 'a' }, position('shared', 2)))
      .wait,
    800,
  )
  f.at(1000, { via: 'a' }, position('shared', 2))
  assertEquals(
    refused(() => f.at(1000, { via: 'b' }, position('shared', 3))).wait,
    100,
  )
  f.at(1100, { via: 'b' }, position('shared', 3))
})

test('writers with no via share a clock even when their by differs', () => {
  let f = admission()
  f.at(0, { by: 'one' }, position('shared'))
  let e = refused(() => f.at(100, { by: 'two' }, position('shared', 1)))
  assertEquals([e.actor, e.wait], [null, 900])
  refused(() => f.at(100, null, position('shared', 1)))
  f.at(100, { by: 'two' }, position('another'))
  f.at(100, browser, position('shared', 1))
  f.at(1000, null, position('shared', 2))
})

test('a retry, including the same JSON value, starts no new clock', () => {
  let f = admission()
  let settings = (): Bundle => ({
    entity: { eid: 'json' },
    position: { settings: { smoothing: true } },
  })
  f.at(0, browser, position('a'), settings())
  f.at(900, browser, position('a'), settings())
  f.at(1000, browser, position('a', 1), {
    entity: { eid: 'json' },
    position: { settings: { smoothing: false } },
  })
})

test('one transaction combines patches on one paced component', () => {
  let f = fixture()
  f.at(0, browser, position('a'), {
    entity: { eid: 'a' },
    position: { y: 2 },
  })
  assertEquals((f.storage.get(['a']) as Bundle[])[0].position, { x: 0, y: 2 })
  refused(() => f.at(100, browser, position('a', 1)))
})

test('component removal leaves its pacing clock intact', () => {
  let f = admission()
  f.at(0, browser, position('a'))
  f.at(100, browser, { entity: { eid: 'a' }, position: null })
  refused(() => f.at(100, browser, position('a', 1)))
  f.at(1000, browser, position('a', 1))
})

for (
  let [attack, _pace] of Object.entries({
    clear: null,
    empty: { writes: [] },
    forged: { writes: [{ comp: 'position', via: 'browser', at: -1000 }] },
  })
) {
  test(`clients cannot replace server clocks with ${attack} clocks`, () => {
    let f = fixture()
    f.at(0, browser, position('a'))
    f.at(100, browser, { entity: { eid: 'a' }, _pace })
    refused(() => f.at(100, browser, { ...position('a', 1), _pace }))
  })
}

test('stored clocks survive rebuilding the graph over its storage', () => {
  let f = fixture()
  f.at(0, browser, position('a'))
  let reopened = fixture(f.storage)
  assertEquals(
    refused(() => reopened.at(100, browser, position('a', 1))).wait,
    900,
  )
  reopened.at(1000, browser, position('a', 1))
})

test('legacy stamps initialize recent clocks once, then component clocks stand alone', () => {
  let f = admission()
  f.storage.tx((tx) =>
    tx.patch([{
      ...position('a', 1),
      volume: { level: 0 },
      created: { at: new Date(0).toISOString(), via: 'created-via' },
      updated: { at: new Date(100).toISOString(), via: 'updated-via' },
    }])
  )
  assertEquals(
    refused(() => f.at(200, { via: 'created-via' }, position('a', 2))).wait,
    800,
  )
  assertEquals(
    refused(() => f.at(200, { via: 'updated-via' }, volume('a', 1))).wait,
    900,
  )
  // A third instrument migrates the row without discarding either clock.
  f.at(200, browser, position('a', 2))
  refused(() => f.at(200, { via: 'created-via' }, position('a', 3)))
  refused(() => f.at(200, { via: 'updated-via' }, volume('a', 1)))
  f.at(1000, { via: 'created-via' }, position('a', 3))
  // The updated stamp now names created-via; it cannot extend volume's clock.
  f.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'a' },
      updated: { at: new Date(1000).toISOString(), via: 'created-via' },
    }])
  )
  f.at(1100, { via: 'created-via' }, volume('a', 1))
})

test('a legacy signed writer with no via enters the pooled clock', () => {
  let f = fixture()
  graph({ storage: f.storage, vocab }).apply(
    signed([position('a')], { by: 'one' }),
    {
      now: new Date(0).toISOString(),
    },
  )
  assertEquals(
    refused(() => f.at(100, { by: 'two' }, position('a', 1))).wait,
    900,
  )
  f.at(1000, { by: 'two' }, position('a', 1))
})

test('a delete wins over paced patches, and its clocks die with it', () => {
  let storage = ram(vocab)
  storage.tx((tx) =>
    tx.patch([{
      ...position('a'),
      _pace: { writes: [{ comp: 'position', via: browser.via, at: 0 }] },
    }])
  )
  let f = fixture(storage)
  let gone: Bundle = { entity: { eid: 'a' }, $delete: true }
  f.at(100, browser, position('a', 1), gone, position('a', 2))
  assertEquals(f.storage.get(['a']), [{ entity: { eid: 'a' }, tombstone: {} }])
  // An ordinary blind write revives the identity as the graph specifies.
  f.at(100, browser, position('a', 3))
  refused(() => f.at(100, browser, position('a', 4)))
})

test('a paced patch that raced a tombstone cannot gain clocks and revive it', () => {
  let f = fixture()
  f.at(0, browser, position('a'))
  f.at(100, browser, { entity: { eid: 'a' }, $delete: true })
  f.at(100, browser, { ...position('a', 1), $was: { position: { x: 'old' } } })
  assertEquals(f.storage.get(['a']), [{ entity: { eid: 'a' }, tombstone: {} }])
})
