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
