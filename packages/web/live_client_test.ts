// The replica over a hand-driven socket: what it asks the host, and what a
// frame the host sends does to the box and to the names that asked.
import './testing.ts'
import { assertEquals } from '@std/assert'
import type { Frame, Socket } from '@yaks/sync'
import { liveClient } from './live_client.ts'

// A socket that is open at once, keeps what is sent on it, and lets the test
// speak for the host.
let host = () => {
  let sent: Record<string, unknown>[] = []
  let heard: ((e: Event & { data?: unknown }) => void)[] = []
  let socket: Socket = {
    readyState: 1,
    send: (text) => void sent.push(JSON.parse(text)),
    close: () => {},
    addEventListener: (type, fn) => {
      if (type == 'message') heard.push(fn)
    },
  }
  let say = (f: Frame) => {
    for (let fn of heard) fn({ data: JSON.stringify(f) } as Event & { data: string })
  }
  return { socket, sent, say }
}

let replica = () => {
  let h = host()
  let frames: [string[], Frame, boolean][] = []
  let c = liveClient({
    url: 'http://host.test',
    connect: () => h.socket,
    changed: () => {},
    ready: () => {},
    frame: (subs, f, reset) => void frames.push([subs, f, reset]),
  })
  return { c, frames, ...h }
}

let row = (eid: string, title: string) => ({
  entity: { eid, num: 1 },
  doc: { title },
})

Deno.test('two names on one line share one subscription on the wire', () => {
  let { c, sent } = replica()
  c.open('a', '.doc!')
  c.open('b', '.doc!')
  assertEquals(sent.filter((m) => 'subscribe' in m).length, 1)
  c.close('a')
  assertEquals(sent.filter((m) => 'unsubscribe' in m).length, 0)
  c.close('b')
  assertEquals(sent.filter((m) => 'unsubscribe' in m).length, 1)
})

Deno.test('a frame lands in the box and is reported to every name, first as a reset', () => {
  let { c, frames, sent, say } = replica()
  c.open('a', '.doc!')
  c.open('b', '.doc!')
  let id = String(sent[0].id)
  say({ id, bundles: [row('x', 'One')] })
  assertEquals(c.members('a'), ['x'])
  assertEquals(c.ready('b'), true)
  assertEquals(c.box.ent('x')?.doc, { title: 'One' })
  assertEquals(frames.map(([subs, , reset]) => [subs, reset]), [
    [['a', 'b'], true],
  ])
  say({ id, bundles: [row('x', 'Two')] })
  assertEquals(frames[1][2], false)
  assertEquals(c.box.ent('x')?.doc, { title: 'Two' })
})

Deno.test('a refusal is reported, and lands no rows', () => {
  let { c, frames, sent, say } = replica()
  c.open('a', '.nope!')
  say({ id: String(sent[0].id), refused: { error: 'Refused', message: 'no' } })
  assertEquals(frames[0][1].refused?.message, 'no')
  assertEquals(frames[0][2], false)
  assertEquals(c.members('a'), [])
})

Deno.test('a test server speaks through receive, as changes', () => {
  let { c, frames } = replica()
  c.open('a', '.doc!')
  c.receive({
    sub: 'a',
    replace: true,
    changes: [{ eid: 'x', name: 'doc', comp: { title: 'One' } }],
  })
  assertEquals(c.members('a'), ['x'])
  assertEquals(frames.length, 1)
})
