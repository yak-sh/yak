// A worker command's HTTP answer as both human text and its existing data.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { workerReply } from './app-command.ts'

Deno.test('JSON command answers show fields and keep their raw answer', async () => {
  let payload = { player: 'Elder Wren', level: 'tombsands', x: 27 }
  let res = Response.json(payload)
  let out = await workerReply(res, 'teleport', 'yourname/vale')

  assertStringIncludes(out.text, 'teleport: answered in yourname/vale')
  assertStringIncludes(out.text, '**player**: `"Elder Wren"`')
  assertStringIncludes(out.text, '**level**: `"tombsands"`')
  assertEquals(out.text.includes('{"player":'), false)
  assertEquals(out.value.answer, JSON.stringify(payload))
})

Deno.test('worker command plain text keeps its sentence and answer', async () => {
  let res = new Response('moved to Tombsands', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
  let out = await workerReply(res, 'teleport', 'yourname/vale')
  assertEquals(out, {
    text: 'teleport: moved to Tombsands in yourname/vale',
    value: { answer: 'moved to Tombsands' },
  })
})

Deno.test('JSON MIME suffix and charset render as fields', async () => {
  let res = new Response('{"state":"ready"}', {
    headers: { 'content-type': 'application/vnd.yaks+json; charset=utf-8' },
  })
  let out = await workerReply(res, 'inspect', 'yourname/vale')
  assertStringIncludes(out.text, '**state**: `"ready"`')
  assertEquals(out.value.answer, '{"state":"ready"}')
})
