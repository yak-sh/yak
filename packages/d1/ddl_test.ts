// D1 is SQLite behind an async binding, so its schema IS @yaks/sqlite's: the
// same statements, constraints included, and a store over the stand-in holds
// what the vocabulary said the way the reference adapter does.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { schema } from '@yaks/sqlite'
import { d1 } from './harness.ts'
import { storage } from './store.ts'

let strict = loadVocab({
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: {},
    },
    repo: {
      component: true,
      type: 'object',
      required: ['base'],
      properties: {
        base: { type: 'string', default: 'main' },
        state: { enum: ['stopped', 'running'] },
        seq: { type: 'integer' },
      },
    },
  },
})

Deno.test('the d1 schema is the sqlite schema, constraints included', async () => {
  let s = storage(d1(), strict)
  assertEquals(s.ddl(), schema(strict))
  assert(s.ddl().join('\n').includes(`"base" text not null default 'main'`))
  await s.install()
  await s.install() // a second install finds everything standing
})

Deno.test('a d1 store refuses what the vocabulary refuses', async () => {
  let s = storage(d1(), strict)
  await s.install()
  await s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, repo: { seq: 3 } }]))
  let [row] = await s.read('.repo!')
  assertEquals(row.repo, { base: 'main', seq: 3, state: null })
  await assertRejects(() =>
    s.tx((tx) =>
      tx.patch([{ entity: { eid: 'r1' }, repo: { state: 'flying' } }])
    )
  )
})
