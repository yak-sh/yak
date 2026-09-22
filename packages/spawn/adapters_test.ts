import { assert, assertEquals } from '@std/assert'
import { claude, codex } from './adapters.ts'

let job = {
  session: 'S1',
  model: 'opus-5',
  effort: 'high',
  instruction: '-x fix it',
}

Deno.test('a provider is its argv: the thread it is told to be, and -- last', () => {
  let argv = claude.argv(job)
  assertEquals(argv[0], 'claude')
  // The session entity is the provider's thread name, so a resume knows it.
  assertEquals(argv[argv.indexOf('--session-id') + 1], 'S1')
  assertEquals(argv[argv.indexOf('--model') + 1], 'opus-5')
  // A dash-leading instruction is content, never an unknown flag.
  assertEquals(argv.slice(-2), ['--', '-x fix it'])

  let said = codex.argv(job)
  assertEquals(said.slice(0, 3), ['codex', 'exec', '--json'])
  assertEquals(said[said.indexOf('-c') + 1], 'model_reasoning_effort=high')
  assertEquals(said.slice(-2), ['--', '-x fix it'])
  // An unstated effort says nothing at all, rather than a flag reading null.
  assert(!codex.argv({ ...job, effort: undefined }).includes('-c'))
})

Deno.test('claude: what it said, what it thought, and how the turn ended', () => {
  let say = claude.entry({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'hello' }] },
  })
  assertEquals(say, { content: { body: 'hello' } })

  let thought = claude.entry({
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking: 'hmm' }] },
  })
  assertEquals(thought, { content: { body: 'hmm' }, reasoning: {} })

  // A tool use is left in the file: written as a `call` it would be handed to
  // this host's own runner, which would run it a second time.
  assertEquals(
    claude.entry({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash' }] },
    }),
    null,
  )

  assertEquals(
    claude.entry({ type: 'result', usage: { input_tokens: 12 } }),
    { stop: {}, usage: { input_tokens: 12 } },
  )
  // A refusal is an ending too — with the diagnosis it carried.
  assertEquals(
    claude.entry({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'over quota',
    }),
    {
      error: { code: 'success' },
      content: { body: 'over quota' },
      stop: {},
    },
  )
  assertEquals(
    claude.about!({ type: 'system', subtype: 'init', session_id: 'abc' }),
    { session: { id: 'abc' } },
  )
})

Deno.test('codex: the item it completed, and the turn it closed', () => {
  assertEquals(
    codex.entry({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'hi' },
    }),
    { content: { body: 'hi' } },
  )
  assertEquals(
    codex.entry({
      type: 'item.completed',
      item: { type: 'command_execution', text: 'ls' },
    }),
    null,
  )
  assertEquals(
    codex.entry({ type: 'turn.completed', usage: { cached_input_tokens: 7 } }),
    { stop: {}, usage: { cached_tokens: 7 } },
  )
  assertEquals(
    codex.entry({ type: 'turn.failed', error: { message: 'nope' } }),
    { error: { code: 'turn.failed' }, content: { body: 'nope' }, stop: {} },
  )
  assertEquals(
    codex.about!({ type: 'thread.started', thread_id: 't1' }),
    { session: { id: 't1' } },
  )
})
