// The regression behind T-24455: the real approved-task sweep runs in the
// doing owner, but its graph-native Session consequence belongs to serving.
// Two SQLite connections and two feeds model the production split; no boot
// relay or process restart is involved.
import { assert, assertEquals } from '@std/assert'

let graph = Deno.env.get('DB_PATH')!

let { apply, eager, journalSince } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { db } = await import('./live_db.ts')
let { catchup } = await import('./catchup.ts')
let { attemptEligible, dispatchSweep } = await import('./dispatch.ts')
let { configureEffects, dispatch } = await import('./effects.ts')
let { wireDoing } = await import('./doing.ts')
let { codexPending } = await import('./sessions.ts')
let { writeSession } = await import('./session_store.ts')
let { rowsFor } = await import('./graph_query.ts')

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
  let old = crypto.randomUUID(), setting = crypto.randomUUID()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Split project' } },
    { eid: project, name: 'project', comp: {} },
    { eid: project, name: 'repo', comp: { path: repo } },
    { eid: task, name: 'doc', comp: { title: 'Launch through serving' } },
    { eid: task, name: 'task', comp: { priority: 0, project } },
    { eid: task, name: 'decided', comp: { at: new Date().toISOString() } },
    {
      eid: setting,
      name: 'setting',
      comp: { key: 'DISPATCH_RETRY_BACKOFF', value: '1' },
    },
    {
      eid: old,
      name: 'session',
      comp: { id: crypto.randomUUID(), requested_task: task, actor: project },
    },
    { eid: task, name: 'claim', comp: { session: old } },
  ])
  await new Promise((resolve) => setTimeout(resolve, 5))
  // Terminal failure releases the claim. The write rule mints resume.at/rank;
  // the retained failed Session is evidence, while that generation authorizes
  // one later Session after the configured backoff.
  writeSession(db, old, {
    status: 'failed',
    finished_at: new Date().toISOString(),
  })
  apply(db, [{ eid: task, name: 'claim', comp: null }])
  let generation = eager(db, task).resume
  assert(generation?.at, 'claim release minted a resume generation')
  await new Promise((resolve) => setTimeout(resolve, 5))
  let retryRows = rowsFor(db, [task, old])
  assert(
    attemptEligible(retryRows, task, Date.now(), 1),
    `released generation is retry eligible: ${JSON.stringify(retryRows)}`,
  )

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
     where s.requested_task = (select id from entity where eid = ?)
     order by e.num desc limit 1`,
  ).get(task) as { eid: string } | undefined)?.eid
  assert(born, 'the actual dispatcher minted a Session')
  assert(
    born != old,
    `retry is a new Session, never mutation of the failure (${
      JSON.stringify(generation)
    }; telemetry ${
      JSON.stringify(
        db.prepare(
          'select name, error, detail from tool_call order by rowid desc limit 3',
        ).all(),
      )
    })`,
  )
  assertEquals(
    Number(
      (db.prepare(
        `select count(*) as n from session where requested_task =
       (select id from entity where eid = ?)`,
      ).get(task) as { n: number }).n,
    ),
    2,
    'the failed attempt and retry both remain queryable',
  )
  assert(
    db.prepare(
      'select 1 from settled where entity = (select id from entity where eid = ?) and status = ?',
    )
      .get(old, 'failed'),
    'the old terminal failure remains queryable',
  )
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

  // A repeated sweep sees that this resume generation already has a birth.
  restore()
  restore = configureEffects({
    split: true,
    want: (w) => w == 'do',
    settle: daemonFeed.settle,
  })
  await dispatchSweep(() => {}, ready)
  assertEquals(
    Number(
      (db.prepare(
        `select count(*) as n from session where requested_task =
       (select id from entity where eid = ?)`,
      ).get(task) as { n: number }).n,
    ),
    2,
    'the resume generation is consumed exactly once',
  )
  assertEquals(starts, 1, 'the retry launcher runs exactly once')

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
console.log('split dispatcher launched one retained-failure retry')
