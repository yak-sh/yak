// Session follower contention against a file-backed graph. A second process
// owns SQLite's write lock, reproducing the cross-process shape the in-memory
// lifecycle suite cannot.
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { type Change } from './types.ts'
import { slow } from './testing.ts'

let tmp = Deno.makeTempDirSync({ prefix: 'tasks-session-lock-' })
Deno.env.set('DB_PATH', `${tmp}/tasks.db`)
Deno.env.set('LOGS_DIR', `${tmp}/logs`)
Deno.env.set('POLL_MS', '5')

let { apply, db } = await import('./db.ts')
let { logsDir, recover, running } = await import('./sessions.ts')
let { writeSession } = await import('./session_store.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let row = (eid: string) =>
  db.prepare('select * from session where eid = ?').get(eid) as
    | Record<string, string | number | null>
    | undefined
let log = (eid: string) => `${logsDir()}/${eid}.jsonl`

let INIT = '{"type":"init","session_id":"sid-1","model":"fake-fast"}'
let RESULT = '{"type":"result","final_text":"done"}'

let plant = () => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  writeSession(db, eid, {
    origin: 'managed',
    status: 'running',
    provider: 'fake',
  })
  Deno.mkdirSync(logsDir(), { recursive: true })
  Deno.writeTextFileSync(log(eid), `${INIT}\n${RESULT}\n`)
  return eid
}

let locker = async (ms: number) => {
  let code = `
    import { DatabaseSync } from 'node:sqlite'
    let db = new DatabaseSync(Deno.args[0])
    db.exec('begin immediate')
    console.log('locked')
    await new Promise((go) => setTimeout(go, Number(Deno.args[1])))
    db.exec('rollback')
  `
  let child = new Deno.Command(Deno.execPath(), {
    args: ['eval', code, `${tmp}/tasks.db`, String(ms)],
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let read = child.stdout.getReader()
  let ready = await read.read()
  read.releaseLock()
  assertEquals(new TextDecoder().decode(ready.value).trim(), 'locked')
  return child
}

slow('a graph mutation waits out a handoff writer', async () => {
  let child = await locker(80)
  let eid = uid()
  let began = Date.now()
  try {
    apply(db, [{ eid, name: 'doc', comp: { title: 'waited' } }])
  } finally {
    assertEquals((await child.status).success, true)
  }
  assert(Date.now() - began >= 40)
  assertEquals(
    db.prepare('select title from doc where eid = ?').get(eid),
    { title: 'waited' },
  )
  apply(db, [{ eid, name: 'entity', comp: null }])
})

slow('a failed follower is observed without hiding its rejection', async () => {
  let eid = plant()
  let warned: unknown[][] = []
  let warn = console.warn
  console.warn = (...parts) => warned.push(parts)
  try {
    recover(() => {
      throw new Error('cast broke')
    })
    let done = running.get(eid)!.done
    await new Promise((go) => setTimeout(go, 30))
    await assertRejects(() => done, Error, 'cast broke')
  } finally {
    console.warn = warn
    running.delete(eid)
    apply(db, [{ eid, name: 'entity', comp: null }])
  }
  assertMatch(warned.flat().join(' '), /follower stopped.*cast broke/)
})

slow('a follower waits out a brief SQLite lock', async () => {
  let eid = plant()
  db.exec('pragma busy_timeout = 10')
  let child = await locker(80)
  let began = Date.now()
  let warned: unknown[][] = []
  let warn = console.warn
  console.warn = (...parts) => warned.push(parts)
  try {
    recover(cast)
    await running.get(eid)!.done
  } finally {
    console.warn = warn
    db.exec('pragma busy_timeout = 5000')
    assertEquals((await child.status).success, true)
  }
  assert(Date.now() - began >= 40)
  assertMatch(warned.flat().join(' '), /follower waiting.*database is locked/)
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(row(eid)?.latest_seq, 2)
})
