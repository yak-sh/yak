// The CLI usage-report HTTP seam: an expected grammar refusal stays durable
// telemetry without becoming a Session exception or self-healing bug. This is
// a real-server probe because the classification belongs to the /usage route.
import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let url = ''
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  url = `http://127.0.0.1:${port}`
}

slow(
  'POST /usage records telemetry without stamping an exception (T-20579)',
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let { apply, db } = await import('./db.ts')
    let eid = crypto.randomUUID()
    apply(db, [{
      eid,
      name: 'session',
      comp: { id: 'usage-probe-session' },
    }])

    let response = await fetch(`${url}/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        args: ['list', '.status=open', '--fields=id,title'],
        error: 'list does not take --fields',
        session: 'usage-probe-session',
      }),
    })

    assertEquals(response.status, 204)
    assertEquals(
      db.prepare(
        `select source, name, session_id, ok, error, detail from tool_call
         where session_id = ?`,
      ).get('usage-probe-session'),
      {
        source: 'cli',
        name: 'usage',
        session_id: 'usage-probe-session',
        ok: 0,
        error: 'list does not take --fields',
        detail: '["list",".status=open","--fields=id,title"]',
      },
    )
    assertEquals(
      db.prepare(
        `select count(*) as n from exception
         where entity = (select id from entity where eid = ?)`,
      ).get(eid),
      { n: 0 },
    )
    assertEquals(db.prepare('select count(*) as n from bug').get(), { n: 0 })
  },
)
