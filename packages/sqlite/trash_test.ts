/// <reference lib="deno.ns" />
import { cleanup, equal, test, throws } from '@yaks/testing'
import { graph, Refused, type Storage } from '@yaks/graph'
import { restoreTrash, restoring } from '@yaks/graph/trash'
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
    await restoreTrash(g, entry)
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
  let booked = make(), books = graph({ storage: booked, vocab })
  await books.apply([{ entity: { eid: 'run' }, note: { title: 'Done' } }])
  test(`${name} a drop removes bookkeeping and keeps no copy of it`, async () => {
    equal(await books.drop([{ entity: { eid: 'run' } }]), ['run'])
    equal((await books.get(['run']))[0].note, undefined)
    equal(await booked.trash!(['run']), [])
  })
  let cleaning = make(), clean = graph({ storage: cleaning, vocab })
  await clean.apply([{
    entity: { eid: 'cleanup' },
    note: { title: 'Recover me' },
  }])
  test(`${name} delete and prune housekeeping succeed while trash holds its identity`, async () => {
    await clean.apply([{ entity: { eid: 'cleanup' }, $delete: true }, {
      entity: { eid: 'cleanup' },
      $prune: true,
    }], { trusted: true })
    await cleaning.tx((tx) => tx.prune!(['cleanup']))
    equal((await clean.get(['cleanup']))[0].tombstone, {})
    let [entry] = await cleaning.trash!(['cleanup'])
    await restoreTrash(clean, entry)
    equal((await clean.get(['cleanup']))[0].note, { title: 'Recover me' })
  })

  let pages = make(), paged = graph({ storage: pages, vocab })
  await paged.apply(
    ['a', 'b', 'c'].map((eid) => ({ entity: { eid }, note: { title: eid } })),
  )
  for (let eid of ['a', 'b', 'c']) {
    await paged.apply([{ entity: { eid }, $delete: true }])
  }
  test(`${name} every retained transaction remains discoverable by cursor and exact id`, async () => {
    let first = await pages.trash!(undefined, { limit: 2 })
    let next = await pages.trash!(undefined, {
      after: first.at(-1)!.id,
      limit: 2,
    })
    equal(first.length, 2)
    equal(next.length, 1)
    equal(new Set([...first, ...next].map((r) => r.id)).size, 3)
    equal((await pages.trash!(undefined, { id: next[0].id }))[0], next[0])
  })

  let racing = make(), raced = graph({ storage: racing, vocab })
  await raced.apply([{ entity: { eid: 'racing' }, note: { title: 'Before' } }])
  await raced.apply([{ entity: { eid: 'racing' }, $delete: true }])
  let [raceEntry] = await racing.trash!(['racing'])
  let recovered = await restoring(raced, raceEntry)
  await raced.apply([{
    entity: { eid: 'racing' },
    note: { title: 'Later revival' },
  }])
  test(`${name} a restore cannot overwrite a revival that raced its read`, async () => {
    await throws(() => raced.apply(recovered), /moved since/)
    equal((await raced.get(['racing']))[0].note, { title: 'Later revival' })
  })

  let purging = make(), purge = graph({ storage: purging, vocab })
  await purge.apply(
    ['chosen', 'unrelated'].map((eid) => ({
      entity: { eid },
      note: { title: eid },
    })),
  )
  await purge.apply(
    ['chosen', 'unrelated'].map((eid) => ({ entity: { eid }, $delete: true })),
  )
  test(`${name} a deliberate entity purge keeps unrelated rows in the same trash group`, async () => {
    await purging.purgeTrash!(['chosen'])
    equal(await purging.trash!(['chosen']), [])
    let [entry] = await purging.trash!(['unrelated'])
    equal(entry.bundles.map((b) => b.entity.eid), ['unrelated'])
  })
}

let stamp = {
  component: true,
  properties: {
    at: { type: 'string', stamped: true },
    by: { type: 'string', stamped: true },
  },
}
let stampedVocab = loadVocab({
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
    created: stamp,
    updated: stamp,
  },
})
let actor = '7d02f71c-d815-4aad-baea-57121b96be97'
let author = '4a858b73-45dc-4b7f-a04b-936577750b0d'
let store = ram(stampedVocab)
let authorized: boolean[] = []
let stamped = graph({
  storage: store,
  vocab: stampedVocab,
  actor: { by: author },
  plugins: [{
    name: 'permission',
    hooks: {
      precondition: (bundles, _tx, _err, context) => {
        if (bundles.some((b) => b.$restore)) {
          authorized.push(context?.trusted === true)
        }
        return bundles
      },
    },
  }],
})
await stamped.apply([{
  entity: { eid: 'original' },
  note: { text: 'Keep original authorship' },
}], { now: '2026-01-01T00:00:00.000Z' })
let original = (await stamped.get(['original']))[0].created
await stamped.apply([{ entity: { eid: 'original' }, $delete: true }])
let [entry] = store.trash(['original'])
test('archive admission keeps original creation and stamps the restore under ordinary permissions', async () => {
  let patches = (await restoring(stamped, entry)).map((b) => ({
    ...b,
    $actor: { by: actor },
  }))
  await stamped.apply(patches, { now: '2026-02-01T00:00:00.000Z' })
  let [back] = await stamped.get(['original'])
  equal(back.created, original)
  equal(back.updated, { at: '2026-02-01T00:00:00.000Z', by: actor })
  equal(authorized, [false])
})
test('a restore marker never admits invented server-owned values', async () => {
  await throws(
    () =>
      stamped.apply([{
        entity: { eid: 'original' },
        $restore: entry.id,
        created: { at: '2099-01-01T00:00:00.000Z' },
      }]),
    /server-owned/,
  )
})
let refused = graph({
  storage: store,
  vocab: stampedVocab,
  plugins: [{
    name: 'permission',
    hooks: {
      precondition: (bundles) => {
        if (bundles.some((b) => b.$restore)) throw new Refused('not permitted')
        return bundles
      },
    },
  }],
})
test('verified before-images still pass ordinary write authorization', async () => {
  await throws(
    () =>
      refused.apply([{
        entity: { eid: 'original' },
        $restore: entry.id,
        note: { text: 'Forbidden' },
      }]),
    /not permitted/,
  )
})

let manyStore = ram(stampedVocab),
  many = graph({ storage: manyStore, vocab: stampedVocab })
await many.apply([{ entity: { eid: 'first' }, note: { text: 'First' } }], {
  now: '2026-01-01T00:00:00.000Z',
})
await many.apply([{ entity: { eid: 'second' }, note: { text: 'Second' } }], {
  now: '2026-01-02T00:00:00.000Z',
})
await many.apply([{ entity: { eid: 'first' }, $delete: true }])
await many.apply([{ entity: { eid: 'second' }, $delete: true }])
test('one restore spanning deletion groups retains each original creation source', async () => {
  let entries = manyStore.trash()
  await restoreTrash(many, entries)
  equal((await many.get(['first', 'second'])).map((b) => b.created), [
    { at: '2026-01-01T00:00:00.000Z' },
    { at: '2026-01-02T00:00:00.000Z' },
  ])
})
