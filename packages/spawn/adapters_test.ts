import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from 'smol-toml'
import { claude, codex } from './adapters.ts'

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
      tasks: { type: 'http', url: mcp.tasks, headers: { 'x-via': 'S1' } },
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
    tasks: { url: mcp.tasks, http_headers: { 'x-via': 'S1' } },
    'yaks.app': { url: mcp['yaks.app'], http_headers: { 'x-via': 'S1' } },
  })
  assert(!told.some((a) => a.startsWith('mcp_servers.')))
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
