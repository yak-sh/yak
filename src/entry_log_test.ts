// Graph Session log projection tests hold the provider-neutral rendering and
// derived-state contract without a server, browser, or process transcript.
import { assert, assertEquals, assertMatch } from '@std/assert'
import {
  contextOf,
  type EntryRow,
  graphLog,
  pageEntries,
  standingOf,
} from './entry_log.ts'

let row = (
  eid: string,
  seq: number,
  comps: EntryRow['comps'],
): EntryRow => ({ eid, seq, comps })

Deno.test('graph log renders ordered calls, results, model, and usage', () => {
  let rows = [
    row('input', 1, {
      message: { role: 'user' },
      content: { body: 'do it' },
      created: { at: '2026-08-12T00:00:00Z' },
    }),
    row('generation', 2, {
      generation: {
        through: 'input',
        provider: 'codex',
        model: 'requested',
        serving_model: 'served',
      },
      usage: { input: 8, cached: 3, output: 5, reasoning: 2 },
      delivered: { at: 'now', via: 'runner:tasksd' },
    }),
    row('call', 3, {
      output: { source: 'generation' },
      call: { key: 'call-1' },
      bash: { command: 'printf yes' },
    }),
    row('result', 4, {
      result: { call: 'call' },
      content: { body: 'yes' },
      exit: { code: 0 },
    }),
    row('final', 5, {
      output: { source: 'generation' },
      message: { role: 'agent' },
      content: { body: 'done' },
    }),
  ]
  let log = graphLog(rows.toReversed())
  assertEquals(log.latest, 5)
  assertEquals(log.terminal, false)
  assertEquals(log.context, 8)
  assertEquals(log.model, 'served')
  assertEquals(log.busy, false)
  assertEquals(log.entries.map((entry) => entry.seq), [1, 2, 3, 4, 5])
  assertEquals(log.entries[0].row?.at, '2026-08-12T00:00:00Z')
  assertEquals(log.entries[1].row, {
    kind: 'turn',
    model: 'served',
    usage: JSON.stringify({
      input_tokens: 8,
      cached_input_tokens: 3,
      output_tokens: 5,
      reasoning_tokens: 2,
    }),
    context: 8,
  })
  assertEquals(log.entries[2].row, {
    kind: 'exec',
    command: 'printf yes',
    desc: 'Command',
  })
  assertEquals(log.entries[3].row, {
    kind: 'tool',
    name: '↳ shell',
    detail: 'yes',
    ok: true,
  })
  assertEquals(log.entries[3].call, 'call')
  assertMatch(log.entries[4].line, /"message":\{"role":"agent"\}/)
})

Deno.test('an imported tool call keeps its real name and arg preview', () => {
  // A tool facet with no first-class kind (bash/patch/…): toolName() reads
  // c.tool.name and the bare-call arm renders its one-line detail (D-16704).
  let log = graphLog([
    row('call', 1, {
      call: { key: 'call-1' },
      tool: { name: 'web_search', detail: 'query: everforest palette' },
    }),
  ])
  assertEquals(log.entries[0].row, {
    kind: 'tool',
    name: 'web_search',
    detail: 'query: everforest palette',
  })
})

Deno.test('graph log reports each request input as its context', () => {
  let rows = [
    row('first', 1, {
      generation: { model: 'gpt' },
      usage: { input: 8000, cached: 3000, output: 5, reasoning: 2 },
      delivered: { at: 'then' },
    }),
    row('second', 2, {
      generation: { model: 'gpt' },
      usage: { input: 21000, cached: 14000, output: 9, reasoning: 4 },
      delivered: { at: 'now' },
    }),
  ]
  assertEquals(
    graphLog(rows).entries.map((entry) =>
      entry.row?.kind == 'turn' ? entry.row.context : undefined
    ),
    [8000, 21000],
  )
})

Deno.test('graph log derives busy and pages by sequence', () => {
  let rows = [
    row('input', 1, { message: { role: 'user' } }),
    row('generation', 2, {
      generation: { through: 'input', provider: 'codex', model: 'asked' },
      lease: { holder: 'runner', at: 'a', until: 'b' },
    }),
    row('attention', 3, { attention: {} }),
  ]
  assertEquals(graphLog(rows).busy, true)
  assertEquals(graphLog(rows).activity, {
    kind: 'model',
    label: 'waiting for model…',
  })
  assertEquals(
    pageEntries(graphLog(rows).entries, { after: 1 }).map((e) => e.seq),
    [2, 3],
  )
  assertEquals(
    pageEntries(graphLog(rows).entries, { tail: 2, limit: 1 }).map((e) =>
      e.seq
    ),
    [2],
  )
})

Deno.test('contextOf reads the latest turn context from usage_json', () => {
  assertEquals(contextOf('{"input_tokens":13966,"output_tokens":5}'), 13966)
  assertEquals(contextOf(undefined), undefined)
  assertEquals(contextOf('{"output_tokens":5}'), undefined)
  assertEquals(contextOf('not json'), undefined)
})

Deno.test('graph log names queued and running tool activity', () => {
  let call = row('call', 2, {
    call: { key: 'one' },
    graph_query: { query: '.task.status=open' },
  })
  assertEquals(graphLog([call]).activity, {
    kind: 'tool',
    label: 'waiting for graph_query…',
  })
  assertEquals(
    graphLog([
      { ...call, comps: { ...call.comps, lease: { holder: 'runner' } } },
    ]).activity,
    {
      kind: 'tool',
      label: 'running graph_query…',
    },
  )
  assertEquals(
    graphLog([
      call,
      row('result', 3, { result: { call: 'call' } }),
    ]).activity,
    undefined,
  )
})

Deno.test('graph log names a generation waiting to be picked up', () => {
  assertEquals(
    graphLog([row('generation', 1, { generation: { model: 'gpt' } })])
      .activity,
    { kind: 'runner', label: 'waiting for runner…' },
  )
})

Deno.test('a drained final answer is terminal until new input arrives', () => {
  let rows = [
    row('input', 1, { message: { role: 'user' } }),
    row('generation', 2, {
      generation: { through: 'input', provider: 'codex', model: 'asked' },
      delivered: { at: 'now' },
    }),
    row('final', 3, {
      output: { source: 'generation', phase: 'final_answer' },
      message: { role: 'agent' },
    }),
  ]
  assertEquals(graphLog(rows).terminal, true)
  assertEquals(
    graphLog([...rows, row('next', 4, { message: { role: 'user' } })])
      .terminal,
    false,
  )
})

Deno.test('assistant progress stays beside tools and empty reasoning hides', () => {
  let log = graphLog([
    row('progress', 1, {
      output: { source: 'generation', phase: 'commentary' },
      message: { role: 'agent' },
      content: { body: 'Checking the worktree.' },
    }),
    row('call', 2, {
      output: { source: 'generation' },
      call: { key: 'call-1' },
      bash: { command: 'git status --short' },
    }),
    row('result', 3, {
      result: { call: 'call' },
      content: { body: '' },
      exit: { code: 0 },
    }),
    row('reasoning', 4, {
      output: { source: 'generation' },
      reasoning: {},
    }),
  ])
  assertEquals(log.entries.map((entry) => entry.row?.kind), [
    'say',
    'exec',
    'tool',
    undefined,
  ])
})

Deno.test('failed generations show their reason, not opaque evidence tags', () => {
  let log = graphLog([
    row('generation', 1, {
      generation: { through: 'input', provider: 'codex', model: 'gpt' },
      error: { message: 'responses: incomplete — max_output_tokens' },
    }),
    row('partial', 2, {
      output: { source: 'generation' },
      opaque: {
        format: 'openai:failed:function_call',
        data: '{"type":"function_call"}',
      },
    }),
  ])
  assertEquals(log.entries.map((entry) => entry.row), [
    { kind: 'error', text: 'responses: incomplete — max_output_tokens' },
    undefined,
  ])
})

Deno.test('output evidence without a lease is not ready twice', () => {
  let rows = [
    row('generation', 1, {
      generation: { through: 'input', provider: 'codex', model: 'asked' },
    }),
    row('output', 2, {
      output: { source: 'generation' },
      opaque: { format: 'openai:future', data: '{}' },
    }),
  ]
  assertEquals(graphLog(rows).busy, false)
})

// standingOf is the busy/terminal fact WITHOUT the entries build (the O(1)
// facet the SessionDot materialization reads). It must never disagree with
// graphLog's own busy/terminal — they share the derivation, this holds the seam.
let agrees = (rows: EntryRow[]) => {
  let log = graphLog(rows)
  let want = log.busy ? 'busy' : log.terminal ? 'terminal' : 'idle'
  assertEquals(standingOf(rows), want)
  return standingOf(rows)
}

Deno.test('standingOf matches graphLog busy/terminal across states', () => {
  // busy: a generation in flight (not delivered, no output sources it)
  assertEquals(
    agrees([row('gen', 1, { generation: { model: 'm' } })]),
    'busy',
  )
  // terminal: the last generation delivered its final answer, nothing pending
  assertEquals(
    agrees([
      row('input', 1, { message: { role: 'user' }, content: { body: 'go' } }),
      row('gen', 2, {
        generation: { through: 'input' },
        delivered: { at: 'x' },
      }),
      row('final', 3, {
        output: { source: 'gen', phase: 'final_answer' },
        message: { role: 'agent' },
        content: { body: 'done' },
      }),
    ]),
    'terminal',
  )
  // idle: delivered generation but no final-answer output — neither busy nor terminal
  assertEquals(
    agrees([
      row('gen', 1, { generation: {}, delivered: { at: 'x' } }),
    ]),
    'idle',
  )
  // pending input after the edge keeps it out of terminal (idle, not completed)
  agrees([
    row('gen', 1, { generation: {}, delivered: { at: 'x' } }),
    row('final', 2, {
      output: { source: 'gen', phase: 'final_answer' },
      message: { role: 'agent' },
    }),
    row('ask', 3, { attention: {} }),
  ])
  // empty log is idle
  assertEquals(agrees([]), 'idle')
})

// T-21829: maintainStanding must not rescan the whole log per turn edge. It reads
// only the current turn's tail, from the last generation's `through` edge —
// standingWindow (entries.ts) picks that seq in SQL; this mirrors the SAME rule
// purely so we can prove, over many logs, that slicing there leaves standingOf's
// verdict IDENTICAL to the whole-log scan. That equivalence is the whole license
// for the optimization: a wrong slice would corrupt the SessionDot facet.
let boundary = (rows: EntryRow[]): number => {
  let sorted = rows.toSorted((a, b) => a.seq - b.seq)
  let gen = sorted.filter((r) => r.comps.generation).at(-1)
  if (!gen) return 1
  let through = sorted.find((r) => r.eid == gen!.comps.generation?.through)
  return through?.seq ?? gen.seq
}
let tail = (rows: EntryRow[]) => {
  let from = boundary(rows)
  return rows.filter((r) => r.seq >= from)
}
// The bounded window yields the same verdict AND is actually smaller than the
// whole log (or equal, for a single-turn / pre-generation log) — a window that
// never shrank would pass equivalence while fixing nothing.
let equiv = (rows: EntryRow[], want: 'busy' | 'terminal' | 'idle') => {
  let full = standingOf(rows)
  assertEquals(full, want, 'full-log verdict')
  assertEquals(standingOf(tail(rows)), full, 'bounded verdict matches full')
  assert(tail(rows).length <= rows.length)
}

// A completed turn: user input, its generation (delivered), a final-answer agent
// output. Seqs are assigned by the caller so turns chain in one log.
let doneTurn = (base: number) => [
  row(`in${base}`, base, {
    message: { role: 'user' },
    content: { body: 'go' },
  }),
  row(`gen${base}`, base + 1, {
    generation: { through: `in${base}` },
    delivered: { at: 'x' },
  }),
  row(`out${base}`, base + 2, {
    output: { source: `gen${base}`, phase: 'final_answer' },
    message: { role: 'agent' },
    content: { body: 'done' },
  }),
]

Deno.test('bounded standing window equals the whole-log scan', () => {
  // Three settled turns, then a fresh generation still in flight → busy. The
  // window drops the six prior-turn rows yet still reads busy from the last gen.
  let busyTail = [
    ...doneTurn(1),
    ...doneTurn(4),
    ...doneTurn(7),
    row('in10', 10, { message: { role: 'user' }, content: { body: 'more' } }),
    row('gen10', 11, { generation: { through: 'in10' } }),
  ]
  equiv(busyTail, 'busy')
  assert(tail(busyTail).length < busyTail.length, 'prior turns are dropped')

  // Same history, last turn delivered its final answer → terminal.
  equiv([...doneTurn(1), ...doneTurn(4), ...doneTurn(7)], 'terminal')

  // A multi-generation turn (tool loop): early generations delivered with tool
  // outputs, the last still open → busy. All share one `through`, so the whole
  // turn is one window and every early generation is resolved inside it.
  equiv([
    row('in1', 1, { message: { role: 'user' } }),
    row('gen1', 2, { generation: { through: 'in1' }, delivered: { at: 'x' } }),
    row('call1', 3, { output: { source: 'gen1' }, call: { key: 'c1' } }),
    row('res1', 4, { result: { call: 'call1' }, content: { body: 'ok' } }),
    row('gen2', 5, { generation: { through: 'in1' } }),
  ], 'busy')

  // An unresolved lease in the current turn → busy, even past settled history.
  equiv([
    ...doneTurn(1),
    row('in4', 4, { message: { role: 'user' } }),
    row('gen4', 5, { generation: { through: 'in4' }, lease: { holder: 'r' } }),
  ], 'busy')

  // An unresolved call (no result) in the current turn → busy.
  equiv([
    ...doneTurn(1),
    row('in4', 4, { message: { role: 'user' } }),
    row('gen4', 5, { generation: { through: 'in4' }, delivered: { at: 'x' } }),
    row('call4', 6, { output: { source: 'gen4' }, call: { key: 'c4' } }),
  ], 'busy')

  // A resolved cancellation closes the provider interaction as interrupted.
  equiv([
    ...doneTurn(1),
    row('in4', 4, { message: { role: 'user' } }),
    row('gen4', 5, { generation: { through: 'in4' } }),
    row('cancel4', 6, { cancel: { target: 'gen4' } }),
  ], 'terminal')

  // A terminal turn reopened by a trailing user message, no generation yet →
  // idle. The window keeps that whole last turn (the last generation is behind
  // the new input), and the verdict still matches.
  equiv([
    ...doneTurn(1),
    ...doneTurn(4),
    row('in7', 7, { message: { role: 'user' }, content: { body: 'again' } }),
  ], 'idle')

  // Pre-generation log (only a user message queued): no boundary, read whole,
  // idle.
  equiv([row('in1', 1, { message: { role: 'user' } })], 'idle')

  // Empty log: idle, window is the (empty) whole log.
  equiv([], 'idle')
})
