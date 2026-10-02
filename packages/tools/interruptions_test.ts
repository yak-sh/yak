// Historical diagnostics require evidence, and expansion preserves old readers.
import { equal, test, throws } from '@yaks/testing'
import { type Bundle } from '@yaks/graph'
import { interruptionMove } from './interruptions.ts'
let ask: Bundle = {
  entity: { eid: 'ask' },
  entry: { session: 'session', seq: 1 },
  ask: {},
  attempt: { state: 'interrupted' },
}
let row = (code: string): Bundle => ({
  entity: { eid: 'line' },
  entry: { session: 'session', seq: 2 },
  error: { code },
  content: { body: 'cut' },
})
test('explicit historical terminal interruptions do not turn into retry', () => {
  let patches = interruptionMove(row('interrupted'), () => [ask])
  equal(!!patches[0].interrupted, true)
  equal(!!patches[0].failed, true)
  equal(patches[1].error, undefined)
  equal(patches[2].output, { source: 'ask' })
})
test('provider diagnostic only retries with interrupted ask evidence', () => {
  let [patch] = interruptionMove(row('transport'), () => [ask])
  equal(!!patch.provisional, true)
  let [no] = interruptionMove(
    row('transport'),
    () => [{ ...ask, attempt: { state: 'completed' } }],
  )
  equal(no.provisional, undefined)
})
test('source-associated tool cutoffs are marks, not failures or refusals', () => {
  let call: Bundle = {
    entity: { eid: 'call' },
    call: {},
    execution: { state: 'failed' },
  }
  let patches = interruptionMove({
    ...row('interrupted'),
    output: { source: 'call' },
  }, () => [call])
  equal(!!patches[0].interrupted, true)
  equal(patches[0].failed, undefined)
  equal(patches.length, 2)
})
test('missing explicit source refuses instead of guessing', () => {
  throws(() =>
    interruptionMove(
      { ...row('interrupted'), output: { source: 'call' } },
      () => [],
    )
  )
})
test('an unassociated historical diagnostic stays on its own entity', () => {
  let patches = interruptionMove(row('interrupted'), () => [])
  equal(patches[0].entity.eid, 'line')
  equal(!!patches[0].failed, true)
  equal(patches.length, 1)
})
