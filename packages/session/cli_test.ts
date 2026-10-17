// A local prompt context finishes without any graph capability. Lifecycle
// events that need a session still reach the graph's ordinary tool runner.
import { equal, test } from '@yaks/testing'
import type { Ctx } from '@yaks/cli'
import { tools } from './cli.ts'

let path = Deno.makeTempFileSync()
Deno.writeTextFileSync(
  path,
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-17T18:00:00Z',
    message: { stop_reason: 'end_turn' },
  }) + '\n',
)
let said: string[] = []
let context = {
  out: (s: string) => said.push(s),
  json: false,
} as unknown as Ctx
let run = tools.session_context

test('local prompt context reads its transcript without opening a graph', () => {
  said.length = 0
  equal(
    run({
      hook: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        transcript_path: path,
      }),
    }, context),
    0,
  )
  equal(said.length, 1)
  equal(
    said[0].endsWith('previous reply ended: 2026-10-17T18:00:00.000Z.'),
    true,
  )
})
test('empty and malformed context hooks finish without graph work', () => {
  for (let hook of ['{}', 'broken', '{"hook_event_name":"UserPromptSubmit"}']) {
    said.length = 0
    equal(run({ hook }, context), 0)
    equal(said, [])
  }
})
test('session start and explicit session context delegate to the graph', () => {
  equal(
    run(
      { hook: '{"session_id":"a","hook_event_name":"SessionStart"}' },
      context,
    ),
    undefined,
  )
  equal(run({ session: 'a', hook: 'broken' }, context), undefined)
})

test('structured context delegates to the ordinary tool runner', () => {
  equal(
    run({ hook: '{"hook_event_name":"UserPromptSubmit"}' }, {
      ...context,
      json: true,
    }),
    undefined,
  )
})
