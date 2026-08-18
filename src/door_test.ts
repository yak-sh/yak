// The door, against real processes: a deno symlinked as `claude` IS a
// claude to /proc, so the pid branch is exercised rather than mocked —
// which is the whole point, since the bug this fixes was a predicate that
// never asked the process anything.
import { assertEquals } from '@std/assert'
import { fakeClaude, fakeCodex } from './door_fake.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { delivery, present, reachable } = await import('./door.ts')

open()
let uid = () => crypto.randomUUID()

// A session row, with the server-owned columns written the way the server
// writes them (never over the wire).
let session = (
  comp: Record<string, unknown>,
  own: Record<string, unknown> = {},
) => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid(), ...comp } }])
  let cols = Object.keys(own)
  if (cols.length) {
    db.prepare(
      `update session set ${cols.map((c) => `${c} = ?`).join(', ')}
       where entity = (select id from entity where eid = ?)`,
    ).run(...cols.map((c) => own[c] as string), eid)
  }
  return eid
}

Deno.test('a managed run is heard through its tail until it settles', () => {
  let going = session({}, { origin: 'managed', status: 'running' })
  let done = session({}, { origin: 'managed', status: 'completed' })
  assertEquals(delivery(going), {
    state: 'reachable',
    transport: 'managed',
  })
  assertEquals(delivery(done), { state: 'absent', transport: null })
  assertEquals(delivery(uid()), { state: 'absent', transport: null })
})

Deno.test('a session with no pid and no run has no door', () => {
  assertEquals(delivery(session({})), { state: 'absent', transport: null })
})

Deno.test('a live claude answers, a dead one does not — and only the newest row on a pid is served', async () => {
  let c = await fakeClaude()
  // An EXTERNAL session (the operator's case): origin says nothing, the
  // process says everything.
  let op = session({ pid: c.pid })
  assertEquals(delivery(op), { state: 'reachable', transport: 'channel' })
  // A /clear reifies a new entity under the same process; the channel
  // follows it forward, so the row it left behind goes quiet.
  let after = session({ pid: c.pid })
  assertEquals(reachable(op), false)
  assertEquals(reachable(after), true)
  c.kill('SIGKILL')
  await c.status
  assertEquals(reachable(after), false)
})

Deno.test("a subagent reifying does not take its operator's door (T-7288)", async () => {
  let c = await fakeClaude()
  let op = session({ pid: c.pid })
  // A subagent is a tool call inside the operator's claude: its row is
  // newer, and wears no pid because a child has no process of its own.
  let kid = session({})
  assertEquals(reachable(op), true)
  assertEquals(reachable(kid), false)
  c.kill('SIGKILL')
  await c.status
})

Deno.test('a live pid that is not a claude is not a door', () => {
  assertEquals(
    delivery(session({ pid: Deno.pid })),
    { state: 'absent', transport: null },
  )
})

Deno.test('a live Codex pane is queued without claiming content surfaced', async () => {
  let c = await fakeCodex()
  let eid = session({ pid: c.pid, pane: '%42' })
  assertEquals(present(eid), true)
  assertEquals(delivery(eid), { state: 'queued', transport: 'tmux' })
  assertEquals(reachable(eid), false)
  let noPane = session({ pid: c.pid })
  assertEquals(delivery(eid), { state: 'absent', transport: null })
  assertEquals(delivery(noPane), { state: 'queued', transport: null })
  c.kill('SIGKILL')
  await c.status
  assertEquals(present(noPane), false)
  assertEquals(delivery(noPane), { state: 'absent', transport: null })
})
