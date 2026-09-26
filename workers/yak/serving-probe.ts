// What serving_test.ts and selling_test.ts stand on: the platform in memory
// (testing.ts) under one session secret, Ada signed in the way the browser
// carries her, and her space and her app written the way `space_new` and
// `app_new` write them.
import { sign } from './lib/token.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { platform as inMemory } from './testing.ts'

let SECRET = 'a probe secret'

/** The platform in memory, with `vars` beside its own. */
export let platform = (vars: Partial<Env> = {}) => inMemory(SECRET, vars)

export let ADA = 'a0000000-0000-4000-8000-0000000000ad'

/** Ada as the directory's door hears an owner. */
export let ADA_OWNS = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }

/** A signed-in person's cookie, as the browser carries it. */
export let as = async (person: string) =>
  `yak_session=${await sign(
    { person, space: null, exp: Date.now() + 60_000 },
    SECRET,
  )}`

/** Ada's space `ada` and its app `cookbook`, open to `access`. */
export let seeded = async (env: Env, access = 'public') => {
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
    ],
  }, ADA_OWNS)
  let space = (await dir.space('ada'))!
  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      doc: { title: 'Cookbook' },
      app: {
        slug: 'cookbook',
        space: space.eid,
        version: 1,
        access,
        store: 'ada/cookbook.aaa111',
      },
      former: { slug: 'cookbook' },
    }],
  }, ADA_OWNS)
  let app = (await dir.app(space, 'cookbook'))!
  return { dir, space, app }
}

/** One request at the app's own address. */
export let visit = (path: string, init: RequestInit = {}) =>
  new Request(`https://ada.yaks.app${path}`, init)
