// `wake_new` over a graph small enough to read: a cadence, an instant or both
// make one wake aimed at the target, and a time nobody can read is refused.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph, Refused } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { wakeDoc } from './comp.ts'
import { wakes } from './plugin.ts'
import { runs } from './tools.ts'

let vocab = loadVocab([wakeDoc, {
  $defs: { goal: { component: true, type: 'object' } },
}])
let NOW = Date.parse('2026-11-07T09:17:00Z')
let MORNING = '0 7 * * * America/Detroit'

// The wake a call writes, or what it was refused with.
let made = async (args: Record<string, unknown>) => {
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [wakes({ now: () => NOW })],
  })
  await g.apply([{ entity: { eid: 'funnel' }, goal: {} }])
  try {
    let call = { entity: { eid: 'c1' }, call: { args } }
    let [b] = await g.apply(await runs().wake_new!(call, g) as Bundle[])
    return b.wake
  } catch (e) {
    if (e instanceof Refused) return e.message.split(':')[0]
    throw e
  }
}

let cases: [string, Record<string, unknown>, unknown][] = [
  ['a cadence starts at its next instant', { every: MORNING, note: 'weigh' }, {
    target: 'funnel',
    every: MORNING,
    at: '2026-11-07T12:00:00.000Z',
    note: 'weigh',
  }],
  ['an instant fires once', { at: '2026-11-08T09:00Z' }, {
    target: 'funnel',
    at: '2026-11-08T09:00:00.000Z',
  }],
  ['a cadence keeps the first instant it is given', {
    every: '1d',
    at: '2026-11-08T09:00Z',
  }, { target: 'funnel', every: '1d', at: '2026-11-08T09:00:00.000Z' }],
  ['no time is refused', { note: 'weigh' }, 'a wake needs a time'],
  [
    'an unreadable cadence is refused',
    { every: 'sometimes' },
    'sometimes is no cadence',
  ],
  ['an unreadable instant is refused', { at: 'soon' }, 'soon is no instant'],
]
for (let [name, args, wake] of cases) {
  test(`wake_new: ${name}`, async () => {
    equal(await made({ target: 'funnel', ...args }), wake)
  })
}
