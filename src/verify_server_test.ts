// Verification's HTTP boundaries against a disposable server. The policy
// tests exercise in-process actions; this file proves remote telemetry and
// the completion → verifier → independent-review lifecycle through /apply.
import { assert, assertEquals } from '@std/assert'
import type { DatabaseSync } from './sqlite.ts'
import { slow, until } from './testing.ts'
import { statusOf } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('TASKS_VERIFIER_PROVIDER', 'fake')
Deno.env.set('TASKS_VERIFIER_MODEL', 'fake-fast')

let U = ''
let db: DatabaseSync
let task = ''
let taskId = ''
let lifecycleTask = ''
let lifecycleBuilder = ''
let lifecycleReviewer = ''
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
  lifecycleBuilder = uid()
  lifecycleReviewer = uid()
  task = uid()
  lifecycleTask = uid()
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
    {
      eid: lifecycleBuilder,
      name: 'session',
      comp: { id: uid() },
    },
    {
      eid: lifecycleReviewer,
      name: 'session',
      comp: { id: uid() },
    },
    { eid: task, name: 'doc', comp: { title: 'Completed HTTP work' } },
    { eid: task, name: 'task', comp: { project } },
    { eid: task, name: 'accept', comp: { body: 'exercise POST /verify' } },
    {
      eid: lifecycleTask,
      name: 'doc',
      comp: { title: 'Verify the effect lifecycle' },
    },
    { eid: lifecycleTask, name: 'task', comp: { project } },
    {
      eid: lifecycleTask,
      name: 'accept',
      comp: { body: 'reject this completion independently' },
    },
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

let post = async (changes: unknown[], via: string) => {
  let response = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-via': via },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    throw new Error(`apply ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

let read = async (id: string) => {
  let response = await fetch(`http://${U}/query?id=${id}`)
  if (!response.ok) {
    throw new Error(`query ${response.status}: ${await response.text()}`)
  }
  return ((await response.json()) as Record<string, unknown>[])[0]
}

let query = async (q: string) => {
  let response = await fetch(`http://${U}/query?${encodeURIComponent(q)}`)
  if (!response.ok) {
    throw new Error(`query ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<Record<string, unknown>[]>
}

let verifiersFor = async (target: string) =>
  (await query('.verifier!')).filter((row) =>
    (row.session as { requested_task?: string })?.requested_task == target
  )

type Journal = {
  changes: { name: string; comp: Record<string, unknown> | null }[]
}

let journal = async (eid: string) => {
  let response = await fetch(`http://${U}/journal?eid=${eid}`)
  if (!response.ok) {
    throw new Error(`journal ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<Journal[]>
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

slow(
  'POST /apply drives one verifier and independent rejection reopens the task',
  alone,
  async () => {
    let completion = [{
      eid: lifecycleTask,
      name: 'completed',
      comp: {},
    }]

    // No explicit verification call participates: the booted server's
    // registered completed effect is the only path that can mint this Session.
    await post(completion, lifecycleBuilder)
    await until(async () => (await verifiersFor(lifecycleTask)).length == 1, {
      label: 'the registered completion effect to mint one verifier',
    })
    let [verifier] = await verifiersFor(lifecycleTask)
    assertEquals((verifier.spawn as { provider?: string }).provider, 'fake')
    assertEquals((verifier.spawn as { model?: string }).model, 'fake-fast')

    // Replaying the same public write is an update to the existing mark, not a
    // second component birth, so the created effect must remain idempotent.
    await post(completion, lifecycleBuilder)
    assertEquals((await verifiersFor(lifecycleTask)).length, 1)

    let completed = await read(lifecycleTask)
    let completedAt = String((completed.completed as { at?: string }).at)
    await until(() => Date.now() > Date.parse(completedAt), {
      label: 'the review clock to pass the completion stamp',
    })

    let review = uid()
    let evidence = 'The acceptance criterion failed through POST /apply.'
    await post([
      { eid: review, name: 'doc', comp: { title: '', body: evidence } },
      {
        eid: review,
        name: 'comment',
        comp: { target: lifecycleTask },
      },
      { eid: review, name: 'review', comp: { verdict: 'rejected' } },
    ], lifecycleReviewer)

    await until(async () => {
      return !(await read(lifecycleTask)).completed
    }, { label: 'the rejecting review effect to retract completed' })
    let reopened = await read(lifecycleTask)
    assertEquals(statusOf(reopened), 'open')
    assertEquals((reopened.task as { status?: string }).status, 'open')
    let history = await journal(lifecycleTask)
    let changes = history.flatMap((entry) => entry.changes)
    assertEquals(
      changes.some((change) =>
        change.name == 'completed' && change.comp == null
      ),
      true,
    )
    assertEquals(
      changes.some((change) =>
        change.name == 'task' && !!change.comp && 'status' in change.comp
      ),
      false,
    )

    let kept = await read(review)
    assertEquals(kept.doc, { title: '', body: evidence })
    assertEquals(kept.comment, { target: lifecycleTask })
    assertEquals(kept.review, { verdict: 'rejected' })
    assertEquals(
      (kept.created as { via?: string }).via,
      lifecycleReviewer,
    )
    assertEquals((await verifiersFor(lifecycleTask)).length, 1)
  },
)
