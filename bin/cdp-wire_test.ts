import { assertEquals } from '@std/assert'
import { wireBreakdown } from './cdp-wire.ts'

Deno.test('CDP breakdown counts UTF-8 control bytes and overlapping row/peer IDs', () => {
  let event = (sent: boolean, frame: unknown) => ({
    method: `Network.webSocketFrame${sent ? 'Sent' : 'Received'}`,
    params: {
      response: {
        payloadData: typeof frame == 'string' ? frame : JSON.stringify(frame),
      },
    },
  })
  let events = [
    event(true, { sub: 'a', q: '.task!' }),
    event(false, {
      sub: 'a',
      changes: [{ eid: 'x' }, { eid: 'x' }],
      peers: [{ eid: 'y' }],
    }),
    event(false, { sub: 'a', changes: [{ eid: 'z' }] }),
    event(false, { sub: 'b', changes: [{ eid: 'x' }] }),
    event(false, { snapshot: { changes: [{ eid: 'boot' }] } }),
    event(false, 'é'),
    event(true, { unsub: 'a' }),
  ]
  let rows = wireBreakdown(events), a = rows.find((r) => r.sub == 'a')!
  assertEquals(a.query, '.task!')
  assertEquals(a.ids, ['x', 'y', 'z'])
  assertEquals([a.frames, a.members, a.peers, a.distinctIDs, a.exclusiveIDs], [
    2,
    2,
    1,
    3,
    2,
  ])
  assertEquals(rows.length, 3)
  assertEquals(
    rows.reduce((sum, r) => sum + r.bytes, 0),
    events.filter((e) => e.method.endsWith('Received')).reduce(
      (n, e) =>
        n + new TextEncoder().encode(e.params.response.payloadData).length,
      0,
    ),
  )
})
