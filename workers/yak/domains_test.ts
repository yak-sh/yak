// The Cloudflare half of a person's own domain (domains.ts, T-33038): the
// requests the platform makes, and the reading it gives an agent back.
//
// The three payloads below are not invented. They were recorded from the live
// account on 2026-09-03 by attaching `probe.crayonbloom.com` to the yaks.app
// zone, adding the CNAME, and reading the custom hostname back as it came up
// — creation, the minute the record had not propagated, and active. The whole
// point of `steps()` is to tell those three apart specifically enough for an
// agent to say what the person is waiting on, so the test holds it to the
// bytes Cloudflare actually sends.
import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  apex,
  type Custom,
  customOf,
  provision,
  reachable,
  reading,
  records,
  release,
  stageOf,
  steps,
} from './domains.ts'
import type { Env } from './env.ts'
import { ORIGIN } from './route.ts'

let env = { CF_ZONE: 'zone', CF_HOSTNAMES_TOKEN: 'a-token' } as Env
let AT = 'https://api.cloudflare.com/client/v4/zones/zone/custom_hostnames'

// Just made: Cloudflare has not looked for the record yet.
let MADE: Custom = {
  id: '32b2c24d-e60a-4f29-bc24-5dc32ad8ecfe',
  hostname: 'probe.crayonbloom.com',
  status: 'pending',
  ssl: { status: 'initializing' },
  ownership_verification: {
    type: 'txt',
    name: '_cf-custom-hostname.probe.crayonbloom.com',
    value: '955d9acb-87bd-428f-a52f-f8e15a61d841',
  },
}

// It looked, and the record is not there — the state an agent has to be able
// to name, because it is the only one the person can do something about.
let WAITING: Custom = {
  ...MADE,
  ssl: { status: 'pending_validation' },
  verification_errors: ['custom hostname does not CNAME to this zone.'],
}

let LIVE: Custom = {
  id: MADE.id,
  hostname: MADE.hostname,
  status: 'active',
  ssl: { status: 'active' },
}

let state = (c: Custom) => steps(c).map((s) => `${s.step}:${s.state}`)

Deno.test('the three moments a person waits through read differently', () => {
  assertEquals(state(MADE), [
    'dns:waiting',
    'validation:waiting',
    'certificate:waiting',
  ])
  assertEquals(state(WAITING), [
    'dns:waiting',
    'validation:waiting',
    'certificate:waiting',
  ])
  assertEquals(state(LIVE), [
    'dns:done',
    'validation:done',
    'certificate:done',
  ])
  assertEquals(stageOf(steps(MADE)), 'pending')
  assertEquals(stageOf(steps(WAITING)), 'pending')
  assertEquals(stageOf(steps(LIVE)), 'active')
  // Same stage, different sentence: `pending` twice over is exactly what
  // made an agent guess, so the words have to disagree. Cloudflare's own
  // are handed on, because they are more specific than ours.
  let said = (c: Custom) => steps(c)[0].said
  assert(said(MADE) != said(WAITING), said(MADE))
  assertEquals(
    said(WAITING),
    'custom hostname does not CNAME to this zone — it is not added, or ' +
      'not propagated yet',
  )
})

Deno.test('the certificate step is read apart from the hostname', () => {
  // The hostname is accepted and the certificate is still coming: the one
  // moment where "your CNAME hasn't propagated" would be a lie.
  assertEquals(
    state({ ...LIVE, ssl: { status: 'pending_issuance' } }),
    ['dns:done', 'validation:done', 'certificate:waiting'],
  )
  assertEquals(
    stageOf(steps({ ...LIVE, ssl: { status: 'pending_issuance' } })),
    'pending',
  )
  // A certificate authority that refused says why, and the why is what the
  // person needs — a CAA record is theirs to fix.
  let caa = steps({
    ...LIVE,
    ssl: {
      status: 'pending_validation',
      validation_errors: [{ message: 'caa_error: pki.goog' }],
    },
  })
  assertEquals(caa[2].state, 'error')
  assertEquals(caa[2].said, 'caa_error: pki.goog')
  assertEquals(stageOf(caa), 'error')
})

Deno.test('a word Cloudflare has not shown us yet is said, not assumed', () => {
  // Never `done` on a guess: an unknown word waits, carrying itself.
  let odd = steps({ ...LIVE, status: 'pending_migration' })
  assertEquals(odd[1].state, 'waiting')
  assertEquals(odd[1].said, 'Cloudflare says pending migration')
  // Every timeout spells the same thing, and the list of them grows.
  let out = steps({ ...LIVE, ssl: { status: 'issuance_timed_out' } })
  assertEquals(out[2].state, 'error')
  assertEquals(stageOf(out), 'error')
  // And the two ends of giving up are named with the verb that fixes them.
  for (let status of ['moved', 'deleted', 'blocked']) {
    assertEquals(stageOf(steps({ ...LIVE, status })), 'error')
  }
  assert(/attach/.test(steps({ ...LIVE, status: 'moved' })[1].said))
})

Deno.test('the record a person adds is one CNAME, at the name itself', () => {
  assertEquals(records('herbusiness.com'), [
    { type: 'CNAME', name: 'herbusiness.com', value: ORIGIN },
  ])
  assertEquals(records('www.herbusiness.com')[0].name, 'www.herbusiness.com')
})

Deno.test('the apex hint knows a bare name from one with a label', () => {
  for (let host of ['herbusiness.com', 'herbusiness.co.uk', 'a.io']) {
    assert(apex(host), host)
  }
  for (
    let host of [
      'www.herbusiness.com',
      'shop.herbusiness.co.uk',
      'a.b.io',
    ]
  ) {
    assert(!apex(host), host)
  }
})

Deno.test('the lines an agent reads out say the order of the wait', () => {
  let said = reading(steps(WAITING)).split('\n')
  assertEquals(said.length, 3)
  assert(said[0].startsWith('… dns:'), said[0])
  assertEquals(
    reading(steps(LIVE)).split('\n').filter((l) => l[0] == '✓')
      .length,
    3,
  )
})

Deno.test('with no token or no zone, every door says which is missing', () => {
  assertThrows(() => reachable({} as Env), Error, 'CF_ZONE')
  assertThrows(
    () => reachable({ CF_ZONE: 'zone' } as Env),
    Error,
    'CF_HOSTNAMES_TOKEN',
  )
})

// ── The account API, against the exchange the live zone answered ───────────

type Call = { method: string; url: string; auth: string; body: string }

let recorded = async (
  reply: (r: Request) => Response,
  run: () => Promise<unknown>,
) => {
  let calls: Call[] = []
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let r = new Request(input as string, init)
    calls.push({
      method: r.method,
      url: r.url,
      auth: r.headers.get('authorization') ?? '',
      body: await r.text(),
    })
    return reply(r)
  }) as typeof fetch
  try {
    return { out: await run(), calls }
  } finally {
    globalThis.fetch = was
  }
}

let ok = (result: unknown) =>
  Response.json({ success: true, errors: [], messages: [], result })

Deno.test('provisioning asks for the hostname and nothing else', async () => {
  let { out, calls } = await recorded(
    () => ok(MADE),
    () => provision(env, 'probe.crayonbloom.com'),
  )
  assertEquals(calls.length, 1)
  assertEquals(calls[0].method, 'POST')
  assertEquals(calls[0].url, AT)
  assertEquals(calls[0].auth, 'Bearer a-token')
  // HTTP validation: once the CNAME points here Cloudflare answers the
  // challenge itself, so there is no second record for the person to add.
  assertEquals(JSON.parse(calls[0].body), {
    hostname: 'probe.crayonbloom.com',
    ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
  })
  assertEquals((out as Custom).id, MADE.id)
})

Deno.test('a hostname is looked up by name, never by a stored id', async () => {
  let { out, calls } = await recorded(
    () => ok([LIVE]),
    () => customOf(env, 'probe.crayonbloom.com'),
  )
  assertEquals(calls[0].method, 'GET')
  assertEquals(calls[0].url, `${AT}?hostname=probe.crayonbloom.com`)
  assertEquals((out as Custom).status, 'active')
  // Cloudflare's filter is a prefix match, so the name has to agree exactly:
  // asking about `bloom.com` may not answer about `crayonbloom.com`.
  let { out: none } = await recorded(
    () => ok([LIVE]),
    () => customOf(env, 'bloom.com'),
  )
  assertEquals(none, null)
})

Deno.test('detaching gives the hostname back, and says if there was none', async () => {
  let { out, calls } = await recorded(
    (r) => r.method == 'DELETE' ? ok({ id: MADE.id }) : ok([LIVE]),
    () => release(env, 'probe.crayonbloom.com'),
  )
  assertEquals(out, true)
  assertEquals(calls.map((c) => c.method), ['GET', 'DELETE'])
  assertEquals(calls[1].url, `${AT}/${MADE.id}`)
  // Nothing there is a detach with nothing left to do, not a failure — which
  // is what lets a half-finished detach be finished by asking again.
  let { out: gone, calls: asked } = await recorded(
    () => ok([]),
    () => release(env, 'probe.crayonbloom.com'),
  )
  assertEquals(gone, false)
  assertEquals(asked.map((c) => c.method), ['GET'])
})

Deno.test('a refusal from Cloudflare is answered in its own words', async () => {
  let said = ''
  try {
    await recorded(
      () =>
        Response.json({
          success: false,
          errors: [{ code: 1406, message: 'duplicate custom hostname found.' }],
          result: null,
        }, { status: 409 }),
      () => provision(env, 'probe.crayonbloom.com'),
    )
  } catch (e) {
    said = (e as Error).message
  }
  assertEquals(said, 'cloudflare: duplicate custom hostname found.')
})
