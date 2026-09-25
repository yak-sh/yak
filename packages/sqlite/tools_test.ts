// The checks over the file itself: a key nothing enforced, and a pointer a raw
// writer left behind.

import { assert, assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import type { Driver } from '@yaks/sql'
import { mem } from './testing.ts'
import { storage } from './mod.ts'
import { runs } from './tools.ts'

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
  return { sql, g }
}

let checkup = async (
  name: 'storage_check' | 'archetype_check',
  sql: Driver,
) => {
  let [said] = await runs({ sql })[name](
    { entity: { eid: 'c1' }, call: { args: {} } },
    {} as Graph,
  ) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.error as Comp | undefined)?.code,
  }
}

Deno.test('a file the store wrote is nothing to report', async () => {
  let { sql, g } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  assertEquals((await checkup('storage_check', sql)).level, undefined)
  assertEquals((await checkup('archetype_check', sql)).level, undefined)
})

Deno.test('a component row written with the key off is a fail', async () => {
  let { sql, g } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  // The way the impossible gets in: a writer that opened the file with
  // enforcement off and left a row whose spine is not there.
  sql.exec('pragma foreign_keys = off')
  sql.exec('insert into "doc" (entity, title) values (99999, \'ghost\')')
  sql.exec('pragma foreign_keys = on')
  let said = await checkup('storage_check', sql)
  assertEquals(said.level, 'fail')
  assert(said.body.includes('doc → entity'), said.body)
  assert(said.body.includes('point at an entity that is not there'), said.body)
})

Deno.test('a connection with the key off says so before anything else', async () => {
  let { sql, g } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  sql.exec('pragma foreign_keys = off')
  let said = await checkup('storage_check', sql)
  assertEquals(said.level, 'warn')
  assert(said.body.includes('`foreign_keys` off'), said.body)
})

Deno.test('a row landed past the graph drifts its pointer', async () => {
  let { sql, g } = file()
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  // A raw writer: the entity wears `task` now, and nothing reclassified it.
  sql.exec(
    'insert into "task" (entity) select id from entity where eid = \'a\'',
  )
  let said = await checkup('archetype_check', sql)
  assertEquals(said.level, 'fail')
  assert(said.body.includes('disagree with the'), said.body)
  assert(said.body.includes('in: a'), said.body)
})

Deno.test('a file that keeps no archetypes says so rather than passing', async () => {
  let { sql, g } = file(false)
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }])
  let said = await checkup('archetype_check', sql)
  assertEquals(said.level, 'warn')
  assert(said.body.includes('keeps no archetypes'), said.body)
})
