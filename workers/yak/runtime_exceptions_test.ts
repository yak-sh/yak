// A recorded runner defect reaches telemetry once, with the original stack;
// standalone platform reporting and transient provider failures stay separate.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { exceptionOf } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import { exceptionDoc } from './vocab.ts'
import { runtimeExceptions } from './runtime_exceptions.ts'

let vocab = loadVocab([exceptionDoc])
let fixture = () => {
  let seen: Error[] = []
  let fx = effects(vocab)
  runtimeExceptions(fx, (error) => seen.push(error))
  let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
  return { g, seen }
}

let error = new TypeError('missing field')
let row = { entity: { eid: 'fault' }, exception: exceptionOf(error) }
let committed = fixture()
test('a committed runtime exception reports its original type, value and stack once', () => {
  let { g, seen } = committed
  g.apply([row], { trusted: true })
  g.apply([row], { trusted: true })
  equal(seen.length, 1)
  equal([seen[0].name, seen[0].message, seen[0].stack], [
    error.name,
    error.message,
    error.stack,
  ])
})

let skipped = fixture()
let skipRows = [
  { entity: { eid: 'platform' }, exception: { message: 'platform failure' } },
  {
    entity: { eid: 'timeout' },
    exception: exceptionOf(new Error('fetch timed out')),
  },
  {
    entity: { eid: 'provider' },
    exception: exceptionOf(new Error('HTTP 503')),
  },
  { entity: { eid: 'empty' }, exception: { value: '' } },
]
test('runtime telemetry leaves standalone platform reports and transient failures to their boundaries', () => {
  let { g, seen } = skipped
  g.apply(skipRows, { trusted: true })
  equal(seen, [])
})
