import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from 'smol-toml'
import { antigravity, claude, codex, gemini, grok } from './adapters.ts'

let job = {
  session: 'S1',
  model: 'opus-5',
  effort: 'high',
  instruction: '-x fix it',
}

// The value of a codex `-c key=value` setting, read the way codex reads it:
// the key as written, split at its dots and never as TOML, and the value as
// TOML, or as the raw string where that does not parse.
let setting = (argv: string[], key: string): unknown => {
  let said = argv.find((a, i) => argv[i - 1] == '-c' && a.startsWith(`${key}=`))
  if (said == null) return undefined
  let raw = said.slice(key.length + 1)
  try {
    return parse(`v = ${raw}`).v
  } catch {
    return raw
  }
}

// Prepare the provider commands and interpret the setting as the consumer does.
let argv = claude.argv(job)
let said = codex.argv(job)
let effort = setting(said, 'model_reasoning_effort')
let unstated = setting(
  codex.argv({ ...job, effort: undefined }),
  'model_reasoning_effort',
)

test('a provider is its argv: the thread it is told to be, and -- last', () => {
  assertEquals(argv[0], 'claude')
  // The session entity is the provider's thread name, so a resume knows it.
  assertEquals(argv[argv.indexOf('--session-id') + 1], 'S1')
  assertEquals(argv[argv.indexOf('--model') + 1], 'opus-5')
  // A dash-leading instruction is content, never an unknown flag.
  assertEquals(argv.slice(-2), ['--', '-x fix it'])

  assertEquals(said.slice(0, 3), ['codex', 'exec', '--json'])
  assertEquals(effort, 'high')
  assertEquals(said.slice(-2), ['--', '-x fix it'])
  // An unstated effort says nothing at all, rather than a flag reading null.
  assertEquals(unstated, undefined)
})

test('a run that carries on resumes its thread instead of naming a new one', () => {
  let again = claude.argv({ ...job, thread: 'T1' })
  assertEquals(again[again.indexOf('--resume') + 1], 'T1')
  assert(!again.includes('--session-id'))
  let more = codex.argv({ ...job, thread: 'T1' })
  assertEquals(more.slice(0, 4), ['codex', 'exec', 'resume', '--json'])
  assertEquals(more.slice(-3), ['--', 'T1', '-x fix it'])
})

test('a persona reaches each provider through its own instruction flag', () => {
  let persona = '# N-1 common\n\n"quoted" \\ and\ttabbed, $was\x7f'
  let said = claude.argv({ ...job, persona })
  assertEquals(said[said.indexOf('--append-system-prompt') + 1], persona)
  let told = codex.argv({ ...job, persona })
  assertEquals(setting(told, 'developer_instructions'), persona)
  // No persona, no flag.
  assert(!claude.argv(job).includes('--append-system-prompt'))
  assertEquals(setting(codex.argv(job), 'developer_instructions'), undefined)
})

test("a run goes without a server through its provider's own way of leaving one out", () => {
  let without = ['claude.ai Google Drive', 'plugin:stripe:stripe', 'yaks.app']
  // Claude reads them as settings for the run: the servers it never connects,
  // each by its name.
  let said = claude.argv({ ...job, without })
  assertEquals(JSON.parse(said[said.indexOf('--settings') + 1]), {
    deniedMcpServers: [
      { serverName: 'claude.ai Google Drive' },
      { serverName: 'plugin:stripe:stripe' },
      { serverName: 'yaks.app' },
    ],
  })
  assertEquals(said.slice(-2), ['--', '-x fix it'])
  // Codex reads them as one table of its config, each name a key of it, a
  // dotted name too.
  assertEquals(setting(codex.argv({ ...job, without }), 'mcp_servers'), {
    'claude.ai Google Drive': { enabled: false },
    'plugin:stripe:stripe': { enabled: false },
    'yaks.app': { enabled: false },
  })
  // Nothing to go without, nothing said.
  assert(!claude.argv(job).includes('--settings'))
  assertEquals(setting(codex.argv(job), 'mcp_servers'), undefined)
})

test('a run names its session to each server it is connected to', () => {
  let mcp = {
    tasks: 'http://localhost/mcp',
    'yaks.app': 'https://yaks.app/mcp',
  }
  let said = claude.argv({ ...job, mcp })
  assertEquals(JSON.parse(said[said.indexOf('--mcp-config') + 1]), {
    mcpServers: {
      tasks: {
        command: 'yak',
        args: ['mcp', '--host', 'http://localhost'],
        env: {
          CLAUDE_CODE_SESSION_ID: 'S1',
          TASKS_SESSION: 'S1',
          AI_AGENT: '',
        },
      },
      'yaks.app': {
        type: 'http',
        url: mcp['yaks.app'],
        headers: { 'x-via': 'S1' },
      },
    },
  })
  // Codex is told the server under the name its own config has, so the
  // header reaches the connection its tools are called through.
  let told = codex.argv({ ...job, mcp, without: ['railway'] })
  assertEquals(setting(told, 'mcp_servers'), {
    railway: { enabled: false },
    tasks: {
      command: 'yak',
      args: ['mcp', '--host', 'http://localhost'],
      env: {
        CLAUDE_CODE_SESSION_ID: 'S1',
        TASKS_SESSION: 'S1',
        AI_AGENT: '',
      },
    },
    'yaks.app': { url: mcp['yaks.app'], http_headers: { 'x-via': 'S1' } },
  })
  assert(!told.some((a) => a.startsWith('mcp_servers.')))
})

test('a run sends a server the token its environment holds, never on its command line', () => {
  let mcp = { yaks: 'https://yaks.app/mcp' }
  let keys = { yaks: 'YAKS_TOKEN' }
  let said = claude.argv({ ...job, mcp, keys })
  assertEquals(
    JSON.parse(said[said.indexOf('--mcp-config') + 1]).mcpServers.yaks.headers,
    { 'x-via': 'S1', authorization: 'Bearer ${YAKS_TOKEN}' },
  )
  assertEquals(setting(codex.argv({ ...job, mcp, keys }), 'mcp_servers'), {
    yaks: {
      url: mcp.yaks,
      http_headers: { 'x-via': 'S1' },
      bearer_token_env_var: 'YAKS_TOKEN',
    },
  })
})

test("a run that names no model runs its CLI's own default", () => {
  let { model: _, ...unnamed } = job
  assert(!claude.argv(unnamed).includes('--model'))
  assert(!codex.argv(unnamed).includes('-m'))
})

test("a bare run is given none of its provider's tools, settings or servers", () => {
  let said = claude.argv({
    ...job,
    bare: true,
    persona: 'Keep the graph true.',
    mcp: { tasks: 'http://localhost/mcp' },
    without: ['railway'],
  })
  assertEquals(said[said.indexOf('--tools') + 1], '')
  assertEquals(said[said.indexOf('--setting-sources') + 1], '')
  for (let flag of ['--safe-mode', '--strict-mcp-config']) {
    assert(said.includes(flag), flag)
  }
  // What it works with is left out whole: it has nothing to connect or permit.
  for (let flag of ['--mcp-config', '--settings', '--permission-mode']) {
    assert(!said.includes(flag), flag)
  }
  // Its persona and its instruction are all it carries.
  assertEquals(
    said[said.indexOf('--append-system-prompt') + 1],
    'Keep the graph true.',
  )
  assertEquals(said.slice(-2), ['--', '-x fix it'])
  // A provider that cannot go without its tools refuses, not runs with them.
  assertThrows(() => codex.argv({ ...job, bare: true }), Error, 'bare')
})

test('grok runs headless on its thread, its persona in its rules', () => {
  let first = grok.argv({ ...job, persona: 'Be brief.' })
  assertEquals(first.slice(0, 2), ['grok', '-p'])
  assertEquals(first[first.indexOf('--session-id') + 1], 'S1')
  assertEquals(
    first[first.indexOf('--output-format') + 1],
    'streaming-messages-json',
  )
  assertEquals(first[first.indexOf('--model') + 1], 'opus-5')
  assertEquals(first[first.indexOf('--reasoning-effort') + 1], 'high')
  assertEquals(first[first.indexOf('--rules') + 1], 'Be brief.')
  assertEquals(first.slice(-2), ['--', '-x fix it'])
  let again = grok.argv({ ...job, thread: 'T1' })
  assertEquals(again[again.indexOf('--resume') + 1], 'T1')
  assert(!again.includes('--session-id'))
})

test('a CLI that keeps its own servers refuses a run it cannot give them to or take them from', () => {
  // This machine's server is `yak mcp`, which each one's own config names.
  let here = { mcp: { tasks: 'http://localhost:5173/mcp' } }
  for (let cli of [grok, gemini, antigravity]) {
    cli.argv({ ...job, ...here })
    for (
      let ask of [
        { mcp: { yaks: 'https://yaks.app/mcp' } },
        { without: ['railway'] },
        { bare: true },
      ]
    ) assertThrows(() => cli.argv({ ...job, ...ask }), Error)
  }
})

test('gemini and agy run headless on their threads, the persona heading the prompt', () => {
  let flag = (argv: string[], name: string) => argv[argv.indexOf(name) + 1]
  let brief = 'Be brief.\n\n---\n\n-x fix it'
  let first = gemini.argv({ ...job, persona: 'Be brief.' })
  assertEquals(flag(first, '--session-id'), 'S1')
  assertEquals(flag(first, '--output-format'), 'stream-json')
  assertEquals(flag(first, '--approval-mode'), 'yolo')
  assertEquals(first.at(-1), `--prompt=${brief}`)
  let again = gemini.argv({ ...job, persona: 'Be brief.', thread: 'T1' })
  assertEquals(flag(again, '--resume'), 'T1')
  // The thread holds the persona from its first run.
  assertEquals(again.at(-1), '--prompt=-x fix it')
  let agy = antigravity.argv({ ...job, persona: 'Be brief.' })
  assert(!agy.includes('--conversation'))
  assertEquals(flag(agy, '--output-format'), 'stream-json')
  assertEquals(flag(agy, '--effort'), 'high')
  assertEquals(JSON.parse(flag(agy, '--settings')), { useG1Credits: false })
  assertEquals(agy.at(-1), `--print=${brief}`)
  assertEquals(
    flag(antigravity.argv({ ...job, thread: 'T1' }), '--conversation'),
    'T1',
  )
})

test("gemini's and agy's streams read as transcripts, their threads named by their opening lines", () => {
  let step = (s: Record<string, unknown>) => ({
    event: 'step_update',
    step_update: { state: 'DONE', ...s },
  })
  let streams = [
    [gemini, [
      { type: 'init', session_id: 'g1', model: 'gemini-3' },
      { type: 'message', role: 'user', content: '-x fix it' },
      { type: 'message', role: 'assistant', content: 'Look', delta: true },
      { type: 'tool_use', tool_name: 'ls', tool_id: 't1', parameters: {} },
      {
        type: 'result',
        status: 'success',
        stats: { input_tokens: 9, output_tokens: 2, cached: 4 },
      },
    ]],
    [antigravity, [
      { event: 'init', conversation_id: 'g1', init: { model: 'gemini-3' } },
      step({ step_index: 0, step_type: 'user_input' }),
      step({
        step_index: 2,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: 'Look',
      }),
      step({
        step_index: 3,
        step_type: 'tool',
        tool_info: { name: 'ls', parameters: {}, output: 'a' },
      }),
      {
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: 'Look',
          usage: { input_tokens: 9, output_tokens: 2, cache_read_tokens: 4 },
        },
      },
    ]],
  ] as const
  for (let [cli, events] of streams) {
    let lines = events.map((e) => cli.read(e))
    assertEquals(lines[0].about, { session: { id: 'g1' } })
    assertEquals(lines[0].model, 'gemini-3')
    // The prompt it echoes is the run's own request already.
    assertEquals(lines[1].entries, [])
    assertEquals(lines[2].part?.entry, {
      content: { body: 'Look' },
      output: {},
    })
    assertEquals(lines[3].entries[0].call?.to, 'ls')
    // The reply the result repeats was said by its parts.
    assertEquals(lines[4].entries, [{
      stop: {},
      usage: { input_tokens: 9, output_tokens: 2, cached_tokens: 4 },
    }])
  }
})

test("grok's stream reads as a transcript, its thread named by its opening line", () => {
  let lines = [
    { type: 'system', subtype: 'init', session_id: 'S1', model: 'grok-build' },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'text', text: 'Reading.' },
          {
            type: 'tool_use',
            id: 'c1',
            name: 'read_file',
            input: { path: 'a.ts' },
          },
        ],
      },
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'x' }],
      },
    },
  ].map(grok.read)
  assertEquals(lines[0].about, { session: { id: 'S1' } })
  assertEquals(lines[0].model, 'grok-build')
  assertEquals(lines[1].entries[0], {
    content: { body: 'Reading.' },
    output: {},
  })
  assertEquals(lines[1].entries[1].call?.to, 'read_file')
  assertEquals(lines[2].entries[0].result?.call, 'c1')
})
