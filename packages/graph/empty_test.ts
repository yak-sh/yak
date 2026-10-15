// Losing the last substantive component deletes an entity at the graph door,
// including losses caused by another entity's death. Each case's graph is
// built and seeded at load, so a case times only the write it is about.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import { slow } from './testing.ts'
import type { Bundle, Plugin } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    created: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
    updated: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
    item: { component: true, properties: { text: { type: 'string' } } },
    other: { component: true },
    completed: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity', death: 'release' } },
    },
    child: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity', death: 'cascade' } },
    },
  },
}])

// No created or updated stamp: an entity with nothing is still an identity.
let words = loadVocab([{
  $defs: {
    item: { component: true },
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity', death: 'release' } },
    },
  },
}])

for (let async of [false, true]) {
  let seeded = async (
    seed: Bundle[],
    { plugins = [] as Plugin[], over = vocab } = {},
  ) => {
    let storage = ram(over)
    let g = graph({
      vocab: over,
      storage: async ? slow(storage) : storage,
      plugins,
    })
    await g.apply(seed)
    return g
  }

  let released = await seeded([
    { entity: { eid: 'bare' } },
    { entity: { eid: 'root' }, item: {} },
    { entity: { eid: 'owner' }, link: { to: 'root' } },
  ], { over: words })
  test(`an unstamped identity stays live after a release (${async})`, async () => {
    await released.apply([{ entity: { eid: 'root' }, $delete: true }])
    equal(await released.get(['bare', 'owner']), [
      { entity: { eid: 'bare' } },
      { entity: { eid: 'owner' } },
    ])
  })

  let bare = await seeded([{ entity: { eid: 'bare' } }], { over: words })
  test(`an unstamped identity stays live after a removal (${async})`, async () => {
    await bare.apply([{ entity: { eid: 'bare' }, item: {} }])
    await bare.apply([{ entity: { eid: 'bare' }, item: null }])
    equal(await bare.get(['bare']), [{ entity: { eid: 'bare' } }])
  })

  let marked = await seeded([
    { entity: { eid: 'empty' }, item: { text: 'one' } },
    { entity: { eid: 'kept' }, item: {}, other: {} },
    { entity: { eid: 'marked' }, item: {}, completed: {} },
  ])
  test(`only provenance remains: delete, preserve marks, and return tombstones (${async})`, async () => {
    let out = await marked.apply(
      ['empty', 'kept', 'marked'].map((eid) => ({
        entity: { eid },
        item: null,
      })),
    )
    ok(out.find((b) => b.entity.eid == 'empty')?.tombstone)
    let rows = await marked.get(['empty', 'kept', 'marked'])
    ok(rows[0].tombstone)
    ok(rows[1].other)
    ok(rows[2].completed)
  })

  let emptied = await seeded([{ entity: { eid: 'empty' }, item: {} }])
  await emptied.apply([{ entity: { eid: 'empty' }, item: null }])
  test(`an emptied entity takes no removal, and a write revives it (${async})`, async () => {
    equal(await emptied.apply([{ entity: { eid: 'empty' }, item: null }]), [])
    await emptied.apply([{ entity: { eid: 'empty' }, item: {} }])
    ok((await emptied.get(['empty']))[0].item)
  })

  let chain = await seeded([
    { entity: { eid: 'root' }, item: {} },
    { entity: { eid: 'middle' }, link: { to: 'root' } },
    { entity: { eid: 'leaf' }, link: { to: 'middle' } },
    { entity: { eid: 'child' }, child: { to: 'leaf' } },
    { entity: { eid: 'kept' }, link: { to: 'root' }, other: {} },
  ])
  test(`release of the last component cascades to a fixed point (${async})`, async () => {
    let dead = ['root', 'middle', 'leaf', 'child']
    let out = await chain.apply([{ entity: { eid: 'root' }, item: null }])
    for (let eid of dead) ok(out.find((b) => b.entity.eid == eid)?.tombstone)
    let rows = await chain.get([...dead, 'kept'])
    for (let row of rows.slice(0, -1)) ok(row.tombstone)
    ok(rows.at(-1)!.other)
  })

  let checked = await seeded([{ entity: { eid: 'one' }, item: {} }])
  test(`empty deletion is rolled back by check (${async})`, async () => {
    let out = await checked.apply([{ entity: { eid: 'one' }, item: null }], {
      check: true,
    })
    ok(out.find((b) => b.entity.eid == 'one')?.tombstone)
    ok((await checked.get(['one']))[0].item)
  })

  let reject = false
  let refused = await seeded([{ entity: { eid: 'one' }, item: {} }], {
    plugins: [{
      name: 'refuse',
      hooks: {
        journal: (bs) => {
          if (reject) throw Error('no')
          return bs
        },
      },
    }],
  })
  reject = true
  test(`empty deletion is rolled back by refusal (${async})`, async () => {
    try {
      await refused.apply([{ entity: { eid: 'one' }, item: null }])
      throw Error('expected refusal')
    } catch (e) {
      equal((e as Error).message, 'no')
    }
    ok((await refused.get(['one']))[0].item)
  })

  let seen: Bundle[][] = []
  let ordered = await seeded([{ entity: { eid: 'first' }, item: {} }], {
    plugins: [{
      name: 'ordered',
      beforeWrite: () => (bs, tx) => {
        if (bs[0].entity.eid == 'second') {
          return Promise.resolve(tx.get(['first'])).then((rows) => {
            seen.push(rows)
            return bs
          })
        }
        return bs
      },
    }],
  })
  test(`ordered writes see last-component death (${async})`, async () => {
    await ordered.apply([{ entity: { eid: 'first' }, item: null }, {
      entity: { eid: 'second' },
      item: {},
    }])
    ok(seen[0][0].tombstone)
  })
}
