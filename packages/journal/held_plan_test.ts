// A scoped get of deleted identities seeks their last state, however many
// changes their components or other entities have recorded.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { insert } from '@yaks/sql'
import { stepping } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { storage as reading } from '../sqlite/read-store.ts'
import { backed } from './backed.ts'
import { ddl } from './log.ts'
import { journalDoc } from './vocab.ts'

let names = ['mail', 'recipient', 'sms_consent', 'text', 'draft']
let vocab = loadVocab([journalDoc, {
  $defs: Object.fromEntries([...names, 'doc'].map((name) => [name, {
    component: true,
    type: 'object',
    properties: {},
  }])),
}])
let visibility = { entity: names.map((name) => `!${name}`).join('&') }
let fixture = (changes: number) => {
  let { driver: sql, steps } = stepping()
  let store = storage(sql, vocab)
  store.install()
  store.raise()
  for (let s of ddl(vocab)) sql.query(s)
  sql.query(insert('entity', ...[1, 2, 3].map((id) => ({ id, eid: `e${id}` }))))
  sql.query(insert('journal_tx', { id: 1, ts: '2026-11-17' }))
  let record = (entity: number, component: string, operation = 'upsert') => ({
    tx: 1,
    ordinal: 0,
    entity,
    component,
    operation,
  })
  sql.query(insert('journal_change', record(1, 'doc'), record(2, 'doc')))
  for (let at = 0; at < changes; at += 500) {
    let rows = Array.from({ length: Math.min(500, changes - at) }, () => [
      record(1, 'draft'),
      record(3, 'doc'),
    ]).flat()
    sql.query(insert('journal_change', ...rows))
  }
  sql.query(insert('journal_change', record(1, 'draft', 'remove')))
  sql.query(insert(
    'tombstone',
    ...[1, 2].map((entity) => ({ entity, deleted_at: '2026-11-17' })),
  ))
  let reader = reading(sql, vocab, { backed: backed(vocab) })
  return () => {
    let before = steps()
    let rows = reader.get(['e1', 'e2'], [], { visibility })
    return { ids: rows.map((b) => b.entity.eid), steps: steps() - before }
  }
}
let small = fixture(1), large = fixture(2048)

test('a scoped get of deleted identities does not walk their recorded changes', () => {
  let a = small(), b = large()
  equal(a.ids, ['e1', 'e2'])
  equal(b.ids, a.ids)
  ok(b.steps < a.steps + 200, `${a.steps} steps small; ${b.steps} large`)
})
