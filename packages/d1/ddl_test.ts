// D1 is SQLite behind an async binding, so its schema is @yaks/sqlite's: the
// same statements, constraints included, and a store over the stand-in holds
// what the vocabulary said the way the reference adapter does.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { schema } from '@yaks/sqlite'
import { col, notNull, select, table, val } from '@yaks/sql'
import { prepare } from './d1.ts'
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

test('the d1 schema is the sqlite schema, constraints included', async () => {
  let s = storage(d1(), strict)
  assertEquals(s.ddl(), schema(strict))
  await s.install()
  await s.install() // a second install finds everything standing
})

test('a d1 install preserves undeclared columns, empty or populated', async () => {
  let db = d1(), s = storage(db, strict)
  await s.install()
  await s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, repo: {} }]))
  await db.batch([
    prepare(db, {
      t: 'alter table',
      table: 'repo',
      add: { name: 'old', type: 'text' },
    }),
    prepare(db, {
      t: 'alter table',
      table: 'repo',
      add: { name: 'used', type: 'text' },
    }),
    prepare(db, { t: 'update', table: 'repo', set: { used: val('kept') } }),
  ])
  await s.install()
  let has = (name: string) =>
    prepare(
      db,
      select({
        cols: [col(name)],
        from: table('repo'),
        where: notNull(col(name)),
      }),
    ).all()
  assertEquals(
    (await (await prepare(db, { t: 'pragma', name: 'table_info', arg: 'repo' })
      .all()).results)
      .map((r) => r.name).includes('old'),
    true,
  )
  assertEquals((await has('used')).results.length, 1)
  await s.install()
  assertEquals((await has('used')).results.length, 1)
})

test('a d1 look survives reference upgrades and rollbacks', async () => {
  let words = (ref: boolean) =>
    loadVocab({
      $defs: {
        player: { component: true, properties: {} },
        seen: { component: true, properties: { level: { type: 'string' } } },
        look: {
          component: true,
          properties: {
            player: ref
              ? { type: 'string', ref: 'player', death: 'cascade' }
              : { type: 'string' },
          },
        },
      },
    })
  let db = d1(), before = storage(db, words(false))
  await before.install()
  await before.tx((tx) =>
    tx.patch([
      { entity: { eid: 'hero' }, player: {}, seen: { level: 'vale' } },
      { entity: { eid: 'face' }, look: { player: 'hero' } },
    ])
  )
  assertEquals((await before.read('.look&*'))[0].look, { player: 'hero' })
  let after = storage(db, words(true))
  await after.install()
  assertEquals((await after.read('.look&*'))[0].look, { player: 'hero' })
  assertEquals((await after.read('.look.player.seen.level=vale&*'))[0].look, {
    player: 'hero',
  })
  await before.install()
  assertEquals((await before.read('.look.player=hero&*'))[0].look, {
    player: 'hero',
  })
  await after.install()
  assertEquals((await after.read('.look.player.seen.level=vale&*'))[0].look, {
    player: 'hero',
  })
})

test('a d1 store takes a state its vocabulary stopped listing', async () => {
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

test('a d1 store refuses what the vocabulary refuses', async () => {
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
