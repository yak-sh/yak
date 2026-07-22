// The inbound seam: message→changes mapping, request→hook derivation,
// address routing, and the sweep's idempotency — against an in-memory
// db and a fixture FleetApi (no network, no live spool, no stamps
// anywhere but here).
import type { Change } from './types.ts'
import type { FleetMsg, SpoolReq } from './inbound.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { hookChanges, inboundSweep, mailChanges, routeTo } = await import(
  './inbound.ts'
)
let { mailed } = await import('./mail.ts')
let { assertEquals, assertMatch } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)

let mailRow = (eid: string) =>
  db.prepare('select * from mail where eid = ?').get(eid) as Record<
    string,
    string | number | null
  >

// The triage fallback: a project renumbered to P-20, the holdco slot.
let holdco = (() => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'Holdco' } },
    { eid, name: 'project', comp: {} },
  ])
  db.prepare('update entity set num = 20 where eid = ?').run(eid)
  return eid
})()

// An addressed operator to route at.
let operator = (() => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'Venture' } },
    { eid, name: 'project', comp: {} },
    { eid, name: 'email', comp: { address: 'venture@bot.test' } },
  ])
  return eid
})()

// The archive dialect, as rowToJson speaks it: from/to/text, boolean
// verified, ISO received_at riding beside the epoch ts.
let msg = (over: Partial<FleetMsg> = {}): FleetMsg => ({
  id: `msg:1752000000000:abc`,
  ts: 1752000000000,
  received_at: '2025-07-08T18:40:00.000Z',
  dir: 'in',
  from: 'sender@x.test',
  to: 'venture@bot.test',
  subject: 'hello',
  text: 'the body',
  verified: true,
  ...over,
})

Deno.test('routeTo: the address book reversed, case-blind, P-20 the rest', () => {
  assertEquals(routeTo('venture@bot.test'), operator)
  assertEquals(routeTo('VENTURE@bot.test'), operator)
  assertEquals(routeTo('stranger@x.test'), holdco)
  assertEquals(routeTo(null), holdco)
})

Deno.test('mailChanges: subject and body land verbatim, provenance stamps', () => {
  let { wire, stamp } = mailChanges(msg(), operator)
  let doc = wire.find((c) => c.name == 'doc')!.comp!
  let mail = wire.find((c) => c.name == 'mail')!.comp!
  assertEquals(doc.title, 'hello')
  assertEquals(doc.body, 'the body')
  assertEquals(mail.to, 'venture@bot.test')
  assertEquals(mail.from, 'sender@x.test')
  assertEquals(mail.target_eid, operator)
  assertEquals(stamp.message_id, 'msg:1752000000000:abc')
  assertEquals(stamp.verified, 1) // boolean in the dialect, 1/0 in the row
  assertEquals(stamp.received_at, '2025-07-08T18:40:00.000Z')
  // without the ISO copy, the epoch ts still says when
  let fromTs = mailChanges(msg({ received_at: null }), null)
  assertMatch(String(fromTs.stamp.received_at), /^2025-07-08T/)
  // unverified is a VERDICT on the row, never a gate on the content
  let un = mailChanges(msg({ verified: false, subject: '' }), null)
  assertEquals(un.stamp.verified, 0)
  assertEquals(
    un.wire.find((c) => c.name == 'doc')!.comp!.title,
    '(no subject)',
  )
})

Deno.test('hookChanges: the event word, best source first; payload verbatim', () => {
  let base = { id: 'r1', ts: 1752000000000, source: 'github' }
  let named = hookChanges({
    ...base,
    headers: JSON.stringify({ 'X-GitHub-Event': 'issues' }),
    body: '{"action":"opened"}',
  }, holdco)
  assertEquals(named.stamp.event, 'issues') // the sender's own header wins
  assertEquals(named.stamp.payload, '{"action":"opened"}')
  assertEquals(named.stamp.spool_id, 'r1')
  let doc = named.wire.find((c) => c.name == 'doc')!.comp!
  assertEquals(doc.title, 'github: issues')
  let edge = named.wire.find((c) => c.name == 'dependency')!.comp!
  assertEquals(edge.type, 'about')
  assertEquals(edge.child_eid, holdco)
  // a JSON body's own word, when no header names it
  let bodied = hookChanges({
    ...base,
    source: 'posthog',
    body: '{"event":"signup"}',
  }, null)
  assertEquals(bodied.stamp.event, 'signup')
  // nothing to parse: the route itself
  let route = hookChanges({
    ...base,
    source: 'stripe',
    method: 'POST',
    path: '/hook/stripe',
    body: 'not json',
  }, null)
  assertEquals(route.stamp.event, 'POST /hook/stripe')
})

// A fixture spool: counts stamps, never a network in sight.
let fakeApi = (msgs: FleetMsg[], reqs: SpoolReq[] | null) => {
  let notified: string[][] = []
  let processed: string[][] = []
  return {
    api: {
      messages: () => Promise.resolve(msgs),
      notified: (ids: string[]) => {
        notified.push(ids)
        return Promise.resolve()
      },
      requests: () => Promise.resolve(reqs),
      processed: (ids: string[]) => {
        processed.push(ids)
        return Promise.resolve()
      },
    },
    notified,
    processed,
  }
}

let mailCount = () =>
  (db.prepare('select count(*) as n from mail where message_id is not null')
    .get() as { n: number }).n

Deno.test('the sweep: mints once, stamps back, and dir=out never lands', async () => {
  let { api, notified, processed } = fakeApi(
    [msg(), msg({ id: 'out:1:x', dir: 'out' })],
    [{ id: 'r9', source: 'github', body: '{"action":"ping"}' }],
  )
  await inboundSweep(cast, api)
  assertEquals(mailCount(), 1) // the outbound archive row stayed out
  let minted = db.prepare('select * from mail where message_id = ?')
    .get('msg:1752000000000:abc') as Record<string, string | null>
  assertEquals(minted.target_eid, operator) // routed through the address book
  assertEquals(minted.verified as unknown as number, 1)
  // only the ingested id stamps back: the sweep never writes facts
  // about rows it refused (.dir=in should keep them out upstream anyway)
  assertEquals(notified, [['msg:1752000000000:abc']])
  assertEquals(processed, [['r9']])
  let hooks = db.prepare('select * from hook').all() as Record<
    string,
    string
  >[]
  assertEquals(hooks.length, 1)
  assertEquals(hooks[0].source, 'github')
  // sweep again: idempotent on the provenance keys, stamps still answer
  await inboundSweep(cast, api)
  assertEquals(mailCount(), 1)
  assertEquals(
    (db.prepare('select count(*) as n from hook').get() as { n: number }).n,
    1,
  )
  assertEquals(notified.length, 2)
})

Deno.test('no spool yet: requests 404s into null, silently nothing', async () => {
  let before = mailCount()
  let { api, processed } = fakeApi([], null)
  await inboundSweep(cast, api)
  assertEquals(mailCount(), before)
  assertEquals(processed, []) // nothing pulled, nothing stamped
})

Deno.test('inbound mail never delivers: arrival is a record, not an ask', async () => {
  let dir = Deno.makeTempDirSync()
  let sh = `${dir}/mailer.sh`
  Deno.writeTextFileSync(sh, `#!/bin/sh\necho "$@" >> ${dir}/out.txt\n`)
  Deno.chmodSync(sh, 0o755)
  Deno.env.set('TASKS_MAIL_CMD', sh)
  let eid = (db.prepare('select eid from mail where message_id is not null')
    .get() as { eid: string }).eid
  await mailed(cast)(eid, {}) // the live path: created(mail) fires on mints
  assertEquals(mailRow(eid).acted_at, null)
  try {
    Deno.readTextFileSync(`${dir}/out.txt`)
    throw new Error('delivered')
  } catch (e) {
    assertMatch(String(e), /NotFound/) // the mailer never ran
  }
  // and the boot sweep's predicate screens it the same way
  let pending = db.prepare(
    'select eid from mail where acted_at is null and message_id is null',
  ).all() as { eid: string }[]
  assertEquals(pending.some((p) => p.eid == eid), false)
  Deno.env.delete('TASKS_MAIL_CMD')
})

Deno.test('stamp-back arrives in bites: D1 binds one variable per id', async () => {
  Deno.env.set('FLEET_MAIL_API_URL', 'http://edge.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 't')
  let { fleetApi } = await import('./inbound.ts')
  let batches: string[][] = []
  let real = globalThis.fetch
  globalThis.fetch = (_url, init) => {
    batches.push(JSON.parse(String(init?.body)).ids)
    return Promise.resolve(new Response('{}'))
  }
  try {
    await fleetApi()!.notified(Array.from({ length: 120 }, (_, i) => `m${i}`))
  } finally {
    globalThis.fetch = real
    Deno.env.delete('FLEET_MAIL_API_URL')
    Deno.env.delete('FLEET_MAIL_API_TOKEN')
  }
  assertEquals(batches.map((b) => b.length), [50, 50, 20])
})
