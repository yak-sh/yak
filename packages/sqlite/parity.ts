// The conformance script every storage adapter is held to (not part of the
// published package — see deno.json): one list of batches, two storages, no
// disagreement.
//
// This adapter is the REFERENCE. A new adapter — a Map, a Durable Object's
// embedded SQLite, a remote SQL service — proves itself by running the same
// script through @yaks/graph's own `apply()` and agreeing with this one on
// every step: the same bundles returned (births with the same numbers,
// casualties, stamps, `$alias` resolutions), the same batches refused with the
// same error, and the same entities read back afterwards. That agreement is the
// promise the seam makes: a graph does not care where its bytes are.
//
// Adapters differ in one place, smoothed by `plain()`: a database reads back
// every declared column, `null` for the ones never written, and holds a boolean
// as 0/1; a map holds what it was given. A null column and an absent one mean
// the same thing in this model, so both sides are compared with the nulls
// dropped and booleans as the number a column stores.

import { assertEquals } from '@std/assert'
import type { Bundle, Change, Graph, Plugin, Storage } from '@yaks/graph'
import { each, graph, then, token } from '@yaks/graph'
import { shop } from './harness.ts'

/** A bookmark is content-addressed: it IS the sentence "someone marked this",
 * so two writers who state it land on one entity. This is what gives the script
 * an `$alias` whose id is derived rather than minted. */
export let bookmarks: Plugin = {
  name: 'bookmarks',
  derive: { bookmark: (comp) => `mark:${comp.of}` },
}

/** The batch nobody wants: a hook that refuses at the last moment INSIDE the
 * transaction, after the patches have gone in. Whatever it wrote must be
 * gone. */
export let doorman: Plugin = {
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

/** A fresh alias-id counter. Every contender mints from its own, so an entity
 * the batch named rather than identified is comparable across them. */
export let counter = (): () => string => {
  let n = 0
  return () => `x${++n}`
}

/** A graph rigged for the script: the shop vocabulary, both plugins, and a
 * counter of its own. Hand it the storage under test. */
export let rig = (storage: Storage): Graph =>
  graph({
    storage,
    vocab: shop,
    plugins: [bookmarks, doorman],
    mint: counter(),
  })

/** One step of the script: a batch, and the clock it is applied under. */
export type Step = { name: string; batch: Change; now?: string }

let AT = '2026-03-01T00:00:00.000Z'

/** The script: everything a batch can do, in the order a shop would do it. */
export let script: Step[] = [
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
      {
        entity: { eid: 'u1' },
        doc: { title: 'Reader' },
        bookmark: { of: 'p1' },
      },
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

// A bundle as every adapter agrees on it: nulls dropped (an absent column and a
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

// A refusal, however it arrived: a throw from a synchronous graph, a rejection
// from an asynchronous one. Both are the same answer and compare the same way.
let refused = (e: unknown): Said => ({
  err: `${(e as Error).name}: ${(e as Error).message}`,
})

let say = (g: Graph, batch: Change, now: string): Said | Promise<Said> => {
  try {
    let out = g.apply(batch, { now })
    return out instanceof Promise
      ? out.then((bs) => ({ ok: byNum(bs) }), refused)
      : { ok: byNum(out) }
  } catch (e) {
    return refused(e)
  }
}

let state = (g: Graph) =>
  then(
    each(READS, [] as Bundle[][], (acc, q) =>
      then(g.read(q), (bs) => [...acc, byNum(bs)])),
    (reads) =>
      then(
        g.storage.tx((tx) =>
          tx.get(NAMED)
        ),
        (named) => ({
          reads,
          named: byNum(named as Bundle[]),
        }),
      ),
  )

/**
 * Run the script through both graphs and assert they never disagree — what
 * each batch returned, and what the store reads back after it. Build each one
 * with {@link rig} so they share vocabulary, plugins and alias counter.
 *
 * Threaded with @yaks/graph's own sync pass-through, so it returns `void` over
 * two synchronous adapters and a promise as soon as either side is
 * asynchronous. Asserting the return is NOT a promise is therefore how a
 * synchronous adapter proves it stayed synchronous through the whole script.
 */
export let parity = (a: Graph, b: Graph): void | Promise<void> =>
  then(
    each(script, null, (_, step) =>
      then(say(a, step.batch, step.now ?? AT), (sa) =>
        then(say(b, step.batch, step.now ?? AT), (sb) => {
          assertEquals(sa, sb, `returned: ${step.name}`)
          return then(state(a), (ra) =>
            then(state(b), (rb) => {
              assertEquals(ra, rb, `read back: ${step.name}`)
              return null
            }))
        }))),
    () => {},
  )
