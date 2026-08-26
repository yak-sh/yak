// Redaction's HTTP/client seam. The database tests own the mutation details;
// this slow probe proves a removed literal stays in the POST body and the
// server returns only its hash-backed audit, never the bytes it forgot.
import { assertEquals, assertMatch } from '@std/assert'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let port = 0
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  Deno.env.set('TASKS_HOST', `127.0.0.1:${port}`)
  await import('./server.ts')
}

slow(
  'POST /redact forgets through the client without echoing the value',
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let { readComp } = await import('./db.ts')
    let { db } = await import('./live_db.ts')
    let { redact, send } = await import('./client.ts')
    let eid = crypto.randomUUID()
    let secret = "route'\ncredential-12696"
    await send([{
      eid,
      name: 'doc',
      comp: { title: 'Route probe', body: `before ${secret} after` },
    }])

    let out = await redact(eid, secret)

    assertEquals(
      readComp(db, eid, 'doc')?.body,
      'before [redacted] after',
    )
    assertEquals(JSON.stringify(out).includes(secret), false)
    assertMatch(out.audit, /^X-\d+$/)
    assertEquals(
      db.prepare('select count(*) as n from journal where instr(batch, ?) > 0')
        .get(secret),
      { n: 0 },
    )

    let second = crypto.randomUUID()
    let stdinSecret = 'stdin-credential-12696'
    await send([{
      eid: second,
      name: 'doc',
      comp: { title: 'CLI probe', body: stdinSecret },
    }])
    let child = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'redact',
        second,
        '@-',
      ],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let input = child.stdin.getWriter()
    await input.write(new TextEncoder().encode(stdinSecret))
    await input.close()
    let cli = await child.output()
    let said = new TextDecoder().decode(
      new Uint8Array([...cli.stdout, ...cli.stderr]),
    )
    assertEquals(cli.success, true, said)
    assertEquals(said.includes(stdinSecret), false)
    assertEquals(readComp(db, second, 'doc')?.body, '[redacted]')
  },
)
