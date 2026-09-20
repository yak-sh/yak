import { assertEquals } from '@std/assert'
import { upgradable } from './host.ts'

let req = (h: Record<string, string> = {}) =>
  new Request('http://x/ws', { headers: h })

Deno.test('upgradable: only a websocket upgrade header opens a socket door', () => {
  assertEquals(upgradable(req()), false)
  assertEquals(upgradable(req({ upgrade: 'h2c' })), false)
  assertEquals(upgradable(req({ upgrade: 'websocket' })), true)
  assertEquals(upgradable(req({ Upgrade: 'WebSocket' })), true)
})
