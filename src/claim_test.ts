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
        task: { status: 'open', project: P },
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
    let ok = await run('claim', tHuman, sHuman)
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
  },
)
