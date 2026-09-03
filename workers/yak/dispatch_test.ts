// An app's own worker, held against a stub namespace. A dispatch namespace
// is REMOTE-ONLY — there is no workerd implementation, so `wrangler dev`
// leaves the binding undefined
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/local-development/)
// — and the probe kernel therefore proves only the other half: an app with no
// worker serves its files, which is what every other workerd test here
// already exercises. So the forwarding is proved on the seam instead, which
// is where it lives: `ran` over a `{get(name)}` stub, and the SHIM itself
// imported as the module it is.
//
// What must hold, and what a mistake in any of it would cost:
//   - the grant is the app's ONLY claim to an identity, so a forged, expired
//     or borrowed one grants nothing
//   - the app's code never sees the grant, and never sees the person's
//     platform-wide session cookie
//   - a 404 from the worker, and no worker at all, both mean the files
//   - a 5xx is written where the person's agent reads it
import { assert, assertEquals } from '@std/assert'
import { COOKIE, seal, sign } from '../../src/token.ts'
import type { App, Space } from './directory.ts'
import { granted, granting, ran, scriptName, SHIM } from './dispatch.ts'
import type { Env } from './env.ts'
import { nobody } from './session.ts'

let SECRET = 'a-probe-secret'

let space: Space = {
  eid: 's1',
  slug: 'jeff',
  home: null,
  title: 'jeff',
  tier: null,
  meter: null,
  told: false,
}
let app: App = {
  eid: 'a1',
  slug: 'recipes',
  space: 's1',
  version: 7,
  title: 'recipes',
  access: 'public',
  store: 'jeff/recipes',
  slugs: ['jeff/recipes'],
  meter: null,
}

// Every entity the kernel wrote while a test ran, so a break can be read
// back the way `app_errors` reads one.
let wrote: unknown[] = []

// The env `ran` asks for: the namespace under test, the secret it seals a
// grant with, and a store that keeps what it was told.
let envOf = (get: (name: string) => { fetch(r: Request): Promise<Response> }) =>
  ({
    SESSION_SECRET: SECRET,
    DISPATCH: { get },
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (r: Request) => {
          wrote.push(JSON.parse(await r.text()))
          return Response.json({ ok: true })
        },
      }),
    },
  }) as unknown as Env

// One app request, as a browser would send it — carrying the person's
// platform session and trying to say who it is.
let visit = (path = '/hello', headers: Record<string, string> = {}) =>
  new Request(`https://jeff.yaks.app/recipes${path}`, {
    headers: {
      cookie: `${COOKIE}=whatever; theme=dark`,
      'x-yak-person': 'a-liar',
      'x-yak-role': 'owner',
      ...headers,
    },
  })

let who = { person: 'p1', role: 'editor' as const }

// A worker that answers by reporting what it was handed.
let mirror = (status = 200) => {
  let seen: Request | null = null
  return {
    seen: () => seen!,
    get: () => ({
      fetch: (r: Request) => {
        seen = r
        return Promise.resolve(new Response('from the worker', { status }))
      },
    }),
  }
}

Deno.test('a script is named for the store, which a rename never moves', () => {
  assertEquals(scriptName('jeff/recipes'), 'jeff_recipes')
})

Deno.test('the worker is handed who is looking, and never the cookie', async () => {
  let m = mirror()
  let out = await ran(envOf(m.get), space, app, visit(), who)
  assertEquals(await out!.text(), 'from the worker')
  let sent = m.seen()
  assertEquals(sent.headers.get('x-yak-person'), 'p1')
  assertEquals(sent.headers.get('x-yak-role'), 'editor')
  assertEquals(sent.headers.get('x-yak-app'), 'recipes')
  // The session cookie is a credential for every space this person belongs
  // to; the app is owed this visit and no more. Its own cookies survive.
  assertEquals(sent.headers.get('cookie'), 'theme=dark')
})

Deno.test('a worker acts as the visitor, and only on its own store', async () => {
  let m = mirror()
  await ran(envOf(m.get), space, app, visit(), who)
  let carried = m.seen().headers.get('x-yak-grant')!
  assert(carried, 'the worker was handed no grant')
  let back = (grant: string, store = 'jeff/recipes') =>
    granted(
      new Request('https://jeff.yaks.app/recipes/api/query', {
        headers: { 'x-yak-grant': grant },
      }),
      SECRET,
      store,
    )
  assertEquals(await back(carried), who)
  // Another app's store is not what this grant names.
  assertEquals(await back(carried, 'jeff/photos'), null)
  // Nor is a grant anyone else signed, or one that has run out.
  assertEquals(
    await back(await granting('another-secret', 'jeff/recipes', who)),
    null,
  )
  assertEquals(
    await back(
      await seal(
        { store: 'jeff/recipes', person: 'p1', role: 'owner', exp: 1 },
        SECRET,
      ),
    ),
    null,
  )
  // And a session token is not a grant, however well signed.
  assertEquals(
    await back(
      await sign({ person: 'p1', space: null, exp: 2 ** 31 }, SECRET),
    ),
    null,
  )
})

Deno.test('a client cannot send its own grant, or say who it is', async () => {
  let m = mirror()
  await ran(
    envOf(m.get),
    space,
    app,
    visit('/hello', { 'x-yak-grant': 'mine', 'x-yak-app': 'photos' }),
    nobody,
  )
  let sent = m.seen()
  assertEquals(sent.headers.get('x-yak-app'), 'recipes')
  assertEquals(sent.headers.get('x-yak-person'), null)
  assertEquals(await granted(sent, SECRET, 'jeff/recipes'), nobody)
})

Deno.test('a 404 from the worker, and no worker, both mean the files', async () => {
  assertEquals(
    await ran(envOf(mirror(404).get), space, app, visit(), who),
    null,
  )
  let gone = () => {
    throw new Error("Worker not found: 'jeff_recipes'")
  }
  assertEquals(await ran(envOf(gone), space, app, visit(), who), null)
  // No namespace at all is local development, which serves the files too.
  assertEquals(await ran({} as Env, space, app, visit(), who), null)
})

Deno.test("a worker's 5xx is written where the agent reads it", async () => {
  wrote = []
  let out = await ran(envOf(mirror(503).get), space, app, visit(), who)
  assertEquals(out!.status, 503)
  let broke =
    (wrote[0] as { entities: { exception: Record<string, unknown> }[] })
      .entities[0].exception
  assertEquals(broke.version, 7)
  assertEquals(broke.request, 'worker GET /recipes/hello')
  assertEquals(broke.message, "the app's worker answered 503")
})

// The shim is the only thing standing between the app's code and the grant,
// so it is run, not read: written out beside a worker.js that reports what
// it was given, and imported as the module the namespace would run.
Deno.test('the shim gives the app its doors and keeps the grant', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-shim-' })
  try {
    Deno.writeTextFileSync(`${dir}/entry.js`, SHIM)
    Deno.writeTextFileSync(
      `${dir}/worker.js`,
      `export default {
        async fetch(req, env) {
          let rows = await env.STORE.fetch('/query?.doc!')
          let page = await env.FILES.fetch('style.css')
          return Response.json({
            grant: req.headers.get('x-yak-grant'),
            person: req.headers.get('x-yak-person'),
            secret: env.SPOON,
            asked: [await rows.text(), await page.text()],
          })
        },
      }`,
    )
    let { default: shim } = await import(`file://${dir}/entry.js`)
    let asked: Request[] = []
    let env = {
      SPOON: 'the app is told its own secrets',
      KERNEL: {
        fetch: (r: Request) => {
          asked.push(r)
          return Promise.resolve(new Response(new URL(r.url).pathname))
        },
      },
    }
    let out = await shim.fetch(
      new Request('https://jeff.yaks.app/recipes/hello', {
        headers: {
          'x-yak-grant': 'the-grant',
          'x-yak-app': 'recipes',
          'x-yak-person': 'p1',
        },
      }),
      env,
      {},
    )
    let said = await out.json()
    // The app's code never sees the grant — it sees who is looking, and its
    // own secrets.
    assertEquals(said.grant, null)
    assertEquals(said.person, 'p1')
    assertEquals(said.secret, 'the app is told its own secrets')
    // A leading slash is the APP's root, not the hostname's, both doors.
    assertEquals(said.asked, ['/recipes/api/query', '/recipes/style.css'])
    assertEquals(
      asked.map((r) => r.headers.get('x-yak-grant')),
      ['the-grant', 'the-grant'],
    )
    assertEquals(
      asked[0].url,
      'https://jeff.yaks.app/recipes/api/query?.doc!',
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
