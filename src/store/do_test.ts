// The store seam's contract, held in workerd itself: `wrangler dev` boots
// workers/store on a probe port with a throwaway persistence directory, and
// the doors are driven over HTTP the way a headless client drives the Deno
// server. Slow tier only — a real runtime boots. The pinned wrangler runs
// through npx (WRANGLER overrides the command); the process is its own
// session so the reap takes workerd down with it, and the test proves the
// reap before it returns.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow, until } from '../testing.ts'

let root = new URL('../../workers/store/', import.meta.url).pathname
let wrangler = (Deno.env.get('WRANGLER') ?? 'npx --yes wrangler@4.42.2')
  .split(' ')

let freePort = () => {
  let l = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let { port } = l.addr as Deno.NetAddr
  l.close()
  return port
}

let listening = async (port: number) => {
  try {
    ;(await Deno.connect({ hostname: '127.0.0.1', port })).close()
    return true
  } catch {
    return false
  }
}

type Row = { entity: { eid: string; num: number }; [k: string]: unknown }

slow('the store on Durable Object SQLite serves the wire', async () => {
  let port = freePort()
  let state = Deno.makeTempDirSync({ prefix: 'tasks-do-' })
  let log = Deno.makeTempFileSync({ prefix: 'tasks-do-', suffix: '.log' })
  // One handle per stream: a WritableStream locks to a single piper.
  let out = Deno.openSync(log, { write: true, append: true })
  let err = Deno.openSync(log, { write: true, append: true })
  let child = new Deno.Command('setsid', {
    args: [
      ...wrangler,
      'dev',
      '--config',
      'wrangler.toml',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      state,
      '--show-interactive-dev-session=false',
    ],
    cwd: root,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let logged = Promise.all([
    child.stdout.pipeTo(out.writable, { preventClose: true }),
    child.stderr.pipeTo(err.writable, { preventClose: true }),
  ])
  let base = `http://127.0.0.1:${port}`
  let get = async (q: string) =>
    (await (await fetch(`${base}/query?${q}`)).json()) as Row[]
  let post = (body: unknown) =>
    fetch(`${base}/apply`, { method: 'POST', body: JSON.stringify(body) })
  let applied = async (body: unknown) => {
    let r = await post(body)
    assertEquals(r.status, 200, await r.clone().text())
    return (await r.json()) as {
      ok: boolean
      changes: { eid: string; name: string; comp: unknown }[]
    }
  }
  try {
    await until(async () => {
      try {
        return (await fetch(`${base}/graph`)).ok
      } catch {
        return false
      }
    }, { timeout: 60_000, poll: 250, label: () => Deno.readTextFileSync(log) })
    // Planted on first touch: the identity door answers with an epoch.
    let serving = await (await fetch(`${base}/graph`)).json()
    assertMatch(serving.epoch, /^[0-9a-f-]{36}$/)
    assertEquals(serving.db, 'do:default/default')

    // A batch: a task, a second task it requires, a comment on it.
    let task = crypto.randomUUID(), dep = crypto.randomUUID()
    let note = crypto.randomUUID()
    let batch = await applied([
      { eid: task, name: 'doc', comp: { title: 'planted', body: 'in a DO' } },
      { eid: task, name: 'task', comp: { priority: 1 } },
      { eid: dep, name: 'doc', comp: { title: 'needed' } },
      { eid: dep, name: 'task', comp: {} },
      { eid: task, name: 'dependency', comp: { type: 'requires', child: dep } },
      { eid: note, name: 'doc', comp: { title: 'a comment', body: 'hi' } },
      { eid: note, name: 'comment', comp: { target: task } },
    ])
    assert(batch.ok)
    assert(batch.changes.some((c) => c.eid == task && c.name == 'entity'))

    // Read back: the filter grammar, edges, and FTS search all serve.
    let [hit] = await get(`id=${task}&deps=1`)
    assertEquals(hit.entity.eid, task)
    assertEquals((hit.doc as { title: string }).title, 'planted')
    assertEquals((hit.task as { status: string }).status, 'open')
    assertEquals(hit.deps, [{ parent: task, type: 'requires', child: dep }])
    assertEquals((await get('.kind=task')).length, 2)
    assertEquals((await get('planted')).map((r) => r.entity.eid), [task])
    let [about] = await get(`.comment.target=${task}`)
    assertEquals(about.entity.eid, note)

    // A claim lease bounces a second session and audits the conflict.
    let a = crypto.randomUUID(), b = crypto.randomUUID()
    await applied([
      { eid: a, name: 'session', comp: { id: 'session-a' } },
      { eid: b, name: 'session', comp: { id: 'session-b' } },
      { eid: task, name: 'claim', comp: { session: a } },
    ])
    let bounce = await post([{
      eid: task,
      name: 'claim',
      comp: { session: b },
    }])
    assertEquals(bounce.status, 400)
    assertMatch(await bounce.text(), /already claimed by session-a/)
    assertEquals((await get('.kind=conflict')).length, 1)

    // A bad batch leaves no partial write: the rename before the refusal is
    // rolled back with it.
    let bad = await post([
      { eid: task, name: 'doc', comp: { title: 'renamed' } },
      { eid: task, name: 'dependency', comp: { type: 'requires', child: 'x' } },
      { eid: task, name: 'task', comp: { priority: 'not a number' } },
    ])
    assertEquals(bad.status, 400)
    assertEquals(
      ((await get(`id=${task}`))[0].doc as { title: string }).title,
      'planted',
    )

    // Deleting the task tombstones it and takes the comment about it along;
    // the reply names the casualty so a client cache drops it too.
    let death = await applied([{ eid: task, name: 'entity', comp: null }])
    assert(death.changes.some((c) => c.eid == note && c.name == 'entity'))
    assertEquals(await get(`id=${task},${note}`), [])
    assertEquals((await get('.kind=task')).map((r) => r.entity.eid), [dep])
    // A late patch for the dead eid is void: accepted, and nothing rises.
    await applied([{ eid: task, name: 'doc', comp: { title: 'ghost' } }])
    assertEquals(await get(`id=${task}`), [])
  } finally {
    // The whole session — wrangler and the workerd it spawned — and proof.
    try {
      await new Deno.Command('kill', { args: ['-TERM', `-${child.pid}`] })
        .output()
    } catch { /* already gone */ }
    await until(async () => !(await listening(port)), {
      timeout: 15_000,
      poll: 100,
      label: 'the probe port to close',
    })
    await child.status
    await logged
    out.close()
    err.close()
    Deno.removeSync(state, { recursive: true })
    Deno.removeSync(log)
  }
})
