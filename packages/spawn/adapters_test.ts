import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from 'smol-toml'
import { claude, codex, grok } from './adapters.ts'

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

test('grok refuses a run it cannot give its servers or take them from', () => {
  // This machine's server is `yak mcp`, which grok's own config names.
  let here = { mcp: { tasks: 'http://localhost:5173/mcp' } }
  assertEquals(grok.argv({ ...job, ...here }).slice(0, 2), ['grok', '-p'])
  for (
    let ask of [
      { mcp: { yaks: 'https://yaks.app/mcp' } },
      { without: ['railway'] },
      { bare: true },
    ]
  ) assertThrows(() => grok.argv({ ...job, ...ask }), Error)
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
