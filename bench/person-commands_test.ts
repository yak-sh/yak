import { equal, test, throws } from '@yaks/testing'
import { hookAnswer, measure } from './person-commands.ts'

test('hook timing rejects an empty or failed response rather than banking it', () => {
  equal(hookAnswer(''), false)
  equal(hookAnswer('Error: config failed'), false)
  equal(hookAnswer('Prompt sent: 2026-10-17T12:00:01.000Z'), false)
  equal(
    hookAnswer(
      'Prompt sent: 2026-10-17T12:00:01.000Z; previous reply ended: 2026-10-17T12:00:00.000Z.',
    ),
    true,
  )
  equal(
    hookAnswer(
      'Prompt observed: 2026-10-17T12:00:01.000Z; previous reply ended: unknown.',
    ),
    true,
  )
})

test('an invalid sample count refuses before creating a benchmark fixture', async () => {
  await throws(() => measure(['0']))
})
