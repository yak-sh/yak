import { assert, assertEquals, assertThrows } from '@std/assert'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { type Bundle, graph, type Plugin } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ddl, journal, log } from '@yaks/journal'
import {
  among,
  by,
  col,
  type CreateTable,
  desc,
  type Driver,
  eq,
  insert,
  join,
  lit,
  scan,
  select,
  table,
  tally,
  val,
} from '@yaks/sql'
import {
  backfill,
  columns,
  componentTables,
  drift,
  reclassify,
  schema,
  storage,
} from './mod.ts'
import { mem, spy } from './testing.ts'

// A table as a file an older install, or a writer outside the vocabulary,
// raised it.
let raised = (name: string, ...cols: CreateTable['cols']): CreateTable => ({
  t: 'create table',
  name,
  cols,
})
let key = { name: 'entity', type: 'integer', pk: true }
let OLD_SPINE = raised(
  'entity',
  { name: 'id', type: 'integer', pk: true },
  { name: 'eid', type: 'text', unique: true },
  { name: 'num', type: 'integer', unique: true },
)
let HIDDEN = raised('hidden', {
  ...key,
  ref: { table: 'entity', cols: ['id'] },
})

let idOf = (d: Driver, eid: string) =>
  Number(scan(d, 'entity', by({ eid }), ['id'])[0].id)
let indexes = (d: Driver, name: string) =>
  d.query({ t: 'pragma', name: 'index_list', arg: name }).map((r) => r.name)

let domain = {
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    task: {
      component: true,
      type: 'object',
    },
    link: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity', death: 'release' } },
    },
    child: {
      component: true,
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

Deno.test('archetype: non-opt-in schema adapters can reinstall over a legacy spine', () => {
  let d = mem()
  d.query(OLD_SPINE)
  for (let s of schema(loadVocab([domain]))) d.query(s)
  assertEquals(columns(d, 'entity'), ['id', 'eid', 'num'])
  let s = storage(d, vocab)
  s.install()
  assert(indexes(d, 'entity').includes('entity_archetype'))
})

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
  assertEquals(tally(driver, 'archetype', by({ tables: '["doc"]' })), 1)
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
  assertEquals(tally(driver, 'archetype'), 0)
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

Deno.test('archetype: the journal sees a descriptor creation, once', () => {
  let v = loadVocab([archetypeDoc, domain])
  let d = mem()
  let s = storage(d, v)
  s.install()
  for (let s of ddl()) d.query(s)
  let j = log({ rows: (s) => d.query(s) })
  let g = graph({ storage: s, vocab: v, plugins: [journal(j), archetypes()] })
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals(tally(d, 'entity', by({ archetype: null })), 0)
  let descriptors = () =>
    tally(d, 'journal_change', by({ component: 'archetype' }))
  assert(descriptors() > 0)
  let before = descriptors()
  // A descriptor is minted once: the second batch finds the same archetype and
  // writes nothing new about it.
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals(descriptors(), before)
})

Deno.test('archetype: additive boot, physical hidden table, idempotent backfill, retirement', () => {
  let d = mem()
  d.query(OLD_SPINE)
  d.query(HIDDEN)
  d.query(insert('entity', { id: 1, eid: 'old', num: 1 }))
  d.query(insert('hidden', { entity: 1 }))
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
  let count = tally(d, 'archetype')
  d.query({ t: 'drop', kind: 'table', name: 'hidden' })
  s.install()
  assertEquals(read().entity.archetype, eidOf([]))
  let old = s.tx((tx) => tx.get([eidOf(['hidden'])]))[0]
  assertEquals(old.retired, {})
  assertEquals(old.entity.archetype, eidOf(['archetype', 'retired']))
  assertEquals(old.tombstone, undefined)
  assert(tally(d, 'archetype') >= count)
  assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  assert(indexes(d, 'entity').includes('entity_archetype'))
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
        component: true,
        type: 'object',
        properties: { at: { type: 'string', stamped: true } },
      },
      updated: {
        component: true,
        type: 'object',
        properties: { at: { type: 'string', stamped: true } },
      },
    },
  }])
  let updates = 0
  let d = spy(mem(), (sql, params) => {
    if (
      sql.startsWith('update "entity" set "archetype"') && params.at(-1) == 'a'
    ) updates++
  })
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
  driver.query(HIDDEN)
  store.tx((tx) => tx.patch([{ entity: { eid: 'old' }, task: {} }]))
  driver.query(insert('hidden', { entity: idOf(driver, 'old') }))
  store.install()
  g.apply([{ entity: { eid: 'old' }, $delete: true }])
  assertEquals(get('old').entity.archetype, eidOf(['tombstone']))
  assertEquals(tally(driver, 'hidden'), 0)
  assertEquals(backfill(driver), { entities: 0, archetypes: 0, retired: 0 })
})

Deno.test('archetype: boot respects number exclusions and the persistent high-water mark', () => {
  for (let numbered of [true, false]) {
    let d = mem()
    let s = storage(d, vocab, {
      number: { except: numbered ? ['task'] : ['archetype'] },
    })
    // A file an older install wrote, holding an owner nothing classified.
    for (let stmt of s.ddl()) d.query(stmt)
    s.tx((tx) => tx.patch([{ entity: { eid: 'owner' }, doc: {} }]))
    let num = (n: number | null) =>
      d.query({
        t: 'update',
        table: 'entity',
        set: { num: val(n) },
        where: by({ eid: 'owner' }),
      })
    num(99)
    num(null)
    s.install()
    let numbers = d.query(select({
      cols: [col('num', 'entity')],
      from: table('entity'),
      joins: [
        join(
          table('archetype', 'a'),
          eq(col('entity', 'a'), col('id', 'entity')),
        ),
      ],
    }))
    assert(numbers.length > 0)
    assert(numbers.every((r) => numbered ? Number(r.num) > 99 : r.num == null))
    assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  }
})

Deno.test('physical archetype discovery never inspects provider-owned SQLite tables', () => {
  let base = mem()
  base.query(raised('_cf_KV', key, { name: 'value', type: 'text' }))
  base.query(raised('__cf_METADATA', key))
  base.query(raised('ordinary', key))
  let d = spy(base, (sql) => {
    if (/pragma.*table_info.*_cf_/i.test(sql)) {
      throw new Error('provider table access prohibited')
    }
  })
  assertEquals(componentTables(d), ['ordinary'])
})

Deno.test('one-archetype paged reads use the compound ordering index', async () => {
  let d = mem()
  let s = storage(d, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  await g.apply([{ entity: { eid: 'one' }, doc: { title: 'One' } }])
  let [{ archetype }] = scan(d, 'entity', by({ eid: 'one' }), ['archetype'])
  let plan = d.query({
    t: 'explain query plan',
    of: select({
      cols: [col('eid')],
      from: table('entity'),
      where: among(col('archetype'), [val(Number(archetype))]),
      order: [desc(col('num'))],
      limit: lit(25),
    }),
  }).map((r) => String(r.detail)).join('\n')
  assert(plan.includes('entity_archetype_num'), plan)
  assert(!plan.includes('TEMP B-TREE'), plan)
  // Installing into an existing tracked database adds the ordering index too.
  d.query({ t: 'drop', kind: 'index', name: 'entity_archetype_num' })
  s.install()
  assert(indexes(d, 'entity').includes('entity_archetype_num'))
})

Deno.test('archetype: reclassify classifies rows written past the graph, no triggers', () => {
  let { driver, g, get } = setup()
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  assertEquals(get('a').entity.archetype, eidOf(['doc']))
  let id = idOf(driver, 'a')
  driver.query(insert('task', { entity: id }))
  assertEquals(get('a').entity.archetype, eidOf(['doc']))
  let echoes = reclassify(driver, ['a'])
  assertEquals(echoes.at(-1), {
    entity: { eid: 'a', archetype: eidOf(['doc', 'task']) },
  })
  assertEquals(echoes[0].archetype, { tables: '["doc","task"]' })
  assertEquals(get('a').entity.archetype, eidOf(['doc', 'task']))
  assertEquals(reclassify(driver, ['a']), [])
  driver.query({ t: 'delete', from: 'doc', where: by({ entity: id }) })
  let moved = reclassify(driver, ['a', 'a', 'nobody'])
  assertEquals(moved.length, 2) // The {task} descriptor is born here.
  assertEquals(moved[1], { entity: { eid: 'a', archetype: eidOf(['task']) } })
  assertEquals(reclassify(driver, [eidOf(['task']), eidOf(['archetype'])]), [])
  assertEquals(get(eidOf(['task'])).entity.archetype, eidOf(['archetype']))
  // A table raised after the first call is seen: the facet list follows the
  // schema version, not the first look.
  driver.query(HIDDEN)
  driver.query(insert('hidden', { entity: id }))
  assertEquals(get('a').entity.archetype, eidOf(['task']))
  reclassify(driver, ['a'])
  assertEquals(get('a').entity.archetype, eidOf(['hidden', 'task']))
  assertEquals(backfill(driver), { entities: 0, archetypes: 0, retired: 0 })
})

Deno.test('archetype: drift finds the pointer a raw writer left behind', () => {
  let { driver, g } = setup()
  g.apply([
    { entity: { eid: 'a' }, doc: { title: 'A' } },
    { entity: { eid: 'b' }, doc: {}, task: {} },
  ])
  assertEquals(drift(driver), { checked: 2, drifted: 0, sample: [] })
  // The forgetful raw writer: rows in, no eids named, no reclassify.
  driver.query(insert('task', { entity: idOf(driver, 'a') }))
  assertEquals(drift(driver), { checked: 2, drifted: 1, sample: ['a'] })
  assertEquals(drift(driver, 0).sample, []) // a bound on the sample, not the count
  reclassify(driver, ['a']) // an audit reports; only a writer repairs
  assertEquals(drift(driver), { checked: 2, drifted: 0, sample: [] })
})
