// Schema readiness is a host's single-owner assertion at the first operation,
// never permission to stop watching schema edits through other connections.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { as, type Driver, scan, select, val } from '@yaks/sql'
import { type Opts, storage } from './mod.ts'
import { open } from './db.ts'
import { mem, shop, spy } from './testing.ts'

// The cast lets these regressions run against the adapter before it accepts
// the option: that adapter ignores the assertion and inspects the schema.
let ready = (schemaReady: () => boolean): Opts => ({ schemaReady }) as Opts
let schemaReads = (said: string[]) =>
  said.filter((sql) => /\b(?:sqlite_schema|sqlite_master)\b/.test(sql))

test('a fresh single-owner store uses host schema readiness without inspecting schema', () => {
  let d = mem()
  storage(d, shop).install()
  let said: string[] = [], asked = 0
  let s = storage(
    spy(d, (sql) => void said.push(sql)),
    shop,
    ready(() => {
      asked++
      return true
    }),
  )
  assertEquals(asked, 0)
  assertEquals(said, [])
  assertEquals(s.get(['absent'], ['doc']), [])
  assertEquals(schemaReads(said), [])
  assertEquals(asked, 1)
  s.tx((tx) => tx.patch([{ entity: { eid: 'one' }, doc: { title: 'kept' } }]))
  assertEquals(s.get(['one'], ['doc'])[0].doc, { title: 'kept', body: null })
  assertEquals(asked, 1)
  assertEquals(schemaReads(said), [])
})

test('known schema reads backed-property epoch without checking meta table existence', () => {
  let vocab = loadVocab({
    $defs: {
      record: {
        component: true,
        computed: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  })
  let d = mem()
  storage(d, vocab).install()
  let said: string[] = []
  let backing = {
    rows: select({ cols: [as(val(7), 'entity'), as(val('kept'), 'title')] }),
  }
  let incarnation = () =>
    storage(spy(d, (sql) => void said.push(sql)), vocab, {
      ...ready(() => true),
      backed: { record: backing },
    })
  let first = incarnation().read('.record')
  assertEquals(first.length, 1)
  assertEquals(first[0].record, { title: 'kept' })
  assertEquals(incarnation().get([first[0].entity.eid], ['record']), first)
  assert(said.some((sql) => sql.includes('server_meta')))
  assertEquals(schemaReads(said), [])
})

test('an unready schema falls back to installation and vocabulary growth', () => {
  let book = (more: boolean) =>
    loadVocab({
      $defs: {
        book: {
          component: true,
          type: 'object',
          properties: {
            title: { type: 'string' },
            ...(more ? { tag: { type: 'string', index: true } } : {}),
          },
        },
      },
    })
  let d = mem(), asked = 0
  let before = storage(
    d,
    book(false),
    ready(() => {
      asked++
      return false
    }),
  )
  before.tx((tx) => tx.patch([{ entity: { eid: 'a' }, book: { title: 'A' } }]))
  assertEquals(asked, 1)
  let after = storage(d, book(true), ready(() => false))
  after.tx((tx) => tx.patch([{ entity: { eid: 'a' }, book: { tag: 'new' } }]))
  assertEquals(after.get(['a'], ['book'])[0].book, { title: 'A', tag: 'new' })
})

test('explicit install validates even when a host asserts schema readiness', () => {
  let d = mem()
  storage(d, shop).install()
  d.query({ t: 'drop', kind: 'index', name: 'shelf_aisle_height' })
  let asked = 0
  let s = storage(
    d,
    shop,
    ready(() => {
      asked++
      return true
    }),
  )
  s.install()
  assertEquals(asked, 0)
  assert(
    scan(d, 'sqlite_schema', undefined, ['name'])
      .some((r) => r.name == 'shelf_aisle_height'),
  )
})

test('file stores ignore single-owner readiness and mend external schema edits', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yaks-readiness-' })
  let first = open(`${dir}/graph.sqlite`)
  let second = open(`${dir}/graph.sqlite`)
  try {
    let asked = 0
    let opts = ready(() => {
      asked++
      return true
    })
    let s = storage(first, shop, opts)
    s.tx((tx) => tx.patch([{ entity: { eid: 'a' }, doc: { title: 'A' } }]))
    let drop = () => second.query({ t: 'drop', kind: 'table', name: 'shelf' })
    let exists = (d: Driver) =>
      scan(d, 'sqlite_schema', undefined, ['name']).some((r) =>
        r.name == 'shelf'
      )
    drop()
    assertEquals(exists(first), false)
    assertEquals(s.get(['a'], ['doc'])[0].doc, { title: 'A', body: null })
    assertEquals(exists(first), true)
    drop()
    let reopened = storage(second, shop, opts)
    assertEquals(reopened.get(['a'], ['doc'])[0].doc, {
      title: 'A',
      body: null,
    })
    assertEquals(exists(second), true)
    assertEquals(asked, 0)
  } finally {
    second.close()
    first.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
