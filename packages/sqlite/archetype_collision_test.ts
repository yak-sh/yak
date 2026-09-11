import { assertEquals, assertNotEquals, assertThrows } from '@std/assert'
import { archetypeDoc, archetypes, eidOf, tablesOf } from '@yaks/archetype'
import { type Bundle, graph, sha256 } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { STOCK } from '@yaks/sql'
import { backfill, type Driver, storage } from './mod.ts'
import { Database } from './db.ts'
import { mem } from './harness.ts'

// Fleet's text blobs are entities wearing blob + blob_text; exercise the same
// physical shape, including text equal to old/new descriptor hash preimages.
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    doc: { type: 'object', properties: { title: { type: 'string' } } },
    blob: { type: 'object', properties: { bytes: { type: 'number' } } },
    blob_text: { type: 'object', properties: { text: { type: 'string' } } },
    link: {
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

for (let backend of ['ram', 'sqlite']) {
  for (let first of [true, false]) {
    Deno.test(`archetype/blob: ${backend}, blobs first=${first}`, () => {
      let s = backend == 'ram' ? ram(vocab) : storage(mem(), vocab)
      if ('install' in s) s.install()
      let g = graph({ storage: s, vocab, plugins: [archetypes()] })
      let get = (eid: string) => s.tx((tx) => tx.get([eid]))[0]
      let batches = [texts.map(blob), owners]
      for (let batch of first ? batches : batches.reverse()) g.apply(batch)
      assertNotEquals(eidOf([]), sha256(''))
      assertEquals(get('empty').entity.archetype, eidOf([]))
      assertEquals(get('document').entity.archetype, eidOf(['doc']))
      for (let text of texts) {
        let b = get(sha256(text))
        assertEquals(b.blob_text, { text })
        assertEquals(b.entity.archetype, eidOf(['blob', 'blob_text']))
        assertEquals(b.archetype, undefined)
      }
      g.apply(owners.map((b) => ({ entity: b.entity, $delete: true })))
      for (let tables of [[], ['doc']]) {
        let eid = eidOf(tables)
        assertEquals(get(eid).archetype, { tables: JSON.stringify(tables) })
        assertThrows(() => g.apply([{ entity: { eid }, $delete: true }]))
        assertThrows(() => g.apply([{ entity: { eid }, archetype: null }]))
      }
      assertEquals(get(sha256('')).blob_text, { text: '' })
    })
  }
}

Deno.test('archetype/blob: file backfill and reopen preserve text in both insertion orders', () => {
  for (let first of [true, false]) {
    let path = Deno.makeTempFileSync({ suffix: '.sqlite' })
    let db = new Database(path)
    let driver = (): Driver => ({
      query: (sql, params) => db.prepare(sql).all(...params),
      exec: (sql) => db.exec(sql),
      arms: STOCK,
    })
    try {
      let s = storage(driver(), vocab)
      s.install()
      let batches = [texts.map(blob), owners]
      for (let batch of first ? batches : batches.reverse()) {
        s.tx((tx) => tx.patch(batch)) // legacy/unclassified physical rows
      }
      s.install()
      db.close()
      db = new Database(path)
      s = storage(driver(), vocab)
      s.install()
      assertEquals(backfill(driver()), {
        entities: 0,
        archetypes: 0,
        retired: 0,
      })
      let get = (eid: string) => s.tx((tx) => tx.get([eid]))[0]
      assertEquals(get('empty').entity.archetype, eidOf([]))
      for (let text of texts) {
        assertEquals(get(sha256(text)).blob_text, { text })
      }
      let g = graph({ storage: s, vocab, plugins: [archetypes()] })
      g.apply([{ entity: { eid: 'after-reopen' } }])
      assertEquals(get('after-reopen').entity.archetype, eidOf([]))
      assertThrows(() =>
        g.apply([{ entity: { eid: eidOf([]) }, $delete: true }])
      )
    } finally {
      db.close()
      Deno.removeSync(path)
    }
  }
})

Deno.test('archetype: migrate legacy SHA descriptors in place, references and retirement survive', () => {
  let d = mem()
  let s = storage(d, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    ...owners,
    { entity: { eid: 'reference' }, link: { to: eidOf([]) } },
    { entity: { eid: '$gone' }, archetype: { tables: '["gone"]' } },
  ])
  s.install() // Retire the missing-table descriptor before migration.
  let rows = d.query(
    'select e.id, e.eid, e.num, a.tables from entity e join archetype a on a.entity = e.id',
    [],
  )
  for (let r of rows) {
    d.query('update entity set eid = ? where id = ?', [
      sha256(tablesOf(r.tables).join('|')),
      Number(r.id),
    ])
  }
  s.install()
  for (let r of rows) {
    assertEquals(
      d.query('select eid, num from entity where id = ?', [Number(r.id)]),
      [
        { eid: r.eid, num: r.num },
      ],
    )
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
  Deno.test(`archetype: legacy migration refuses ${fault} identities atomically`, () => {
    let d = mem()
    let s = storage(d, vocab)
    s.install()
    graph({ storage: s, vocab, plugins: [archetypes()] }).apply(owners)
    let rows = d.query(
      'select e.id, e.eid, a.tables from entity e join archetype a on a.entity = e.id',
      [],
    )
    for (let r of rows) {
      d.query('update entity set eid = ? where id = ?', [
        sha256(tablesOf(r.tables).join('|')),
        Number(r.id),
      ])
    }
    // Fail on the last descriptor so earlier verified renames must roll back.
    if (fault == 'occupied') {
      s.tx((tx) =>
        tx.patch([{ entity: { eid: rows.at(-1)!.eid as string }, doc: {} }])
      )
    } else {
      d.query('update entity set eid = ? where id = ?', [
        'not-a-legacy-descriptor',
        Number(rows.at(-1)!.id),
      ])
    }
    let snapshot = d.query('select * from entity order by id', [])
    assertThrows(
      () => s.install(),
      Error,
      fault == 'occupied'
        ? 'Archetype identity is occupied'
        : 'Invalid archetype identity',
    )
    assertEquals(d.query('select * from entity order by id', []), snapshot)
  })
}

Deno.test('archetype: migration never steals content from a shared legacy blob spine', () => {
  let d = mem()
  let s = storage(d, vocab)
  s.install()
  graph({ storage: s, vocab, plugins: [archetypes()] }).apply(owners)
  let rows = d.query(
    'select e.id, a.tables from entity e join archetype a on a.entity = e.id',
    [],
  )
  for (let r of rows) {
    d.query('update entity set eid = ? where id = ?', [
      sha256(tablesOf(r.tables).join('|')),
      Number(r.id),
    ])
  }
  // Old writers could attach a blob to an already-minted descriptor. The bytes
  // must stay at their SHA, not migrate with the descriptor to a UUID.
  s.tx((tx) => tx.patch([blob('')]))
  let before = d.query('select * from entity order by id', [])
  assertThrows(
    () => s.install(),
    Error,
    'Legacy archetype identity has extra facets',
  )
  assertEquals(d.query('select * from entity order by id', []), before)
  assertEquals(
    d.query(
      'select b.text from blob_text b join entity e on e.id = b.entity where e.eid = ?',
      [sha256('')],
    ),
    [{ text: '' }],
  )
})
