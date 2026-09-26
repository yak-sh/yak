// D1 is SQLite behind an async binding, so its schema is @yaks/sqlite's: the
// same statements, constraints included, and a store over the stand-in holds
// what the vocabulary said the way the reference adapter does.

import { assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { schema } from '@yaks/sqlite'
import { d1 } from './testing.ts'
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
        state: { type: 'string', enum: ['stopped', 'running'] },
        seq: { type: 'integer' },
      },
    },
  },
})

Deno.test('the d1 schema is the sqlite schema, constraints included', async () => {
  let s = storage(d1(), strict)
  assertEquals(s.ddl(), schema(strict))
  await s.install()
  await s.install() // a second install finds everything standing
})

Deno.test('a d1 store takes a state its vocabulary stopped listing', async () => {
  let db = d1()
  let repo = (state: Record<string, unknown>) =>
    loadVocab({
      $defs: {
        ...strict.docs[0].$defs,
        repo: {
          component: true,
          type: 'object',
          properties: { state: { type: 'string', ...state } },
        },
      },
    })
  let s = storage(db, repo({ enum: ['stopped', 'running'] }))
  await s.install()
  await s.tx((tx) =>
    tx.patch([{ entity: { eid: 'r1' }, repo: { state: 'running' } }])
  )
  s = storage(db, repo({}))
  await s.install()
  await s.tx((tx) =>
    tx.patch([{ entity: { eid: 'r2' }, repo: { state: 'flying' } }])
  )
  let states = (await s.read('.repo'))
    .map((b) => (b.repo as Record<string, unknown>).state).sort()
  assertEquals(states, ['flying', 'running'])
})

Deno.test('a d1 store refuses what the vocabulary refuses', async () => {
  let s = storage(d1(), strict)
  await s.install()
  await s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, repo: { seq: 3 } }]))
  let [row] = await s.read('.repo')
  assertEquals(row.repo, { base: 'main', seq: 3, state: null })
  await assertRejects(() =>
    s.tx((tx) =>
      tx.patch([{ entity: { eid: 'r1' }, repo: { state: 'flying' } }])
    )
  )
})
