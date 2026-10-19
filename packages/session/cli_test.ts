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

test('local prompt context reads its transcript without opening a graph', async () => {
  said.length = 0
  equal(
    await run({
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
test('empty and malformed context hooks finish without graph work', async () => {
  for (let hook of ['{}', 'broken', '{"hook_event_name":"UserPromptSubmit"}']) {
    said.length = 0
    equal(await run({ hook }, context), 0)
    equal(said, [])
  }
})
test('session start and explicit session context delegate to the graph', async () => {
  equal(
    await run(
      { hook: '{"session_id":"a","hook_event_name":"SessionStart"}' },
      context,
    ),
    undefined,
  )
  equal(await run({ session: 'a', hook: 'broken' }, context), undefined)
})

test('structured context delegates to the ordinary tool runner', async () => {
  equal(
    await run({ hook: '{"hook_event_name":"UserPromptSubmit"}' }, {
      ...context,
      json: true,
    }),
    undefined,
  )
})

let config = Deno.makeTempFileSync()
Deno.writeTextFileSync(config, JSON.stringify({ port: 1 }))

test('prompt submission prints timing without fetching historical context', async () => {
  let fetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = () => {
    requests++
    return Promise.resolve(new Response('private historical words'))
  }
  let out: string[] = []
  try {
    equal(
      await run({
        hook: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          transcript_path: path,
          prompt: 'attachment files',
        }),
      }, { ...context, config, out: (s) => out.push(s) }),
      0,
    )
    equal(requests, 0)
    equal(out.length, 1)
    equal(out[0].includes('private historical words'), false)
  } finally {
    globalThis.fetch = fetch
  }
})
