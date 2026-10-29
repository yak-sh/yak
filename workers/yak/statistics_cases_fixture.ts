// Statistics follow legacy installations, newly populated components and indexes.
import { by, scan } from '@yaks/sql'
import { driver } from '@yaks/durable-object'
import { meta } from '@yaks/sqlite'
import { installed, SCHEMA } from '../../packages/sqlite/meta.ts'
import { type State, Store } from './graph.ts'

export let statisticsCases = async (db: State['storage']) => {
  let headers = {
    'x-store': 'probe/statistics-cases',
    'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'x-yak-role': 'owner',
    'x-yak-access': 'private',
    'x-yak-kernel': '1',
  }
  let ctx = { storage: db, getWebSockets: () => [], acceptWebSocket: () => {} }
  let store = new Store(ctx, {}, [])
  let words = (indexed = false) => ({
    $defs: {
      recipe: {
        component: true,
        properties: { rating: { type: 'number', index: indexed } },
      },
      note: { component: true, properties: { label: { type: 'string' } } },
    },
  })
  let deploy = async (indexed = false) => {
    let res = await store.fetch(
      new Request('https://store/vocab', {
        method: 'POST',
        headers,
        body: JSON.stringify(words(indexed)),
      }),
    )
    if (!res.ok) throw new Error(await res.text())
    await res.body?.cancel()
    // What a deploy owes, the alarm analyzes.
    await store.alarm()
  }
  let reopen = async () => {
    store = new Store(ctx, {}, [])
    let s = (await store.door).graph.storage
    s.install()
    await store.alarm()
    return s
  }
  let statistics = (name: string) =>
    scan(driver(db), 'sqlite_stat1', by({ tbl: name }), ['idx', 'stat'])
  await deploy()
  let s = (await store.door).graph.storage
  let recipes = (...names: string[]) =>
    s.tx((tx) =>
      tx.patch(names.map((eid) => ({
        entity: { eid },
        recipe: { rating: 1 },
      })))
    )
  recipes('one', 'two')
  s.install()
  // A legacy installation has complete SQLite statistics and a plain schema
  // fingerprint. New wrappers must adopt them rather than repeat the pass.
  let d = driver(db)
  d.query({ t: 'analyze' })
  meta(d).set(SCHEMA, installed(d)!)
  let before = statistics('recipe')
  recipes('three')
  s = await reopen()
  let adopted = statistics('recipe')
  recipes('four')
  s = await reopen()
  let adoption = {
    before,
    adopted,
    after: statistics('recipe'),
    rows: (await s.read('.recipe.rating=1')).length,
  }

  let bytes = db.sql.databaseSize!
  s.tx((tx) => tx.patch([{ entity: { eid: 'one' }, note: { label: 'kept' } }]))
  s = await reopen()
  let populated = statistics('note')
  s.tx((tx) => tx.patch([{ entity: { eid: 'two' }, note: { label: 'kept' } }]))
  s = await reopen()
  let population = {
    populated,
    after: statistics('note'),
    rows: (await s.read('.note.label=kept')).length,
    bytesBefore: bytes,
    bytesAfter: db.sql.databaseSize!,
  }

  await deploy(true)
  s = (await store.door).graph.storage
  let indexed = statistics('recipe')
  recipes('five')
  s = await reopen()
  let index = {
    indexed,
    after: statistics('recipe'),
    rows: (await s.read('.recipe.rating=1')).length,
  }
  await db.deleteAlarm?.()
  return { adoption, population, index }
}
