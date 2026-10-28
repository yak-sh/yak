import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { reader } from './reader.ts'
import { survey, surveyed } from './survey.ts'

let record = (properties: Record<string, unknown>) =>
  loadVocab(
    { $defs: { record: { component: true, properties } } } as VocabDoc,
  )
let title = { type: 'string', index: true }
let vocab = record({ title, input: { type: 'string' } })

// A file an older vocabulary made, without `record.input`, surveyed by a
// writer of the newer one.
let path = `${Deno.makeTempDirSync({ prefix: 'survey-' })}/graph.db`
let made = storage(open(path), record({ title }))
made.install()
made.tx((tx) =>
  tx.patch([{ entity: { eid: 'one' }, record: { title: 'kept' } }])
)
survey(open(path), vocab)
let recorded = surveyed(open(path), vocab)
let lacking = reader(open(path, { readOnly: true }), vocab).get(['one'])[0]
// Then another connection moves the schema: the survey's index is gone.
open(path).query({ t: 'drop', kind: 'index', name: 'record_title' })
let moved = surveyed(open(path), vocab)
let unindexed = reader(open(path, { readOnly: true }), vocab)
  .read('.record.title=kept')[0]

test('a survey says what the file lacks', () =>
  assertEquals(recorded, {
    lacking: ['record.input'],
    absent: [],
    unindexed: [],
    unlogged: [],
  }))

test('a reader reads what the survey says the file lacks as never given', () =>
  assertEquals(lacking?.record, { title: 'kept' }))

test('a survey is not read once the schema has moved past it', () =>
  assertEquals(moved, undefined))

test('a reader looks at the file again once its schema moved', () =>
  assertEquals(unindexed?.record, { title: 'kept' }))
