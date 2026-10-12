// Migration transfers defects through tracker intake and keeps failed calls
// in the session graph, with their text and all unrelated source data intact.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { trackerDoc } from './vocab.ts'
import { ingest } from './intake.ts'
import { legacyException } from './legacy.ts'

let vocab = loadVocab([spineDoc, toolsDoc, trackerDoc])
let target = graph({ vocab, storage: ram(vocab) })
let old: Bundle = {
  entity: { eid: 'failure' },
  created: { at: '2026-09-01T12:00:00Z' },
  exception: {
    at: '2026-09-01T11:59:00Z',
    message: 'missing field',
    stack: 'TypeError: missing field\n    at code.ts:1:2',
    request: 'POST /api',
    request_id: 'request-1',
    version: 3,
  },
  content: { body: 'other source data' },
}

let move = legacyException(old)
await ingest(target, move.records)
await ingest(target, legacyException(old).records)

test('exception migration admits one immutable occurrence and preserves its capture context', async () => {
  equal(move.history, false)
  equal(move.patch.exception, null)
  let [row] = await target.get(['failure'])
  equal(row.error, {
    at: '2026-09-01T11:59:00Z',
    level: 'error',
    version: 3,
    tags: {
      migration: 'exception/1',
      request: 'POST /api',
      request_id: 'request-1',
    },
  })
  equal((row.exception as { value: string }).value, 'missing field')
  equal(
    (row.exception as { stack: string }).stack,
    (old.exception as { stack: string }).stack,
  )
  equal((await target.read('.error')).length, 1)
})

test('failed tool history stays on its entity without becoming another tracker report', () => {
  let move = legacyException({ ...old, output: { source: 'call' } })
  equal(move.history, true)
  equal(move.records, [])
  let x = move.patch.exception as { value: string; message: null }
  equal([x.value, x.message], ['missing field', null])
  equal(
    (move.patch.content as { body: string }).body,
    'other source data\n\nTypeError: missing field\n    at code.ts:1:2',
  )
})

test('standalone JSON diagnostics preserve their capture time and runtime context', () => {
  let move = legacyException({
    entity: { eid: 'diagnostic' },
    exception: {},
    content: {
      body: JSON.stringify({
        at: '2026-09-01T11:59:00Z',
        body: 'TypeError: missing field\n    at code.ts:1:2',
        phase: 'model',
        session: 'session',
        pid: 42,
      }),
    },
  })
  let record = move.records[0]
  equal((record.exception as { value: string }).value, 'missing field')
  equal((record.error as { at: string }).at, '2026-09-01T11:59:00Z')
})

test('a build receipt keeps its once-per-commit retry guard after its report moves', () => {
  let eid = '5a2a6ce96be3adee46ae1d8b7d6fbc2215f5bf13'
  let move = legacyException({
    ...old,
    entity: { eid },
    exception: { ...old.exception as object, request: 'BUILD yak 5a2a6ce9' },
  })
  equal(move.patch.failed, {
    at: '2026-09-01T11:59:00Z',
    reason: 'missing field',
  })
  equal((move.records[0].error as { commit: string }).commit, eid)
})
