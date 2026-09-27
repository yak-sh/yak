import { assert, assertEquals } from '@std/assert'
import { parse } from '@std/toml'
import { claude, codex } from './adapters.ts'

let job = {
  session: 'S1',
  model: 'opus-5',
  effort: 'high',
  instruction: '-x fix it',
}

// The value of a codex `-c key=value` setting, read the way codex reads it: as
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
  assertEquals(setting(said, 'model_reasoning_effort'), 'high')
  assertEquals(said.slice(-2), ['--', '-x fix it'])
  // An unstated effort says nothing at all, rather than a flag reading null.
  let unstated = codex.argv({ ...job, effort: undefined })
  assertEquals(setting(unstated, 'model_reasoning_effort'), undefined)
})

Deno.test('a persona reaches each provider through its own instruction flag', () => {
  let persona = '# N-1 common\n\n"quoted" \\ and\ttabbed, $was\x7f'
  let said = claude.argv({ ...job, persona })
  assertEquals(said[said.indexOf('--append-system-prompt') + 1], persona)
  let told = codex.argv({ ...job, persona })
  assertEquals(setting(told, 'developer_instructions'), persona)
  // No persona, no flag.
  assert(!claude.argv(job).includes('--append-system-prompt'))
  assertEquals(setting(codex.argv(job), 'developer_instructions'), undefined)
})
