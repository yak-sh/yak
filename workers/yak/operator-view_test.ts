// An error in the Operator's chat reads as words; what it said shows only
// inside a closed "Details".
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { rows } from './operator-view.ts'

let error =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"tools.26.custom.input_schema: input_schema does not support oneOf"}}'
let entry = (eid: string, seq: number, comps: Record<string, unknown>) =>
  ({ entity: { eid }, entry: { session: 's', seq }, ...comps }) as Bundle

// A conversation as it was recorded: a refused ask, a failed step and a crash.
let entries = [
  entry('in', 1, { content: { body: 'Any app errors recently?' } }),
  entry('ask', 2, { ask: { to: 'm', through: 'in' } }),
  entry('no', 3, {
    content: { body: error },
    output: { source: 'ask' },
    refusal: { code: 'request' },
    response: { body: error.slice(4) },
  }),
  entry('call', 4, { call: { to: 'tool', args: { app: 'msp430' } } }),
  entry('back', 5, {
    content: { body: '{"message":"no such app"}' },
    result: { call: 'call' },
    refusal: { code: 'missing' },
  }),
  entry('crash', 6, { failed: { message: 'Worker exceeded its CPU time' } }),
  // A helper's end as Jeff's conversation 68fd688b recorded it, before the
  // receipt carried `delivery`.
  entry('helper', 7, {
    content: {
      body:
        'child 44bf29e4-a03f-8fed-ad75-25d6efa4204f failed\nThis call has no verified cost bound',
    },
  }),
]

let drawn = () =>
  parseHTML(
    `<main>${
      rows(entries, (t) => `Read ${t}`).map((r) => r.html).join('')
    }</main>`,
  ).document

test('an error reads as words, its detail only inside a closed disclosure', () => {
  let doc = drawn()
  let shown = [...doc.querySelectorAll('.Talk_Trouble > p')]
    .map((p) => p.textContent)
  assertEquals(shown.length, 4)
  for (let said of shown) assert(!/[{}]/.test(said!), said!)
  let details = [...doc.querySelectorAll('.Talk_Trouble > details')]
  assertEquals(details.length, 4)
  for (let d of details) {
    assert(!d.hasAttribute('open'))
    assertEquals(d.querySelector('summary')!.textContent, 'Details')
  }
  assertStringIncludes(
    details[0].textContent!,
    '"type": "invalid_request_error"',
  )
  assertStringIncludes(details[2].textContent!, 'CPU time')
  assertStringIncludes(details[3].textContent!, 'no verified cost bound')
  // Nothing of an error is drawn as a reply, or as the person's words.
  assertEquals(doc.querySelectorAll('.Talk_Reply').length, 0)
  assertEquals(
    [...doc.querySelectorAll('.Talk_You')].map((p) => p.textContent),
    ['Any app errors recently?'],
  )
})
