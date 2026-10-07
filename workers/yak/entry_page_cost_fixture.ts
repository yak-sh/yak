// A projected transcript page reads its selected owners, not their entire
// historical session a second time. Billed cursors, not returned-row counts.
import {
  driver,
  type DurableStorage,
  storage as durableStorage,
} from '@yaks/durable-object'
import { loadVocab } from '@yaks/vocab'
import { insert } from '@yaks/sql'
import { get } from '../../packages/sqlite/read.ts'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'

export let entryPageCost = (db: DurableStorage) => {
  let vocab = loadVocab({
    $defs: {
      entry: {
        component: true,
        type: 'object',
        index: [['session', 'seq']],
        properties: {
          session: { type: 'string', ref: 'entity' },
          seq: { type: 'integer' },
        },
      },
    },
  })
  let s = durableStorage(db, vocab), d = driver(db)
  s.install()
  d.query(insert('entity', { id: 1, eid: 'session' }))
  for (let at = 0; at < 20000; at += 500) {
    s.tx((tx) =>
      tx.patch(Array.from({ length: 500 }, (_, j) => ({
        entity: { eid: `entry-${at + j}` },
        entry: { session: 'session', seq: at + j + 1 },
      })))
    )
  }
  let exec = db.sql.exec.bind(db.sql), total = { read: 0, written: 0, calls: 0 }
  db.sql.exec = (sql, ...args) => {
    let c = exec(sql, ...args), rows = c.toArray()
    if (c.rowsRead == null || c.rowsWritten == null) {
      throw new Error('workerd cursors required')
    }
    total.read += c.rowsRead
    total.written += c.rowsWritten
    total.calls++
    return {
      rowsRead: c.rowsRead,
      rowsWritten: c.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  try {
    let rows = s.rows(
      '.entry.session=session&.fields=entry.seq&.order=-entry.seq&.limit=1',
    )
    return { total, rows }
  } finally {
    db.sql.exec = exec
  }
}

export let descriptorGatherCost = (db: DurableStorage) => {
  let vocab = loadVocab([archetypeDoc, {
    $defs: {
      holder: { component: true, type: 'object' },
      player: {
        component: true,
        type: 'object',
        properties: Object.fromEntries(
          Array.from(
            { length: 20 },
            (_, i) => ['v' + i, { type: 'string', ref: 'entity' }],
          ),
        ),
      },
    },
  }])
  let s = durableStorage(db, vocab), d = driver(db)
  s.install()
  let g = graph({ vocab, storage: s, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'holder' }, holder: {} }, {
    entity: { eid: 'hero' },
    player: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => ['v' + i, 'holder']),
    ),
  }])
  let [hero] = s.get(['hero']), descriptor = hero.entity.archetype!
  get(d, vocab, ['hero', descriptor])
  let exec = db.sql.exec.bind(db.sql), total = { read: 0, written: 0, calls: 0 }
  db.sql.exec = (sql, ...args) => {
    let c = exec(sql, ...args), rows = c.toArray()
    total.read += c.rowsRead ?? 0
    total.written += c.rowsWritten ?? 0
    total.calls++
    return {
      rowsRead: c.rowsRead,
      rowsWritten: c.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  try {
    let rows = get(d, vocab, ['hero', descriptor])
    return { total, rows }
  } finally {
    db.sql.exec = exec
  }
}
