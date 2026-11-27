import { mint } from '@yaks/graph'
import { col, indexName, select, table } from '@yaks/sql'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { labelStored, loadVocab, type VocabDoc } from '@yaks/vocab'
import { minted } from '@yaks/vocab/minted'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { storage as reader } from './read-store.ts'

let doc = JSON.parse(minted(
  JSON.stringify({
    $defs: {
      doc: {
        component: true,
        properties: {
          title: { type: 'string', unique: true },
          flag: { type: 'string', enum: ['kept', 'moved'] },
        },
      },
    },
  }),
  mint,
)) as VocabDoc
let v = loadVocab(doc)
let note = v.stored('doc'), title = v.stored('doc', 'title')

let names = (d: ReturnType<typeof open>) =>
  d.query(select({
    cols: [col('name')],
    from: table('sqlite_schema'),
  })).map((r) => r.name)

for (let legacy of [false, true]) {
  test(`a ${legacy ? 'label' : 'UUID'} store reopens and keeps its layout`, () => {
    let d = open(':memory:')
    using _close = { [Symbol.dispose]: () => d.close() }
    let layout = legacy ? labelStored(v) : v
    let seed = storage(d, layout)
    seed.tx((tx) =>
      tx.patch([{
        entity: { eid: 'first' },
        doc: { title: 'First', flag: 'kept' },
      }])
    )
    let s = storage(d, v)
    assertEquals(s.install(), [])
    let read = reader(d, v)
    assertEquals(read.rows('.doc.title=First .fields=doc.flag'), [{
      eid: 'first',
      'doc.flag': 'kept',
    }])
    s.tx((tx) =>
      tx.patch([{ entity: { eid: 'first' }, doc: { title: 'Edited' } }])
    )
    assertEquals(read.get(['first'])[0].doc, { title: 'Edited', flag: 'kept' })
    let component = layout.stored('doc')
    let view = `${component}_value`
    assertEquals(
      names(d).filter((n) =>
        [component, view, indexName(layout, 'doc', ['title'])].includes(
          String(n),
        )
      ).length,
      3,
    )
    assertEquals(
      d.query(select({
        cols: [col(layout.stored('doc', 'title'))],
        from: table(view),
      })),
      [{ [layout.stored('doc', 'title')]: 'Edited' }],
    )
  })
}

test('a component and property rename reads and updates the same UUID rows', () => {
  let d = open(':memory:')
  using _close = { [Symbol.dispose]: () => d.close() }
  let s = storage(d, v)
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'first' }, doc: { title: 'First' } }])
  )
  let def = doc.$defs!.doc
  let renamed = loadVocab({
    ...doc,
    $defs: {
      note: {
        ...def,
        properties: {
          heading: def.properties!.title,
          flag: def.properties!.flag,
        },
      },
    },
  })
  let next = storage(d, renamed)
  assertEquals(next.read('.note.heading=First')[0].note, { heading: 'First' })
  next.tx((tx) =>
    tx.patch([{ entity: { eid: 'first' }, note: { heading: 'Second' } }])
  )
  assertEquals(next.get(['first'])[0].note, { heading: 'Second' })
  let physical = select({
    cols: [col(title)],
    from: { t: 'table', name: note, physical: true },
  })
  assertEquals(d.query(physical), [{ [title]: 'Second' }])
})

test('a read-only UUID store sees a property that awaits installation as absent', () => {
  let dir = Deno.makeTempDirSync()
  using _clean = {
    [Symbol.dispose]: () => Deno.removeSync(dir, { recursive: true }),
  }
  let d = open(`${dir}/graph.db`)
  using _close = { [Symbol.dispose]: () => d.close() }
  let def = doc.$defs!.doc
  let old = loadVocab({
    ...doc,
    $defs: { doc: { ...def, properties: { title: def.properties!.title } } },
  })
  let seed = storage(d, old)
  seed.install()
  seed.tx((tx) =>
    tx.patch([{ entity: { eid: 'first' }, doc: { title: 'First' } }])
  )
  let read = reader(d, v)
  assertEquals(read.read('.doc.title=First')[0]?.doc, { title: 'First' })
  assertEquals(read.read('.doc.flag=kept'), [])
})

test('equal labels in different namespaces keep separate component rows', () => {
  let named = (label: string): VocabDoc =>
    JSON.parse(minted(
      JSON.stringify({
        label,
        $defs: {
          cost: { component: true, properties: { amount: { type: 'number' } } },
        },
      }),
      mint,
    ))
  let v = loadVocab([named('@yaks/model'), named('yourname/trip')])
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  let s = storage(db, v)
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'visit' },
      '@yaks/model:cost': { amount: 15 },
      'yourname/trip:cost': { amount: 21 },
    }])
  )
  assertEquals(
    s.read('.@yaks/model:cost.amount=15&.yourname/trip:cost.amount=21')
      .map((b) => b.entity.eid),
    ['visit'],
  )
  assertEquals(s.read('.@yaks/model:cost.amount=21'), [])
})
