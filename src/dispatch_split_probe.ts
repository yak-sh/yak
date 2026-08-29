// The regression behind T-24455: the real approved-task sweep runs in the
// doing owner, but its graph-native Session consequence belongs to serving.
// Two SQLite connections and two feeds model the production split; no boot
// relay or process restart is involved.
import { assert, assertEquals } from '@std/assert'

let graph = Deno.env.get('DB_PATH')!

let { apply, journalSince, open } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { catchup } = await import('./catchup.ts')
let { dispatchSweep } = await import('./dispatch.ts')
let { configureEffects, dispatch } = await import('./effects.ts')
let { wireDoing } = await import('./doing.ts')
let { codexPending } = await import('./sessions.ts')
let { writeSession } = await import('./session_store.ts')

let run = async (serving: ReturnType<typeof open>, repo: string) => {
  let git = (...args: string[]) =>
    new Deno.Command('git', { cwd: repo, args, stdout: 'null', stderr: 'null' })
      .outputSync()
  git('init', '-b', 'main')
  git('config', 'user.email', 'split@example.test')
  git('config', 'user.name', 'Split Test')
  Deno.writeTextFileSync(`${repo}/README.md`, 'split')
  git('add', '-A')
  git('commit', '-m', 'seed')

  let project = crypto.randomUUID(), task = crypto.randomUUID()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Split project' } },
    { eid: project, name: 'project', comp: {} },
    { eid: project, name: 'repo', comp: { path: repo } },
    { eid: task, name: 'doc', comp: { title: 'Launch through serving' } },
    { eid: task, name: 'task', comp: { priority: 0, project } },
    { eid: task, name: 'decided', comp: { at: new Date().toISOString() } },
  ])

  let starts = 0
  let ready = () =>
    Promise.resolve([{ name: 'codex', models: ['gpt-5.6-sol'] }])
  wireDoing({
    cast: () => {},
    native: {
      soon: () => {},
      start: (eid) => {
        starts++
        // The real native runner would append its prompt/generation. This
        // deterministic stub crosses the same callback and proves the Session
        // has left the sequence-0/pending launch husk.
        writeSession(db, eid, { base_revision: 'stub-started' })
        apply(db, [{
          eid: crypto.randomUUID(),
          name: 'entry',
          comp: { session: eid },
        }])
        return Promise.resolve()
      },
      remove: () => {},
      stop: () => {},
      comment: () => {},
    },
    codexReady: () => Promise.resolve(true),
    readyProviders: ready,
  })

  let servingFeed = catchup(serving, (r) => {
    if (r.trace) {
      dispatch(r.batch, r.trace, () => {}, (w) => w == 'serve')
    }
  })
  let daemonFeed = catchup(db, (r) => {
    if (r.trace) dispatch(r.batch, r.trace, () => {}, (w) => w == 'do')
  })
  let restore = configureEffects({
    split: true,
    want: (w) => w == 'do',
    settle: daemonFeed.settle,
  })

  await dispatchSweep(() => {}, ready)
  let born = (db.prepare(
    `select e.eid as eid from session s join entity e on e.id = s.entity
     where s.requested_task = (select id from entity where eid = ?)`,
  ).get(task) as { eid: string } | undefined)?.eid
  assert(born, 'the actual dispatcher minted a Session')
  let birth = journalSince(db, 0).find((r) =>
    r.batch.some((c) => c.eid == born && c.name == 'session')
  )
  assert(birth?.trace, 'the Session birth carries a fed journal trace')
  assertEquals(starts, 0, 'the doing owner cannot call native.start')

  restore()
  restore = configureEffects({
    split: true,
    want: (w) => w == 'serve',
    settle: servingFeed.settle,
  })
  servingFeed.settle()
  await Promise.resolve()
  assertEquals(starts, 1, 'serving launches before any restart or boot relay')
  assertEquals(
    !!db.prepare(
      `select 1 from session where entity =
       (select id from entity where eid = ?) and ${codexPending}`,
    ).get(born),
    false,
  )
  assert(
    db.prepare(
      'select 1 from entry where session = (select id from entity where eid = ?)',
    ).get(born),
    'the stub advanced the Session beyond sequence 0',
  )

  restore()
}

let repo = Deno.makeTempDirSync({
  dir: Deno.env.get('TMPDIR'),
  prefix: 'dispatch-split-repo-',
})
try {
  let serving = open(graph)
  try {
    await run(serving, repo)
  } finally {
    serving.close()
  }
} finally {
  Deno.removeSync(repo, { recursive: true })
}
console.log('split dispatcher launched graph-native session')
