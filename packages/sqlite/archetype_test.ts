import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { after } from '@yaks/fp'
import { type Bundle, detached, graph, type Plugin, token } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { record } from '@yaks/trace'
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
  type Stmt,
  table,
  tally,
  val,
} from '@yaks/sql'
import {
  backfill,
  columns,
  componentTables,
  drift,
  ledger,
  reclassify,
  schema,
  storage,
} from './mod.ts'
import { mem, seedIdentities, spy } from './testing.ts'

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
  let get = async (eid: string) => (await store.tx((tx) => tx.get([eid])))[0]
  return { driver, store, g, get }
}

test('archetype: non-opt-in schema adapters can reinstall over a legacy spine', () => {
  let d = mem()
  d.query(OLD_SPINE)
  for (let s of schema(loadVocab([domain]))) d.query(s)
  assertEquals(columns(d, 'entity'), ['id', 'eid', 'num'])
  let s = storage(d, vocab)
  s.install()
  assert(indexes(d, 'entity').includes('entity_archetype'))
})

test('archetype: two writers, create, value-only, add/remove, same-batch net move', async () => {
  let { g, store, driver, get } = setup()
  let a = g.apply([{
    entity: { eid: 'a', archetype: 'forged' },
    doc: { title: 'A' },
  }]) as Bundle[]
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
  assertEquals(
    a.find((b) => b.entity.eid == 'a')!.entity.archetype,
    eidOf(['doc']),
  )
  let other = graph({ storage: store, vocab, plugins: [archetypes()] })
  other.apply([{ entity: { eid: 'b' }, doc: {} }])
  assertEquals(
    (await get('b')).entity.archetype,
    (await get('a')).entity.archetype,
  )
  assertEquals(tally(driver, 'archetype', by({ tables: '["doc"]' })), 1)
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'B' } }])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc', 'task']))
  g.apply([{ entity: { eid: 'a' }, doc: null }])
  assertEquals((await get('a')).entity.archetype, eidOf(['task']))
  g.apply([{ entity: { eid: 'a' }, doc: {} }, {
    entity: { eid: 'a' },
    doc: null,
  }])
  assertEquals((await get('a')).entity.archetype, eidOf(['task']))
  assertEquals(
    (await get(eidOf(['archetype']))).entity.archetype,
    eidOf(['archetype']),
  )
})

test('archetype: reference-only births, release/cascade and tombstones', async () => {
  let { g, get } = setup()
  // A generated eid is an identity even before it has a component; a word
  // would have to name a live target instead of bringing this stub into being.
  let bare = '00000000-0000-4000-8000-000000000001'
  g.apply([
    { entity: { eid: 'ref' }, link: { to: bare } },
    { entity: { eid: 'child' }, child: { of: bare } },
  ])
  assertEquals((await get(bare)).entity.archetype, eidOf([]))
  g.apply([{ entity: { eid: bare }, $delete: true }])
  assertEquals((await get(bare)).entity.archetype, eidOf(['tombstone']))
  assertEquals((await get('child')).entity.archetype, eidOf(['tombstone']))
  assertEquals((await get('ref')).entity.archetype, eidOf([]))
  assertEquals((await get('ref')).link, undefined)
})

test('identity reads see pending component changes before classification', async () => {
  for (let count of [3, 40]) {
    let { g, store } = setup()
    let stable = Array.from({ length: count }, (_, i) => `stable${i}`)
    g.apply([
      ...stable.map((eid) => ({ entity: { eid }, doc: { title: eid } })),
      { entity: { eid: 'changed' }, doc: { title: 'before' } },
      { entity: { eid: 'emptied' }, task: {} },
    ])
    await store.tx(async (tx) => {
      tx.patch([
        { entity: { eid: 'changed' }, doc: null, task: {} },
        { entity: { eid: 'emptied' }, task: null },
      ])
      assertEquals((tx.read('.task') as Bundle[]).map((b) => b.entity.eid), [
        'changed',
      ])
      assertEquals((tx.read('.task') as Bundle[]).map((b) => b.entity.eid), [
        'changed',
      ])
      tx.patch([{
        entity: { eid: 'changed' },
        task: null,
        doc: { title: 'after' },
      }])
      assertEquals(tx.read('.task'), [])
      assertEquals(
        (tx.read('.doc') as Bundle[]).find((b) => b.entity.eid == 'changed')
          ?.doc,
        { title: 'after' },
      )
      tx.patch([
        { entity: { eid: 'changed' }, doc: null, task: {} },
        { entity: { eid: 'new' }, doc: { title: 'new' } },
      ])
      let ids = ['new', ...stable, 'changed', 'emptied', 'missing', 'changed']
      let read = (names?: string[]) => tx.get(ids, names) as Bundle[]
      assertEquals((await read()).map((b) => [b.entity.eid, b.doc, b.task]), [
        ['new', { title: 'new' }, undefined],
        ...stable.map((eid) => [eid, { title: eid }, undefined]),
        ['changed', undefined, {}],
        ['emptied', undefined, undefined],
        ['changed', undefined, {}],
      ])
      assertEquals(
        (await read(['task'])).map((b) => [b.entity.eid, b.doc, b.task]),
        [
          ...['new', ...stable].map((eid) => [eid, undefined, undefined]),
          ['changed', undefined, {}],
          ['emptied', undefined, undefined],
          ['changed', undefined, {}],
        ],
      )
      tx.remove([{ eid: 'changed' }])
      assert((tx.get(['changed']) as Bundle[])[0].tombstone)
      tx.revive(['changed'])
      tx.patch([{ entity: { eid: 'changed' }, doc: { title: 'back' } }])
      assertEquals((tx.get(['changed']) as Bundle[])[0].doc, { title: 'back' })
    })
  }
})

test('a numbered store keeps its archetype read index without declaring archetypes', () => {
  let words = loadVocab([domain, {
    $defs: {
      entity: {
        component: true,
        type: 'object',
        properties: { num: { type: 'number' } },
      },
    },
  }])
  let s = storage(mem(), words)
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'plain' }, doc: {} },
      { entity: { eid: 'task' }, doc: {}, task: {} },
    ])
  )
  assertEquals(s.read('.doc !task').map((b) => b.entity.eid), ['plain'])
})

test('classification begins the next presence comparison in a ledger', () => {
  let l = ledger(mem())
  l.moved('a', 'doc', false)
  assertEquals(l.owed(), ['a'])
  l.pointed('a')
  assertEquals(l.owed(), [])
  assertEquals(l.owed(), [])
  l.moved('a', 'doc', true)
  assertEquals(l.owed(), ['a'])
  l.pointed('a')
  l.moved('a', 'doc', false)
  l.moved('a', 'doc', true)
  assertEquals(l.owed(), [])
})

test('a birth minted in its learned class keeps its pointer in cached reads', () => {
  let s = storage(mem(), vocab)
  s.install()
  for (let eid of ['first', 'second', 'third']) {
    s.tx((tx) => tx.patch([{ entity: { eid }, doc: { title: eid } }]))
    assertEquals(s.get([eid])[0].entity.archetype, eidOf(['doc']))
  }
})

test("an outer storage read uses the open writer's pending archetypes", () => {
  let driver = mem(), reports: Error[] = []
  let s = storage(driver, vocab, { report: (e) => void reports.push(e) })
  s.install()
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'new' }, doc: { title: 'pending' } }])
    assertEquals(s.read('.doc').map((b) => b.entity.eid), ['new'])
    assertEquals(s.read('.doc', { eids: ['new'] }).map((b) => b.entity.eid), [
      'new',
    ])
    assertEquals(
      (tx.read('.doc', { eids: ['new'] }) as Bundle[]).map((b) => b.entity.eid),
      ['new'],
    )
    assertEquals(s.rows('.doc').map((b) => b.eid), ['new'])
    assertEquals(s.rows('.doc&.count').map((b) => b.n), [1])
    assertEquals(driver.query(s.screen('.doc')!).length, 1)
    tx.patch([{ entity: { eid: 'new' }, doc: null, task: {} }])
    assertEquals(s.read('.doc'), [])
    assertEquals(s.read('.task').map((b) => b.entity.eid), ['new'])
    assertEquals(s.rows('.doc&.count').map((b) => b.n), [0])
    assertEquals(reports, [])
    assertEquals(ledger(driver).owed(), ['new'])
  })
  assertEquals(s.get(['new'])[0].entity.archetype, eidOf(['task']))
})

test('a ledger says what an entity holds from its pointer and the rows since', () => {
  let l = ledger(mem())
  assertEquals(l.held('a', ['doc']), ['doc'])
  assertEquals(l.held('a', null), undefined)
  l.moved('a', 'task', true)
  l.moved('a', 'doc', false)
  assertEquals(l.held('a', ['doc', 'note']), ['note', 'task'])
  assertEquals(l.held('a', null), undefined)
  // A birth holds what it was given, whatever class it was minted in.
  l.born('b')
  l.moved('b', 'doc', true)
  assertEquals(l.held('b', ['doc', 'task']), ['doc'])
  assertEquals(l.held('b', null), ['doc'])
  // The removed hold their tombstone, and what a revival gives them after.
  l.removed('a')
  assertEquals([l.held('a', ['doc']), l.buried(), l.owed()], [
    ['tombstone'],
    ['a'],
    ['b'],
  ])
  l.moved('a', 'tombstone', false)
  l.moved('a', 'note', true)
  assertEquals([l.held('a', ['doc']), l.buried()], [['note'], []])
})

test('a ledger takes back what a rolled back savepoint heard', () => {
  let sql = mem()
  let l = ledger(sql)
  let point = (t: 'savepoint' | 'release' | 'rollback', name: string) =>
    sql.query(t == 'rollback' ? { t, to: name } : { t, name })
  point('savepoint', 'outer')
  l.moved('a', 'doc', true)
  point('savepoint', 'inner')
  l.moved('a', 'task', true)
  l.pointed('a')
  l.born('b')
  assertEquals([l.owed(), l.held('a', ['doc', 'task'])], [['b'], [
    'doc',
    'task',
  ]])
  point('rollback', 'inner')
  point('release', 'inner')
  assertEquals([l.owed(), l.held('a', []), l.wrote('b')], [['a'], [
    'doc',
  ], false])
  point('release', 'outer')
  assertEquals([l.owed(), l.wrote('a')], [[], false])
})

test('archetype: a removal past the graph leaves its archetype, and its tombstone still swallows a racing write', async () => {
  let { g, store, driver, get } = setup()
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' }, task: {} }])
  await store.tx((tx) => tx.remove([{ eid: 'a' }]))
  assertEquals((await get('a')).entity.archetype, eidOf(['tombstone']))
  assertEquals(drift(driver).drifted, 0)
  g.apply([{
    entity: { eid: 'a' },
    doc: { title: 'B' },
    $was: { doc: { title: token('A') } },
  }])
  assert((await get('a')).tombstone)
  assertEquals((await get('a')).entity.archetype, eidOf(['tombstone']))
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'C' } }])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
})

test('archetype: a write past the graph keeps its pointer in step, by every door', async () => {
  // An effect hook writes through the detached transaction, as an audit row,
  // a lease reaped at boot or an effect's own write does.
  let { g, store, driver, get } = setup([{
    name: 'echo',
    hooks: {
      effect: (b, tx) =>
        b.some((x) => x.entity.eid == 'a' && x.doc)
          ? after(tx.patch([{ entity: { eid: 'a' }, task: {} }]), () => b)
          : b,
    },
  }])
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc', 'task']))
  await store.tx((tx) => tx.patch([{ entity: { eid: 'a' }, task: null }]))
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
  detached(store).patch([{ entity: { eid: 'b' }, link: { to: 'c' } }])
  assertEquals((await get('b')).entity.archetype, eidOf(['link']))
  assertEquals((await get('c')).entity.archetype, eidOf([]))
  await store.tx((tx) => tx.remove([{ eid: 'b' }]))
  await store.tx((tx) => tx.revive(['b']))
  assertEquals((await get('b')).entity.archetype, eidOf([]))
  // ... and in one unit, the dead brought back and given a row.
  await store.tx((tx) => {
    tx.remove([{ eid: 'b' }])
    tx.revive(['b'])
    tx.patch([{ entity: { eid: 'b' }, task: {} }])
  })
  assertEquals((await get('b')).entity.archetype, eidOf(['task']))
  // An inner unit's writes are not in its parent's birth ledger.
  await store.tx(async (tx) => {
    tx.patch([{ entity: { eid: 'nested' }, doc: {} }])
    await store.tx((inner) =>
      inner.patch([{ entity: { eid: 'nested' }, task: {} }])
    )
  })
  assertEquals((await get('nested')).entity.archetype, eidOf(['doc', 'task']))
  await store.tx(async (tx) => {
    tx.patch([{ entity: { eid: 'rolled' }, doc: {} }])
    await assertRejects(async () => (await store.tx((inner) => {
      inner.patch([{ entity: { eid: 'rolled' }, task: {} }])
      throw new Error('rollback')
    })))
  })
  assertEquals((await get('rolled')).entity.archetype, eidOf(['doc']))
  assertEquals(drift(driver), { checked: 5, drifted: 0, sample: [] })
})

test('archetype: dry run and late rollback cannot poison cached sets', async () => {
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
  assertEquals(await get('a'), undefined)
  assertEquals(tally(driver, 'archetype'), 0)
  fail = true
  assertThrows(() => g.apply([{ entity: { eid: 'a' }, task: {} }]))
  fail = false
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  assertEquals((await get('a')).entity.archetype, eidOf(['task']))
  assert((await get(eidOf(['task']))).archetype)
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

// A descriptor is derived storage state (`journal: false`, 4936d5746): the
// journal keeps the batch that minted it and nothing of the descriptor. The
// batch is applied as the file loads; the case reads what landed.
let journaled = (() => {
  let v = loadVocab([archetypeDoc, domain])
  let d = mem()
  let s = storage(d, v)
  s.install()
  for (let s of ddl()) d.query(s)
  let j = log({ rows: (s) => d.query(s) })
  let g = graph({
    storage: s,
    vocab: v,
    plugins: [journal(j, v), archetypes()],
  })
  g.apply([{ entity: { eid: 'a' }, task: {} }])
  return d
})()
test('archetype: the journal keeps a batch and none of its descriptor', () => {
  let d = journaled
  assertEquals(tally(d, 'entity', by({ archetype: null })), 0)
  assert(tally(d, 'journal_change', by({ component: 'task' })) > 0)
  assertEquals(tally(d, 'journal_change', by({ component: 'archetype' })), 0)
})

test('archetype: traced flushes cover classification around commit hooks', async () => {
  let tasks = (rows: Bundle[]) => rows.map((b) => b.entity.eid).sort()
  let { g, driver, get } = setup([{
    name: 'late writes',
    hooks: {
      journal: async (bundles, tx) => {
        assertEquals(tasks(await tx.read(parse('.task')) as Bundle[]), ['a'])
        return bundles
      },
      commit: async (bundles, tx) => {
        assertEquals(tasks(await tx.read(parse('.task')) as Bundle[]), ['a'])
        let late = [
          { entity: { eid: 'a' }, task: null, doc: { title: 'After commit' } },
          { entity: { eid: 'late' }, task: {} },
        ]
        await tx.patch(late)
        return [...bundles, ...late]
      },
    },
  }])
  let captured = await record(
    g,
    () => g.apply([{ entity: { eid: 'a' }, task: {} }]),
  )
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
  assertEquals((await get('late')).entity.archetype, eidOf(['task']))
  assertEquals(tasks(await g.read('.task') as Bundle[]), ['late'])
  assertEquals(drift(driver).drifted, 0)
  // Pointer writes from both drains must belong to named flush phases,
  // including writes after an asynchronous commit hook.
  let byId = new Map(captured.spans.map((s) => [s.id, s]))
  let writes = captured.spans.filter((s) =>
    s.kind == 'sql' && s.name == 'entity update'
  )
  assert(writes.length > 0)
  let drains = new Set<string>()
  for (let write of writes) {
    let parent = byId.get(write.parent!)
    while (parent && parent.kind != 'phase') parent = byId.get(parent.parent!)
    assertEquals(parent?.name, 'flush')
    drains.add(parent!.id)
  }
  assertEquals(drains.size, 2)
})

test('archetype: additive boot, physical hidden table, idempotent backfill, retirement', async () => {
  let d = mem()
  d.query(OLD_SPINE)
  d.query(HIDDEN)
  d.query(insert('entity', { id: 1, eid: 'old', num: 1 }))
  d.query(insert('hidden', { entity: 1 }))
  let s = storage(d, vocab)
  s.install()
  let read = async () => (await s.tx((tx) => tx.get(['old'])))[0]
  assertEquals((await read()).entity.archetype, eidOf(['hidden']))
  assert(componentTables(d).includes('hidden'))
  assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'old' }, doc: {} }])
  assertEquals((await read()).entity.archetype, eidOf(['hidden', 'doc']))
  g.apply([{ entity: { eid: 'old' }, doc: null }])
  assertEquals((await read()).entity.archetype, eidOf(['hidden']))
  let count = tally(d, 'archetype')
  d.query({ t: 'drop', kind: 'table', name: 'hidden' })
  s.install()
  assertEquals((await read()).entity.archetype, eidOf([]))
  let old = (await s.tx((tx) => tx.get([eidOf(['hidden'])])))[0]
  assertEquals(old.retired, {})
  assertEquals(old.entity.archetype, eidOf(['archetype', 'retired']))
  assertEquals(old.tombstone, undefined)
  assert(tally(d, 'archetype') >= count)
  assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  assert(indexes(d, 'entity').includes('entity_archetype'))
})

test('archetype: a table rekeyed away from entity leaves every set that named it', async () => {
  let d = mem()
  d.query(OLD_SPINE)
  d.query(HIDDEN)
  d.query(insert('entity', { id: 1, eid: 'old', num: 1 }))
  d.query(insert('hidden', { entity: 1 }))
  let s = storage(d, vocab)
  s.install()
  let read = async () => (await s.tx((tx) => tx.get(['old'])))[0]
  assertEquals((await read()).entity.archetype, eidOf(['hidden']))
  d.query({
    t: 'alter table',
    table: 'hidden',
    rename: { column: 'entity', to: 'owner' },
  })
  assertEquals(backfill(d).retired, 1)
  assertEquals((await read()).entity.archetype, eidOf([]))
  assertEquals(drift(d).drifted, 0)
  // A later boot does not look for the retired set's owners again.
  let repointed: string[] = []
  backfill(spy(d, (sql) => {
    if (/^update "entity" set "archetype"/.test(sql)) repointed.push(sql)
  }))
  assertEquals(repointed, [])
})

test('archetype: pre-existing reference stub can become a descriptor', async () => {
  let { g, get } = setup()
  g.apply([
    { entity: { eid: 'ref' }, link: { to: eidOf(['task']) } },
    { entity: { eid: 'task' }, task: {} },
  ])
  let descriptor = await get(eidOf(['task']))
  assertEquals(descriptor.archetype, { tables: '["task"]' })
  assertEquals(descriptor.entity.archetype, eidOf(['archetype']))
})

test('archetype: explicit content aliases canonicalize the stored list', async () => {
  let { g, get } = setup()
  g.apply([{
    entity: { eid: '$set' },
    archetype: { tables: '["task","doc","task"]' },
  }])
  assertEquals((await get(eidOf(['doc', 'task']))).archetype, {
    tables: '["doc","task"]',
  })
})

test('archetype: stamps join the final set and value-only writes do not assign again', async () => {
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
  // Whom each pointer write named: an eid, or an integer id.
  let pointed: unknown[] = []
  let d = spy(mem(), (sql, params) => {
    if (sql.startsWith('update "entity" set "archetype"')) {
      pointed.push(params.at(-1))
    }
  })
  let s = storage(d, v)
  s.install()
  // What it counts is pointer writes, not a first write's tables (./raise.ts).
  s.raise()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  seedIdentities(g, 'b')
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' }, task: {} }])
  let [{ id }] = d.query(select({
    cols: [col('id')],
    from: table('entity'),
    where: eq(col('eid'), val('a')),
  }))
  let updates = () => pointed.filter((p) => p == 'a' || p == id).length
  assertEquals(
    (await s.tx((tx) => tx.get(['a'])))[0].entity.archetype,
    eidOf(['doc', 'task', 'created']),
  )
  assertEquals(updates(), 1)
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'B' } }])
  assertEquals(updates(), 2) // First later touch adds updated.
  assertEquals(
    (await s.tx((tx) => tx.get(['a'])))[0].entity.archetype,
    eidOf(['doc', 'task', 'created', 'updated']),
  )
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'C' } }])
  assertEquals(updates(), 2)
  g.apply([{ entity: { eid: 'a' }, task: null, link: { to: 'b' } }])
  assertEquals(updates(), 3)
  // A birth in a shape seen finishing is minted in the class it finished in,
  // and one finishing elsewhere is pointed where it did.
  let born = async (eid: string, opts = {}) => {
    let was = pointed.length
    g.apply([{ entity: { eid }, doc: { title: eid }, task: {} }], opts)
    return [
      (await s.tx((tx) => tx.get([eid])))[0].entity.archetype,
      pointed.length - was,
    ]
  }
  let stamped = eidOf(['doc', 'task', 'created'])
  assertEquals(await born('c'), [stamped, 0])
  let unstamped = await born('d', { stamp: false, trusted: true })
  assertEquals(unstamped, [eidOf(['doc', 'task']), 1])
  assertEquals(await born('e'), [stamped, 1])
  assertEquals(await born('f'), [stamped, 0])
})

test('archetype: backfill classifies a future descriptor stub in either order', async () => {
  for (let first of [true, false]) {
    let d = mem()
    let s = storage(d, vocab)
    s.install()
    let rows: Bundle[] = [
      { entity: { eid: eidOf(['task']) } },
      { entity: { eid: 'owner' }, task: {} },
    ]
    await s.tx((tx) => tx.patch(first ? rows : rows.reverse()))
    backfill(d)
    assertEquals(
      (await s.tx((tx) => tx.get([eidOf(['task'])])))[0].entity.archetype,
      eidOf(['archetype']),
    )
    assertEquals(backfill(d), { entities: 0, archetypes: 0, retired: 0 })
  }
})

test('archetype: deletion removes physical facets outside the writer vocabulary', async () => {
  let { driver, store, g, get } = setup()
  driver.query(HIDDEN)
  await store.tx((tx) => tx.patch([{ entity: { eid: 'old' }, task: {} }]))
  // A raw writer names the owners it wrote, as every writer must.
  driver.query(insert('hidden', { entity: idOf(driver, 'old') }))
  reclassify(driver, ['old'])
  store.install()
  g.apply([{ entity: { eid: 'old' }, $delete: true }])
  assertEquals((await get('old')).entity.archetype, eidOf(['tombstone']))
  assertEquals(tally(driver, 'hidden'), 0)
  assertEquals(backfill(driver), { entities: 0, archetypes: 0, retired: 0 })
})

// The tables holding a row for `eid`, read off the file itself.
let holding = (d: Driver, eid: string) =>
  componentTables(d).filter((t) => tally(d, t, by({ entity: idOf(d, eid) })))

test('archetype: a delete clears every row its entity holds, however its pointer stands', async () => {
  let point = (d: Driver, to: number | null) =>
    d.query({
      t: 'update',
      table: 'entity',
      set: { archetype: val(to) },
      where: eq(col('eid'), val('a')),
    })
  let gone = [{ entity: { eid: 'a' }, $delete: true }]
  let task = [{ entity: { eid: 'a' }, task: {} }]
  let deletes: Record<string, (s: ReturnType<typeof setup>) => unknown> = {
    classified: ({ g }) => g.apply(gone),
    // Rows written in the deleting unit, before any pointer named them.
    unit: async ({ store }) => (await store.tx((tx) => {
      tx.patch(task)
      tx.remove([{ eid: 'a' }])
    })),
    // ... in a unit around the one that deletes.
    nested: async ({ store, g }) => (await store.tx((tx) => {
      tx.patch(task)
      g.apply(gone)
    })),
    // ... by the batch whose cascade deletes it.
    cascade: ({ g }) =>
      g.apply([{ entity: { eid: 'a' }, child: { of: 'p' } }, {
        entity: { eid: 'p' },
        $delete: true,
      }]),
    // A pointer never written, or naming no descriptor.
    unclassified: ({ driver, g }) => (point(driver, null), g.apply(gone)),
    dangling: async ({ driver, store }) => (
      point(driver, idOf(driver, 'p')),
        (await store.tx((tx) => tx.remove([{ eid: 'a' }])))
    ),
  }
  for (let [name, remove] of Object.entries(deletes)) {
    let s = setup()
    s.g.apply([
      { entity: { eid: 'p' }, doc: {} },
      { entity: { eid: 'a' }, doc: { title: 'A' }, link: { to: 'p' } },
    ])
    await remove(s)
    assertEquals([name, holding(s.driver, 'a')], [name, ['tombstone']])
    assertEquals([name, (await s.get('a')).entity.archetype], [
      name,
      eidOf(['tombstone']),
    ])
  }
})

test('archetype: a delete touches only the tables its entities hold', () => {
  let { driver, g } = setup()
  g.apply([
    { entity: { eid: 'a' }, doc: { title: 'A' }, link: { to: 'b' } },
    { entity: { eid: 'b' }, task: {} },
  ])
  let cleared: string[] = []
  let send = driver.query.bind(driver), run = driver.run?.bind(driver)
  let heard = (s: Stmt) => s.t == 'delete' && cleared.push(s.from)
  driver.query = (s) => (heard(s), send(s))
  if (run) driver.run = (s) => (heard(s), run(s))
  g.apply([{ entity: { eid: 'a' }, $delete: true }, {
    entity: { eid: 'b' },
    $delete: true,
  }])
  assertEquals([...new Set(cleared)].sort(), ['doc', 'link', 'task'])
})

// By one count a descriptor is numbered like any other entity, past the
// persistent high-water mark; by series it is never, since no component of
// its declares a letter.
test('archetype: boot numbers descriptors past the persistent high-water mark', () => {
  for (let numbered of [true, false]) {
    let d = mem()
    let s = storage(d, vocab, { number: numbered ? true : { task: 'T' } })
    // A file an older install wrote, holding an owner nothing classified.
    for (let stmt of s.ddl()) d.query(stmt)
    d.query(insert('entity', { eid: 'owner' }))
    d.query(insert('doc', { entity: idOf(d, 'owner') }))
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

test('physical archetype discovery never inspects provider-owned SQLite tables', () => {
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

test('one-archetype paged reads use the compound ordering index', async () => {
  let d = mem()
  let numbered = loadVocab([...vocab.docs, {
    $defs: {
      entity: {
        component: true,
        properties: { num: { type: 'number', stamped: true } },
      },
    },
  }])
  let s = storage(d, numbered)
  s.install()
  let g = graph({ storage: s, vocab: numbered, plugins: [archetypes()] })
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
  assert(!indexes(d, 'entity').includes('entity_archetype'))
})

test('a shape read over a file still owed its ordering index names no index', async () => {
  let d = mem()
  let numbered = loadVocab([...vocab.docs, {
    $defs: {
      entity: {
        component: true,
        properties: { num: { type: 'number', stamped: true } },
      },
    },
  }])
  let s = storage(d, numbered)
  s.install()
  let g = graph({ storage: s, vocab: numbered, plugins: [archetypes()] })
  await g.apply([{ entity: { eid: 'one' }, doc: { title: 'One' } }])
  await g.apply([{ entity: { eid: 'two' }, doc: { title: 'Two' }, task: {} }])
  d.query({ t: 'drop', kind: 'index', name: 'entity_archetype_num' })
  let read = await g.read(parse('.doc !task')) as Bundle[]
  assertEquals(read.map((b) => b.entity.eid), ['one'])
})

test('archetype: reclassify classifies rows written past the graph, no triggers', async () => {
  let { driver, store, g, get } = setup()
  store.raise(['task'])
  g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
  let id = idOf(driver, 'a')
  driver.query(insert('task', { entity: id }))
  assertEquals((await get('a')).entity.archetype, eidOf(['doc']))
  let echoes = reclassify(driver, ['a'])
  assertEquals(echoes.at(-1), {
    entity: { eid: 'a', archetype: eidOf(['doc', 'task']) },
  })
  assertEquals(echoes[0].archetype, { tables: '["doc","task"]' })
  assertEquals((await get('a')).entity.archetype, eidOf(['doc', 'task']))
  assertEquals(reclassify(driver, ['a']), [])
  driver.query({ t: 'delete', from: 'doc', where: by({ entity: id }) })
  let moved = reclassify(driver, ['a', 'a', 'nobody'])
  assertEquals(moved.length, 2) // The {task} descriptor is born here.
  assertEquals(moved[1], { entity: { eid: 'a', archetype: eidOf(['task']) } })
  assertEquals(reclassify(driver, [eidOf(['task']), eidOf(['archetype'])]), [])
  assertEquals(
    (await get(eidOf(['task']))).entity.archetype,
    eidOf(['archetype']),
  )
  // A table raised after the first call is seen: the facet list follows the
  // schema version, not the first look.
  driver.query(HIDDEN)
  driver.query(insert('hidden', { entity: id }))
  assertEquals((await get('a')).entity.archetype, eidOf(['task']))
  reclassify(driver, ['a'])
  assertEquals((await get('a')).entity.archetype, eidOf(['hidden', 'task']))
  assertEquals(backfill(driver), { entities: 0, archetypes: 0, retired: 0 })
})

test('archetype: an app may name a component journal or hit', () => {
  let words = loadVocab([archetypeDoc, {
    $defs: {
      journal: {
        component: true,
        type: 'object',
        properties: { quest: { type: 'string' } },
      },
      hit: { component: true, type: 'object' },
    },
  }])
  let driver = mem()
  let store = storage(driver, words)
  store.install()
  let g = graph({ storage: store, vocab: words, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'q' }, journal: { quest: 'boars' }, hit: {} }])
  assertEquals(reclassify(driver, ['q']), [])
  assertEquals(store.read('.journal .hit').map((b) => b.journal), [
    { quest: 'boars' },
  ])
})

test('archetype: drift finds the pointer a raw writer left behind', () => {
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

test('archetype: patches and deletes discover no unchanged physical schema', async () => {
  let { driver, store: s, g } = setup()
  // A first write's tables move the schema; these writes are later ones.
  s.raise()
  await s.tx((tx) =>
    tx.patch([{ entity: { eid: 'same' }, doc: { title: 'before' } }])
  )
  let query = driver.query, calls = 0
  driver.query = (stmt) => {
    if (
      stmt.t == 'select' && JSON.stringify(stmt.from).includes('sqlite_schema')
    ) calls++
    return query(stmt)
  }
  for (let i = 0; i < 5; i++) {
    await s.tx((tx) =>
      tx.patch([{ entity: { eid: 'same' }, task: i % 2 ? null : {} }])
    )
    // A delete asks the cascade who goes with it.
    g.apply([{ entity: { eid: `gone${i}` }, child: { of: 'same' } }])
    g.apply([{ entity: { eid: `gone${i}` }, $delete: true }])
  }
  assertEquals(calls, 0)
})

test('archetype: physical discovery follows same-length table swaps and rollback', async () => {
  let { driver: d, store, get } = setup()
  await store.tx((tx) =>
    tx.patch([{ entity: { eid: 'a' }, doc: { title: 'a' } }])
  )
  d.query(HIDDEN)
  d.query(insert('hidden', { entity: idOf(d, 'a') }))
  reclassify(d, ['a'])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc', 'hidden']))
  d.query({ t: 'savepoint', name: 'swap' })
  d.query({ t: 'alter table', table: 'hidden', rename: 'secret' })
  reclassify(d, ['a'])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc', 'secret']))
  d.query({ t: 'rollback', to: 'swap' })
  d.query({ t: 'release', name: 'swap' })
  reclassify(d, ['a'])
  assertEquals((await get('a')).entity.archetype, eidOf(['doc', 'hidden']))
})
