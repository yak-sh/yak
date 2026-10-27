// A failed door files its own bug; a healthy one resolves nothing.
import type { Bundle } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { monitor } from './monitor.ts'

let now = Date.parse('2026-10-10T00:00:00Z')
let answer = (status: number) =>
  (() => Promise.resolve(new Response(null, { status }))) as typeof fetch
// An app's door that sends nothing: its fetch ends at the deadline, with the
// error `AbortSignal.timeout` aborts one with.
let late = new DOMException('timed out', 'TimeoutError')
let hangs =
  ((url: string) =>
    url.includes('/api/me')
      ? Promise.reject(late)
      : answer(405)(url)) as typeof fetch
// What one pass files, as [fault, message] pairs.
let filed = async (send: typeof fetch, last?: number) => {
  let rows: Bundle[] = []
  await monitor(
    { ingest: (b) => (rows.push(...b), Promise.resolve()) },
    last,
    send,
    now,
  )
  return JSON.parse(JSON.stringify(rows.filter((b) => b.error)))
    .map((b: Bundle & { error: { fault: string } }) => [
      b.error.fault,
      (b.exception as { value: string }).value,
    ])
}

test('healthy doors and a fresh heartbeat file nothing and resolve nothing', async () => {
  equal(await filed(answer(405), now), [])
})

test('each door that fails files the bug of that door', async () => {
  equal(await filed(answer(500)), [
    ['tracker|platform-uptime|MCP', 'MCP probe: 500 from https://yaks.app/mcp'],
    [
      'tracker|platform-uptime|app',
      'app probe: 500 from https://yourname.yaks.app/recipes/api/me',
    ],
  ])
})

test('a door that hangs past the deadline files the bug naming it', async () => {
  equal(await filed(hangs), [[
    'tracker|platform-uptime|app',
    'app probe: no answer within 10 s from ' +
    'https://yourname.yaks.app/recipes/api/me',
  ]])
})

test('an overdue heartbeat files the heartbeat bug', async () => {
  equal(await filed(answer(405), now - 300_001), [[
    'tracker|box-heartbeat',
    'Box heartbeat overdue',
  ]])
})
