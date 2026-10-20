import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { and, eq, list, present } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel'
import { as, lit, select } from '@yaks/sql'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { storage } from './mod.ts'
import { mem, preparedStore } from './testing.ts'

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
let grave = '33333333-3333-4333-8333-333333333333'

let spined = loadVocab([spineDoc, archetypeDoc])
let shaped = preparedStore(spined)
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
let ownerNames = and(eq('entity.archetype', list('', 'yak')))
let sameShape = and(eq('entity.archetype', emptyShape))
test('sqlite: spine reference equality compares archetypes rather than owner identity', () => {
  assertEquals(shaped.rows(ownerNames), [])
  assertEquals(
    shaped.rows(sameShape).map((b) => String(b.eid)).sort(),
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

let raced = preparedStore(vocab)
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
  assertEquals(raced.get(['raced', canonical]), [{ entity: { eid: 'raced' } }])
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

// A list naming the empty value asks for a component's row: a computed one is
// read from its backing, and a backing's entity never wears a stored one.
let backing = storage(
  mem(),
  loadVocab([...vocab.docs, {
    $defs: {
      virtual: {
        component: true,
        computed: true,
        properties: { value: { type: 'string' } },
      },
    },
  }]),
  {
    backed: {
      virtual: {
        tag: '0'.repeat(32),
        rows: select({ cols: [as(lit(1), 'entity'), as(lit(''), 'value')] }),
      },
    },
  },
)
backing.install()
backing.tx((tx) => tx.patch([{ entity: { eid: 'empty' }, doc: { title: '' } }]))
test('sqlite: an empty list member reads a computed component from its backing', () => {
  assertEquals(
    backing.read(and(eq('virtual.value', list('')))).map((b) => b.virtual),
    [{ value: '' }],
  )
})
test('sqlite: an empty list member names no value of a component a backing cannot wear', () => {
  assertEquals(
    backing.read(and(present('virtual'), eq('doc.title', list('')))),
    [],
  )
})

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
      { entity: { eid: grave } },
      { entity: { eid: 'writer' }, mark: { by: 'pointed' } },
    ])
    tx.remove([{ eid: 'buried' }, { eid: grave }])
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

  test(`${name}: a generated identity is pruned only from its tombstone, by trusted code`, () => {
    assertThrows(
      () => g.apply([{ entity: { eid: grave }, $prune: true }]),
      Refused,
    )
    assertThrows(
      () =>
        g.apply([{ entity: { eid: canonical }, $prune: true }], {
          trusted: true,
        }),
      Refused,
    )
  })

  test(`${name}: trusted code prunes a generated identity's tombstone`, () => {
    assertEquals(
      g.apply([{ entity: { eid: grave }, $prune: true }], { trusted: true }),
      [{ entity: { eid: grave }, tombstone: {} }],
    )
    assertEquals(g.get([grave]), [])
  })

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
