// The transcript as the page draws it, over yak entries: what each entry says,
// what the session is waiting on, and paging. No server, browser, or process.
import './testing.ts'
import { assertEquals } from '@std/assert'
import { type EntryRow, graphLog, pageEntries } from './entry_log.ts'

let row = (
  eid: string,
  seq: number,
  comps: EntryRow['comps'],
): EntryRow => ({ eid, seq, comps: { entry: { session: 's', seq }, ...comps } })

let names = (eid: string) =>
  ({ gpt: 'gpt-6', bash: 'bash', query: 'graph_query' })[eid]

let turn = [
  row('input', 1, {
    content: { body: 'do it' },
    created: { at: '2026-08-12T00:00:00Z' },
  }),
  row('ask', 2, {
    ask: { to: 'gpt', through: 'input' },
    usage: { input: 8, cached: 3, output: 5, reasoning: 2 },
  }),
  row('call', 3, {
    call: {
      to: 'bash',
      id: 'c1',
      args: { command: 'printf yes' },
      source: 'ask',
    },
  }),
  row('result', 4, {
    result: { call: 'call' },
    content: { body: 'yes' },
    exit: { code: 0 },
  }),
  row('ask2', 5, {
    ask: { to: 'gpt', through: 'result' },
    usage: { input: 21 },
  }),
  row('final', 6, { content: { body: 'done' }, output: { source: 'ask2' } }),
]

Deno.test('a transcript says who said what, in order', () => {
  let log = graphLog(turn.toReversed(), names)
  assertEquals(log.entries.map((e) => e.seq), [1, 2, 3, 4, 5, 6])
  assertEquals(log.entries.map((e) => e.row), [
    { kind: 'say', role: 'user', text: 'do it', at: '2026-08-12T00:00:00Z' },
    {
      kind: 'turn',
      model: 'gpt-6',
      usage: JSON.stringify({
        input_tokens: 8,
        cached_input_tokens: 3,
        output_tokens: 5,
        reasoning_tokens: 2,
      }),
      context: 8,
    },
    { kind: 'exec', command: 'printf yes', desc: 'bash' },
    { kind: 'tool', name: '↳ bash', detail: 'yes', ok: true },
    {
      kind: 'turn',
      model: 'gpt-6',
      usage: JSON.stringify({
        input_tokens: 21,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
      }),
      context: 21,
    },
    { kind: 'say', role: 'agent', text: 'done' },
  ])
  assertEquals(log.entries[3].call, 'call')
  assertEquals(log.context, 21)
  assertEquals(log.activity, undefined)
})

Deno.test('what an entry is decides its row', () => {
  let shown = (comps: EntryRow['comps']) =>
    graphLog([row('e', 1, comps)], names).entries[0].row
  assertEquals(
    shown({ call: { to: 'query', args: { q: '.task' } } }),
    { kind: 'tool', name: 'graph_query', detail: '{"q":".task"}' },
  )
  assertEquals(shown({ call: { to: 'gone', args: {} } }), {
    kind: 'tool',
    name: 'tool',
    detail: '{}',
  })
  assertEquals(shown({ ask: { to: 'gpt' } }), {
    kind: 'sys',
    tag: 'ask',
    text: 'gpt-6',
  })
  assertEquals(shown({ error: { code: 'rate_limited' } }), {
    kind: 'error',
    text: 'rate_limited',
  })
  assertEquals(shown({ exception: { message: 'boom' } }), {
    kind: 'error',
    text: 'boom',
  })
  assertEquals(shown({ stop: {} }), { kind: 'sys', tag: 'stop' })
  assertEquals(
    shown({ content: { body: 'hmm' }, output: { source: 'a' }, reasoning: {} }),
    { kind: 'reason', text: 'hmm' },
  )
  assertEquals(
    shown({ content: { body: '' }, output: { source: 'a' }, reasoning: {} }),
    undefined,
  )
  assertEquals(
    shown({ content: { body: 'You are Ada.' }, prompt: { scope: 'local' } }),
    { kind: 'sys', tag: 'instructions', text: 'You are Ada.' },
  )
})

Deno.test('the log says what a working transcript waits on', () => {
  let activity = (rows: EntryRow[]) => graphLog(rows, names).activity
  let input = row('input', 1, { content: { body: 'go' }, using: {} })
  let ask = row('ask', 2, { ask: { to: 'gpt', through: 'input' } })
  let call = row('call', 3, { call: { to: 'query', source: 'ask' } })
  assertEquals(activity([input]), {
    kind: 'runner',
    label: 'waiting for runner…',
  })
  // Nothing asked the daemon: a harness's own model is answering.
  assertEquals(activity([row('typed', 1, { content: { body: 'go' } })]), {
    kind: 'model',
    label: 'waiting for model…',
  })
  assertEquals(activity([input, ask]), {
    kind: 'model',
    label: 'waiting for model…',
  })
  assertEquals(activity([input, ask, call]), {
    kind: 'tool',
    label: 'waiting for graph_query…',
  })
  assertEquals(
    activity([input, ask, {
      ...call,
      comps: { ...call.comps, execution: { state: 'running' } },
    }]),
    { kind: 'tool', label: 'running graph_query…' },
  )
  assertEquals(activity(turn), undefined)
  assertEquals(activity([...turn, row('stop', 7, { stop: {} })]), undefined)
})

Deno.test('pageEntries pages the rendered log by sequence', () => {
  let { entries } = graphLog(turn)
  assertEquals(pageEntries(entries, { after: 4 }).map((e) => e.seq), [5, 6])
  assertEquals(
    pageEntries(entries, { tail: 2, limit: 1 }).map((e) => e.seq),
    [5],
  )
})
