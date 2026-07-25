// The door, against real processes: a deno symlinked as `claude` IS a
// claude to /proc, so the pid branch is exercised rather than mocked —
// which is the whole point, since the bug this fixes was a predicate that
// never asked the process anything.
import { assertEquals } from '@std/assert'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { listening } = await import('./door.ts')

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
       where eid = ?`,
    ).run(...cols.map((c) => own[c] as string), eid)
  }
  return eid
}

// A live process whose /proc comm is `claude`: comm comes from the name
// exec'd, so a symlink is enough — no build, no fixture binary.
let fakeClaude = async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-door-' })
  Deno.symlinkSync(Deno.execPath(), `${dir}/claude`)
  let c = new Deno.Command(`${dir}/claude`, {
    args: ['eval', 'await new Promise(() => {})'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  for (let i = 0; i < 200; i++) {
    try {
      if (Deno.readTextFileSync(`/proc/${c.pid}/comm`).trim() == 'claude') break
    } catch { /* not exec'd yet */ }
    await new Promise((r) => setTimeout(r, 10))
  }
  return c
}

Deno.test('a managed run is heard through its tail until it settles', () => {
  let going = session({}, { origin: 'managed', status: 'running' })
  let done = session({}, { origin: 'managed', status: 'completed' })
  assertEquals(listening(going), true)
  assertEquals(listening(done), false)
  assertEquals(listening(uid()), false) // no such session
})

Deno.test('a session with no pid and no run has no door', () => {
  assertEquals(listening(session({})), false)
})

Deno.test('a live claude answers, a dead one does not — and only the newest row on a pid is served', async () => {
  let c = await fakeClaude()
  // An EXTERNAL session (the operator's case): origin says nothing, the
  // process says everything.
  let op = session({ pid: c.pid })
  assertEquals(listening(op), true)
  // A /clear reifies a new entity under the same process; the channel
  // follows it forward, so the row it left behind goes quiet.
  let after = session({ pid: c.pid })
  assertEquals(listening(op), false)
  assertEquals(listening(after), true)
  c.kill('SIGKILL')
  await c.status
  assertEquals(listening(after), false)
})

Deno.test("a subagent reifying does not take its operator's door (T-7288)", async () => {
  let c = await fakeClaude()
  let op = session({ pid: c.pid })
  // A subagent is a tool call inside the operator's claude: its row is
  // newer, and wears no pid because a child has no process of its own.
  let kid = session({})
  assertEquals(listening(op), true)
  assertEquals(listening(kid), false)
  c.kill('SIGKILL')
  await c.status
})

Deno.test('a live pid that is not a claude is not a door', () => {
  assertEquals(listening(session({ pid: Deno.pid })), false) // this is deno
})
