/// <reference lib="deno.ns" />
// The defining test: one script of batches, two storages, no disagreement.
//
// Both sides run @yaks/graph's own `apply()` over @yaks/sqlite's shop
// vocabulary — one storing rows in an in-memory SQLite database, the other
// storing bundles in this package's Map. Every batch must return the same
// bundles (births with the same numbers, casualties, stamps, `$alias`
// resolutions), refuse the same batches with the same error, and leave the two
// stores reading back the same entities. That agreement is the promise: a
// graph does not care where its bytes are.
//
// The two adapters differ in one place, smoothed by `plain()`: a database reads
// back every declared column, `null` for the ones never written, and holds a
// boolean as 0/1; the map holds what it was given. A null column and an absent
// one mean the same thing in this model, so both sides are compared with the
// nulls dropped and booleans as the number a column stores.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Change, Graph, Plugin } from '@yaks/graph'
import { graph, isPromise, token } from '@yaks/graph'
import { shop, store } from '../sqlite/harness.ts'
import { memory } from './mod.ts'

// A bookmark is content-addressed: it IS the sentence "someone marked this",
// so two writers who state it land on one entity. This is what gives the
// script an `$alias` whose id is derived rather than minted.
let bookmarks: Plugin = {
  name: 'bookmarks',
  derive: { bookmark: (comp) => `mark:${comp.of}` },
}

// The batch nobody wants: a hook that refuses at the last moment INSIDE the
// transaction, after the patches have gone in. Whatever it wrote must be gone.
let doorman: Plugin = {
  name: 'doorman',
  hooks: {
    commit: (bundles) => {
      let bad = bundles.some((b) =>
        (b.doc as Record<string, unknown> | undefined)?.title == 'boom'
      )
      if (bad) throw new Error('refused at commit')
      return bundles
    },
  },
}

// Both graphs mint alias ids from the same counter, so an entity the batch
// named rather than identified is comparable across the two.
let counter = () => {
  let n = 0
  return () => `x${++n}`
}

let both = (): [Graph, Graph] => [
  graph({
    storage: memory(shop),
    vocab: shop,
    plugins: [bookmarks, doorman],
    mint: counter(),
  }),
  graph({
    storage: store(),
    vocab: shop,
    plugins: [bookmarks, doorman],
    mint: counter(),
  }),
]

// A bundle as both adapters agree on it: nulls dropped (an absent column and a
// cleared one are the same fact) and booleans as the 0/1 a column stores.
let plain = (b: Bundle): Bundle => {
  let out: Bundle = { entity: b.entity }
  for (let [name, value] of Object.entries(b)) {
    if (name == 'entity') continue
    if (value == null || typeof value != 'object') {
      out[name] = value as never
      continue
    }
    out[name] = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v != null)
        .map(([p, v]) => [p, typeof v == 'boolean' ? Number(v) : v]),
    )
  }
  return out
}

let byNum = (bs: Bundle[]) =>
  [...bs].sort((a, b) => (a.entity.num ?? 0) - (b.entity.num ?? 0)).map(plain)

// One batch, and what the graph said about it: the bundles it returned, or the
// refusal it threw. Either is compared across the two stores.
type Said = { ok?: Bundle[]; err?: string }

let say = (g: Graph, batch: Change, now: string): Said => {
  try {
    let out = g.apply(batch, { now })
    assert(!isPromise(out), 'apply() went async')
    return { ok: byNum(out) }
  } catch (e) {
    return { err: `${(e as Error).name}: ${(e as Error).message}` }
  }
}

let AT = '2026-03-01T00:00:00.000Z'

// The script: everything a batch can do, in the order a shop would do it.
let script: { name: string; batch: Change; now?: string }[] = [
  {
    name: 'create',
    batch: [
      { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
      {
        entity: { eid: 'p1' },
        doc: { title: 'Mug', body: 'holds tea' },
        product: { price: 12, available: true, status: 'live', maker: 'm1' },
        $actor: { by: 'm1' },
      },
      { entity: { eid: 'p2' }, product: { price: 4, status: 'draft' } },
      { entity: { eid: 'r1' }, review: { stars: 5, product: 'p1' } },
      { entity: { eid: 'u1' }, doc: { title: 'Reader' }, bookmark: { of: 'p1' } },
    ],
  },
  {
    name: 'patch a column, leave the rest',
    batch: [{ entity: { eid: 'p1' }, product: { price: 9 } }],
    now: '2026-03-02T00:00:00.000Z',
  },
  {
    name: 'clear a column',
    batch: [{ entity: { eid: 'p1' }, product: { status: null } }],
  },
  {
    name: 'drop a component',
    batch: [{ entity: { eid: 'p2' }, product: null }],
  },
  {
    name: 'a reference mints the entity it names',
    batch: [{ entity: { eid: 'r5' }, review: { stars: 2, product: 'p5' } }],
  },
  {
    name: '$was holds',
    batch: [{
      entity: { eid: 'p1' },
      doc: { title: 'Mug II' },
      $was: { doc: { title: token('Mug') } },
    }],
  },
  {
    name: '$was has moved: the whole batch is refused',
    batch: [
      { entity: { eid: 'p9' }, doc: { title: 'never lands' } },
      {
        entity: { eid: 'p1' },
        doc: { title: 'Mug III' },
        $was: { doc: { title: token('Mug') } },
      },
    ],
  },
  {
    name: 'an alias, and an id derived from it',
    batch: [
      { entity: { eid: '$maker' }, doc: { title: 'Bodge & Sons' } },
      { entity: { eid: '$mark' }, bookmark: { of: '$maker' } },
    ],
  },
  {
    name: 'a hook refuses inside the transaction',
    batch: [
      { entity: { eid: 'p8' }, doc: { title: 'boom' } },
      { entity: { eid: 'p7' }, product: { price: 1 } },
    ],
  },
  {
    name: 'the number a refused batch minted is handed out again',
    batch: [{ entity: { eid: 'p6' }, product: { price: 3 } }],
  },
  {
    name: 'a delete takes its dependents with it',
    batch: [{ entity: { eid: 'p1' }, $delete: true }],
  },
  {
    name: 'a deleted target detaches its referrers',
    batch: [{ entity: { eid: 'm1' }, $delete: true }],
  },
  {
    name: 'a dead entity takes no patch, and mints nothing it names',
    batch: [{ entity: { eid: 'p1' }, product: { price: 1, maker: 'm9' } }],
  },
]

// What both stores must read back — checked after EVERY step, so a difference
// is caught by the batch that made it rather than by the end of the script.
let READS = [
  '.kind=product',
  '.kind=review',
  '.kind=doc&.order=title',
  '.price>0',
  '.available=1',
  '.status=',
  '.maker!',
  '.title~=mug',
]

// Everything named, alive or in its grave: identity, not search.
let NAMED = [
  'm1',
  'p1',
  'p2',
  'r1',
  'u1',
  'p6',
  'p7',
  'p8',
  'p9',
  'r5',
  'p5',
  'm9',
  'x1',
  'mark:x1',
]

let state = (g: Graph) => ({
  reads: READS.map((q) => byNum(g.read(q) as Bundle[])),
  named: byNum(g.storage.tx((tx) => tx.get(NAMED)) as Bundle[]),
})

Deno.test('a memory graph and a sqlite graph agree, batch for batch', () => {
  let [mem, sql] = both()
  for (let step of script) {
    assertEquals(
      say(mem, step.batch, step.now ?? AT),
      say(sql, step.batch, step.now ?? AT),
      `returned: ${step.name}`,
    )
    assertEquals(state(mem), state(sql), `read back: ${step.name}`)
  }
})
