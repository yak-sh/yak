import { equal, ok, test } from '@yaks/testing'
import { faultKey, normalize } from './fault.ts'
import { capture } from './report.ts'
import { grouped } from './group.ts'
import { title } from './model.ts'

let failures = [
  [
    'Native dispatch timing drift: 895ms > 259.5ms prior median',
    'Native dispatch timing drift: 1200ms > 300.25ms prior median',
    'native dispatch timing drift: #ms > #ms prior median',
  ],
  [
    'a letter waited 250687 ms at the edge',
    'a letter waited 318904 ms at the edge',
    'a letter waited # ms at the edge',
  ],
  [
    'sample -1.25e+3ns, 0xdeadbeef, 550e8400-e29b-41d4-a716-446655440000',
    'sample +2.5e-2ns, 0xcafebabe, 850e8400-e29b-41d4-a716-446655440111',
    'sample #ns, #, #',
  ],
  [
    'no space owns subscription sub_1UJMxrRMiIEYfSxgXadXUHqB',
    'no space owns subscription sub_2VK0zMnPJagWaYV',
    'no space owns subscription sub_#',
  ],
  [
    "stripe: No such subscription: 'sub_1UJMxrRMiIEYfSxgXadXUHqB'",
    "stripe: No such subscription: 'sub_2VK0zMnPJagWaYV'",
    "stripe: no such subscription: 'sub_#'",
  ],
  [
    'No such customer: cus_VK0zMnPJagWaYV',
    'No such customer: cus_1UJMxrRMiIEYfSxgXadXUHqB',
    'no such customer: cus_#',
  ],
  [
    'internal error; reference = s9gqbk7i3cdgmgq8ovlkm2e',
    'internal error; reference = abc123',
    'internal error; reference = #',
  ],
]

test('provider occurrence ids normalize to the same fault', () => {
  for (let [a, b, expected] of failures) {
    equal(normalize(a), expected)
    equal(normalize(b), expected)
    equal(faultKey('request', a), faultKey('request', b))
  }
  equal(
    normalize(
      'checkout cs_test_aB3VK0zMnPJagWaYV and cs_live_Xy4VK0zMnPJagWaYV',
    ),
    'checkout cs_# and cs_#',
  )
})

test('normalization keeps failure meaning, object types, kinds and sites distinct', () => {
  for (
    let message of [
      'missing sub_total',
      'missing cus_email',
      'missing custom_VK0zMnPJagWaYV',
      'missing my_sub_VK0zMnPJagWaYV',
      'reference = s9gqbk7i3cdgmgq8ovlkm2e',
    ]
  ) equal(normalize(message), message.toLowerCase())
  let provider = failures.find(([a]) => a.startsWith('no space'))!
  let key = faultKey('request', provider[0], 'at own (/a.ts:1:2)')
  for (
    let other of [
      faultKey('request', failures[1][0], 'at own (/a.ts:1:2)'),
      faultKey(
        'request',
        provider[0].replace('sub_', 'cus_'),
        'at own (/a.ts:1:2)',
      ),
      faultKey('call', provider[0], 'at own (/a.ts:1:2)'),
      faultKey('request', provider[0], 'at lookup (/a.ts:1:2)'),
    ]
  ) ok(key != other)
})

test('captured provider failures group under one bug without losing their messages', () => {
  for (let [a, b] of failures) {
    let rows = [a, b].map((message, i) =>
      capture(message, {
        sink: () => {},
        eid: String(i),
        during: { app: 'app', kind: 'request' },
      })[0]
    )
    let bugs = rows.map((row) => grouped(row, undefined, [])[1])
    equal(bugs[0].entity.eid, bugs[1].entity.eid)
    equal(rows.map(title), [a, b])
  }
})
