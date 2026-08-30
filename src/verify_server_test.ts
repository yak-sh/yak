// Explicit verification's HTTP boundary against a disposable server. The
// policy tests exercise the in-process action; this file proves the remote
// door records one timed HTTP outcome for both a refusal and a successful
// verifier request, with the same message the caller received.
import { assert, assertEquals } from '@std/assert'
import type { DatabaseSync } from './sqlite.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('TASKS_VERIFIER_PROVIDER', 'fake')
Deno.env.set('TASKS_VERIFIER_MODEL', 'fake-fast')

let U = ''
let db: DatabaseSync
let task = ''
let taskId = ''
let alone = { sanitizeOps: false, sanitizeResources: false }
let uid = () => crypto.randomUUID()

if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`

  let store = await import('./live_db.ts')
  let graph = await import('./db.ts')
  db = store.db
  let project = uid()
  let persona = uid()
  let builder = uid()
  task = uid()
  graph.apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Verify HTTP test' } },
    { eid: project, name: 'project', comp: {} },
    {
      eid: project,
      name: 'repo',
      comp: { path: '/tmp/verify-http-test', base_branch: 'main' },
    },
    { eid: persona, name: 'doc', comp: { title: 'verifier' } },
    { eid: persona, name: 'alias', comp: { slug: 'verifier' } },
    { eid: persona, name: 'persona', comp: { home: project } },
    {
      eid: persona,
      name: 'role',
      comp: {
        state: 'running',
        surface: 'managed',
        scope: project,
        quiet: 0,
        cooldown: 300,
        cap: 2,
      },
    },
    { eid: builder, name: 'session', comp: { id: uid() } },
    { eid: task, name: 'doc', comp: { title: 'Completed HTTP work' } },
    { eid: task, name: 'task', comp: { project } },
    { eid: task, name: 'accept', comp: { body: 'exercise POST /verify' } },
  ])
  graph.apply(
    db,
    [{ eid: task, name: 'completed', comp: {} }],
    undefined,
    builder,
  )
  taskId = graph.human(db, task)
  db.exec('delete from tool_call')
}

let request = async (id: string) => {
  let response = await fetch(`http://${U}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return { status: response.status, body: await response.text() }
}

type Call = {
  source: string
  name: string
  ok: number
  ms: number | null
  error: string | null
}

slow(
  'POST /verify records timed success and refusal outcomes',
  alone,
  async () => {
    let missing = await request('missing-verify-task')
    assertEquals(missing, {
      status: 400,
      body: 'no visible task: missing-verify-task',
    })

    let started = await request(taskId)
    assertEquals(started.status, 200)
    let result = JSON.parse(started.body) as {
      state: string
      target: string
      verifier: string
    }
    assertEquals(result.state, 'spawned')
    assertEquals(result.target, taskId)
    assert(result.verifier.startsWith('S-'))

    let telemetry = await (await fetch(`http://${U}/telemetry`))
      .json() as Call[]
    let calls = telemetry.filter((row) =>
      row.source == 'http' && row.name == 'verify'
    )
    assertEquals(calls.length, 2)
    let refused = calls.find((row) => !row.ok)!
    let succeeded = calls.find((row) => !!row.ok)!
    assertEquals(refused.error, missing.body)
    assertEquals(succeeded.error, null)
    assert(typeof refused.ms == 'number' && refused.ms >= 0)
    assert(typeof succeeded.ms == 'number' && succeeded.ms >= 0)
  },
)
