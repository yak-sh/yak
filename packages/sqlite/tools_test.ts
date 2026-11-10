// The checks over the file itself: a key nothing enforced, and a pointer a raw
// writer left behind.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { by, col, type Driver, insert, select, table } from '@yaks/sql'
import { mem } from './testing.ts'
import { drift, storage } from './mod.ts'
import { runs } from './tools.ts'
import { checks } from './check.ts'

let keys = (sql: Driver, value: 'on' | 'off') =>
  sql.query({ t: 'pragma', name: 'foreign_keys', value })

let domain = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    task: { component: true, type: 'object', properties: {} },
  },
}

// A file with the archetype plugin on it, and one without — the second is a
// host that never composed @yaks/archetype.
let file = (classified = true) => {
  let vocab = loadVocab(classified ? [archetypeDoc, domain] : [domain])
  let sql = mem()
  let store = storage(sql, vocab)
  store.install()
  let g = graph({
    storage: store,
    vocab,
    plugins: classified ? [archetypes()] : [],
  })
  return { sql, store, g, host: { storage: { checks: checks(sql) } } }
}

let checkup = async (
  name: 'storage_check' | 'archetype_check',
  host: Parameters<typeof runs>[0],
) => {
  let [said] = await runs(host)[name](
    { entity: { eid: 'c1' }, call: { args: {} } },
    {} as Graph,
  ) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.finding as Comp | undefined)?.level,
  }
}

test('a file the store wrote is nothing to report', async () => {
  let { g, host } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  assertEquals((await checkup('storage_check', host)).level, undefined)
  assertEquals((await checkup('archetype_check', host)).level, undefined)
})

test('a component row written with the key off is a fail', async () => {
  let { sql, g, host } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  // The way the impossible gets in: a writer that opened the file with
  // enforcement off and left a row whose spine is not there.
  keys(sql, 'off')
  sql.query(insert('doc', { entity: 99999, title: 'ghost' }))
  keys(sql, 'on')
  let said = await checkup('storage_check', host)
  assertEquals(said.level, 'fail')
  assert(said.body.includes('doc → entity'), said.body)
  assert(said.body.includes('point at an entity that is not there'), said.body)
})

test('a connection with the key off says so before anything else', async () => {
  let { sql, g, host } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  keys(sql, 'off')
  let said = await checkup('storage_check', host)
  assertEquals(said.level, 'warn')
  assert(said.body.includes('`foreign_keys` off'), said.body)
})

test('a row landed past the graph drifts its pointer', async () => {
  let { sql, store, g, host } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  // A raw writer: the entity wears `task` now, and nothing reclassified it.
  store.raise(['task'])
  sql.query({
    t: 'insert',
    into: 'task',
    cols: ['entity'],
    q: select({
      cols: [col('id')],
      from: table('entity'),
      where: by({ eid: 'a' }),
    }),
  })
  let said = await checkup('archetype_check', host)
  assertEquals(said.level, 'fail')
  assert(said.body.includes('disagree with the'), said.body)
  assert(said.body.includes('in: a'), said.body)
})

test('a store whose vocabulary declares no archetypes keeps its pointers all the same', async () => {
  let { g, sql, host } = file(false)
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  await g.apply([{ entity: { eid: 'a' }, doc: null }])
  await g.apply([{ entity: { eid: 'b' }, doc: { title: 'B' } }])
  await g.apply([{ entity: { eid: 'b' }, $delete: true }])
  assertEquals((await checkup('archetype_check', host)).level, undefined)
  assertEquals(drift(sql), { checked: 2, drifted: 0, sample: [] })
})

test('a store whose vocabulary declares no archetypes shows none: the pointer it keeps is its own', async () => {
  // The kernel's word for the pointer, in a vocabulary with no archetypes.
  let { entity, ...rest } = domain.$defs
  let pointer = { type: 'string', ref: 'archetype', stamped: true }
  let pointed = {
    $defs: {
      ...rest,
      entity: {
        ...entity,
        properties: { ...entity.properties, archetype: pointer },
      },
    },
  }
  let vocab = loadVocab([pointed])
  let store = storage(mem(), vocab)
  store.install()
  let g = graph({ storage: store, vocab })
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  let shown = (rows: Bundle[]) => rows.map((b) => b.entity.archetype ?? null)
  assertEquals(shown(await g.get(['a'])), [null])
  assertEquals(shown(await g.read('.doc&.fields=entity.archetype')), [null])
  assertEquals(await g.read('.entity.archetype'), [])
  assertEquals((await g.read('!entity.archetype')).length, 1)
})

test('an entity met with no archetype is reported once and classified from the rows it holds', async () => {
  let vocab = loadVocab([archetypeDoc, domain])
  let sql = mem()
  let said: Error[] = []
  let store = storage(sql, vocab, { report: (e) => void said.push(e) })
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  // A raw writer: an entity and a row of it, and no pointer.
  sql.query(insert('entity', { eid: 'raw' }))
  sql.query({
    t: 'insert',
    into: 'doc',
    cols: ['entity', 'title'],
    q: select({
      cols: [col('id'), { t: 'lit', v: 'Raw' }],
      from: table('entity'),
      where: by({ eid: 'raw' }),
    }),
  })
  let read = async () => (await g.get(['raw']))[0]?.doc
  assertEquals(await read(), { title: 'Raw' })
  assertEquals(await read(), { title: 'Raw' })
  assertEquals(said.map((e) => e.name), ['Unpointed'])
  assertEquals(drift(sql).drifted, 0)
})

test('storage without diagnostics warns rather than assuming SQLite', async () => {
  let host = { storage: {} }
  for (let name of ['storage_check', 'archetype_check'] as const) {
    let said = await checkup(name, host)
    assertEquals(said.level, 'warn')
    assert(said.body.includes('diagnostics'), said.body)
    assert(said.body.includes('unavailable'), said.body)
  }
})
