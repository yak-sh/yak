import { assert, assertEquals, assertThrows } from '@std/assert'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { type Bundle, graph, type Plugin } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { journal, journalDoc } from '@yaks/journal'
import { backfill, componentTables, storage } from './mod.ts'
import { mem } from './harness.ts'

let domain = {
  $defs: {
    doc: { type: 'object', properties: { title: { type: 'string' } } },
    task: { type: 'object' },
    link: {
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity', death: 'release' } },
    },
    child: {
      type: 'object',
      properties: { of: { type: 'string', ref: 'entity', death: 'cascade' } },
    },
  },
}
let vocab = loadVocab([archetypeDoc, domain])
let setup = (extra: Plugin[] = []) => {
  let driver = mem()
  let store = storage(driver, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes(), ...extra] })
  let get = (eid: string) => store.tx((tx) => tx.get([eid]))[0]
  return { driver, store, g, get }
}

Deno.test('archetype: two writers, create, value-only, add/remove, same-batch net move', () => {
  let { g, store, driver, get } = setup()
  let a = g.apply([{
    entity: { eid: 'a', archetype: 'forged' },
    doc: { title: 'A' },
  }]) as Bundle[]
  assertEquals(get('a').entity.archetype, eidOf(['doc']))
  assertEquals(
    a.find((b) => b.entity.eid == 'a')!.entity.archetype,
    eidOf(['doc']),
  )
  let other = graph({ storage: store, vocab, plugins: [archetypes()] })
  other.apply([{ entity: { eid: 'b' }, doc: {} }])
  assertEquals(get('b').entity.archetype, get('a').entity.archetype)
  assertEquals(
    driver.query('select count(*) as n from archetype where tables = ?', [
      '["doc"]',
    ])[0].n,
    1,
  )
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'B' } }])
  assertEquals(get('a').entity.archetype, eidOf(['doc']))
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals(get('a').entity.archetype, eidOf(['doc', 'task']))
  g.apply([{ entity: { eid: 'a' }, doc: null }])
  assertEquals(get('a').entity.archetype, eidOf(['task']))
  g.apply([{ entity: { eid: 'a' }, doc: {} }, {
    entity: { eid: 'a' },
    doc: null,
  }])
  assertEquals(get('a').entity.archetype, eidOf(['task']))
  assertEquals(get(eidOf(['archetype'])).entity.archetype, eidOf(['archetype']))
})

Deno.test('archetype: reference-only births, release/cascade and tombstones', () => {
  let { g, get } = setup()
  g.apply([
    { entity: { eid: 'ref' }, link: { to: 'bare' } },
    { entity: { eid: 'child' }, child: { of: 'bare' } },
  ])
  assertEquals(get('bare').entity.archetype, eidOf([]))
  g.apply([{ entity: { eid: 'bare' }, $delete: true }])
  assertEquals(get('bare').entity.archetype, eidOf(['tombstone']))
  assertEquals(get('child').entity.archetype, eidOf(['tombstone']))
  assertEquals(get('ref').entity.archetype, eidOf([]))
  assertEquals(get('ref').link, undefined)
})

Deno.test('archetype: dry run and late rollback cannot poison cached sets', () => {
  let fail = false
  let { driver, g, get } = setup([{
    name: 'late',
    hooks: {
      commit: (b) => {
        if (fail) throw new Error('late refusal')
        return b
      },
    },
  }])
  g.apply([{ entity: { eid: 'a' }, task: {} }], { check: true })
  assertEquals(get('a'), undefined)
  assertEquals(driver.query('select * from archetype', []).length, 0)
  fail = true
  assertThrows(() => g.apply([{ entity: { eid: 'a' }, task: {} }]))
  fail = false
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals(get('a').entity.archetype, eidOf(['task']))
  assert(get(eidOf(['task'])).archetype)
  assertThrows(() =>
    g.apply([{ entity: { eid: eidOf(['task']) }, $delete: true }])
  )
  assertThrows(() =>
    g.apply([{ entity: { eid: eidOf(['task']) }, archetype: null }])
  )
  assertThrows(() =>
    g.apply([{
      entity: { eid: eidOf(['task']) },
      archetype: { tables: '["doc"]' },
    }])
  )
})

Deno.test('archetype: journal sees descriptor creations, and its own rows are classified', () => {
  let v = loadVocab([archetypeDoc, domain, journalDoc])
  let d = mem()
  let s = storage(d, v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [journal(v), archetypes()] })
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals(
    d.query('select count(*) as n from entity where archetype is null', [])[0]
      .n,
    0,
  )
  assert(d.query("select * from delta where comp = 'archetype'", []).length > 0)
  let before =
    d.query("select count(*) as n from delta where comp = 'archetype'", [])[0].n
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals(
    d.query("select count(*) as n from delta where comp = 'archetype'", [])[0]
      .n,
    before,
  )
})

Deno.test('archetype: additive boot, physical hidden table, idempotent backfill, retirement', () => {
  let d = mem()
  d.exec(
    `create table entity(id integer primary key, eid text unique, num integer unique);
    create table hidden(entity integer primary key references entity(id));
    insert into entity values (1, 'old', 1);
    insert into hidden values (1);`,
  )
  let s = storage(d, vocab)
  s.install()
  let read = () => s.tx((tx) => tx.get(['old']))[0]
  assertEquals(read().entity.archetype, eidOf(['hidden']))
  assert(componentTables(d).includes('hidden'))
  assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'old' }, doc: {} }])
  assertEquals(read().entity.archetype, eidOf(['hidden', 'doc']))
  g.apply([{ entity: { eid: 'old' }, doc: null }])
  assertEquals(read().entity.archetype, eidOf(['hidden']))
  let count = d.query('select count(*) as n from archetype', [])[0].n
  d.exec('drop table hidden')
  s.install()
  assertEquals(read().entity.archetype, eidOf([]))
  let old = s.tx((tx) => tx.get([eidOf(['hidden'])]))[0]
  assertEquals(old.retired, {})
  assertEquals(old.entity.archetype, eidOf(['archetype', 'retired']))
  assertEquals(old.tombstone, undefined)
  assert(
    Number(d.query('select count(*) as n from archetype', [])[0].n) >=
      Number(count),
  )
  assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  assert(
    d.query('pragma index_list(entity)', []).some((r) =>
      r.name == 'entity_archetype'
    ),
  )
})

Deno.test('archetype: pre-existing reference stub can become a descriptor', () => {
  let { g, get } = setup()
  g.apply([
    { entity: { eid: 'ref' }, link: { to: eidOf(['task']) } },
    { entity: { eid: 'task' }, task: {} },
  ])
  let descriptor = get(eidOf(['task']))
  assertEquals(descriptor.archetype, { tables: '["task"]' })
  assertEquals(descriptor.entity.archetype, eidOf(['archetype']))
})

Deno.test('archetype: explicit content aliases canonicalize the stored list', () => {
  let { g, get } = setup()
  g.apply([{
    entity: { eid: '$set' },
    archetype: { tables: '["task","doc","task"]' },
  }])
  assertEquals(get(eidOf(['doc', 'task'])).archetype, {
    tables: '["doc","task"]',
  })
})

Deno.test('archetype: stamps join the final set and value-only writes do not assign again', () => {
  let v = loadVocab([archetypeDoc, domain, {
    $defs: {
      created: {
        type: 'object',
        properties: { at: { type: 'string', stamped: true } },
      },
      updated: {
        type: 'object',
        properties: { at: { type: 'string', stamped: true } },
      },
    },
  }])
  let d = mem()
  let updates = 0
  let query = d.query
  d.query = (sql, params) => {
    if (sql.startsWith('update entity set archetype') && params.at(-1) == 'a') {
      updates++
    }
    return query(sql, params)
  }
  let s = storage(d, v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' }, task: {} }])
  assertEquals(
    s.tx((tx) => tx.get(['a']))[0].entity.archetype,
    eidOf(['doc', 'task', 'created']),
  )
  assertEquals(updates, 1)
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'B' } }])
  assertEquals(updates, 2) // First later touch adds updated.
  assertEquals(
    s.tx((tx) => tx.get(['a']))[0].entity.archetype,
    eidOf(['doc', 'task', 'created', 'updated']),
  )
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'C' } }])
  assertEquals(updates, 2)
  g.apply([{ entity: { eid: 'a' }, task: null, link: { to: 'b' } }])
  assertEquals(updates, 3)
})

Deno.test('archetype: backfill classifies a future descriptor stub in either order', () => {
  for (let first of [true, false]) {
    let d = mem()
    let s = storage(d, vocab)
    s.install()
    let rows: Bundle[] = [
      { entity: { eid: eidOf(['task']) } },
      { entity: { eid: 'owner' }, task: {} },
    ]
    s.tx((tx) => tx.patch(first ? rows : rows.reverse()))
    backfill(d)
    assertEquals(
      s.tx((tx) => tx.get([eidOf(['task'])]))[0].entity.archetype,
      eidOf(['archetype']),
    )
    assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  }
})

Deno.test('archetype: deletion removes physical facets outside the writer vocabulary', () => {
  let { driver, store, g, get } = setup()
  driver.exec(
    'create table hidden(entity integer primary key references entity(id))',
  )
  store.tx((tx) => tx.patch([{ entity: { eid: 'old' }, task: {} }]))
  driver.exec("insert into hidden select id from entity where eid = 'old'")
  store.install()
  g.apply([{ entity: { eid: 'old' }, $delete: true }])
  assertEquals(get('old').entity.archetype, eidOf(['tombstone']))
  assertEquals(driver.query('select * from hidden', []), [])
  assertEquals(backfill(driver), { entities: 0, archetypes: 0, retired: 0 })
})

Deno.test('archetype: boot respects number exclusions and the persistent high-water mark', () => {
  for (let numbered of [true, false]) {
    let d = mem()
    let s = storage(d, vocab, {
      number: { except: numbered ? ['task'] : ['archetype'] },
    })
    s.install()
    s.tx((tx) => tx.patch([{ entity: { eid: 'owner' }, doc: {} }]))
    d.exec(
      "update entity set num = 99 where eid = 'owner'; update entity set num = null where eid = 'owner'",
    )
    s.install()
    let numbers = d.query(
      'select num from entity join archetype a on a.entity = entity.id',
      [],
    )
    assert(numbers.length > 0)
    assert(numbers.every((r) => numbered ? Number(r.num) > 99 : r.num == null))
    assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  }
})
