// The mover's sweep door (sweep.ts) over the platform in memory: the owner of
// the platform's space lists every store and reaches one at a time; nobody
// else does, and a name the directory does not hold wakes nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { sign } from './lib/token.ts'
import * as sweep from './sweep.ts'
import { platform } from './testing.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let JEFF = 'a0000000-0000-4000-8000-00000000000f'

// Ada owns `ada`, which holds one app; the owner owns `yak`, the platform's own.
let spaces = async () => {
  let scenario = platform(SECRET)
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'notes' },
        app: { slug: 'notes', space: '$space', store: 'ada/notes.abc123' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  await stamp(env, {
    entities: [{
      entity: { eid: '$seat' },
      member: {
        space: (await dir.space('yak'))!.eid,
        person: JEFF,
        role: 'owner',
      },
    }],
  })
  let door = async (
    who: string,
    query = '',
    method = 'GET',
    body?: unknown,
  ) => {
    let cookie = `yak_session=${await sign(
      { person: who, space: null, exp: Date.now() + 60_000 },
      SECRET,
    )}`
    let r = await sweep.fetch(
      new Request(`https://yaks.app${sweep.PATH}${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { cookie },
      }),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  return { scenario, door, dir }
}

test('the platform’s owner sweeps every store, one at a time', async () => {
  let { scenario, door } = await spaces()
  using _ = scenario
  let listed = await door(JEFF)
  assertEquals(
    listed.body.map((s: sweep.Swept) => s.at).filter((at: string) =>
      at == 'ada/notes' || at == 'git' || at == 'directory'
    ),
    ['ada/notes', 'git', 'directory'],
  )
  let rehearsed = await door(JEFF, '?store=ada/notes.abc123&rehearse=1', 'POST')
  assertEquals(rehearsed.body.store, 'ada/notes.abc123')
  assertEquals(
    (await door(JEFF, '?store=ada/nothing', 'POST')).body.error.code,
    'no_store',
  )
})

test('nobody else sweeps', async () => {
  let { scenario, door } = await spaces()
  using _ = scenario
  assertEquals((await door(ADA)).status, 403)
  assertEquals(
    (await door(ADA, '?store=ada/notes.abc123&rehearse=1', 'POST')).status,
    403,
  )
})

test('only the platform owner reads bounded sweep evidence', async () => {
  let { scenario, door } = await spaces()
  using _ = scenario
  let at = '?store=directory&audit=builder-keys'
  // Take a real directory eid from the same roster, without an app route.
  let listed = await door(JEFF)
  let store = listed.body.find((s: sweep.Swept) => s.at == 'directory').store
  at = `?store=${store}&audit=builder-keys`
  assertEquals((await door(ADA, `${at}&eid=${JEFF}`)).status, 403)
  assertEquals((await door(JEFF, at)).status, 200)
  assertEquals((await door(JEFF, at)).body.counts, {
    build: 0,
    built: 0,
    build_of: 0,
    output_of: 0,
  })
  assertEquals((await door(JEFF, `${at}&eid=${JEFF}&after=bad`)).status, 400)
  assertEquals((await door(JEFF, `${at}&eid=${JEFF}`)).status, 200)
  assertEquals((await door(JEFF, `${at}&eid=${JEFF}&refs=1`)).status, 200)
  assertEquals(
    (await door(JEFF, `?store=unknown&audit=builder-keys&eid=${JEFF}`)).status,
    404,
  )
})

test('the audit reaches private trash, git and platform by the roster only', async () => {
  let { scenario, door, dir } = await spaces()
  using _ = scenario
  let [app] = await dir.apply({
    entities: [{
      entity: { eid: '$trash' },
      app: {
        space: (await dir.space('ada'))!.eid,
        store: 'actual.a5b47c',
        access: 'private',
      },
      former: { slug: 'trashed' },
    }],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  let roster = (await door(JEFF)).body
  assertEquals(
    roster.some((s: sweep.Swept) => s.store == 'actual.a5b47c'),
    true,
  )
  for (let at of ['git', 'directory']) {
    let store = roster.find((s: sweep.Swept) => s.at == at).store
    let audit = await door(JEFF, `?store=${store}&audit=builder-keys`)
    assertEquals(audit.status, 200)
    assertEquals(audit.body.counts, {
      build: 0,
      built: 0,
      build_of: 0,
      output_of: 0,
    })
  }
  assertEquals(
    (await door(JEFF, '?store=actual.a5b47c&audit=builder-keys')).status,
    200,
  )
  assertEquals(!!app.app, true)
})

test('the repair is missing-field-only CAS, with a kernel dry run', async () => {
  let { scenario, door } = await spaces()
  using _ = scenario
  let store = 'ada/notes.abc123'
  let raw = storeOf(scenario.env.STORE, store)
  let builder = 'dcbeb828-567c-4b95-9671-7c31f29eaca1'
  let build = '9ebb31ac-46ee-8458-85e6-a1725bfdcb9f'
  let output = '8693d7a4-4d42-8fa1-b662-c36c0ac30b06'
  let input = '1f4b7b6e-44df-432f-844f-85393dabe0b7'
  let seeded = await raw('/apply', {
    method: 'POST',
    body: JSON.stringify([
      { entity: { eid: builder }, builder: { query: '.doc' } },
      { entity: { eid: input }, doc: { body: 'evidence' } },
      { entity: { eid: build }, build: { builder, variant: 'main' } },
      { entity: { eid: output }, built: { slot: 'summary' } },
    ]),
  }, KERNEL)
  assertEquals(seeded.status, 200)
  let at = `?store=${store}&repair=builder-keys`
  let change = [
    {
      entity: { eid: build },
      build: { match: JSON.stringify([input]) },
      $was: { build: { match: null } },
    },
    {
      entity: { eid: output },
      built: { build },
      $was: { built: { build: null } },
    },
  ]
  assertEquals(
    (await door(ADA, at, 'POST', { check: true, change })).status,
    403,
  )
  assertEquals((await door(JEFF, at, 'POST', { change })).status, 400)
  assertEquals(
    (await door(JEFF, at, 'POST', {
      check: true,
      change: [{ ...change[0], doc: { body: 'no' } }],
    })).status,
    400,
  )
  assertEquals(
    (await door(JEFF, at, 'POST', {
      check: true,
      change: [{ ...change[0], $was: { build: { match: 'bad' } } }],
    })).status,
    409,
  )
  assertEquals(
    (await door(JEFF, at, 'POST', { check: true, change })).status,
    200,
  )
  let read = `?store=${store}&audit=builder-keys&eid=${build}`
  assertEquals((await door(JEFF, read)).body[0].build.match, null)
  assertEquals(
    (await door(JEFF, at, 'POST', { check: false, change })).status,
    200,
  )
  assertEquals(
    (await door(JEFF, read)).body[0].build.match,
    JSON.stringify([input]),
  )
  assertEquals(
    (await door(JEFF, at, 'POST', { check: false, change })).status,
    400,
  )
  let selection = await door(
    JEFF,
    `?store=${store}&audit=builder-keys&select=doc`,
  )
  assertEquals(selection.status, 200)
  assertEquals(selection.body.length, 1)
  assertEquals(
    (await door(JEFF, `?store=${store}&audit=builder-keys&eid=${output}`))
      .body[0].built.build,
    build,
  )
  assertEquals(
    (await door(ADA, `?store=${store}&audit=builder-keys&select=doc`)).status,
    403,
  )
})
