// The first-party loop against fake transport, fake tools, and an in-memory
// ordered log. Tests pin projection, provider boundaries, concurrency, errors,
// unknown evidence, instructions, and graph-native correlation.
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { type EntrySpec, type UsageValue } from './entries.ts'
import { type ToolHost } from './harness_tools.ts'
import {
  type ResponseEvent,
  type ResponseItem,
  type ResponseResult,
} from './responses.ts'
import {
  type EntryRow,
  executeCall,
  generationEntries,
  instructions,
  project,
  runTurn,
  type TurnLog,
} from './runner.ts'

let result = (
  items: ResponseItem[],
  unknown: ResponseEvent[] = [],
): ResponseResult => ({
  model: 'gpt-5.6-sol-serving',
  items,
  unknown,
  unknownItems: items.filter((item) => item.type == 'future_item'),
  usage: { input: 10, cached: 3, output: 5, reasoning: 2, raw: {} },
  response: { status: 'completed' },
  limits: {},
})

let row = (
  eid: string,
  seq: number,
  comps: Record<string, Record<string, unknown>>,
): EntryRow => ({ eid, seq, comps })

Deno.test('instructions load the hierarchy and describe host authority', async () => {
  let tree = await Deno.makeTempDir({ prefix: 'tasks-runner-' })
  let outside = await Deno.makeTempDir({ prefix: 'tasks-runner-out-' })
  try {
    await Deno.mkdir(`${tree}/a/b`, { recursive: true })
    await Deno.writeTextFile(`${tree}/AGENTS.md`, 'root voice')
    await Deno.writeTextFile(`${tree}/a/AGENTS.md`, 'near voice')
    let body = await instructions({
      tree,
      cwd: 'a/b',
      persona: 'patient persona',
      prompt: 'finish T-1',
    })
    assert(body.indexOf('root voice') < body.indexOf('near voice'))
    assertMatch(body, /patient persona/)
    assertMatch(body, /finish T-1/)
    assertMatch(body, /host filesystem and network access/)
    assertMatch(body, /default place for repository\s+changes/)
    assertMatch(body, /concise assistant messages/)
    await assertRejects(
      () => instructions({ tree, cwd: outside }),
      Error,
      'leaves worktree',
    )
  } finally {
    await Deno.remove(tree, { recursive: true })
    await Deno.remove(outside, { recursive: true })
  }
})

Deno.test('instructions describe a Tasks-only session without a worktree', async () => {
  let body = await instructions({ prompt: 'triage the graph' })
  assertMatch(body, /no-code\s+session/)
  assertMatch(body, /Tasks graph tools/)
  assertMatch(body, /concise assistant messages/)
  assertMatch(body, /triage the graph/)
  assertEquals(body.includes('/workspace'), false)
  assertEquals(body.includes('task land'), false)
})

Deno.test('provider items become typed entries and unknown evidence stays opaque', () => {
  let work = generationEntries(
    result([
      {
        type: 'reasoning',
        id: 'reason-1',
        summary: [{ type: 'summary_text', text: 'thinking' }],
        encrypted_content: 'ciphertext',
      },
      {
        type: 'function_call',
        id: 'item-1',
        call_id: 'call-1',
        name: 'shell',
        arguments: '{"command":"pwd","timeout_ms":500}',
      },
      {
        type: 'compaction',
        id: 'compact-1',
        summary: [{ type: 'summary_text', text: 'portable summary' }],
        encrypted_content: 'compact-ciphertext',
      },
      { type: 'future_item', id: 'future-1', payload: { x: 1 } },
      {
        type: 'message',
        id: 'message-1',
        content: [{ type: 'output_text', text: 'done' }],
      },
    ], [{ type: 'response.future.delta', value: 1 }]),
    'generation-1',
  )

  assertEquals(work.calls, [{
    index: 1,
    name: 'shell',
    args: { command: 'pwd', timeout_ms: 500 },
  }])
  assertEquals(work.specs[0].reasoning, {})
  assertEquals(work.specs[0].content.body, 'thinking')
  assertEquals(work.specs[1].bash.command, 'pwd')
  assertEquals(work.specs[1].timeout.ms, 500)
  assertEquals(work.specs[1].opaque.format, 'openai:function_call')
  assertEquals(work.specs[2].checkpoint.through, 'generation-1')
  assertEquals(work.specs[3].opaque.format, 'openai:future_item')
  assertEquals(
    work.specs.at(-1)?.opaque.format,
    'openai:event:response.future.delta',
  )
  assertEquals(work.finalText, 'done')
  assertEquals(work.specs[4].opaque.format, 'openai:message')
  assertEquals(work.usage, { input: 10, cached: 3, output: 5, reasoning: 2 })
})

Deno.test('malformed and unsupported calls remain evidence and receive errors', () => {
  let work = generationEntries(
    result([
      {
        type: 'function_call',
        call_id: 'bad-1',
        name: 'shell',
        arguments: '{no',
      },
      {
        type: 'function_call',
        call_id: 'bad-2',
        name: 'future_tool',
        arguments: '{}',
      },
    ]),
    'generation-1',
  )
  assertMatch(work.calls[0].error ?? '', /valid JSON/)
  assertMatch(work.calls[1].error ?? '', /unsupported tool/)
  assertEquals(work.specs.every((spec) => !!spec.opaque), true)
})

Deno.test('refusals stay typed and replay their provider shape', () => {
  let work = generationEntries(
    result([{
      type: 'message',
      id: 'refusal-1',
      role: 'assistant',
      content: [{ type: 'refusal', refusal: 'I cannot do that.' }],
    }]),
    'generation-old',
  )
  assertEquals(work.specs[0].content.body, 'I cannot do that.')
  assertEquals(work.finalText, 'I cannot do that.')
  let input = project([
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'begin' },
    }),
    row('generation-old', 2, {
      generation: { through: 'user', provider: 'codex', model: 'old' },
    }),
    row('refusal', 3, work.specs[0]),
    row('current', 4, {
      generation: { through: 'refusal', provider: 'codex', model: 'new' },
    }),
  ], 'current')
  assertEquals(input.at(-1), {
    type: 'message',
    id: 'refusal-1',
    role: 'assistant',
    content: [{ type: 'refusal', refusal: 'I cannot do that.' }],
  })
})

Deno.test('same-provider messages and calls replay their complete items', () => {
  let message = {
    type: 'message',
    id: 'message-opaque',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'call next' }],
  }
  let call = {
    type: 'function_call',
    id: 'call-opaque',
    call_id: 'call-key',
    name: 'shell',
    arguments: '{"command":"pwd"}',
    status: 'completed',
  }
  let work = generationEntries(result([message, call]), 'old')
  let input = project([
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'begin' },
    }),
    row('old', 2, {
      generation: { through: 'user', provider: 'codex', model: 'old' },
    }),
    row('message', 3, work.specs[0]),
    row('call', 4, work.specs[1]),
    row('result', 5, {
      result: { call: 'call' },
      content: { body: '/workspace' },
    }),
    row('current', 6, {
      generation: { through: 'result', provider: 'codex', model: 'new' },
    }),
  ], 'current')
  assertEquals(input.slice(1, 3), [message, call])
})

Deno.test('tool replay includes stdout, stderr, and exit status', () => {
  let input = project([
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'begin' },
    }),
    row('old', 2, {
      generation: { through: 'user', provider: 'codex', model: 'old' },
    }),
    row('call', 3, {
      output: { source: 'old' },
      call: { key: 'call-key' },
      patch: { path: '.', diff: '*** Begin Patch' },
    }),
    row('result', 4, {
      result: { call: 'call' },
      content: { body: 'partial output' },
      stderr: { text: 'patch refused' },
      exit: { code: 2 },
    }),
    row('current', 5, {
      generation: { through: 'result', provider: 'codex', model: 'new' },
    }),
  ], 'current') as { type?: string; output?: string }[]
  assertEquals(
    input.find((item) => item.type == 'function_call_output')?.output,
    'partial output\nstderr:\npatch refused\nexit code: 2',
  )
})

Deno.test('an interrupted call replays a synthesized function_call_output', () => {
  // The runner died mid-execution; reconciliation errored the call and no result
  // ever landed. Replay must still pair the call with an output, or the Responses
  // API rejects the whole input as an orphaned function_call.
  let input = project([
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'begin' },
    }),
    row('old', 2, {
      generation: { through: 'user', provider: 'codex', model: 'old' },
    }),
    row('call', 3, {
      output: { source: 'old', key: 'call-item' },
      call: { key: 'call-key' },
      bash: { command: 'git commit' },
      error: { message: 'runner disappeared; operation outcome is ambiguous' },
    }),
    row('current', 4, {
      generation: { through: 'call', provider: 'codex', model: 'new' },
    }),
  ], 'current') as { type?: string; call_id?: string; output?: string }[]
  let call = input.find((item) => item.type == 'function_call')
  let output = input.find((item) => item.type == 'function_call_output')
  assertEquals(call?.call_id, 'call-key')
  assertEquals(output?.call_id, 'call-key')
  assertMatch(String(output?.output), /interrupted/)
  assertMatch(String(output?.output), /ambiguous/)
  // No orphaned call: every function_call is matched by an output.
  let calls = input.filter((item) => item.type == 'function_call')
  let outputs = input.filter((item) => item.type == 'function_call_output')
  assertEquals(calls.length, outputs.length)
})

Deno.test('a completed call is not double-sealed with an interrupted output', () => {
  let input = project([
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'begin' },
    }),
    row('old', 2, {
      generation: { through: 'user', provider: 'codex', model: 'old' },
    }),
    row('call', 3, {
      output: { source: 'old' },
      call: { key: 'call-key' },
      bash: { command: 'pwd' },
    }),
    row('result', 4, {
      result: { call: 'call' },
      content: { body: '/workspace' },
    }),
    row('current', 5, {
      generation: { through: 'result', provider: 'codex', model: 'new' },
    }),
  ], 'current') as { type?: string; output?: string }[]
  let outputs = input.filter((item) => item.type == 'function_call_output')
  assertEquals(outputs.length, 1)
  assertEquals(outputs[0].output, '/workspace')
})

Deno.test('projection keeps opaque keys provider-local and typed history portable', () => {
  let entries = [
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'start' },
    }),
    row('claude-generation', 2, {
      generation: { through: 'user', provider: 'claude', model: 'claude' },
    }),
    row('claude-call', 3, {
      output: { source: 'claude-generation' },
      call: { key: 'claude-secret-key' },
      bash: { command: 'pwd' },
      opaque: {
        format: 'anthropic:call',
        data: '{"type":"provider_secret","key":"claude-secret-key"}',
      },
    }),
    row('claude-result', 4, {
      result: { call: 'claude-call' },
      content: { body: '/workspace' },
    }),
    row('codex-reason', 5, {
      output: { source: 'codex-generation-old' },
      reasoning: {},
      opaque: {
        format: 'openai:reasoning',
        data: '{"type":"reasoning","encrypted_content":"codex-cipher"}',
      },
    }),
    row('codex-generation-old', 6, {
      generation: { through: 'claude-result', provider: 'codex', model: 'old' },
    }),
    row('through', 7, {
      message: { role: 'user' },
      content: { body: 'continue' },
    }),
    row('current', 8, {
      generation: { through: 'through', provider: 'codex', model: 'new' },
    }),
  ]
  let input = project(entries, 'current')
  let body = JSON.stringify(input)
  assertMatch(body, /Tool call: shell/)
  assertMatch(body, /Tool result for shell/)
  assertEquals(body.includes('claude-secret-key'), false)
  assertMatch(body, /codex-cipher/)
})

let memoryLog = (initial: EntryRow[]) => {
  let entries = [...initial]
  let settled: { generation: string; usage: UsageValue }[] = []
  let failures: { generation: string; message: string }[] = []
  let next = 1
  let log: TurnLog = {
    read: () => Promise.resolve(entries.map((entry) => structuredClone(entry))),
    append: (specs: EntrySpec[]) => {
      let eids = specs.map((spec) => {
        let eid = `entry-${next++}`
        entries.push(row(eid, entries.length + 1, structuredClone(spec)))
        return eid
      })
      return Promise.resolve(eids)
    },
    settle: (generation, usage) => {
      settled.push({ generation, usage })
      return Promise.resolve()
    },
    fail: (generation, message) => {
      failures.push({ generation, message })
      return Promise.resolve()
    },
  }
  return { log, entries, settled, failures }
}

Deno.test('the loop runs independent tools concurrently and feeds results back', async () => {
  let state = memoryLog([
    row('input', 1, {
      message: { role: 'user' },
      content: { body: 'run both' },
    }),
  ])
  let requests: Record<string, unknown>[] = []
  let replies = [
    result([
      {
        type: 'function_call',
        id: 'tool-item-1',
        call_id: 'call-1',
        name: 'shell',
        arguments: '{"command":"one"}',
      },
      {
        type: 'function_call',
        id: 'tool-item-2',
        call_id: 'call-2',
        name: 'shell',
        arguments: '{"command":"two"}',
      },
      { type: 'future_item', id: 'future-1', payload: true },
    ]),
    result([{
      type: 'message',
      id: 'answer',
      content: [{ type: 'output_text', text: 'both finished' }],
    }]),
  ]
  let active = 0, peak = 0
  let tools: ToolHost = {
    tools: [{
      type: 'function',
      name: 'shell',
      description: 'fake shell',
      parameters: {},
      strict: true,
    }],
    call: async (_name, args) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return {
        output: `out:${args.command}`,
        facets: { exit: { code: 0 } },
      }
    },
  }
  let out = await runTurn({
    log: state.log,
    through: 'input',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    effort: 'high',
    instructions: 'developer words',
    transport: {
      run: (request) => {
        requests.push(request)
        return Promise.resolve(replies.shift()!)
      },
    },
    tools,
    cacheKey: 'session-1',
  })
  assertEquals(out.finalText, 'both finished')
  assertEquals(peak, 2)
  assertEquals(state.settled.length, 2)
  assertEquals(
    state.entries.filter((entry) => entry.comps.result).length,
    2,
  )
  let replay = JSON.stringify(requests[1].input)
  assertMatch(replay, /function_call_output/)
  assertMatch(replay, /out:one/)
  assertMatch(replay, /out:two/)
  assertEquals(requests[0].instructions, 'developer words')
  assertEquals(requests[0].reasoning, { effort: 'high' })
  assertEquals(requests[0].prompt_cache_key, 'session-1')
  // A known serving model carries the compaction policy so the provider
  // compacts its own replay state past the threshold.
  assertEquals(requests[0].context_management, [{
    type: 'compaction',
    compact_threshold: 300_000,
  }])
  assertEquals(
    state.entries.some((entry) =>
      entry.comps.opaque?.format == 'openai:future_item'
    ),
    true,
  )
})

Deno.test('executeCall recovers typed dispatch and records tool failures as results', async () => {
  let call = row('call', 1, {
    call: { key: 'call-1' },
    output: { source: 'generation' },
    apply: {
      change: '{"eid":"e1","name":"doc","comp":{"title":"x"}}',
    },
  })
  let seen: Record<string, unknown> | undefined
  let tools: ToolHost = {
    tools: [],
    call: (_name, args) => {
      seen = args
      throw new Error('refused')
    },
  }
  let spec = await executeCall(call, tools)
  assertEquals(seen, {
    change: { eid: 'e1', name: 'doc', comp: { title: 'x' } },
  })
  assertEquals(spec.result.call, 'call')
  assertMatch(String(spec.content.body), /tool failed: refused/)
})

Deno.test('a failed generation keeps partial items as inert evidence', async () => {
  let state = memoryLog([
    row('input', 1, {
      message: { role: 'user' },
      content: { body: 'start' },
    }),
  ])
  let fault = Object.assign(new Error('responses: failed'), {
    items: [{
      type: 'function_call',
      call_id: 'partial-call',
      name: 'shell',
      arguments: '{"command":"must-not-run"}',
    }],
    evidence: [{ type: 'response.failed', code: 'provider_error' }],
  })
  let called = false
  await assertRejects(
    () =>
      runTurn({
        log: state.log,
        through: 'input',
        provider: 'codex',
        model: 'gpt-test',
        instructions: 'words',
        transport: { run: () => Promise.reject(fault) },
        tools: {
          tools: [],
          call: () => {
            called = true
            return Promise.resolve({ output: 'wrong' })
          },
        },
      }),
    Error,
    'responses: failed',
  )
  assertEquals(called, false)
  let evidence = state.entries.filter((entry) => entry.comps.opaque)
  assertEquals(evidence.length, 2)
  assertEquals(evidence.some((entry) => entry.comps.call), false)
  assertEquals(state.failures.length, 1)
})

Deno.test('failed provider evidence never re-enters a later generation', () => {
  let partial = {
    type: 'function_call',
    status: 'incomplete',
    call_id: 'cut-off',
    name: 'shell',
    arguments: '{"command":"unfinished',
  }
  let ended = {
    type: 'response.incomplete',
    response: { incomplete_details: { reason: 'max_output_tokens' } },
  }
  let input = project([
    row('user', 1, {
      message: { role: 'user' },
      content: { body: 'begin' },
    }),
    row('failed', 2, {
      generation: { through: 'user', provider: 'codex', model: 'old' },
      error: { message: 'responses: incomplete — max_output_tokens' },
    }),
    row('partial', 3, {
      output: { source: 'failed' },
      opaque: {
        format: 'openai:failed:function_call',
        data: JSON.stringify(partial),
      },
    }),
    row('ended', 4, {
      output: { source: 'failed' },
      opaque: {
        format: 'openai:failed:response.incomplete',
        data: JSON.stringify(ended),
      },
    }),
    row('next', 5, {
      message: { role: 'user' },
      content: { body: 'continue' },
    }),
    row('current', 6, {
      generation: { through: 'next', provider: 'codex', model: 'new' },
    }),
  ], 'current')
  assertEquals(JSON.stringify(input).includes('cut-off'), false)
  assertEquals(JSON.stringify(input).includes('response.incomplete'), false)
  assertEquals(input.at(-1), {
    role: 'user',
    content: [{ type: 'input_text', text: 'continue' }],
  })
})

// A compaction item the provider returned, stored as a checkpoint entry.
let checkpointItem = {
  type: 'compaction',
  id: 'compact-1',
  enc: 'summary-blob',
}

// A history whose codex generation emitted a compaction item at seq 5, then a
// new user turn and a fresh generation. Shared by the bounding/portability
// cases below.
let compacted = (
  {
    source = 'gen-early',
    format = 'openai:compaction',
    through = 'gen-early',
  } = {},
) => [
  row('begin', 1, {
    message: { role: 'user' },
    content: { body: 'the original instruction' },
  }),
  row('gen-early', 2, {
    generation: { through: 'begin', provider: 'codex', model: 'old' },
  }),
  row('early-call', 3, {
    output: { source: 'gen-early' },
    call: { key: 'call-early' },
    bash: { command: 'ls' },
  }),
  row('early-result', 4, {
    result: { call: 'early-call' },
    content: { body: 'a b c' },
  }),
  row('checkpoint', 5, {
    output: { source },
    checkpoint: { through },
    content: { body: 'portable summary of the work so far' },
    opaque: { format, data: JSON.stringify(checkpointItem) },
  }),
  row('resume', 6, {
    message: { role: 'user' },
    content: { body: 'keep going' },
  }),
]

Deno.test('projection bounds the input at the newest valid checkpoint', () => {
  let input = project([
    ...compacted(),
    row('current', 7, {
      generation: { through: 'resume', provider: 'codex', model: 'new' },
    }),
  ], 'current')
  // The summarized prefix (instruction, its calls) is gone from the provider
  // input; the compaction item stands in for it, followed by the new turn.
  assertEquals(input, [
    checkpointItem,
    { role: 'user', content: [{ type: 'input_text', text: 'keep going' }] },
  ])
  assertEquals(JSON.stringify(input).includes('original instruction'), false)
})

Deno.test('a daemon derives the identical bounded request from ordered entries', () => {
  let entries = [
    ...compacted(),
    row('current', 7, {
      generation: { through: 'resume', provider: 'codex', model: 'new' },
    }),
  ]
  // project() holds no state: a restarted daemon replays the same entries and
  // computes the same request, checkpoint boundary and all.
  assertEquals(
    project(entries, 'current'),
    project(entries.toReversed(), 'current'),
  )
})

Deno.test('a provider switch ignores the checkpoint and replays typed history', () => {
  let input = project([
    ...compacted(),
    row('current', 7, {
      generation: { through: 'resume', provider: 'claude', model: 'new' },
    }),
  ], 'current')
  // Claude cannot replay codex's opaque compaction, so the whole prefix is
  // rebuilt from portable typed content — instruction, tool call, and the
  // checkpoint's own summary as a user note.
  let body = JSON.stringify(input)
  assertEquals(body.includes('the original instruction'), true)
  assertEquals(body.includes('portable summary of the work so far'), true)
  assertEquals(body.includes('summary-blob'), false)
})

Deno.test('failed compaction evidence never bounds or re-enters replay', () => {
  // Failed evidence carries no checkpoint component and an openai:failed:*
  // format, so it is neither a boundary nor a replayable item.
  let input = project([
    row('begin', 1, {
      message: { role: 'user' },
      content: { body: 'the original instruction' },
    }),
    row('gen-early', 2, {
      generation: { through: 'begin', provider: 'codex', model: 'old' },
    }),
    row('failed-compaction', 3, {
      output: { source: 'gen-early' },
      opaque: {
        format: 'openai:failed:compaction',
        data: JSON.stringify({ type: 'compaction', enc: 'inert-blob' }),
      },
    }),
    row('resume', 4, {
      message: { role: 'user' },
      content: { body: 'keep going' },
    }),
    row('current', 5, {
      generation: { through: 'resume', provider: 'codex', model: 'new' },
    }),
  ], 'current')
  // The window was not bounded: the original instruction still replays, and
  // the failed blob is absent from the provider input.
  let body = JSON.stringify(input)
  assertEquals(body.includes('the original instruction'), true)
  assertEquals(body.includes('inert-blob'), false)
})

Deno.test('a malformed checkpoint falls back to the previous valid one', () => {
  let input = project([
    ...compacted(),
    // A second, malformed checkpoint after the valid one: its opaque data does
    // not round-trip, so it cannot bound the window.
    row('bad-checkpoint', 7, {
      output: { source: 'gen-early' },
      checkpoint: { through: 'gen-early' },
      opaque: { format: 'openai:compaction', data: '{not json' },
    }),
    row('current', 8, {
      generation: {
        through: 'bad-checkpoint',
        provider: 'codex',
        model: 'new',
      },
    }),
  ], 'current')
  // The newest VALID checkpoint (seq 5) still bounds the window; the malformed
  // one neither bounds nor appears as a replayable item.
  assertEquals(input[0], checkpointItem)
  assertEquals(JSON.stringify(input).includes('original instruction'), false)
})
