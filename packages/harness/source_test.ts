// Prompt assembly keeps each writer visible through provider role conversion.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { type Item, type Request } from '@yaks/model'
import { project } from '@yaks/session'
import { closed } from '../session/project.ts'
import { inputText } from './input_text.ts'
import { input } from '../openai/responses.ts'
import { messages } from '../openrouter/prompt.ts'
import { conversation, system } from '../anthropic/mod.ts'

let line = (eid: string, more: Record<string, unknown>): Bundle => ({
  entity: { eid },
  entry: { session: 's' },
  content: { body: eid },
  ...more,
})
let lines = [
  line('person', { created: { by: 'jeff', via: 's' } }),
  line('legacy-helper', {}),
  line('empty-source', { entry: { session: 's', from: '' } }),
  line('summary', { checkpoint: {} }),
  line('instructions', { prompt: {} }),
  line('notice', { notice: {} }),
  line('recovery', { system: {}, created: { by: 'jeff' } }),
  line('wake', { woken: {} }),
  line('attention', { attention: {} }),
  line('parent', { entry: { session: 's', from: 'your parent session (p)' } }),
  line('parent-guidance', { prompt: { source: 'delegation:instructions' } }),
  line('helper', { delivery: { child: 'h', outcome: 'settled' } }),
  line('stopped', { delivery: { child: 'h', outcome: 'stopped' } }),
  line('TaskMaster', { entry: { session: 's', from: 'TaskMaster' } }),
  line('escalation', {
    entry: { session: 's', from: 'your conversation with Ana' },
    notice: {},
    system: {},
  }),
  line('voice', { notice: { own: true } }),
  line('progress', { tool_progress: { call: 'progress-call' } }),
  line('progress-call', { call: { id: 'p', to: 'echo', args: {} } }),
  line('call', { call: { id: 'c', to: 'echo', args: {} } }),
  line('refused', { result: { call: 'call' }, refusal: { code: 'arguments' } }),
]
let tools = new Map([['echo', {
  name: 'echo',
  description: '',
  parameters: {},
}]])
let names = new Map([['jeff', 'Jeff']])
let media: Item = {
  kind: 'document',
  bytes: new Uint8Array(),
  mediaType: 'text/plain',
  label: 'source file',
}
let assembled = () =>
  project(lines, lines, tools, {
    inputText: inputText(lines, names),
    media: new Map([['person', [media]]]),
  })
let expected = [
  ['Jeff', 'person'],
  ['an unknown sender', 'legacy-helper'],
  ['an unknown sender', 'empty-source'],
  ['the checkpoint summarizer', 'summary'],
  ['the system', 'instructions'],
  ['the system', 'notice'],
  ['the system', 'recovery'],
  ['the system', 'wake'],
  ['the system', 'attention'],
  ['your parent session (p)', 'parent'],
  ['your parent session', 'parent-guidance'],
  ['your helper (h)', 'helper'],
  ['the system', 'stopped'],
  ['TaskMaster', 'TaskMaster'],
  ['your conversation with Ana', 'escalation'],
  ['your voice on the call', 'voice'],
  ['the system', 'progress'],
  ['the echo tool', 'refused'],
  ['the attached document', 'source file'],
]

for (
  let [provider, render] of [
    ['Responses', (req: Request) => input(req.items)],
    ['Chat', messages],
    ['Messages', (req: Request) => [system(req), conversation(req)]],
  ] as const
) {
  test(`${provider} assembled prompt names every source, including notices without timestamps`, () => {
    let items = assembled()
    let req = { model: 'test', items, tools: [] }
    let body = JSON.stringify(render(req))
    for (let [from, words] of expected) {
      ok(
        body.includes(JSON.stringify(`From ${from}:\n${words}`).slice(1, -1)),
        `${from}: ${words}`,
      )
    }
    equal(
      items.find((i) => 'text' in i && i.text.endsWith('\nvoice'))?.kind,
      'user',
    )
  })
}

test('a late tool refusal in a user turn retains the tool source', () => {
  let call = line('c', {
    call: { id: 'c', to: 'echo', args: {} },
    tool_async: {},
  })
  let asked = line('a', { ask: { through: 'c' } })
  let result = line('r', {
    result: { call: 'c' },
    refusal: { code: 'arguments' },
  })
  let history = [call, asked, result].map((b, seq) => ({
    ...b,
    entry: { ...b.entry as Comp, seq },
  }))
  let items = project(history, history, tools, { resultUpdatesAsUser: true })
  let last = items.at(-1)!
  equal(last.kind, 'user')
  ok(
    'text' in last && last.text.startsWith('From the echo tool:\n') &&
      last.text.endsWith('\nr'),
  )
})

test('closing a turn identifies the generated system message', () => {
  let items = closed([{ kind: 'assistant', text: 'Finished.' }])
  let last = items.at(-1)!
  ok('text' in last && last.text.startsWith('From the system:\n'))
})

test('inherited assistant history names the parent and its calls while the receiver owns only its output', () => {
  let history = [
    line('parent-answer', {
      entry: { session: 'p' },
      output: {},
      content: { body: 'I checked it.' },
    }),
    line('parent-call', {
      entry: { session: 'p' },
      call: { id: 'c', to: 'echo', args: {} },
    }),
    line('result', {
      entry: { session: 'p' },
      result: { call: 'parent-call' },
    }),
    line('own', { output: {}, content: { body: 'I finished it.' } }),
  ]
  let items = project(history, history, tools, { session: 's' })
  equal(items[0], {
    kind: 'assistant',
    text: 'From your parent session:\nI checked it.',
  })
  ok(
    items.some((i) =>
      'text' in i &&
      i.text.includes('tool calls were made by your parent session')
    ),
  )
  equal(items.at(-1), { kind: 'assistant', text: 'I finished it.' })
})
