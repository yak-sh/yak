// The claim verb's session argument resolves a human S-id like every other
// reference (CLAUDE.md invariant), and NEVER mints a phantom session named
// after the literal string. Two builders ran `task claim <id> S-16450`, which
// silently minted a session whose id was the string "S-16450" and claimed
// under that garbage row; `task land` then reported "no task" (T-16487). This
// drives the REAL CLI against a REAL server, so it is slow(): the fast tier
// skips it, and it takes an ephemeral port handed back before the server binds.
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { query } from './client.ts'
import { slow } from './testing.ts'
import type { Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let U = ''
let alone = { sanitizeOps: false, sanitizeResources: false }
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
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

let ent = (
  eid: string,
  num: number,
  comps: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'entity', comp: { eid, num } },
  ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
]

let uid = (n: number) =>
  `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
let P = uid(1) // the project the session stands in
let S = uid(2) // the real session, external id 'sess-real', human id S-2
let T = uid(3) // the task to claim, human id T-3

let run = (...args: string[]) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('./cli.ts', import.meta.url).pathname, ...args],
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
      ...ent(P, 1, { doc: { title: 'Home', body: '' }, project: {} }),
      ...ent(S, 2, {
        doc: { title: 'Work session', body: '' },
        session: { id: 'sess-real', cwd: '/w', actor: P },
      }),
      ...ent(T, 3, {
        doc: { title: 'A task', body: '' },
        task: { project: P },
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
      ...ent(guarded, 5, {
        doc: { title: 'Guarded task', body: '' },
        task: { project: P },
        decided: {},
      }),
      ...ent(wrongTask, 6, {
        doc: { title: 'Wrong task identity', body: '' },
        task: { project: P },
      }),
      ...ent(design, 7, {
        doc: { title: 'Wrong design identity', body: '' },
        design: {},
      }),
      ...ent(comment, 8, {
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

    // Two worker takes arriving together serialize at the writer transaction:
    // exactly one claims, the loser leaves no Session, and the existing
    // conflict audit records the collision.
    let racing = uid(4)
    await post(ent(racing, 4, {
      doc: { title: 'Racing task', body: '' },
      task: { project: P },
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
