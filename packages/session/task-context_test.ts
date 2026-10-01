// Task context is frozen once, with exact revisions and releases appended
// later. Pure values make prefix stability observable without a provider.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { admitted, changes, items, snapshot } from './task-context.ts'

test('task snapshots keep exact specs and distinguish edits from releases', () => {
  let before = snapshot([{
    entity: { eid: 't1' },
    doc: { title: 'Draft', body: 'Keep it.' },
  }])
  let original = JSON.stringify(items(before))
  let after = snapshot([{
    entity: { eid: 't1' },
    doc: { title: 'Draft', body: 'Sync it.' },
  }, { entity: { eid: 't2' }, doc: { title: 'Next' } }])
  assertEquals(
    changes(before, after),
    'Claimed task t1\nDraft\n\nSync it.\n\nClaimed task t2\nNext',
  )
  assertEquals(changes(after, after), '')
  assertEquals(
    changes(after, {}),
    'Released task t1: no longer claimed by this session.\n\n' +
      'Released task t2: no longer claimed by this session.',
  )
  assertEquals(JSON.stringify(items(before)), original)
})

test('the newest task notice belongs to its checkpoint, not another fork', () => {
  let mark = {
    entity: { eid: 'cp' },
    entry: { seq: 4 },
    checkpoint: { tasks: { t1: { body: 'old' } } },
  }
  let entries = [mark, {
    entity: { eid: 'change' },
    entry: { seq: 5 },
    task_context: { checkpoint: 'cp', tasks: { t1: { body: 'new' } } },
  }, {
    entity: { eid: 'elsewhere' },
    entry: { seq: 6 },
    task_context: { checkpoint: 'other', tasks: {} },
  }]
  assertEquals(admitted([mark], mark), { t1: { body: 'old' } })
  assertEquals(admitted(entries, mark), { t1: { body: 'new' } })
})
