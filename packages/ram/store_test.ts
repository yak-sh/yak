/// <reference lib="deno.ns" />
// The map itself: what a patch does to a record, what identity storage mints,
// what a query reads back, and what a rolled-back transaction leaves behind.
// The whole-stack agreement with a database lives in ./parity_test.ts.
//
// The vocabulary is @yaks/sqlite's shop fixture, so both test files in this
// package — and the adapter they hold against each other — speak one domain.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Storage } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { matcher } from '@yaks/match'
import { shop } from '../sqlite/testing.ts'
import {
  bundles,
  corpus,
  DEAD,
  NOW,
  QUERIES,
  shop as books,
} from '../match/testing.ts'
import { ram, type RamOpts, type Store } from './mod.ts'

// The shop numbers: its entities are things a person points at by number, and
// the sqlite store these are held against is opened the same way.
let shopRam = (opts: RamOpts = {}) => ram(shop, { number: true, ...opts })

let put = (s: Store, ...bundles: Bundle[]) => s.tx((tx) => tx.patch(bundles))
let at = (s: Store, eid: string) => s.tx((tx) => tx.get([eid]))[0]
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? {}) as Record<string, unknown>

Deno.test('a patch mints identity in first-touch order and says what it minted', () => {
  let s = shopRam()
  let born = put(
    s,
    { entity: { eid: 'p1' }, doc: { title: 'Mug' } },
    { entity: { eid: 'p2' }, doc: { title: 'Cup' } },
  )
  assertEquals(born, [{ eid: 'p1', num: 1 }, { eid: 'p2', num: 2 }])
  assertEquals(put(s, { entity: { eid: 'p1' }, doc: { title: 'Mug II' } }), [])
  assertEquals(at(s, 'p1').entity, { eid: 'p1', num: 1 })
})

Deno.test('a patch touches only the properties it names; null clears one', () => {
  let s = shopRam()
  put(s, { entity: { eid: 'p1' }, product: { price: 12, status: 'live' } })
  put(s, { entity: { eid: 'p1' }, product: { price: 9 } })
  assertEquals(comp(at(s, 'p1'), 'product'), { price: 9, status: 'live' })
  put(s, { entity: { eid: 'p1' }, product: { status: null } })
  assertEquals(comp(at(s, 'p1'), 'product'), { price: 9, status: null })
})

Deno.test('a null component drops it, the entity survives', () => {
  let s = shopRam()
  put(s, {
    entity: { eid: 'p1' },
    doc: { title: 'Mug' },
    product: { price: 12 },
  })
  put(s, { entity: { eid: 'p1' }, product: null })
  assertEquals(at(s, 'p1').product, undefined)
  assertEquals(comp(at(s, 'p1'), 'doc').title, 'Mug')
})

Deno.test('a reference names an entity the batch mints, in any order', () => {
  let s = shopRam()
  let born = put(s, {
    entity: { eid: 'r1' },
    review: { stars: 5, product: 'p1' },
  })
  assertEquals(born.map((e) => e.eid), ['r1', 'p1'])
  // A pointer to nothing: held, and unnumbered until it carries something.
  assertEquals(at(s, 'p1'), { entity: { eid: 'p1' } })
})

Deno.test('a removed entity is tombstoned, and takes no patch after', () => {
  let s = shopRam()
  put(s, { entity: { eid: 'p1' }, doc: { title: 'Mug' } })
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(at(s, 'p1'), { entity: { eid: 'p1', num: 1 }, tombstone: {} })
  put(s, {
    entity: { eid: 'p1' },
    product: { price: 1, maker: 'm9' },
    doc: { title: 'back from the dead' },
  })
  assertEquals(at(s, 'p1').doc, undefined)
  assertEquals(at(s, 'm9'), undefined) // nor does it mint what it names
  assertEquals(s.read('.kind=doc'), [])
})

Deno.test('a revived entity keeps its identity and takes patches again', () => {
  let s = shopRam()
  put(s, { entity: { eid: 'p1' }, doc: { title: 'Mug' } })
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  s.tx((tx) => tx.revive(['p1']))
  assertEquals(at(s, 'p1'), { entity: { eid: 'p1', num: 1 } })
  put(s, { entity: { eid: 'p1' }, doc: { title: 'back' } })
  assertEquals(at(s, 'p1'), {
    entity: { eid: 'p1', num: 1 },
    doc: { title: 'back' },
  })
})

Deno.test('a read is the query grammar, answered from the map', () => {
  let s = shopRam()
  put(
    s,
    { entity: { eid: 'p1' }, doc: { title: 'Mug' }, product: { price: 12 } },
    { entity: { eid: 'p2' }, doc: { title: 'Cup' }, product: { price: 4 } },
    { entity: { eid: 'd1' }, doc: { title: 'Manual' } },
  )
  assertEquals(s.read('.price<10').map((b) => b.entity.eid), ['p2'])
  assertEquals(s.read('.kind=product&.order=-price').map((b) => b.entity.eid), [
    'p1',
    'p2',
  ])
  assertEquals(s.rows('.price<10'), [{ eid: 'p2' }])
  assertEquals(s.rows('.price<10&.count'), [{ value: '', n: 1 }])
})

// A read through the store's indexes selects what a scan of the same bundles
// selects, for every line of the grammar the in-memory evaluator is held to
// (@yaks/match's parity with @yaks/sqlite).
Deno.test('an indexed read answers every query the way a scan does', () => {
  let s = ram(books, { number: true, now: NOW })
  s.tx((tx) => tx.patch(corpus))
  s.tx((tx) => tx.remove([{ eid: DEAD }]))
  let ids = (bs: Bundle[], q: string) => {
    let out = bs.map((b) => b.entity.eid)
    return /\.order=|\.limit=|\.after=/.test(q) ? out : out.sort()
  }
  for (let q of QUERIES) {
    let scan = matcher(q, books, { now: NOW })(bundles)
    assertEquals(ids(s.read(q), q), ids(scan, q), q)
  }
})

Deno.test('a read by value follows the value through writes and a rollback', () => {
  let s = shopRam()
  let live = () => s.read('.status=live').map((b) => b.entity.eid)
  put(s, { entity: { eid: 'p1' }, product: { status: 'live' } })
  assertEquals(live(), ['p1'])
  put(s, { entity: { eid: 'p2' }, product: { status: 'live' } })
  put(s, { entity: { eid: 'p1' }, product: { status: 'sold' } })
  assertEquals(live(), ['p2'])
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'p1' }, product: { status: 'live' } }])
      tx.patch([{ entity: { eid: 'p2' }, product: null }])
      throw new Error('refused')
    })
  )
  assertEquals(live(), ['p2'])
  s.tx((tx) => tx.remove([{ eid: 'p2' }]))
  assertEquals(live(), [])
  assertEquals(s.read('.status=sold').map((b) => b.entity.eid), ['p1'])
})

Deno.test('a range of numbers follows each value through writes and a rollback', () => {
  let s = shopRam()
  let cheap = () => s.read('.price=0..9').map((b) => b.entity.eid)
  let under = () => s.read('.price<=9.5').map((b) => b.entity.eid)
  put(s, { entity: { eid: 'p1' }, product: { price: 5 } })
  put(s, { entity: { eid: 'p2' }, product: { price: 50 } })
  assertEquals(cheap(), ['p1'])
  put(s, { entity: { eid: 'p1' }, product: { price: 9.5 } })
  put(s, { entity: { eid: 'p2' }, product: { price: 7 } })
  assertEquals(cheap(), ['p2'])
  assertEquals(under().sort(), ['p1', 'p2'])
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'p1' }, product: { price: 1 } }])
      tx.patch([{ entity: { eid: 'p2' }, product: { price: null } }])
      throw new Error('refused')
    })
  )
  assertEquals(cheap(), ['p2'])
  s.tx((tx) => tx.remove([{ eid: 'p2' }]))
  assertEquals(cheap(), [])
  assertEquals(under(), ['p1'])
})

Deno.test('a throwing transaction leaves the map exactly as it was', () => {
  let s = shopRam()
  put(s, { entity: { eid: 'p1' }, product: { price: 12 } })
  let before = s.read('')
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([
        { entity: { eid: 'p2' }, product: { price: 1 } },
        { entity: { eid: 'p1' }, product: { price: 99 } },
      ])
      tx.remove([{ eid: 'p1' }])
      throw new Error('refused')
    })
  )
  assertEquals(s.read(''), before)
  // the numbers the rolled-back batch minted are handed out again
  assertEquals(put(s, { entity: { eid: 'p3' }, product: {} }), [{
    eid: 'p3',
    num: 2,
  }])
})

Deno.test('a nested transaction rolls back to where it opened', () => {
  let s = shopRam()
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }])
    assertThrows(() =>
      s.tx((inner) => {
        inner.patch([{ entity: { eid: 'p2' }, doc: { title: 'Cup' } }])
        throw new Error('inner')
      })
    )
    return tx
  })
  assert(at(s, 'p1'))
  assertEquals(at(s, 'p2'), undefined)
})

Deno.test('an outer rollback undoes what an inner transaction committed', () => {
  let s = shopRam()
  assertThrows(() =>
    s.tx(() => {
      s.tx((inner) => inner.patch([{ entity: { eid: 'p1' }, doc: {} }]))
      throw new Error('outer')
    })
  )
  assertEquals(at(s, 'p1'), undefined)
})

Deno.test('a mirror holds only the number it is told, never a guess', () => {
  let s = shopRam({ adopt: true })
  // Until it is told, it has none: a guess could be another entity's number.
  put(s, { entity: { eid: 'p1' }, doc: { title: 'Mug' } })
  assertEquals(at(s, 'p1').entity, { eid: 'p1' })
  put(s, { entity: { eid: 'p1', num: 7 }, doc: { title: 'Mug' } })
  assertEquals(at(s, 'p1').entity.num, 7)
  // An entity reached only by reference has none either.
  put(s, { entity: { eid: 'p2' }, doc: { title: 'Cup' } })
  assertEquals(at(s, 'p2').entity, { eid: 'p2' })
})

Deno.test('a store nobody mirrors keeps its own numbering', () => {
  let s = shopRam()
  put(s, { entity: { eid: 'p1', num: 7 }, doc: { title: 'Mug' } })
  assertEquals(at(s, 'p1').entity.num, 1)
})

Deno.test('a map has no schema: install does nothing', () => {
  // and a Store is a Storage — the seam @yaks/graph applies changes through
  let s: Storage = shopRam()
  assertEquals(s.install(), undefined)
})

Deno.test('a mirror adopts an explicit unnumbered spine', () => {
  let s = shopRam({ adopt: true })
  put(s, { entity: { eid: 'blob', num: null }, doc: {} })
  assertEquals(at(s, 'blob').entity, { eid: 'blob', num: null })
  put(s, { entity: { eid: 'blob' }, doc: { title: 'still unnumbered' } })
  assertEquals(at(s, 'blob').entity.num, null)
})

Deno.test('physical eviction reserves identity and rolls back with nested transactions', () => {
  let s = shopRam({ adopt: true })
  put(s, { entity: { eid: 'p1', num: 90 }, doc: { title: 'payload' } })
  assertThrows(() =>
    s.tx((tx) => {
      tx.evict(['p1'])
      assertEquals(tx.get(['p1']), [])
      s.tx((inner) =>
        inner.patch([{ entity: { eid: 'p1' }, doc: { title: 'new' } }])
      )
      throw new Error('rollback')
    })
  )
  assertEquals(comp(at(s, 'p1'), 'doc').title, 'payload')
  s.tx((tx) => tx.evict(['p1']))
  assertEquals(at(s, 'p1'), undefined)
  assertEquals(s.read(''), [])
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([{
        entity: { eid: 'p1', num: 91 },
        doc: { title: 'temporary' },
      }])
      throw new Error('rollback')
    })
  )
  assertEquals(at(s, 'p1'), undefined)
  assertEquals(
    put(s, { entity: { eid: 'p1' }, doc: { title: 'restored' } }),
    [],
  )
  assertEquals(at(s, 'p1').entity.num, 90)
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  s.tx((tx) => tx.evict(['p1']))
  put(s, { entity: { eid: 'p1' }, doc: { title: 'cannot revive' } })
  assertEquals(at(s, 'p1').tombstone, {})
})

Deno.test('a real delete after payload eviction still makes death permanent', () => {
  let s = shopRam()
  put(s, { entity: { eid: 'p1' }, doc: { title: 'live' } })
  s.tx((tx) => tx.evict(['p1']))
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  put(s, { entity: { eid: 'p1' }, doc: { title: 'late snapshot' } })
  assertEquals(at(s, 'p1').tombstone, {})
  assertEquals(at(s, 'p1').entity.num, 1)
})

// A property the vocabulary declares but never stores is answered by the rule
// the store is handed, and refused by name without one.
Deno.test('a computed property is read through the rule the store is given', () => {
  let vocab = loadVocab({
    $defs: {
      lamp: {
        type: 'object',
        component: true,
        properties: {
          watts: { type: 'number' },
          glow: { type: 'string', computed: true },
        },
      },
    },
  })
  let lamps = [
    { entity: { eid: 'l1' }, lamp: { watts: 60 } },
    { entity: { eid: 'l2' }, lamp: { watts: 5 } },
  ]
  let lit = ram(vocab, {
    computed: {
      'lamp.glow': (b) => Number(comp(b, 'lamp').watts) > 40 ? 'bright' : 'dim',
    },
  })
  put(lit, ...lamps)
  assertEquals(lit.read('.lamp.glow=bright').map((b) => b.entity.eid), ['l1'])
  let dark = ram(vocab)
  put(dark, ...lamps)
  assertThrows(() => dark.read('.lamp.glow=bright'), Error, 'lamp.glow')
})
