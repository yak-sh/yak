// The mover's sweep door (sweep.ts) over the platform in memory: the owner of
// the platform's space lists every store and reaches one at a time; nobody
// else does, and a name the directory does not hold wakes nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
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
  let door = async (who: string, query = '', method = 'GET') => {
    let cookie = `yak_session=${await sign(
      { person: who, space: null, exp: Date.now() + 60_000 },
      SECRET,
    )}`
    let r = await sweep.fetch(
      new Request(`https://yaks.app${sweep.PATH}${query}`, {
        method,
        headers: { cookie },
      }),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  return { scenario, door }
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
  assertEquals((await door(JEFF, at)).status, 400)
  assertEquals((await door(JEFF, `${at}&eid=${JEFF}&after=bad`)).status, 400)
  assertEquals((await door(JEFF, `${at}&eid=${JEFF}`)).status, 200)
  assertEquals((await door(JEFF, `${at}&eid=${JEFF}&refs=1`)).status, 200)
  assertEquals(
    (await door(JEFF, `?store=unknown&audit=builder-keys&eid=${JEFF}`)).status,
    404,
  )
})
