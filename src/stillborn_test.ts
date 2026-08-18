// T-19149 / D-19177 layer 1: an external ("graph-native", process-backed)
// operator that dies BEFORE its first turn must stamp an `exception` — heal.ts's
// trigger — so a startup crash-loop stops being silent (R-9381's fable operator
// crash-looped undiagnosed for days because a seq-0 death stamped only
// finished_at). The C-19190 guard is the whole point of these tests: the
// exception fires ONLY for a session that was EXPECTED to run (a `role`, or
// `operator: true`); a free interactive external session (a human's
// `task claude`) closed before its first turn is a normal event and must stay
// silent, or heal.ts files a spurious bug for every one.
//
// Drives watched()'s external-death branch against a :memory: graph with a GHOST
// pid (above pid_max, so present()'s /proc walk finds no live provider and the
// door reads shut) and registers the REAL heal effect, so the full wiring —
// watched → stamp → exception facet → fileBug — is proven, not mocked. Every
// write is synchronous through the death branch (followWrite runs its stamp
// before the first await), so these assert without waiting on the clock.
import { assert, assertEquals } from '@std/assert'
import { type Change } from './types.ts'
import { on } from './effects.ts'

Deno.env.set('DB_PATH', ':memory:')
// A filed bug would summon a fixer; point it at the in-repo fake provider and
// never register created(session), so heal's ticket never launches a subprocess.
Deno.env.set('TASKS_FIXER_PROVIDER', 'fake')
Deno.env.set('TASKS_FIXER_MODEL', 'fake-fast')

let { apply, db } = await import('./db.ts')
let { fileBug } = await import('./heal.ts')
let { watched } = await import('./sessions.ts')
let { writeSession } = await import('./session_store.ts')

let uid = () => crypto.randomUUID()
// Component/edge tables are id-keyed (entity int → entity(id)); the spine keeps
// text eid. OWNED locates a component row by its owner eid; idOf resolves an eid
// to the internal id a reference column now stores.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let casts: Change[][] = []
let cast = (c: Change[]) => casts.push(c)
// The real self-healing effect, wired exactly as server.ts wires it: a stamped
// `exception` files its bug. Registering it here is what makes "heal fires" a
// fact this test can observe rather than an assumption.
on('exception', { created: fileBug(cast) })

// Above the kernel's pid_max: /proc has no such entry, so commOf() is empty,
// present() finds no live provider, and watched() takes the death branch.
let ghostPid = 2_147_483_646

let broke = (eid: string) =>
  (db.prepare(`select message from exception where ${OWNED}`).get(eid) as
    | { message: string }
    | undefined)?.message
let finishedAt = (eid: string) =>
  (db.prepare(`select finished_at from session where ${OWNED}`).get(eid) as
    | { finished_at: string | null }
    | undefined)?.finished_at
let filedBugAbout = (eid: string) =>
  !!db.prepare(
    `select 1 from dependency d join bug b on b.entity = d.parent
     where d.type = 'about' and d.child = ${idOf}`,
  ).get(eid)

// A reified external session with a ghost provider pid (present() false), dead
// before its first turn. `extra` sets the "expected to run" signal under test.
let stillborn = (extra: Record<string, unknown> = {}) => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }]) // mints the entity
  writeSession(db, eid, {
    origin: 'external',
    pid: ghostPid,
    latest_seq: 0,
    ...extra,
  })
  return eid
}

let STILLBORN =
  'operator died before its first turn (no diagnostic; process not owned)'

Deno.test('a role operator dead at seq 0 stamps an exception and heal fires', () => {
  // A real role entity: session.role is a reference resolved to its int id on
  // write now (D-18866), so a ghost uuid would store null and read as roleless.
  let role = uid()
  apply(db, [{ eid: role, name: 'role', comp: { state: 'stopped' } }])
  let eid = stillborn({ role })
  watched(cast)(eid, { pid: ghostPid })
  assert(finishedAt(eid), 'the door is stamped shut')
  assertEquals(broke(eid), STILLBORN)
  assert(filedBugAbout(eid), 'heal filed one bug about the dead operator')
})

Deno.test('an operator:true session dead at seq 0 stamps an exception', () => {
  let eid = stillborn({ operator: 1 })
  watched(cast)(eid, { pid: ghostPid })
  assertEquals(broke(eid), STILLBORN)
  assert(filedBugAbout(eid), 'heal filed a bug for the broken operator')
})

Deno.test('a free interactive external session dead at seq 0 stays silent', () => {
  let eid = stillborn() // no role, not an operator — a human's own session
  watched(cast)(eid, { pid: ghostPid })
  assert(finishedAt(eid), 'its ending is still stamped, as before')
  assertEquals(broke(eid), undefined, 'but no exception — a normal close')
  assertEquals(filedBugAbout(eid), false, 'and heal filed nothing')
})

Deno.test('a role operator that produced a turn is a normal end, not a break', () => {
  let role = uid()
  apply(db, [{ eid: role, name: 'role', comp: { state: 'stopped' } }])
  let eid = stillborn({ role, latest_seq: 1 })
  watched(cast)(eid, { pid: ghostPid })
  assert(finishedAt(eid), 'the ending is stamped')
  assertEquals(broke(eid), undefined, 'seq 1 means it ran — no break')
  assertEquals(filedBugAbout(eid), false, 'and no bug')
})
