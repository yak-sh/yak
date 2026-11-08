import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { personName } from '../stamps.ts'

let named = (b: Record<string, unknown>) =>
  personName({ entity: { eid: 'p', num: 7 }, person: {}, ...b })

test('a person is named by what they gave, else what reaches them, else their row', () => {
  assertEquals(
    [
      named({ doc: { title: 'Ada' }, email: { address: 'ada@x.io' } }),
      named({ email: { address: 'ada@x.io' } }),
      named({ phone: { number: '+15550100' } }),
      named({}),
    ],
    ['Ada', 'ada', '+15550100', 'Person #7'],
  )
})
