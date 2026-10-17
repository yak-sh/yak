// A transcript-only hook is a local command even when its configured graph
// cannot be opened. Validation and session-start delegation still apply.
import { equal, test } from '@yaks/testing'
import { cli } from './run.ts'
import { TOOLS, YAK } from './yak.ts'

let dir = Deno.makeTempDirSync({ prefix: 'T-127094-hook-' })
let config = `${dir}/yak.json`
Deno.writeTextFileSync(
  config,
  JSON.stringify({
    db: dir,
    duties: false,
    plugins: ['@yaks/kernel', '@yaks/doc', '@yaks/session'],
  }),
)
let transcript = `${dir}/transcript.jsonl`
Deno.writeTextFileSync(
  transcript,
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-17T18:00:00Z',
    message: { stop_reason: 'end_turn' },
  }) + '\n',
)
let hook = JSON.stringify({
  hook_event_name: 'UserPromptSubmit',
  transcript_path: transcript,
})
let said: string[] = []
let errors: string[] = []
let run = (payload: string, ...extra: string[]) => {
  said.length = errors.length = 0
  return cli(TOOLS, {
    ...YAK,
    argv: [
      '--config',
      config,
      'session',
      'context',
      '--hook',
      payload,
      ...extra,
    ],
    out: (line) => {
      said.push(line)
    },
    note: (line) => {
      errors.push(line)
    },
  })
}
// Run each CLI scenario before timing its assertions. The database path is
// a directory, so any attempt to open SQLite is a real failure.
let snapshot = async (payload: string, ...extra: string[]) => {
  let code = await run(payload, ...extra)
  return { code, said: [...said], errors: [...errors] }
}
let prompt = await snapshot(hook)
let empty = await snapshot('{}')
let invalid = await snapshot(hook, '--not-an-argument', 'x')

test('a local context hook succeeds without an openable graph', () => {
  equal(prompt.code, 0)
  equal(prompt.errors, [])
  equal(prompt.said.length, 1)
  equal(
    prompt.said[0].endsWith('previous reply ended: 2026-10-17T18:00:00.000Z.'),
    true,
  )
})
test('an empty local context hook never opens the configured graph', () => {
  equal(empty, { code: 0, said: [], errors: [] })
})
test('local context hooks still refuse undeclared tool arguments', () => {
  equal(invalid.code, 2)
  equal(invalid.said, [])
})
