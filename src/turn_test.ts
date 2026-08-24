// The tiny turn-hook executable durably queues lifecycle payloads without
// importing the full CLI graph or waiting for the server event loop.
import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'
import { drain, report, turnOf } from './turn.ts'

Deno.test('turnOf recognizes only turn boundaries', () => {
  assertEquals(turnOf({ hook_event_name: 'UserPromptSubmit' }), 'busy')
  assertEquals(turnOf({ hook_event_name: 'Stop' }), 'idle')
  assertEquals(turnOf({ hook_event_name: 'SessionStart' }), undefined)
})

slow('report appends and drain consumes every queued boundary', () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/turns.jsonl`
  report({ hook_event_name: 'UserPromptSubmit', session_id: 'thread-1' }, path)
  report({ hook_event_name: 'Stop', session_id: 'thread-1' }, path)
  let turns: unknown[] = []
  drain((turn) => turns.push(turn), path)
  assertEquals(turns, [
    { sid: 'thread-1', turn: 'busy' },
    { sid: 'thread-1', turn: 'idle' },
  ])
  Deno.removeSync(dir, { recursive: true })
})
