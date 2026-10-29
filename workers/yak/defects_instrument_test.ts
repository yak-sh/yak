// Construction, lifecycle and RPC wrappers keep their invocation's reports.
import { equal, test, throws } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { instrument } from './defects-runtime.ts'
import { caught } from './defects.ts'

class Subject {
  constructor(_state: unknown, _env: unknown) {
    caught(Error('constructor failure'), {})
  }
  fetch() {
    caught(Error('lifecycle failure'), {})
    return new Response('answered', { status: 500 })
  }
  fail() {
    throw Error('RPC failure')
  }
}

test('instrumentation reports constructor, lifecycle and escaping RPC failures', async () => {
  let rows: Bundle[] = []
  let env = {
    ERRORS: {
      send: (batch: Bundle[]) => {
        rows.push(...batch)
        return Promise.resolve()
      },
    },
  }
  let Tracked = instrument(Subject)
  let object = new Tracked({}, env)
  equal(object.fetch().status, 500)
  await throws(() => object.fail(), 'RPC failure')
  rows = rows.filter((row) => row.error)
  equal(rows.map((row) => (row.exception as { value: string }).value).sort(), [
    'RPC failure',
    'constructor failure',
    'lifecycle failure',
  ])
  equal(
    rows.map((row) => (row.error as { tags: { request: string } }).tags.request)
      .sort(),
    [
      'Subject constructor',
      'Subject fail',
      'Subject fetch',
    ],
  )
})
