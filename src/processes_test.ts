// The fleet's binding of @yaks/process (T-35323): the two verbs the package
// asks a host for, answered against a :memory: graph. What is under test is the
// SEAM — a bundle lowered into apply(), the one query that finds unfinished
// processes, and the boot reconcile stamping an ending nobody was there to see.
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
