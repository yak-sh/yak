// Migration transfers defects through tracker intake and keeps failed calls
// in the session graph, with their text and all unrelated source data intact.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph, Stale } from '@yaks/graph'
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

let sourceVocab = loadVocab([spineDoc, toolsDoc, trackerDoc, {
  $defs: {
    exception: {
      extends: true,
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string' },
        message: { type: 'string' },
        request: { type: 'string' },
        request_id: { type: 'string' },
        version: { type: 'number' },
      },
    },
  },
}])
let source = graph({ vocab: sourceVocab, storage: ram(sourceVocab) })
let origin = '10000000-0000-4000-8000-000000000001'
let empty = { ...old, output: { source: origin }, content: { body: '' } }
source.apply([
  { entity: { eid: origin }, content: { body: 'tool request' } },
  empty,
], { trusted: true })
test('an empty history body retains its stack through guarded graph admission', async () => {
  await source.apply([legacyException(empty).patch], { trusted: true })
  let [row] = await source.get(['failure'])
  equal(
    (row.content as { body: string }).body,
    (old.exception as { stack: string }).stack,
  )
  equal((row.exception as { value: string }).value, 'missing field')
})

let changed = graph({ vocab: sourceVocab, storage: ram(sourceVocab) })
await changed.apply([old], { trusted: true })
let pending = legacyException(old).patch
await changed.apply([{
  entity: old.entity,
  exception: { type: 'TypeError', value: 'a new failure' },
}], { trusted: true })
test('a failure added while its historical report moves refuses the stale source removal', async () => {
  let refused = false
  try {
    await changed.apply([pending], { trusted: true })
  } catch (error) {
    refused = error instanceof Stale
  }
  equal(refused, true)
  equal((await changed.get(['failure']))[0].exception, {
    ...old.exception as object,
    type: 'TypeError',
    value: 'a new failure',
  })
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
