// The claim verb's session argument resolves a human S-id like every other
// reference (CLAUDE.md invariant), and NEVER mints a phantom session named
// after the literal string. Two builders ran `task claim <id> S-16450`, which
// silently minted a session whose id was the string "S-16450" and claimed
// under that garbage row; `task land` then reported "no task" (T-16487). This
// drives the REAL CLI against a REAL server, so it is slow(): the fast tier
// skips it, and it takes an ephemeral port handed back before the server binds.
import { fileURLToPath } from 'node:url'
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { query } from './client.ts'
import { idOf } from './types.ts'
import type { Sql } from './store/sql.ts'
import { slow } from '../bin/testing.ts'
import type { Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let U = ''
let sourceSid = '11111111-2222-4333-8444-555555555555'
let sourceEid = ''
let liveDb: Sql | undefined
let alone = { sanitizeOps: false, sanitizeResources: false }
if (Deno.env.get('TASKS_SLOW')) {
  let sourceStore = Deno.makeTempDirSync()
  let sourceProject = `${sourceStore}/project`
  Deno.mkdirSync(sourceProject)
  Deno.writeTextFileSync(
    `${sourceProject}/${sourceSid}.jsonl`,
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'legacy work' }] },
    }),
  )
  let emptySources = Deno.makeTempDirSync()
  Deno.env.set('CLAUDE_PROJECTS', sourceStore)
  Deno.env.set('CODEX_SESSIONS', emptySources)
  // Empty managed logs via a temp HOME, never a global LOGS_DIR: the isolated
  // pass shares one process, and a leaked LOGS_DIR pointed roles_test's
  // managed resume at this dir while it read `$HOME/.tasks/logs`.
  Deno.env.set('HOME', Deno.makeTempDirSync({ prefix: 'tasks-claim-' }))
  sourceEid = (await import('./source_file.ts')).sidEid(sourceSid)
  Deno.env.set('PORT', '0')
  let { http } = await import('./server.ts')
  let port = (http.addr as Deno.NetAddr).port
  liveDb = (await import('./live_db.ts')).db
  U = `127.0.0.1:${port}`
  Deno.env.set('TASKS_HOST', U)
}

let post = async (changes: Change[]) => {
  let res = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error(`apply ${res.status}: ${await res.text()}`)
}

// Each fixture entity asks for a human number the way the doors a person
// authors through ask (`task new`, `task design`, a CLI comment): a num is a
// per-entity REQUEST since T-37071, and `entity.num` is server-owned, so a
// number written as a column is dropped and the id reads as a short eid.
let ent = (
  eid: string,
  comps: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'entity', comp: {}, $num: true },
  ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
]

let uid = (n: number) =>
  `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
let P = uid(1) // the project the session stands in
let S = uid(2) // the real session, external id 'sess-real'
let T = uid(3) // the task to claim

let run = (...args: string[]) =>
  new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      fileURLToPath(new URL('./cli.ts', import.meta.url)),
      ...args,
    ],
    env: { TASKS_HOST: U, TASKS_BACKOFF: '' },
  }).output()

let dec = (b: Uint8Array) => new TextDecoder().decode(b)
let phantoms = async (id: string) =>
  (await query(['.kind=session'])).filter((r) =>
    String(r.comps.session?.id) == id
  )

slow(
  'task claim resolves a human S-id and never mints a phantom (T-16487)',
  alone,
  async () => {
    await post([
      ...ent(P, { doc: { title: 'Home', body: '' }, project: {} }),
      ...ent(S, {
        doc: { title: 'Work session', body: '' },
        session: { id: 'sess-real', cwd: '/w', actor: P },
      }),
      ...ent(T, {
        doc: { title: 'A task', body: '' },
        task: {},
        filed: { project: P },
        decided: {},
        created: { at: '2026-01-01', by: P },
      }),
    ])

    // The server MINTS nums on first touch, so read back the real human ids.
    let srow = (await query(['.kind=session']))
      .find((r) => String(r.comps.session?.id) == 'sess-real')!
    let sHuman = `S-${srow.num}`
    let tHuman = `T-${
      (await query(['.kind=task'])).find((r) => r.eid == T)!.num
    }`

    // Claim by the human session id — it must resolve to S's real entity.
    let ok = await run('claim', tHuman, '--session', sHuman)
    assertEquals(ok.code, 0, dec(ok.stderr))
    // The confirmation names the resolved external id, not the literal S-num.
    assertStringIncludes(dec(ok.stdout), 'sess-real')

    // The lease points at the REAL session, and NO phantom (id === sHuman) exists.
    let task = (await query(['.kind=task'])).find((r) => r.eid == T)
    assertEquals(String(task?.comps.claim?.session), S)
    assertEquals((await phantoms(sHuman)).length, 0)

    // A nonexistent human id ERRORS rather than minting a phantom.
    let bad = await run('claim', tHuman, 'S-999999')
    assertEquals(bad.code, 1)
    assertMatch(dec(bad.stderr), /no entity: S-999999/)
    assertEquals((await phantoms('S-999999')).length, 0)

    // Every human graph address is authoritative. A task, design, or comment
    // cannot fall through to stable session.id minting, and malformed payloads
    // cannot carry a second write shape through the named mutation.
    let guarded = uid(5), wrongTask = uid(6), design = uid(7), comment = uid(8)
    await post([
      ...ent(guarded, {
        doc: { title: 'Guarded task', body: '' },
        task: {},
        filed: { project: P },
        decided: {},
      }),
      ...ent(wrongTask, {
        doc: { title: 'Wrong task identity', body: '' },
        task: {},
        filed: { project: P },
      }),
      ...ent(design, {
        doc: { title: 'Wrong design identity', body: '' },
        design: {},
      }),
      ...ent(comment, {
        doc: { title: 'Wrong comment identity', body: '' },
        comment: { target: guarded },
      }),
    ])
    let rows = [
      ...await query(['.kind=task']),
      ...await query(['.kind=design']),
      ...await query(['.kind=comment']),
    ]
    let address = (eid: string, prefix: string) =>
      `${prefix}-${rows.find((row) => row.eid == eid)!.num}`
    let guardedHuman = address(guarded, 'T')
    let wrongs = [
      address(wrongTask, 'T'),
      address(design, 'D'),
      address(comment, 'C'),
    ]
    let guardedAttempt = (session: unknown, extra = {}) =>
      fetch(`http://${U}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mutation: 'claim_work',
          target: guardedHuman,
          session,
          mode: 'ready',
          ...extra,
        }),
      })
    for (let wrong of wrongs) {
      let refusal = await guardedAttempt(wrong)
      assertEquals(refusal.status, 400)
      assertStringIncludes(await refusal.text(), `${wrong} is not a session`)
      assertEquals((await phantoms(wrong)).length, 0)
    }
    let smuggled = await guardedAttempt('smuggler', {
      changes: [{ eid: uid(9), name: 'project', comp: {} }],
    })
    assertEquals(smuggled.status, 400)
    assertEquals(await smuggled.text(), 'claim_work unknown field: changes')
    let blankCwd = await guardedAttempt('blank-cwd', { cwd: ' ' })
    assertEquals(blankCwd.status, 400)
    assertEquals(await blankCwd.text(), 'claim_work cwd must not be empty')
    let wrongTarget = await fetch(`http://${U}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mutation: 'claim_work',
        target: address(comment, 'C'),
        session: 'wrong-target',
        mode: 'ready',
      }),
    })
    assertEquals(wrongTarget.status, 400)
    assertStringIncludes(await wrongTarget.text(), 'is not a task')
    assertEquals((await phantoms('smuggler')).length, 0)
    assertEquals((await phantoms('blank-cwd')).length, 0)
    assertEquals((await phantoms('wrong-target')).length, 0)
    assertEquals(
      (await query(['.kind=task'])).find((row) => row.eid == guarded)?.comps
        .claim,
      undefined,
    )

    // The source Session is planned as its existing identity, but graduation
    // itself rides the guarded apply transaction. A readiness failure leaves no
    // partial SQL identity; concurrent successful takes graduate once and both
    // claims point at that same eid.
    let sourceFailed = uid(10), sourceA = uid(11), sourceB = uid(12)
    await post([
      ...ent(sourceFailed, {
        doc: { title: 'Source refusal', body: '' },
        task: {},
        filed: { project: P },
        proposed: {},
      }),
      ...ent(sourceA, {
        doc: { title: 'Source claim A', body: '' },
        task: {},
        filed: { project: P },
        decided: {},
      }),
      ...ent(sourceB, {
        doc: { title: 'Source claim B', body: '' },
        task: {},
        filed: { project: P },
        decided: {},
      }),
    ])
    let sourceAttempt = (target: string, session: string) =>
      fetch(`http://${U}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mutation: 'claim_work',
          target,
          session,
          mode: 'ready',
        }),
      })
    let sql = liveDb!
    let journal = Number(
      (sql.prepare('select count(*) as n from journal_tx').get() as {
        n: number
      })
        .n,
    )
    let sourceRefusal = await sourceAttempt(sourceFailed, sourceSid)
    assertEquals(sourceRefusal.status, 400)
    assertStringIncludes(
      await sourceRefusal.text(),
      'proposed but not decided',
    )
    assertEquals(
      sql.prepare('select 1 from entity where eid = ?').get(sourceEid),
      undefined,
    )
    assertEquals(
      Number(
        (sql.prepare('select count(*) as n from journal_tx').get() as {
          n: number
        }).n,
      ),
      journal,
    )

    let sourceClaims = await Promise.all([
      sourceAttempt(sourceA, sourceSid),
      sourceAttempt(sourceB, sourceSid),
    ])
    assertEquals(sourceClaims.map((res) => res.status), [200, 200])
    let sourceTasks = await query(['.kind=task'])
    assertEquals(
      sourceTasks.find((row) => row.eid == sourceA)?.comps.claim?.session,
      sourceEid,
    )
    assertEquals(
      sourceTasks.find((row) => row.eid == sourceB)?.comps.claim?.session,
      sourceEid,
    )
    let sourceSession = (await query(['.kind=session'])).find((row) =>
      row.eid == sourceEid
    )!
    assertEquals(sourceSession.comps.session?.id, sourceSid)
    // A session asks for no human number (T-37071): graduation leaves it the
    // short eid form, which every door resolves the same way.
    assertMatch(idOf(sourceSession), /^S#[0-9a-f]+$/)
    assertEquals(
      sql.prepare(
        `select count(*) as n from session
         where id = ? and entity = (select id from entity where eid = ?)`,
      ).get(sourceSid, sourceEid),
      { n: 1 },
    )
    let replay = await sourceAttempt(sourceA, sourceSid)
    assertEquals(replay.status, 200)
    assertEquals((await replay.json()).changes, [])
    let humanReplay = await sourceAttempt(sourceA, idOf(sourceSession))
    assertEquals(humanReplay.status, 200, await humanReplay.clone().text())
    assertEquals((await humanReplay.json()).changes, [])

    // Two worker takes arriving together serialize at the writer transaction:
    // exactly one claims, the loser leaves no Session, and the existing
    // conflict audit records the collision.
    let racing = uid(4)
    await post(ent(racing, {
      doc: { title: 'Racing task', body: '' },
      task: {},
      filed: { project: P },
      decided: {},
    }))
    let attempt = (session: string) =>
      fetch(`http://${U}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mutation: 'claim_work',
          target: racing,
          session,
          mode: 'ready',
        }),
      })
    let raced = await Promise.all([attempt('racer-a'), attempt('racer-b')])
    assertEquals(raced.map((r) => r.status).sort(), [200, 400])
    let live = (await query(['.kind=task'])).find((r) => r.eid == racing)!
    let sessions = await query(['.kind=session'])
    let winner = sessions.find((r) => r.eid == live.comps.claim?.session)
    assertMatch(String(winner?.comps.session?.id), /^racer-[ab]$/)
    assertEquals(
      sessions.filter((r) => /^racer-[ab]$/.test(String(r.comps.session?.id)))
        .length,
      1,
    )
    assertEquals((await query(['.kind=conflict'])).length >= 1, true)
  },
)
