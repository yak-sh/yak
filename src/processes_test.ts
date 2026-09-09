// The fleet's binding of @yaks/process (T-35323, T-35328): the three verbs the
// package asks a host for, answered against a :memory: graph. What is under
// test is the SEAM — a bundle lowered into apply(), the query that finds
// unfinished processes, the join that reads desired state whole, and the boot
// reconcile stamping an ending nobody was there to see.
// The launcher itself is the package's own test (packages/process/run_test.ts);
// no child is spawned here.
import { assert, assertEquals } from '@std/assert'
import { type Change } from './types.ts'
import { until } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let tmp = Deno.makeTempDirSync({ prefix: 'tasks-processes-' })
Deno.env.set('PROCESS_DIR', `${tmp}/processes`)

let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { uuid } = await import('./types.ts')
let { processStore, watchProcesses } = await import('./processes.ts')

let heard: Change[] = []
let cast = (changes: Change[]) => void heard.push(...changes)
let comp = (eid: string, name: string) =>
  db.prepare(
    `select * from "${name}" where entity = (select id from entity where eid = ?)`,
  ).get(eid) as Record<string, unknown> | undefined

// A pid that certainly is not running: spawned, waited on, and gone.
let gone = async () => {
  let child = new Deno.Command('sh', {
    args: ['-c', 'exit 0'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let pid = child.pid
  await child.status
  return pid
}

Deno.test('a process bundle lands as a row, and casts', async () => {
  let eid = uuid()
  heard = []
  await processStore(cast).apply([{
    entity: { eid },
    process: { pid: 4242, command: 'sh -c true', cwd: '/tmp' },
  }])
  assertEquals(comp(eid, 'process')?.pid, 4242)
  assertEquals(comp(eid, 'process')?.command, 'sh -c true')
  assert(heard.some((c) => c.eid == eid && c.name == 'process'))
})

Deno.test('a line off a stream lands without an entry to hang on', async () => {
  let proc = uuid(), line = uuid()
  let store = processStore(cast)
  await store.apply([{ entity: { eid: proc }, process: { pid: 7 } }])
  await store.apply([{
    entity: { eid: line },
    content: { body: 'hello', source: proc },
  }])
  assertEquals(comp(line, 'content')?.body, 'hello')
})

Deno.test('running() is every process with no exit and no session of its own', async () => {
  let live = uuid(), done = uuid(), owned = uuid(), sess = uuid()
  let store = processStore(cast)
  await store.apply([
    { entity: { eid: live }, process: { pid: 1 } },
    { entity: { eid: done }, process: { pid: 2 } },
    { entity: { eid: owned }, process: { pid: 3 } },
  ])
  await store.apply([{ entity: { eid: done }, exit: { code: 0 } }])
  // A session's own child is watched by the session launcher, not here.
  cast(apply(db, [{
    eid: sess,
    name: 'session',
    comp: { id: sess, process: owned },
  }]))
  let eids = (await store.running()).map((b) => b.entity.eid)
  assert(eids.includes(live))
  assert(!eids.includes(done))
  assert(!eids.includes(owned))
})

Deno.test('services() reads desired state whole, and only what is there', async () => {
  let want = uuid(), up = uuid(), ended = uuid(), stopped = uuid()
  let store = processStore(cast)
  await store.apply([
    { entity: { eid: want }, service: { command: 'sleep 1' } },
    {
      entity: { eid: up },
      service: { command: 'sleep 2', restart: 'always' },
      process: { pid: 11 },
    },
    {
      entity: { eid: ended },
      service: { command: 'sleep 3', restart: 'on-failure', attempts: 2 },
      process: { pid: 12 },
    },
    {
      entity: { eid: stopped },
      service: { command: 'sleep 4' },
      process: { pid: 13 },
    },
  ])
  await store.apply([{ entity: { eid: ended }, exit: { code: 7 } }])
  await store.apply([{ entity: { eid: stopped }, stop: {} }])
  let rows = Object.fromEntries(
    (await store.services()).map((b) => [b.entity.eid, b]),
  )
  // The three absences the supervisor decides on: no process yet, no ending
  // yet, no stop.
  assertEquals(rows[want].process, undefined)
  assertEquals(rows[want].service, {
    command: 'sleep 1',
    cwd: null,
    restart: null,
    attempts: null,
  })
  assertEquals(rows[up].exit, undefined)
  assertEquals(rows[up].stop, undefined)
  assertEquals(rows[ended].exit, { code: 7 })
  assertEquals((rows[ended].service as Record<string, unknown>).attempts, 2)
  assertEquals(rows[stopped].stop, {})
})

Deno.test('the boot reconcile stamps a process that died while we were away', async () => {
  let eid = uuid()
  await processStore(cast).apply([{
    entity: { eid },
    process: { pid: await gone() },
  }])
  await watchProcesses(cast)
  await until(() => comp(eid, 'exit') !== undefined, {
    label: 'the exit stamp',
  })
  assertEquals(comp(eid, 'exit')?.code, null)
})
