/// <reference lib="deno.ns" />
import { cleanup, equal, test } from '@yaks/testing'
import { graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { preparedStore } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      journal: false,
      properties: {
        title: { type: 'string' },
        bytes: { type: 'string', contentEncoding: 'base64' },
        metadata: { type: 'object' },
      },
    },
    child: {
      component: true,
      properties: {
        parent: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
    loose: {
      component: true,
      properties: {
        parent: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})
let makers: Record<string, () => Storage> = {
  RAM: () => ram(vocab),
  SQLite: () => {
    let store = preparedStore(vocab)
    cleanup(() => store[Symbol.dispose]())
    return store
  },
}

for (let [name, make] of Object.entries(makers)) {
  let s = make(), g = graph({ storage: s, vocab })
  let bytes = new Uint8Array([0, 255, 3])
  await g.apply([
    {
      entity: { eid: 'parent' },
      note: {
        title: 'Precious',
        bytes,
        metadata: { $bytes: 'ordinary JSON', encoding: 'base64' },
      },
    },
    { entity: { eid: 'child' }, child: { parent: 'parent' } },
    { entity: { eid: 'loose' }, loose: { parent: 'parent' } },
  ])
  test(`${name} trash keeps unjournaled bytes and every side of a death cascade`, async () => {
    await g.apply([{ entity: { eid: 'parent' }, $delete: true }])
    equal((await g.get(['parent']))[0].tombstone, {})
    let [entry] = await s.trash!(['parent'])
    equal(entry.bundles.map((b) => b.entity.eid).sort(), [
      'child',
      'loose',
      'parent',
    ])
    equal(entry.bundles.find((b) => b.entity.eid == 'parent')!.note, {
      title: 'Precious',
      bytes,
      metadata: { $bytes: 'ordinary JSON', encoding: 'base64' },
    })
    await g.apply(entry.bundles)
    equal((await g.get(['child']))[0].child, { parent: 'parent' })
    equal((await g.get(['loose']))[0].loose, { parent: 'parent' })
    equal(
      (await g.get(['parent']))[0].note,
      entry.bundles.find((b) => b.entity.eid == 'parent')!.note,
    )
  })

  let part = make(), edit = graph({ storage: part, vocab })
  await edit.apply([{
    entity: { eid: 'part' },
    note: { title: 'Original', bytes },
  }])
  test(`${name} cleared properties and components retain the transaction's first image`, async () => {
    await part.tx(async (tx) => {
      await tx.patch([{ entity: { eid: 'part' }, note: { title: null } }])
      await tx.patch([{ entity: { eid: 'part' }, note: null }])
    })
    let [entry] = await part.trash!(['part'])
    equal(entry.bundles.length, 1)
    equal(entry.bundles[0].note, { title: 'Original', bytes })
  })

  let rolled = make(), dry = graph({ storage: rolled, vocab })
  await dry.apply([{ entity: { eid: 'kept' }, note: { title: 'Keep' } }])
  test(`${name} a rolled-back deletion creates no trash`, async () => {
    await dry.apply([{ entity: { eid: 'kept' }, $delete: true }], {
      check: true,
    })
    equal(await rolled.trash!(['kept']), [])
    equal((await dry.get(['kept']))[0].note, { title: 'Keep' })
  })
}
