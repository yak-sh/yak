// A narrow migration owns its new declarations, not another running writer's indexes.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { open } from './db.ts'
import { objects, storage } from './mod.ts'

let full = loadVocab({
  $defs: {
    wake: {
      component: true,
      properties: {
        at: { type: 'string', index: true },
        target: { type: 'string', index: true },
        note: { type: 'string' },
      },
    },
  },
})
let narrow = loadVocab({
  $defs: {
    wake: {
      component: true,
      properties: {
        note: { type: 'string' },
      },
    },
  },
})
let sql = open(':memory:')
let writer = storage(sql, full)
writer.install()
writer.tx((tx) =>
  tx.patch([{
    entity: { eid: 'job' },
    wake: { at: 'now', target: 'owner', note: 'kept' },
  }])
)
let expected = objects(sql, { type: 'index' }).map((r) => r.name).sort()
let migration = storage(sql, narrow, { schemaReady: () => true, partial: true })

migration.install()
test('a partial installer preserves indexes used by the complete writer', () => {
  equal(objects(sql, { type: 'index' }).map((r) => r.name).sort(), expected)
  equal(writer.read('.wake.target=owner')[0].wake, {
    at: 'now',
    target: 'owner',
    note: 'kept',
  })
})
