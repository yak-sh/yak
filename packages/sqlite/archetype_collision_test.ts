import { test } from '@yaks/testing'
import {
  assertEquals,
  assertIsError,
  assertNotEquals,
  assertThrows,
} from '@std/assert'
import {
  archetypeDoc,
  Archetypes,
  archetypes,
  eidOf,
  tablesOf,
} from '@yaks/archetype'
import { type Bundle, graph, sha256 } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  by,
  col,
  type Driver,
  eq,
  insert,
  join,
  scan,
  select,
  table,
  val,
} from '@yaks/sql'
import { backfill, storage } from './mod.ts'
import { open } from './db.ts'
import { meta, SCHEMA } from './meta.ts'
import { mem } from './testing.ts'

// Every descriptor, with the tables it names, joined to its spine row.
let descriptors = (d: Driver) =>
  d.query(select({
    cols: ['id', 'eid', 'num'].map((c) => col(c, 'e')).concat(
      col('tables', 'a'),
    ),
    from: table('entity', 'e'),
    joins: [
      join(table('archetype', 'a'), eq(col('entity', 'a'), col('id', 'e'))),
    ],
  }))

// A descriptor called by the bare SHA of its tables, as the first contract
// minted it.
let legacy = (d: Driver, id: number, eid: string) =>
  d.query({
    t: 'update',
    table: 'entity',
    set: { eid: val(eid) },
    where: by({ id }),
  })

let spine = (d: Driver) =>
  d.query(select({ from: table('entity'), order: [col('id')] }))

// Fleet's text blobs are entities wearing blob + blob_text; exercise the same
// physical shape, including text equal to old/new descriptor hash preimages.
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    blob: {
      component: true,
      type: 'object',
      properties: { bytes: { type: 'number' } },
    },
    blob_text: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string' } },
    },
    link: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity', death: 'keep' } },
    },
  },
}])
let texts = ['', 'doc', 'blob|blob_text', 'archetype|', 'archetype|doc']
let blob = (text: string): Bundle => ({
  entity: { eid: sha256(text) },
  blob: { bytes: new TextEncoder().encode(text).length },
  blob_text: { text },
})
let owners: Bundle[] = [
  { entity: { eid: 'empty' } },
  { entity: { eid: 'document' }, doc: {} },
]

let blobs = texts.map(blob)
let addresses = new Map(texts.map((text) => [text, sha256(text)]))
let sets = new Archetypes()
let tableSets = [[], ['archetype'], ['doc'], ['blob', 'blob_text'], [
  'tombstone',
]]
for (let tables of tableSets) {
  sets.intern(tables)
}
let emptyId = eidOf([]), docId = eidOf(['doc'])
let blobId = eidOf(['blob', 'blob_text'])
let ownerDeletes = owners.map((b) => ({ entity: b.entity, $delete: true }))
let protectedSets = [[], ['doc']].map((tables) => ({
  eid: eidOf(tables),
  shape: { tables: JSON.stringify(tables) },
}))

for (let backend of ['ram', 'sqlite']) {
  for (let first of [true, false]) {
    let s = backend == 'ram' ? ram(vocab) : storage(mem(), vocab)
    if ('install' in s) s.install()
    let g = graph({ storage: s, vocab, plugins: [archetypes(sets)] })
    let get = (eid: string) => s.get([eid])[0]
    let batches = [blobs, owners]
    for (let bundles of first ? batches : batches.reverse()) g.apply(bundles)
    let before = new Map([
      'empty',
      'document',
      ...addresses.values(),
    ].map((eid) => [eid, get(eid)]))
    g.apply(ownerDeletes)
    let after = new Map(protectedSets.map(({ eid }) => [eid, get(eid)]))
    let refused = protectedSets.flatMap(({ eid }) =>
      [{ entity: { eid }, $delete: true }, { entity: { eid }, archetype: null }]
        .map((bundle) => {
          try {
            g.apply([bundle])
          } catch (error) {
            return error
          }
        })
    )
    let remaining = get(addresses.get('')!)
    test(`archetype/blob: ${backend}, blobs first=${first}`, () => {
      assertNotEquals(emptyId, addresses.get(''))
      assertEquals(before.get('empty')!.entity.archetype, emptyId)
      assertEquals(before.get('document')!.entity.archetype, docId)
      for (let text of texts) {
        let b = before.get(addresses.get(text)!)!
        assertEquals(b.blob_text, { text })
        assertEquals(b.entity.archetype, blobId)
        assertEquals(b.archetype, undefined)
      }
      for (let { eid, shape } of protectedSets) {
        assertEquals(after.get(eid)!.archetype, shape)
      }
      for (let error of refused) assertIsError(error)
      assertEquals(remaining.blob_text, { text: '' })
    })
  }
}

let reopened = [true, false].map((first) => {
  let path = Deno.makeTempFileSync({ suffix: '.sqlite' })
  let db = open(path)
  try {
    let s = storage(db, vocab)
    s.install()
    let batches = [blobs, owners]
    for (let bundles of first ? batches : batches.reverse()) {
      s.tx((tx) => tx.patch(bundles)) // legacy/unclassified physical rows
    }
    // As a file an older build wrote: no mark this vocabulary installed.
    meta(db).del(SCHEMA)
    s.install()
    db.close()
    db = open(path)
    s = storage(db, vocab)
    s.install()
    let filled = backfill(db)
    let get = (eid: string) => s.get([eid])[0]
    let empty = get('empty').entity.archetype
    let content = texts.map((text) => get(addresses.get(text)!).blob_text)
    let g = graph({ storage: s, vocab, plugins: [archetypes()] })
    g.apply([{ entity: { eid: 'after-reopen' } }])
    let fresh = get('after-reopen').entity.archetype
    let refused: unknown
    try {
      g.apply([{ entity: { eid: emptyId }, $delete: true }])
    } catch (error) {
      refused = error
    }
    return { filled, empty, content, fresh, refused }
  } finally {
    db.close()
    Deno.removeSync(path)
  }
})
test('archetype/blob: file backfill and reopen preserve text in both insertion orders', () => {
  for (let fixture of reopened) {
    assertEquals(fixture.filled, { entities: 0, archetypes: 0, retired: 0 })
    assertEquals(fixture.empty, emptyId)
    assertEquals(fixture.content, texts.map((text) => ({ text })))
    assertEquals(fixture.fresh, emptyId)
    assertIsError(fixture.refused)
  }
})

test('archetype: migrate legacy SHA descriptors in place, references and retirement survive', () => {
  let d = mem()
  let s = storage(d, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    ...owners,
    { entity: { eid: 'reference' }, link: { to: eidOf([]) } },
    { entity: { eid: '$gone' }, archetype: { tables: '["gone"]' } },
  ])
  backfill(d) // Retire the missing-table descriptor before migration.
  let rows = descriptors(d)
  for (let r of rows) {
    legacy(d, Number(r.id), sha256(tablesOf(r.tables).join('|')))
  }
  backfill(d)
  for (let r of rows) {
    assertEquals(scan(d, 'entity', by({ id: Number(r.id) }), ['eid', 'num']), [
      { eid: r.eid, num: r.num },
    ])
  }
  let get = (eid: string) => s.tx((tx) => tx.get([eid]))[0]
  assertEquals(get('reference').link, { to: eidOf([]) })
  assertEquals(get(eidOf(['gone'])).retired, {})
  assertEquals(get('empty').entity.archetype, eidOf([]))
  assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply(texts.map(blob)) // Old descriptor addresses are now free for blobs.
  for (let text of texts) assertEquals(get(sha256(text)).blob_text, { text })
  assertThrows(() => g.apply([{ entity: { eid: eidOf([]) }, $delete: true }]))
})

for (let fault of ['occupied', 'invalid']) {
  test(`archetype: legacy migration refuses ${fault} identities atomically`, () => {
    let d = mem()
    let s = storage(d, vocab)
    s.install()
    graph({ storage: s, vocab, plugins: [archetypes()] }).apply(owners)
    let rows = descriptors(d)
    for (let r of rows) {
      legacy(d, Number(r.id), sha256(tablesOf(r.tables).join('|')))
    }
    // Fail on the last descriptor so earlier verified renames must roll back.
    if (fault == 'occupied') {
      // Past every door, as only a raw writer could: a unit through the store
      // classifies what it writes, and refuses the occupied address itself.
      d.query(insert('entity', { eid: String(rows.at(-1)!.eid) }))
      d.query(insert('doc', { entity: Number(spine(d).at(-1)!.id) }))
    } else {
      legacy(d, Number(rows.at(-1)!.id), 'not-a-legacy-descriptor')
    }
    let snapshot = spine(d)
    assertThrows(
      () => backfill(d),
      Error,
      fault == 'occupied'
        ? 'Archetype identity is occupied'
        : 'Invalid archetype identity',
    )
    assertEquals(spine(d), snapshot)
  })
}

test('archetype: migration never steals content from a shared legacy blob spine', () => {
  let d = mem()
  let s = storage(d, vocab)
  s.install()
  graph({ storage: s, vocab, plugins: [archetypes()] }).apply(owners)
  for (let r of descriptors(d)) {
    legacy(d, Number(r.id), sha256(tablesOf(r.tables).join('|')))
  }
  // Old writers could attach a blob to an already-minted descriptor. The bytes
  // must stay at their SHA, not migrate with the descriptor to a UUID.
  s.tx((tx) => tx.patch([blob('')]))
  let before = spine(d)
  assertThrows(
    () => backfill(d),
    Error,
    'Legacy archetype identity has extra facets',
  )
  assertEquals(spine(d), before)
  assertEquals(
    d.query(select({
      cols: [col('text', 'b')],
      from: table('blob_text', 'b'),
      joins: [
        join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'b'))),
      ],
      where: eq(col('eid', 'e'), val(sha256(''))),
    })),
    [{ text: '' }],
  )
})
