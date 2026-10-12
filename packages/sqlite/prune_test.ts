import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { and, eq, list } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

let vocab = loadVocab([{
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    mark: {
      component: true,
      properties: { by: { type: 'string', ref: 'entity', death: 'keep' } },
    },
  },
}])
let canonical = '11111111-1111-4111-8111-111111111111'

let spined = loadVocab([spineDoc, archetypeDoc])
let shaped = storage(mem(), spined)
shaped.install()
shaped.tx((tx) =>
  tx.patch([
    { entity: { eid: '' } },
    { entity: { eid: 'yak' } },
    { entity: { eid: 'https://github.com/yaksh/yaks' } },
  ])
)
let tracked = graph({
  storage: shaped,
  vocab: spined,
  plugins: [archetypes()],
})
let emptyShape = shaped.get(['yak'])[0].entity.archetype!
test('sqlite: spine reference equality compares archetypes rather than owner identity', () => {
  assertEquals(shaped.read(and(eq('entity.archetype', list('', 'yak')))), [])
  assertEquals(
    shaped.read(and(eq('entity.archetype', emptyShape))).map((b) =>
      b.entity.eid
    ).sort(),
    ['', 'https://github.com/yaksh/yaks', 'yak'],
  )
})
for (let i = 0; i < 8; i++) {
  shaped.tx((tx) => tx.patch([{ entity: { eid: 'warming' } }]))
  tracked.apply([{ entity: { eid: 'warming' }, $prune: true }])
}
for (let eid of ['', 'yak', 'https://github.com/yaksh/yaks']) {
  test(`sqlite: pruning the malformed orphan ${JSON.stringify(eid)} with archetype metadata erases its identity`, async () => {
    await tracked.apply([{ entity: { eid }, $prune: true }])
    assertEquals(await tracked.get([eid]), [])
  })
}

let raced = storage(mem(), vocab)
raced.install()
raced.tx((tx) => tx.patch([{ entity: { eid: 'raced' } }]))
let late = graph({
  vocab,
  storage: {
    ...raced,
    tx: (body) =>
      raced.tx((tx) =>
        body({
          ...tx,
          prune: (eids) => {
            // A storage writer can arrive after the graph read its references.
            tx.patch([{ entity: { eid: canonical }, mark: { by: 'raced' } }])
            tx.prune(eids)
          },
        })
      ),
  },
})
for (let i = 0; i < 3; i++) {
  try {
    late.apply([{ entity: { eid: 'raced' }, $prune: true }])
  } catch {
    // Its failing SQL statement and transaction rollback are prepared too.
  }
}
test('sqlite: a reference added after prune admission rolls back the erase', () => {
  assertThrows(() => late.apply([{ entity: { eid: 'raced' }, $prune: true }]))
  assertEquals(raced.get(['raced']), [{ entity: { eid: 'raced' } }])
  assertEquals(raced.get([canonical]), [])
})

let lists = storage(mem(), vocab)
lists.install()
lists.tx((tx) =>
  tx.patch([
    { entity: { eid: '' } },
    { entity: { eid: 'Ada' } },
    { entity: { eid: 'empty' }, doc: { title: '' }, mark: { by: '' } },
    { entity: { eid: 'named' }, doc: { title: 'Ada' }, mark: { by: 'Ada' } },
    { entity: { eid: 'unset' }, doc: {}, mark: {} },
  ])
)
for (let field of ['doc.title', 'mark.by']) {
  test(`sqlite: empty list members name values for ${field}`, () => {
    for (let value of [list(''), list('', 'Ada')]) {
      assertEquals(
        lists.read(and(eq(field, value))).map((b) => b.entity.eid).sort(),
        value.items.length == 1 ? ['empty'] : ['empty', 'named'],
      )
    }
  })
}

for (
  let [name, store] of [
    ['sqlite', storage(mem(), vocab)],
    ['ram', ram(vocab)],
  ] as const
) {
  store.install()
  let g = graph({
    storage: store,
    vocab,
    plugins: [{
      name: 'names',
      address: (_tx, ids) =>
        new Map(
          ids.filter((id) => id == 'server').map((id) => [id, canonical]),
        ),
    }],
  })
  store.tx((tx) => {
    tx.patch([
      { entity: { eid: 'server' } },
      { entity: { eid: '' } },
      { entity: { eid: 'buried' } },
      { entity: { eid: 'checked' } },
      { entity: { eid: 'held' }, doc: { title: 'Keep' } },
      { entity: { eid: 'pointed' } },
      { entity: { eid: canonical } },
      { entity: { eid: 'writer' }, mark: { by: 'pointed' } },
    ])
    tx.remove([{ eid: 'buried' }])
  })

  // Prepare the adapter's statement and query caches outside the cases.
  for (let i = 0; i < 3; i++) {
    store.tx((tx) => tx.patch([{ entity: { eid: 'warming' } }]))
    g.apply([{ entity: { eid: 'warming' }, $prune: true }], { check: true })
    g.apply([{ entity: { eid: 'warming' }, $prune: true }])
    try {
      g.apply([
        { entity: { eid: canonical }, doc: { title: 'Discard' } },
        { entity: { eid: 'pointed' }, $prune: true },
      ])
    } catch (error) {
      if (!(error instanceof Refused)) throw error
    }
  }

  for (let eid of ['server', '', 'buried']) {
    test(`${name}: pruning removes the exact malformed orphan ${JSON.stringify(eid)}`, async () => {
      assertEquals(g.apply([{ entity: { eid }, $prune: true }]), [
        { entity: { eid }, tombstone: {} },
      ])
      assertEquals(g.get([eid]), [])
      assertEquals((await g.get([canonical])).length, 1)
    })
  }

  test(`${name}: pruning an absent malformed identity does nothing`, () => {
    assertEquals(g.apply([{ entity: { eid: 'absent' }, $prune: true }]), [])
    assertEquals(g.get(['absent']), [])
  })

  for (let eid of ['held', 'pointed', canonical]) {
    test(`${name}: pruning refuses identity ${JSON.stringify(eid)}`, async () => {
      assertThrows(() => g.apply([{ entity: { eid }, $prune: true }]), Refused)
      assertEquals((await g.get([eid])).length, 1)
    })
  }

  test(`${name}: a prune request cannot also patch its identity`, async () => {
    assertThrows(() =>
      g.apply([{
        entity: { eid: 'checked' },
        $prune: true,
        doc: { title: 'Lost' },
      }]), Refused)
    assertEquals((await g.get(['checked'])).length, 1)
  })

  test(`${name}: a refused prune rolls back ordinary writes in its batch`, () => {
    assertThrows(() =>
      g.apply([
        { entity: { eid: canonical }, doc: { title: 'Discard' } },
        { entity: { eid: 'pointed' }, $prune: true },
      ]), Refused)
    assertEquals(g.get([canonical]), [{ entity: { eid: canonical } }])
  })

  test(`${name}: a pruning check rolls back identity removal`, () => {
    assertEquals(
      g.apply([{ entity: { eid: 'checked' }, $prune: true }], {
        check: true,
      }),
      [{ entity: { eid: 'checked' }, tombstone: {} }],
    )
    assertEquals(g.get(['checked']), [{ entity: { eid: 'checked' } }])
  })
}
