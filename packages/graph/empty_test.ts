// Losing the last substantive component deletes an entity at the graph door,
// including losses caused by another entity's death.
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

for (let async of [false, true]) {
  test(`an unstamped identity stays live after a release or removal (${async})`, async () => {
    let words = loadVocab([{
      $defs: {
        item: { component: true },
        link: {
          component: true,
          properties: {
            to: { type: 'string', ref: 'entity', death: 'release' },
          },
        },
      },
    }])
    let storage = ram(words)
    let g = graph({ vocab: words, storage: async ? slow(storage) : storage })
    await g.apply([
      { entity: { eid: 'bare' } },
      { entity: { eid: 'root' }, item: {} },
      { entity: { eid: 'owner' }, link: { to: 'root' } },
    ])
    await g.apply([{ entity: { eid: 'root' }, $delete: true }])
    equal(await g.get(['bare', 'owner']), [
      { entity: { eid: 'bare' } },
      { entity: { eid: 'owner' } },
    ])
    await g.apply([{ entity: { eid: 'bare' }, item: {} }])
    await g.apply([{ entity: { eid: 'bare' }, item: null }])
    equal(await g.get(['bare']), [{ entity: { eid: 'bare' } }])
  })
  let make = (plugins: Plugin[] = []) =>
    graph({
      vocab,
      storage: async ? slow(ram(vocab)) : ram(vocab),
      plugins,
    })
  test(`only provenance remains: delete, preserve marks, and return tombstones (${async})`, async () => {
    let g = make()
    await g.apply([
      { entity: { eid: 'empty' }, item: { text: 'one' } },
      { entity: { eid: 'kept' }, item: {}, other: {} },
      { entity: { eid: 'marked' }, item: {}, completed: {} },
    ])
    let out = await g.apply(
      ['empty', 'kept', 'marked'].map((eid) => ({
        entity: { eid },
        item: null,
      })),
    )
    ok(out.find((b) => b.entity.eid == 'empty')?.tombstone)
    let rows = await g.get(['empty', 'kept', 'marked'])
    ok(rows[0].tombstone)
    ok(rows[1].other)
    ok(rows[2].completed)
    equal(await g.apply([{ entity: { eid: 'empty' }, item: null }]), [])
    await g.apply([{ entity: { eid: 'empty' }, item: {} }])
    ok((await g.get(['empty']))[0].item)
  })
  test(`release of the last component cascades to a fixed point (${async})`, async () => {
    let g = make()
    await g.apply([
      { entity: { eid: 'root' }, item: {} },
      { entity: { eid: 'middle' }, link: { to: 'root' } },
      { entity: { eid: 'leaf' }, link: { to: 'middle' } },
      { entity: { eid: 'child' }, child: { to: 'leaf' } },
      { entity: { eid: 'kept' }, link: { to: 'root' }, other: {} },
    ])
    let out = await g.apply([{ entity: { eid: 'root' }, item: null }])
    for (let eid of ['root', 'middle', 'leaf', 'child']) {
      ok(out.find((b) => b.entity.eid == eid)?.tombstone)
      ok((await g.get([eid]))[0].tombstone)
    }
    ok((await g.get(['kept']))[0].other)
  })
  test(`empty deletion is rolled back by check and refusal (${async})`, async () => {
    let reject = false
    let g = make([{
      name: 'refuse',
      hooks: {
        journal: (bs) => {
          if (reject) throw Error('no')
          return bs
        },
      },
    }])
    await g.apply([{ entity: { eid: 'one' }, item: {} }])
    let out = await g.apply([{ entity: { eid: 'one' }, item: null }], {
      check: true,
    })
    ok(out.find((b) => b.entity.eid == 'one')?.tombstone)
    ok((await g.get(['one']))[0].item)
    reject = true
    try {
      await g.apply([{ entity: { eid: 'one' }, item: null }])
      throw Error('expected refusal')
    } catch (e) {
      equal((e as Error).message, 'no')
    }
    ok((await g.get(['one']))[0].item)
  })
  test(`ordered writes see last-component death (${async})`, async () => {
    let seen: Bundle[][] = []
    let g = make([{
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
    }])
    await g.apply([{ entity: { eid: 'first' }, item: {} }])
    await g.apply([{ entity: { eid: 'first' }, item: null }, {
      entity: { eid: 'second' },
      item: {},
    }])
    ok(seen[0][0].tombstone)
  })
}
