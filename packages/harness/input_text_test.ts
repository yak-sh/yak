import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { project } from '@yaks/session'
import { input } from '../openai/responses.ts'
import { inputText, senders } from './input_text.ts'
import { harness } from './testing.ts'
import { human } from '@yaks/id'

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
  input(project(entries, window, new Map(), { inputText: inputText(entries) }))

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
    project(entries, [entry], new Map(), { inputText: inputText(entries) })[0]
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
  equal(
    project(transcript, [notice, imported], new Map(), {
      inputText: inputText(transcript),
    }),
    [
      { kind: 'user', text: 'one more thing' },
      { kind: 'user', text: 'having read that' },
    ],
  )
})

// Who sent an input, as its header names them: `by` writes through the
// transcript itself, another session sends through itself.
let from = (created: Record<string, string>) =>
  inputText(
    [first],
    new Map([['jeff', 'Jeff (U-1)'], ['S2', 'S-2 wearing Oracle (N-3)']]),
  )(
    { ...first, created: { at: '2026-10-16T10:00:00Z', ...created } },
  ).split('\n')[0]

test('an input names who sent it, a person or another session', () => {
  equal(
    from({ by: 'jeff', via: 's' }),
    '[From Jeff (U-1); sent 2026-10-16T10:00:00Z; previous reply ended none]',
  )
  equal(
    from({ by: 'oracle', via: 'S2' }),
    '[From S-2 wearing Oracle (N-3); sent 2026-10-16T10:00:00Z; previous reply ended none]',
  )
  equal(
    from({ by: 'stranger', via: 'stranger' }),
    '[Sent 2026-10-16T10:00:00Z; previous reply ended none]',
  )
})

// Seeded and read when the file loads; the case checks the names.
let named = await (async () => {
  let h = await harness()
  try {
    let [jeff, oracle, other, self] = [1, 2, 3, 4].map(() =>
      crypto.randomUUID()
    )
    await h.g.apply(
      [
        { entity: { eid: jeff }, person: {}, doc: { title: 'Jeff' } },
        { entity: { eid: oracle }, persona: {}, doc: { title: 'Oracle' } },
        { entity: { eid: other }, session: { persona: oracle } },
        { entity: { eid: self }, session: {} },
      ],
      { trusted: true },
    )
    let line = (by: string, via: string): Bundle => ({
      entity: { eid: crypto.randomUUID() },
      entry: { session: self, seq: 1 },
      content: { body: 'hi' },
      created: { by, via },
    })
    let names = await senders(h.g, [line(jeff, self), line(oracle, other)])
    let id = async (eid: string) =>
      human(h.g.vocab)(
        (await h.g.read(`.entity.eid=${eid} ?person ?persona ?session`))[0],
      )
    let [j, o, s] = await Promise.all([jeff, oracle, other].map(id))
    return {
      got: [jeff, oracle, other, self].map((eid) => names.get(eid)),
      want: [`Jeff (${j})`, `Oracle (${o})`, `${s} wearing Oracle (${o})`],
    }
  } finally {
    await h.close()
  }
})()

test('senders names people, personas and sessions by title and id', () =>
  equal(named.got, [...named.want, undefined]))
