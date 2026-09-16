// The classifier tells tool traffic from handshake noise; the outcome reads a
// reply as ok-or-error.

import { assertEquals } from '@std/assert'
import { outcome, toolCall } from './mcp.ts'

Deno.test('toolCall names the tool and its session; noise is null', () => {
  assertEquals(
    toolCall({
      method: 'tools/call',
      params: { name: 'task_list', arguments: { session: 'S-1' } },
    }),
    { name: 'task_list', session_id: 'S-1' },
  )
  assertEquals(toolCall({ method: 'tools/call', params: { name: 'x' } }), {
    name: 'x',
    session_id: null,
  })
  assertEquals(toolCall({ method: 'initialize' }), null)
  assertEquals(toolCall(null), null)
})

Deno.test('outcome: protocol error, isError result, and success', () => {
  assertEquals(outcome({ error: { message: 'bad' } }), {
    ok: false,
    error: 'bad',
  })
  assertEquals(outcome({ error: {} }), { ok: false, error: 'jsonrpc error' })
  assertEquals(
    outcome({
      result: { isError: true, content: [{ type: 'text', text: 'no' }] },
    }),
    { ok: false, error: 'no' },
  )
  assertEquals(outcome({ result: { isError: true } }), {
    ok: false,
    error: 'tool error',
  })
  assertEquals(outcome({ result: {} }), { ok: true, error: null })
})
