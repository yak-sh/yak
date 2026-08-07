// The inbound seam: message→changes mapping, request→hook derivation,
// address routing, and the sweep's idempotency — against an in-memory
// db and a fixture FleetApi (no network, no live spool, no stamps
// anywhere but here).
import type { Change } from './types.ts'
import type { FleetMsg, SpoolReq } from './inbound.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let {
  author,
  fleetRaw,
  hookChanges,
  hookTo,
  inboundSweep,
  mailChanges,
  mailIdOf,
  mayStamp,
  routeTo,
  wearer,
} = await import('./inbound.ts')
let { mailed } = await import('./mail.ts')
let { recent } = await import('./telemetry.ts')
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
// A mail's send outcome is the shared delivered facet now (D-14945).
let deliveredRow = (eid: string) =>
  db.prepare('select * from delivered where eid = ?').get(eid) as
    | Record<string, string | null>
    | undefined

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

let venture = (title: string, address: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title } },
    { eid, name: 'project', comp: {} },
    { eid, name: 'email', comp: { address } },
  ])
  return eid
}

let cafecar = venture('CafeCar', 'cafecar@bot.yak.sh')
let homelab = venture('Homelab', 'homelab@bot.yak.sh')
let moonshot = venture('Moonshot', 'moonshot@bot.yak.sh')

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

// An id-shaped local-part must route the same way it delivers in-graph, or
// one address answers differently depending on which side it arrived from.
Deno.test('routeTo: an id names its entity; a wrong prefix names nobody', () => {
  let s = uid()
  apply(db, [
    { eid: s, name: 'doc', comp: { title: 'a session' } },
    { eid: s, name: 'session', comp: { id: 'sess-route' } },
  ])
  let num = (db.prepare('select num from entity where eid = ?').get(s) as {
    num: number
  }).num
  assertEquals(routeTo(`S-${num}@bot.yak.sh`), s)
  assertEquals(routeTo(`s-${num}@bot.yak.sh`), s) // canon lowercases
  // Same num, wrong prefix: it is a different id, so it names nothing and
  // falls to triage rather than delivering to the session by accident.
  assertEquals(routeTo(`T-${num}@bot.yak.sh`), holdco)
  // The derivation is scoped to the fleet domain.
  assertEquals(routeTo(`S-${num}@elsewhere.test`), holdco)
  assertEquals(routeTo('S-999999@bot.yak.sh'), holdco) // no such entity
})

// Routing and ATTRIBUTION read the same book and must not share a fallback:
// where to file a stranger's letter is a choice, who wrote it is a fact.
Deno.test('wearer: the same book, strict — a stranger is nobody', () => {
  assertEquals(wearer('venture@bot.test'), operator)
  assertEquals(wearer('VENTURE@bot.test'), operator)
  assertEquals(wearer('stranger@x.test'), null) // routeTo says holdco
  assertEquals(wearer(null), null)
})

Deno.test('hookTo: the venture path routes, variants converge, misses fall back', () => {
  let observer = uid()
  apply(db, [
    { eid: observer, name: 'doc', comp: { title: 'Observer' } },
    { eid: observer, name: 'email', comp: { address: 'observer@bot.yak.sh' } },
  ])
  assertEquals(hookTo('/hook/cafecar/posthog'), cafecar)
  assertEquals(hookTo('/hook/cafe_car/posthog'), cafecar)
  assertEquals(hookTo('/hook/Cafe_Car/posthog'), cafecar)
  assertEquals(hookTo('/hook/homelab/github'), homelab)
  assertEquals(hookTo('/hook/moonshot/anything'), moonshot)
  assertEquals(hookTo('/hook/observer/anything'), holdco)
  assertEquals(hookTo('/hook/stranger/posthog'), holdco)
  assertEquals(hookTo('/hook'), holdco)
  assertEquals(hookTo('/hook/'), holdco)
  assertEquals(hookTo('/hook//posthog'), holdco)
  assertEquals(hookTo('/hooks/cafecar/posthog'), holdco)
  assertEquals(hookTo('/prefix/hook/cafecar/posthog'), holdco)
  assertEquals(hookTo(null), holdco)
})

Deno.test('author: the From header wins over the envelope', () => {
  // Cloudflare Email Sending's envelope — the header names the author
  assertEquals(
    author(msg({
      from: 'bounces@cf-bounce.bot.test',
      from_header: '"holdco" <holdco@bot.test>',
    })),
    'holdco@bot.test',
  )
  assertEquals(
    author(msg({ from_header: 'plain@bot.test' })),
    'plain@bot.test',
  )
  // no header (or an unparseable one) → the envelope still names someone
  assertEquals(author(msg()), 'sender@x.test')
  assertEquals(author(msg({ from_header: 'not an address' })), 'sender@x.test')
  assertEquals(author(msg({ from: null })), null)
})

Deno.test('mailChanges: from is the author, not the envelope', () => {
  // The sender rides the STAMP, never the wire — an outbound letter's from
  // is derived from its author, so arrival is the one case that supplies it.
  let { stamp } = mailChanges(
    msg({
      from: 'bounces@cf-bounce.bot.test',
      from_header: '"holdco" <holdco@bot.test>',
    }),
    null,
  )
  assertEquals(stamp.from, 'holdco@bot.test')
})

Deno.test('mailChanges: subject and body land verbatim, provenance stamps', () => {
  let { wire, stamp } = mailChanges(msg(), operator)
  let doc = wire.find((c) => c.name == 'doc')!.comp!
  let mail = wire.find((c) => c.name == 'mail')!.comp!
  assertEquals(doc.title, 'hello')
  assertEquals(doc.body, 'the body')
  assertEquals(mail.to, undefined) // recipient is arrival DATA, not the wire
  assertEquals(mail.from, undefined) // off the wire
  assertEquals(stamp.to_addr, 'venture@bot.test') // the address it arrived at
  assertEquals(stamp.from, 'sender@x.test')
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

Deno.test('hookChanges: event derives; captured request stays verbatim', () => {
  let base = { id: 'r1', ts: 1752000000000, source: 'github' }
  let headers = JSON.stringify({ 'X-GitHub-Event': 'issues' })
  let path = '/hook/cafe_car/posthog/issue-created'
  let named = hookChanges({
    ...base,
    method: 'POST',
    path,
    headers,
    body: '{"action":"opened"}',
    sig_ok: 0,
  }, holdco)
  assertEquals(named.stamp.event, 'issues') // the sender's own header wins
  assertEquals(named.stamp.payload, '{"action":"opened"}')
  assertEquals(named.stamp.spool_id, 'r1')
  assertEquals(named.stamp.method, 'POST')
  assertEquals(named.stamp.path, path)
  assertEquals(named.stamp.headers, headers)
  assertEquals(named.stamp.sig_ok, 0) // routing never upgrades trust
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

// Read-state is the stamp, not a mail column (T-7006).
let opened = (eid: string) =>
  (db.prepare('select count(*) as n from opened where eid = ?')
    .get(eid) as { n: number }).n

Deno.test('the sweep: mints once, stamps back, and dir=out never lands', async () => {
  let { api, notified, processed } = fakeApi(
    [msg(), msg({ id: 'out:1:x', dir: 'out' })],
    [{
      id: 'r9',
      source: 'github',
      method: 'POST',
      path: '/hook/cafecar/github',
      headers: '{"content-type":"application/json"}',
      body: '{"action":"ping"}',
      sig_ok: 1,
    }],
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
    string | number | null
  >[]
  assertEquals(hooks.length, 1)
  assertEquals(hooks[0].source, 'github')
  assertEquals(hooks[0].method, 'POST')
  assertEquals(hooks[0].path, '/hook/cafecar/github')
  assertEquals(hooks[0].headers, '{"content-type":"application/json"}')
  assertEquals(hooks[0].payload, '{"action":"ping"}')
  assertEquals(hooks[0].sig_ok, 1)
  let aimed = db.prepare(
    `select child_eid from dependency
     where parent_eid = ? and type = 'about'`,
  ).get(hooks[0].eid) as { child_eid: string }
  assertEquals(aimed.child_eid, cafecar)
  // sweep again: idempotent on the provenance keys, stamps still answer
  await inboundSweep(cast, api)
  assertEquals(mailCount(), 1)
  assertEquals(
    (db.prepare('select count(*) as n from hook').get() as { n: number }).n,
    1,
  )
  assertEquals(notified.length, 2)
})

// One letter, one entity: the echo of our own send stamps arrival ON
// the sent mail — unread for the recipient — never a twin, never a
// silent skip (T-5882).
// The sweep is machinery, but the letter it mints has an AUTHOR — the
// sender. Left unattributed it used to inherit the box owner, so every
// stranger's mail entered the journal in his name (T-9934).
Deno.test('the sweep: an arriving letter is authored by its sender', async () => {
  let by = (id: string) =>
    (db.prepare(
      'select c."by" as by from created c join mail m using(eid) where m.message_id = ?',
    ).get(id) as { by: string | null } | undefined)?.by ?? null

  // Positive control FIRST: a sender the book knows lands attributed, so the
  // null below is a refusal to guess and not an inert fixture.
  let known = 'msg:1752000000001:known'
  await inboundSweep(
    cast,
    fakeApi([msg({ id: known, from_header: 'cafecar@bot.yak.sh' })], null).api,
  )
  assertEquals(by(known), cafecar)

  // A stranger has no entity to be. Nobody is the honest answer.
  let alien = 'msg:1752000000002:alien'
  await inboundSweep(
    cast,
    fakeApi([msg({ id: alien, from_header: 'nobody@elsewhere.test' })], null)
      .api,
  )
  assertEquals(by(alien), null)
})

Deno.test('the sweep: an echo arrives on the sent entity, once', async () => {
  let letter = uid()
  apply(db, [
    { eid: letter, name: 'doc', comp: { title: 'to the fleet' } },
    { eid: letter, name: 'mail', comp: {} },
    { eid: letter, name: 'deliver', comp: { to: 'venture@bot.test' } },
  ])
  db.prepare('update mail set sent_id = ? where eid = ?')
    .run('echo-1@bot.test', letter)
  // Sent = the shared delivered facet now (D-14945), via the Message-ID.
  db.prepare('insert into delivered (eid, at, via) values (?, ?, ?)')
    .run(letter, '2025-07-08T18:39:00.000Z', 'echo-1@bot.test')
  let echo = msg({
    id: 'msg:1752000000001:echo-1@bot.test',
    from: 'bounces@cf-bounce.bot.test',
    from_header: '"holdco" <holdco@bot.test>',
  })
  let before = mailCount()
  let { api } = fakeApi([echo], null)
  await inboundSweep(cast, api)
  assertEquals(mailCount(), before + 1) // the stamp, not a twin
  let row = mailRow(letter)
  assertEquals(row.message_id, 'msg:1752000000001:echo-1@bot.test')
  assertEquals(row.received_at, '2025-07-08T18:40:00.000Z')
  assertEquals(row.verified, 1)
  assertEquals(row.target_eid, operator) // routed like a fresh mint
  assertEquals(row.from, 'holdco@bot.test') // the header, not the envelope
  assertEquals(opened(letter), 0) // unread for the recipient (T-7006)
  // re-sweep: arrival is already recorded — idempotent, still no twin
  await inboundSweep(cast, api)
  assertEquals(mailCount(), before + 1)
  // a duplicate delivery (same rfc id, a new store key) records nothing
  await inboundSweep(
    cast,
    fakeApi([msg({
      id: 'msg:1752000000002:echo-1@bot.test',
      received_at: '2025-07-08T19:00:00.000Z',
    })], null).api,
  )
  assertEquals(mailRow(letter).message_id, 'msg:1752000000001:echo-1@bot.test')
  assertEquals(mailCount(), before + 1)
})

Deno.test('the echo keeps an aimed target and a stamped from', async () => {
  let letter = uid()
  apply(db, [
    { eid: letter, name: 'doc', comp: { title: 'relay' } },
    {
      eid: letter,
      name: 'mail',
      comp: { target_eid: holdco },
    },
    { eid: letter, name: 'deliver', comp: { to: 'venture@bot.test' } },
  ])
  // `from` is server-stamped now (apply derives it from the author), so a
  // fixture standing in for an already-sent letter writes it the same way.
  db.prepare('update mail set sent_id = ?, "from" = ? where eid = ?')
    .run('echo-2@bot.test', 'me@bot.test', letter)
  await inboundSweep(
    cast,
    fakeApi([msg({ id: 'msg:1752000000003:echo-2@bot.test' })], null).api,
  )
  let row = mailRow(letter)
  assertEquals(row.message_id, 'msg:1752000000003:echo-2@bot.test')
  assertEquals(row.target_eid, holdco) // the relay still aims at its task
  assertEquals(row.from, 'me@bot.test')
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
  assertEquals(deliveredRow(eid), undefined)
  try {
    Deno.readTextFileSync(`${dir}/out.txt`)
    throw new Error('delivered')
  } catch (e) {
    assertMatch(String(e), /NotFound/) // the mailer never ran
  }
  // and the boot sweep's predicate screens it the same way
  let pending = db.prepare(
    `select eid from mail where message_id is null
       and not exists (select 1 from delivered where delivered.eid = mail.eid)
       and not exists (select 1 from error where error.eid = mail.eid)`,
  ).all() as { eid: string }[]
  assertEquals(pending.some((p) => p.eid == eid), false)
  Deno.env.delete('TASKS_MAIL_CMD')
})

// The theft guard, pure: env in, verdict out. The live service (no
// DB_PATH) sweeps; any scratch db refuses even with creds inherited;
// only the explicit opt-in arms it (T-3839).
Deno.test('mayStamp: a scratch db refuses to stamp; the opt-in arms it', () => {
  let env = (vars: Record<string, string>) => (k: string) => vars[k]
  assertEquals(mayStamp(env({})), true)
  assertEquals(mayStamp(env({ DB_PATH: '/tmp/probe.db' })), false)
  assertEquals(mayStamp(env({ DB_PATH: ':memory:' })), false)
  assertEquals(
    mayStamp(env({ DB_PATH: '/tmp/probe.db', FLEET_MAIL_SWEEP: '1' })),
    true,
  )
  assertEquals(
    mayStamp(env({ DB_PATH: '/tmp/probe.db', FLEET_MAIL_SWEEP: '0' })),
    false,
  )
})

Deno.test('fleetApi: creds alone never arm a non-live db', async () => {
  Deno.env.set('FLEET_MAIL_API_URL', 'http://edge.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 't')
  let { fleetApi } = await import('./inbound.ts')
  try {
    // DB_PATH=:memory: rides this whole file — the guard holds the door
    assertEquals(fleetApi(), null)
  } finally {
    Deno.env.delete('FLEET_MAIL_API_URL')
    Deno.env.delete('FLEET_MAIL_API_TOKEN')
  }
})

Deno.test('stamp-back arrives in bites: D1 binds one variable per id', async () => {
  Deno.env.set('FLEET_MAIL_API_URL', 'http://edge.test')
  Deno.env.set('FLEET_MAIL_API_TOKEN', 't')
  Deno.env.set('FLEET_MAIL_SWEEP', '1') // scratch db: the guard needs the opt-in
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
    Deno.env.delete('FLEET_MAIL_SWEEP')
  }
  assertEquals(batches.map((b) => b.length), [50, 50, 20])
})

Deno.test('mailIdOf: E-num, bare num, and eid all land; the misses differ', () => {
  let { eid } = db.prepare(
    'select eid from mail where message_id is not null',
  ).get() as { eid: string }
  let { num } = db.prepare('select num from entity where eid = ?').get(eid) as {
    num: number
  }
  assertEquals(mailIdOf(eid)?.message_id, 'msg:1752000000000:abc')
  assertEquals(mailIdOf(`E-${num}`)?.message_id, 'msg:1752000000000:abc')
  assertEquals(mailIdOf(String(num))?.message_id, 'msg:1752000000000:abc')
  assertEquals(mailIdOf('nope-not-here'), null) // no mail at all
  let out = uid() // an outbound row: mail, but no spool provenance
  apply(db, [
    { eid: out, name: 'doc', comp: { title: 'sent' } },
    { eid: out, name: 'mail', comp: {} },
    { eid: out, name: 'deliver', comp: { to: 'x@y.test' } },
  ])
  assertEquals(mailIdOf(out)?.message_id, null) // a mail, never spooled
})

Deno.test('fleetRaw: dormant without config — the token never has a default', () => {
  Deno.env.delete('FLEET_MAIL_API_URL')
  Deno.env.delete('FLEET_MAIL_API_TOKEN')
  assertEquals(fleetRaw('/messages/x/attachments'), null)
})

Deno.test('the sweep preserves In-Reply-To and links its graph mail', async () => {
  let orig = uid()
  apply(db, [
    { eid: orig, name: 'doc', comp: { title: 'opener' } },
    { eid: orig, name: 'mail', comp: {} },
    { eid: orig, name: 'deliver', comp: { to: 'sender@x.test' } },
  ])
  db.prepare('update mail set sent_id = ? where eid = ?')
    .run('opener@bot.test', orig)
  let reply = msg({
    id: 'msg:1752000000010:reply@x.test',
    in_reply_to: 'opener@bot.test',
  })

  await inboundSweep(cast, fakeApi([reply], null).api)

  let row = db.prepare('select * from mail where message_id = ?')
    .get(reply.id) as Record<string, string | null>
  assertEquals(row.in_reply_to, 'opener@bot.test')
  assertEquals(row.reply_to_eid, orig)
})

Deno.test('mailChanges links an earlier inbound RFC id when present', () => {
  let orig = uid()
  apply(db, [
    { eid: orig, name: 'doc', comp: { title: 'first arrival' } },
    { eid: orig, name: 'mail', comp: {} },
    { eid: orig, name: 'deliver', comp: { to: 'venture@bot.test' } },
  ])
  db.prepare('update mail set message_id = ? where eid = ?')
    .run('msg:1752000000020:first@x.test', orig)
  let { wire, stamp } = mailChanges(
    msg({ in_reply_to: 'first@x.test' }),
    operator,
  )
  let mail = wire.find((c) => c.name == 'mail')!.comp!
  assertEquals(mail.reply_to_eid, orig)
  assertEquals(stamp.in_reply_to, 'first@x.test')
})

// A broken pull is NOT an empty one: before this, a dead token or moved
// worker threw into `console.warn` on a socket nobody collects, so a sweep
// that could not fetch looked exactly like a quiet spool (T-15110). Now the
// failure lands as a `srv` telemetry row — queryable, not just gone.
Deno.test('a broken sweep surfaces as a srv telemetry error', async () => {
  let boom = 'spool fetch refused — dead token'
  await inboundSweep(cast, {
    messages: () => Promise.reject(new Error(boom)), // the mail pull dies
    notified: () => Promise.resolve(),
    requests: () => Promise.resolve(null), // the hook stream is simply quiet
    processed: () => Promise.resolve(),
  })
  let hit = recent(db, { only: 'errors' })
    .find((r) =>
      r.source == 'srv' && r.name == 'inbound sweep (mail)' &&
      String(r.error).includes(boom)
    )
  assertEquals(!!hit, true)
})

// The two streams still fail alone: a hook pull that throws records its own
// error and leaves the mail pull — which delivered a letter — untouched.
Deno.test('a hook-stream failure records without silencing mail', async () => {
  let before = mailCount()
  let boom = 'requests endpoint 500'
  await inboundSweep(cast, {
    messages: () =>
      Promise.resolve([msg({ id: 'msg:1752000009999:solo@x.test' })]),
    notified: () => Promise.resolve(),
    requests: () => Promise.reject(new Error(boom)), // hooks die
    processed: () => Promise.resolve(),
  })
  assertEquals(mailCount(), before + 1) // the mail still landed
  let hit = recent(db, { only: 'errors' })
    .find((r) =>
      r.name == 'inbound sweep (hooks)' && String(r.error).includes(boom)
    )
  assertEquals(!!hit, true)
})
