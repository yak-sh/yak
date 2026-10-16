import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { project } from '@yaks/session'
import { input } from '../openai/responses.ts'
import { inputText } from './input_times.ts'

let row = (
  eid: string,
  seq: number,
  rest: Omit<Bundle, 'entity' | 'entry'>,
): Bundle => ({
  entity: { eid },
  entry: { session: 's', seq },
  ...rest,
})
let first = row('first', 1, {
  content: { body: 'begin' },
  created: { at: '2026-10-16T10:00:00Z' },
})
let ask = row('ask', 2, {
  ask: { through: 'first' },
  attempt: { by: null },
  created: { at: '2026-10-16T10:00:01Z' },
  updated: { at: '2026-10-16T10:00:10Z' },
})
// Streaming creates output before either the next input or the reply's end.
let output = row('output', 3, {
  output: { source: 'ask' },
  content: { body: 'reply' },
  created: { at: '2026-10-16T10:00:02Z' },
})
let during = row('during', 4, {
  content: { body: 'one more thing' },
  created: { at: '2026-10-16T10:00:05Z' },
})
let after = row('after', 5, {
  content: { body: 'having read that' },
  created: { at: '2026-10-16T10:00:15Z' },
})
let transcript = [first, ask, output, during, after]
let render = (window: Bundle[], entries = transcript) =>
  input(project(entries, window, new Map(), { inputText }))

test('model messages distinguish input during a reply from input after its end', () => {
  equal(render([during, after]), [
    {
      role: 'user',
      content: [{
        type: 'input_text',
        text:
          '[Sent 2026-10-16T10:00:05Z; previous reply ended 2026-10-16T10:00:10Z]\none more thing',
      }],
    },
    {
      role: 'user',
      content: [{
        type: 'input_text',
        text:
          '[Sent 2026-10-16T10:00:15Z; previous reply ended 2026-10-16T10:00:10Z]\nhaving read that',
      }],
    },
  ])
})

test('an input arriving before non-streamed output still sees that reply end', () => {
  // The input's seq can precede output too; ask.through identifies its reply.
  equal(
    render([during], [first, ask, during, {
      ...output,
      entry: { session: 's', seq: 6 },
    }]),
    render([during]),
  )
})

test('missing completion times are not replaced with reply start times', () => {
  let message = (entries: Bundle[], entry = during) =>
    project(entries, [entry], new Map(), { inputText })[0]
  equal(message([first, { ...ask, updated: undefined }, output, during]), {
    kind: 'user',
    text:
      '[Sent 2026-10-16T10:00:05Z; previous reply ended unknown]\none more thing',
  })
  equal(
    message([first, { ...ask, attempt: { by: 'worker' } }, output, during]),
    {
      kind: 'user',
      text:
        '[Sent 2026-10-16T10:00:05Z; previous reply ended unknown]\none more thing',
    },
  )
  equal(message(transcript, first), {
    kind: 'user',
    text: '[Sent 2026-10-16T10:00:00Z; previous reply ended none]\nbegin',
  })
})

test('notices and imported inputs without sent times keep their prose', () => {
  let notice = { ...during, notice: {} }
  let imported = { ...after, created: undefined }
  equal(project(transcript, [notice, imported], new Map(), { inputText }), [
    { kind: 'user', text: 'one more thing' },
    { kind: 'user', text: 'having read that' },
  ])
})
