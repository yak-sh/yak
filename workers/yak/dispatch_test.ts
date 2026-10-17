// An app's own worker, held against a stub namespace. A dispatch namespace
// is remote-only — there is no workerd implementation, so `wrangler dev`
// leaves the binding undefined
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/local-development/)
// — and the probe kernel therefore proves only the other half: an app with no
// worker serves its files, which is what every other workerd test here
// already exercises. So the forwarding is proved on the seam instead, which
// is where it lives: `ran` over a `{get(name)}` stub, and the SHIM itself
// imported as the module it is.
//
// What must hold, and what a mistake in any of it would cost:
//   - the grant is the app's only claim to an identity, so a forged, expired
//     or borrowed one grants nothing
//   - the app's code never sees the grant, and never sees the person's
//     platform-wide session cookie
//   - a 404 from the worker, and no worker at all, both mean the files
//   - a 5xx is written where the person's agent reads it
//   - the script carries every module the app's worker imports, each typed by
//     what the runtime must do with it — a wasm compiled, a `.js` linked
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { clock } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { COOKIE, seal, sign } from './lib/token.ts'
import type { App, Space } from './directory.ts'
import {
  carried,
  commandWorker,
  dropSecret,
  granted,
  granting,
  itsApp,
  moduleType,
  owning,
  ran,
  scriptName,
  secrets,
  setSecret,
  SHIM,
  shim,
  upload,
  WORKER,
  workerBreak,
} from './dispatch.ts'
import { CallError } from '@yaks/tools/errors'
import { caught, within } from './defects.ts'
import type { Env } from './env.ts'
import { nobody, type Who } from './session.ts'

let SECRET = 'a-probe-secret'

let space: Space = {
  eid: 's1',
  slug: 'jeff',
  title: 'jeff',
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
}
let app: App = {
  eid: '00000000-0000-4000-8000-000000000002',
  slug: 'recipes',
  space: 's1',
  version: 7,
  title: 'recipes',
  access: 'public',
  store: 'jeff/recipes',
  slugs: ['jeff/recipes'],
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  gallery: null,
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
}

// App worker failures enter the tenant tracker through its queue interface;
// a person's also enter the platform's, with no space in `during`.
let wrote: Bundle[] = []
let during = (row: Bundle) => row.during as { space?: string } | undefined
let kept = () => wrote.filter((row) => row.error && during(row)?.space)
let shared = () => wrote.filter((row) => row.error && !during(row)?.space)
let envOf = (get: (name: string) => { fetch(r: Request): Promise<Response> }) =>
  ({
    SESSION_SECRET: SECRET,
    DISPATCH: { get },
    ERRORS: {
      send: (rows: Bundle[]) => {
        wrote.push(...rows)
        return Promise.resolve()
      },
    },
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({ fetch: () => Promise.resolve(Response.json([])) }),
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

let who = {
  person: 'p1',
  role: 'editor' as const,
  via: '00000000-0000-4000-8000-000000000001',
}
let standing = (who: Who | null) =>
  who && { person: who.person, role: who.role }

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

let tracked = async (run: (seen: Bundle[]) => Promise<void>) => {
  let seen: Bundle[] = []
  let env = {
    ERRORS: {
      send: (rows: Bundle[]) => {
        seen.push(rows[0])
        return Promise.resolve()
      },
    },
  }
  await within(env, {}, () => run(seen), clock())
}

test('a script is named for the store, which a rename never moves', () => {
  assertEquals(scriptName('jeff/recipes'), 'jeff_recipes')
})

test('the worker is handed who is looking, and never the cookie', async () => {
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

test('the worker acts as its vouched browser without receiving the browser cookie', async () => {
  let m = mirror()
  let guest = { ...nobody, via: who.via }
  await ran(
    envOf(m.get),
    space,
    app,
    visit('/hello', {
      'x-yak-via': 'forged',
      'x-via': 'forged',
    }),
    guest,
  )
  let sent = m.seen()
  assertEquals(sent.headers.get('x-yak-person'), null)
  assertEquals(sent.headers.get('x-yak-via'), guest.via)
  assertEquals(sent.headers.get('x-via'), null)
  assertEquals(sent.headers.get('cookie'), 'theme=dark')
  assertEquals(await granted(sent, SECRET, 'jeff/recipes'), guest)
})

test('what the worker sends out is said to be the app’s, for this visitor', async () => {
  let asked: unknown[] = []
  let m = mirror()
  await ran(
    envOf((...args: unknown[]) => (asked = args, m.get())),
    space,
    app,
    visit(),
    who,
  )
  assertEquals(asked, ['jeff_recipes', {}, {
    outbound: {
      CALLER: {
        app: app.eid,
        level: 'editor',
        person: 'p1',
      },
    },
  }])
})

test('declared commands have bounded CPU and only scheduled calls have context', async () => {
  let m = mirror()
  let asked: unknown[] = []
  let env = envOf((...args: unknown[]) => (asked = args, m.get()))
  await commandWorker(
    env,
    space,
    app,
    { person: app.eid, role: 'editor' },
    '/tick',
    {},
    {
      call: 'call-1',
      at: '2026-09-28T00:00:00Z',
      source: 'world-1',
    },
  )
  assertEquals((asked[2] as { limits: unknown }).limits, {
    cpuMs: 5_000,
    subRequests: 50,
  })
  assertEquals(m.seen().headers.get('x-yak-command-call'), 'call-1')
  assertEquals(m.seen().headers.get('x-yak-command-source'), 'world-1')
  assertEquals(
    m.seen().headers.get('x-yak-command-at'),
    '2026-09-28T00:00:00Z',
  )
  await commandWorker(env, space, app, who, '/inspect', {})
  assertEquals((asked[2] as { limits: unknown }).limits, {
    cpuMs: 5_000,
    subRequests: 50,
  })
  assertEquals(m.seen().headers.get('x-yak-command-call'), null)
  await ran(
    env,
    space,
    app,
    visit('/tick', {
      'x-yak-command-call': 'forged',
      'x-yak-command-source': 'world-1',
    }),
    who,
  )
  assertEquals((asked[2] as { limits?: unknown }).limits, undefined)
  assertEquals(m.seen().headers.get('x-yak-command-call'), null)
  assertEquals(m.seen().headers.get('x-yak-command-source'), null)
})

test('a command worker failure calls its reporter once', async () => {
  let notes: string[] = []
  let report = (req: Request, error: Error) => {
    notes.push(`${req.method} ${new URL(req.url).pathname}: ${error.message}`)
    return Promise.resolve()
  }
  await assertRejects(
    () =>
      commandWorker(envOf(mirror(503).get), space, app, who, '/inspect', {}, {
        report,
      }),
    Error,
    '503',
  )
  assertEquals(notes, [
    'POST /recipes/inspect: app worker answered 503 ' +
    '(command CPU limit 5000 ms): from the worker',
  ])
  notes = []
  await assertRejects(
    () =>
      commandWorker(envOf(mirror(403).get), space, app, who, '/inspect', {}, {
        report,
      }),
    Error,
    '403',
  )
  assertEquals(notes, [])
  await assertRejects(
    () =>
      commandWorker(
        envOf(() => {
          throw new Error("Worker not found: 'jeff_recipes'")
        }),
        space,
        app,
        who,
        '/inspect',
        {},
        { report },
      ),
    Error,
    'app worker is unavailable',
  )
  assertEquals(notes, [
    'POST /recipes/inspect: app worker is unavailable',
  ])
})

test('a command failure is captured once across worker and caller', () =>
  tracked(async (seen) => {
    let env = envOf(mirror(503).get)
    wrote = []
    let failure: unknown
    try {
      await commandWorker(env, space, app, who, '/inspect', {}, {
        report: (req, error) => workerBreak(env, space, app, req, error),
      })
    } catch (e) {
      failure = e
      caught(e, { request: 'outer command reporter' })
    }
    assert(failure instanceof Error)
    assertEquals(kept().length, 1)
    assertEquals(seen.length, 0)
    assertEquals((wrote[0].error as { tags: unknown }).tags, {
      script: scriptName(app.script ?? `${space.slug}/${app.slug}`),
      version: '7',
      entrypoint: 'fetch',
      space: space.slug,
      app: app.slug,
      request: 'worker POST /recipes/inspect',
      request_id: undefined,
      account: 'person',
    })
    assertEquals(wrote[0].during, {
      space: space.eid,
      app: app.eid,
      kind: 'exception',
      request: wrote[1].entity.eid,
    })
  }))

// A signed-in visitor's session, made once.
let token = await sign({
  person: 'p1',
  space: space.eid,
  exp: Math.floor(Date.now() / 1000) + 600,
  via: crypto.randomUUID(),
}, SECRET)

let failureEnv = envOf(mirror(503).get)
let failureError = new Error('worker fell over')
let signedFailureVisit = visit('/hello', { cookie: `${COOKIE}=${token}` })
let anonymousFailureVisit = visit()

test('an app failure names the signed-in person who saw it, and nobody else', () =>
  tracked(async () => {
    let seenBy = async (req: Request) => {
      wrote = []
      await workerBreak(failureEnv, space, app, req, failureError)
      return (wrote[0].error as { tags: Record<string, unknown> }).tags.user_id
    }
    assertEquals(
      await seenBy(signedFailureVisit),
      'p1',
    )
    assertEquals(await seenBy(anonymousFailureVisit), undefined)
  }))

// Prepare the worker's cookie response and browser request, not the dispatch.
let cookieHeaders = new Headers()
for (
  let set of [
    'theme=dark; Path=/; Secure',
    'yak_session=attackers.token; Domain=yaks.app; Path=/',
    'yak_session=attackers.token; Path=/recipes/api',
    'fix=1; domain=.jeff.yaks.app; Path=/',
    'bare=1; Domain; Path=/',
  ]
) cookieHeaders.append('set-cookie', set)
let cookieResponses = [
  new Response('hi', { headers: cookieHeaders }),
  new Response('hi', { headers: cookieHeaders }),
  new Response('hi', { headers: cookieHeaders }),
  new Response('hi', { headers: cookieHeaders }),
]
let cookieEnv = envOf(() => ({
  fetch: () => Promise.resolve(cookieResponses.shift()!),
}))
let cookieVisit = visit()

test('an app sets cookies for its own host, and none for the zone', async () => {
  // Login fixation (T-37876): an app that sets the platform's session, or any
  // cookie scoped past its own hostname, signs visitors elsewhere in as
  // whoever it likes. Its own host-only cookies are its business.
  let out = await ran(cookieEnv, space, app, cookieVisit, who)
  assertEquals(out!.headers.getSetCookie(), ['theme=dark; Path=/; Secure'])
  assertEquals(await out!.text(), 'hi')
})

test('a worker acts as the visitor, and only on its own store', async () => {
  let m = mirror()
  await ran(envOf(m.get), space, app, visit(), who)
  let held = m.seen().headers.get('x-yak-grant')!
  assert(held, 'the worker was handed no grant')
  let back = (grant: string, store = 'jeff/recipes') =>
    granted(
      new Request('https://jeff.yaks.app/recipes/api/query', {
        headers: { 'x-yak-grant': grant },
      }),
      SECRET,
      store,
    )
  assertEquals(await back(held), who)
  // Another app's store is not what this grant names.
  assertEquals(await back(held, 'jeff/photos'), null)
  // Nor is a grant anyone else signed, or one that has run out.
  assertEquals(
    await back(await granting('another-secret', 'jeff/recipes', who)),
    null,
  )
  assertEquals(
    await back(
      await seal(
        'visit',
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

test('a client cannot send its own grant, or say who it is', async () => {
  let m = mirror()
  await ran(
    envOf(m.get),
    space,
    app,
    visit('/hello', {
      'x-yak-grant': 'mine',
      'x-yak-app-grant': 'mine too',
      'x-yak-app': 'photos',
      'x-yak-via': 'forged',
      'x-via': 'forged',
    }),
    nobody,
  )
  let sent = m.seen()
  assertEquals(sent.headers.get('x-yak-app'), 'recipes')
  assertEquals(sent.headers.get('x-yak-person'), null)
  assertEquals(sent.headers.get('x-yak-via'), null)
  assertEquals(sent.headers.get('x-via'), null)
  assertEquals(standing(await granted(sent, SECRET, 'jeff/recipes')), nobody)
  // The app's own grant is the kernel's word too, and what a client sent
  // under that name is gone before the kernel wrote it.
  assertEquals(
    standing(
      await granted(
        new Request('https://jeff.yaks.app/recipes/api/apply', {
          headers: { 'x-yak-grant': sent.headers.get('x-yak-app-grant')! },
        }),
        SECRET,
        'jeff/recipes',
      ),
    ),
    { person: app.eid, role: 'editor' },
  )
})

// ── env.APP (T-34303): the second grant, naming the APP as the actor, so a
// worker can be the gatekeeper on a store its visitors may not touch.

test('a worker is handed the app itself, and only on its own store', async () => {
  let m = mirror()
  await ran(envOf(m.get), space, app, visit(), who)
  let mine = m.seen().headers.get('x-yak-app-grant')!
  assert(mine, 'the worker was handed no grant of its own')
  assert(mine != m.seen().headers.get('x-yak-grant'), 'the visitor grant again')
  let back = (grant: string, store = 'jeff/recipes') =>
    granted(
      new Request('https://jeff.yaks.app/recipes/api/apply', {
        headers: { 'x-yak-grant': grant },
      }),
      SECRET,
      store,
    )
  // The app entity, at editor — the level that carries it past its own access
  // mode and no further: an editor writes the data and not the roster.
  assertEquals(standing(await back(mine)), {
    person: app.eid,
    role: 'editor',
  })
  // And it opens nowhere else, exactly like the visitor's.
  assertEquals(await back(mine, 'jeff/photos'), null)
  assertEquals(
    await back(await owning('another-secret', 'jeff/recipes', app)),
    null,
  )
})

test('the app keeps its instrument when its self grant is renewed', async () => {
  let first = await granting(SECRET, 'jeff/recipes', {
    person: app.eid,
    role: 'editor',
    via: app.eid,
  })
  for (
    let sealed of [first, await owning(SECRET, 'jeff/recipes', app)]
  ) {
    let who = await granted(
      new Request('https://jeff.yaks.app/recipes/api/apply', {
        headers: { 'x-yak-grant': sealed },
      }),
      SECRET,
      'jeff/recipes',
    )
    assertEquals(who, { person: app.eid, role: 'editor', via: app.eid })
  }
})

test('the app acting as itself is told apart from any visitor', () => {
  assert(
    itsApp(
      { person: app.eid, role: 'editor' },
      app,
    ),
  )
  assert(!itsApp(who, app))
  assert(!itsApp(nobody, app))
  assert(!itsApp(null, app))
})

test('a 404 from the worker, and no worker, both mean the files', async () => {
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
  // And so is a namespace bound where it cannot be reached: `wrangler dev`
  // binds a stub that throws, since a dispatch namespace is remote-only, and
  // a runtime with no app workers is not an app that broke (T-34179).
  let elsewhere = () => {
    throw new Error('Binding DISPATCH needs to be run remotely')
  }
  assertEquals(await ran(envOf(elsewhere), space, app, visit(), who), null)
})

// A 4xx the worker answered is its own deliberate no — the outside service
// that refused its key, a city it does not know — and the platform files
// nothing about it (T-32874, C-32869 item 5). A 5xx is nobody's choice.
test("a worker's own no is not a break; its 5xx is", async () => {
  wrote = []
  let no = await ran(envOf(mirror(401).get), space, app, visit(), who)
  assertEquals(no!.status, 401)
  assertEquals(await no!.text(), 'from the worker')
  assertEquals(wrote.length, 0, 'a refusal filed something')
  let out = await ran(envOf(mirror(503).get), space, app, visit(), who)
  assertEquals(out!.status, 503)
  assertEquals(wrote[0].during, {
    space: space.eid,
    app: app.eid,
    kind: 'exception',
    request: wrote[1].entity.eid,
  })
  let broke = wrote[0].exception as { value: string; stack: string }
  assertEquals((wrote[0].error as { version: number }).version, 7)
  assertEquals(
    (wrote[0].error as { tags: { request: string } }).tags.request,
    'worker GET /recipes/hello',
  )
  assertEquals(broke.value, "the app's worker answered 503")
})

test('an answered worker 5xx reaches the tracker with its app', () =>
  tracked(async (seen) => {
    await ran(envOf(mirror(503).get), space, app, visit(), who)
    assertEquals(seen.length, 0)
    assertEquals(
      (kept().at(-1)!.error as { tags: unknown }).tags,
      {
        script: scriptName(app.script ?? `${space.slug}/${app.slug}`),
        version: '7',
        entrypoint: 'fetch',
        space: space.slug,
        app: app.slug,
        request: 'worker GET /recipes/hello',
        request_id: undefined,
        account: 'person',
      },
    )
  }))

// The seam (T-33234). `worker.fetch` is the one line in the kernel where the
// code running belongs to the app, so it is the one place a throw may be filed
// as the APP's break — and it is filed here, rather than left to index.ts's
// catch-all, which files by route and so wore the same entity for anything the
// platform broke on a URL that happened to name an app.
//
// A throw and an answered 5xx are one event, so they are one entity: the app's
// own store, its serving version, and the soft page the visitor already got.
test("a worker that throws is the app's break, and is filed here", async () => {
  wrote = []
  let boom = () => ({
    fetch: () => Promise.reject(new Error('undefined is not an object')),
  })
  let out = await ran(envOf(boom), space, app, visit(), who)
  assertEquals(out!.status, 500, 'the visitor gets the soft page')
  assertEquals(kept().length, 1, 'one break, and only one')
  assertEquals(wrote[0].during, {
    space: space.eid,
    app: app.eid,
    kind: 'exception',
    request: wrote[1].entity.eid,
  }, "the app's own store")
  let broke = wrote[0].exception as { value: string; stack: string }
  assertEquals((wrote[0].error as { version: number }).version, 7)
  assertEquals(
    (wrote[0].error as { tags: { request: string } }).tags.request,
    'worker GET /recipes/hello',
  )
  assertEquals(broke.value, 'undefined is not an object')
  assert(String(broke.stack).includes('undefined is not an object'))
})

// A person's app breaking may be the platform's doing, so the platform's
// tracker records it too, as its own occurrence; a probe's space is left out.
test("a person's app break is the platform's to look at too", async () => {
  let fell = new Error('worker fell over')
  wrote = []
  await workerBreak(envOf(mirror().get), space, app, visit(), fell)
  let [platform] = shared()
  assertEquals(shared().length, 1)
  assert(platform.entity.eid != kept()[0].entity.eid)
  assertEquals(platform.during, {
    kind: 'exception',
    request: wrote.at(-1)!.entity.eid,
  })
  let tags = (platform.error as { tags: Record<string, unknown> }).tags
  assertEquals([tags.source, tags.space, tags.app], ['app', 'jeff', 'recipes'])
  let probe = { ...space, eid: 's-probe', slug: 'probe' }
  let env = {
    ...envOf(mirror().get),
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: () =>
          Promise.resolve(Response.json([{
            entity: { eid: 'p-probe' },
            member: { person: 'p-probe', space: probe.eid },
            email: { address: 'probe@bot.yak.sh' },
          }])),
      }),
    },
  } as unknown as Env
  wrote = []
  await workerBreak(env, probe, app, visit(), fell)
  let account = (kept()[0].error as { tags: { account?: string } }).tags.account
  assertEquals([kept().length, shared().length, account], [1, 0, 'test'])
})

// And the same rule the answered status reads: a no the app's worker relayed
// by throwing what one of our doors told it is an answer carried out, not
// something that fell over.
test('a no the worker threw is not the app breaking', async () => {
  wrote = []
  let relayed = () => ({
    fetch: () =>
      Promise.reject(
        new Error(JSON.stringify({ error: { code: 'not_a_writer' } })),
      ),
  })
  let out = await ran(envOf(relayed), space, app, visit(), who)
  assertEquals(out!.status, 500)
  assertEquals(wrote.length, 0, 'a relayed no filed something')
})

// The shim is the only thing standing between the app's code and the grant,
// so it is run, not read: written out beside a worker.js that reports what
// it was given, and imported as the module the namespace would run.
test('the shim gives the app its doors and keeps the grant', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-shim-' })
  try {
    Deno.writeTextFileSync(`${dir}/entry.js`, SHIM)
    Deno.writeTextFileSync(
      `${dir}/worker.js`,
      `export default {
        async fetch(req, env) {
          let rows = await env.STORE.fetch('/query?.doc')
          let page = await env.FILES.fetch('style.css')
          let mine = await env.APP.fetch('/apply', { method: 'POST' })
          return Response.json({
            grant: req.headers.get('x-yak-grant'),
            self: req.headers.get('x-yak-app-grant'),
            person: req.headers.get('x-yak-person'),
            secret: env.SPOON,
            asked: [await rows.text(), await page.text(), await mine.text()],
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
          'x-yak-app-grant': 'the-app-grant',
          'x-yak-app': 'recipes',
          'x-yak-person': 'p1',
        },
      }),
      env,
      {},
    )
    let said = await out.json()
    // The app's code never sees either grant — it sees who is looking, and
    // its own secrets.
    assertEquals(said.grant, null)
    assertEquals(said.self, null)
    assertEquals(said.person, 'p1')
    assertEquals(said.secret, 'the app is told its own secrets')
    // A leading slash is the APP's root, not the hostname's, every door.
    assertEquals(said.asked, [
      '/recipes/api/query',
      '/recipes/style.css',
      '/recipes/api/apply',
    ])
    // `APP` is the same doors as `STORE`; the grant it spends is the whole
    // difference between them.
    assertEquals(
      asked.map((r) => r.headers.get('x-yak-grant')),
      ['the-grant', 'the-grant', 'the-app-grant'],
    )
    assertEquals(
      asked[0].url,
      'https://jeff.yaks.app/recipes/api/query?.doc',
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// The shim loaded as the module it is, over a worker module given as text: both
// are data: modules, so nothing is written to disk.
let loaded = (worker: string) => {
  let data = (code: string) =>
    'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(code)))
  return import(
    data(SHIM.replaceAll(`"./${WORKER}"`, JSON.stringify(data(worker))))
  )
}

// The worker the door test runs the shim over, loaded once.
let { default: doors } = await loaded(`export default {
    async fetch(req, env) {
      let said = []
      for (let r of [
        await env.FILES.fetch(req),
        await env.FILES.fetch(new URL('/style.css?v=2', req.url)),
        await env.STORE.fetch(new Request(new URL('/recipes/api/query?.doc', req.url), { method: 'POST', body: 'x' })),
      ]) said.push(await r.text())
      return Response.json(said)
    },
}`)

// A door takes what a Fetcher takes: the request the worker was handed, a
// URL, or a Request of its own, whose method and body go with it. A URL
// names a place on the host, so an app at `/recipes/` and a home app at the
// bare hostname reach the same file.
test('a door takes a Request or a URL as a Fetcher does', async () => {
  let kernel = {
    fetch: async (r: Request) =>
      new Response(
        [
          r.method,
          new URL(r.url).pathname + new URL(r.url).search,
          await r.text(),
        ]
          .join(' '),
      ),
  }
  let visit = (url: string) =>
    doors.fetch(
      new Request(url, { headers: { 'x-yak-app': 'recipes' } }),
      { KERNEL: kernel },
      {},
    ).then((r: Response) => r.json())
  assertEquals(await visit('https://jeff.yaks.app/recipes/style.css'), [
    'GET /recipes/style.css ',
    'GET /recipes/style.css?v=2 ',
    'POST /recipes/api/query?.doc x',
  ])
  assertEquals(
    (await visit('https://jeff.yaks.app/style.css'))[0],
    'GET /recipes/style.css ',
  )
})

test('a vpc_services name is a door to the kernel as the app, never a binding', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-shim-' })
  try {
    Deno.writeTextFileSync(`${dir}/entry.js`, shim(WORKER, ['BOX']))
    Deno.writeTextFileSync(
      `${dir}/worker.js`,
      `export default {
        async fetch(req, env) {
          await env.BOX.fetch('http://localhost/mail/inbound?to=a', {
            method: 'POST',
            body: 'a letter',
          })
          await env.BOX.fetch(new Request('http://x/hooks/y'))
          return new Response('ok')
        },
      }`,
    )
    let { default: entry } = await import(`file://${dir}/entry.js`)
    let asked: Request[] = []
    let env = {
      KERNEL: {
        fetch: (r: Request) => {
          asked.push(r)
          return Promise.resolve(new Response('reached'))
        },
      },
    }
    await entry.fetch(
      new Request('https://jeff.yaks.app/mail/', {
        headers: {
          'x-yak-grant': 'the-grant',
          'x-yak-app-grant': 'the-app-grant',
          'x-yak-app': 'mail',
        },
      }),
      env,
      {},
    )
    assertEquals(asked.map((r) => r.url), [
      'https://jeff.yaks.app/mail/api/tunneled/mail/inbound?to=a',
      'https://jeff.yaks.app/mail/api/tunneled/hooks/y',
    ])
    assertEquals(asked[0].method, 'POST')
    assertEquals(await asked[0].text(), 'a letter')
    assertEquals(
      asked.map((r) => r.headers.get('x-yak-grant')),
      ['the-app-grant', 'the-app-grant'],
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('an ai binding is the app asking ./api/ai/run, and a refusal throws its sentence', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-shim-' })
  try {
    Deno.writeTextFileSync(`${dir}/entry.js`, shim(WORKER, [], 'AI'))
    Deno.writeTextFileSync(
      `${dir}/worker.js`,
      `export default {
        async fetch(req, env) {
          let said = await env.AI.run('typesafe/jev', { prompt: 'hi' }, {
            extraHeaders: { 'x-session-affinity': 'worker-chat' },
          })
          let no = await env.AI.run('typesafe/jev', {}).catch((e) => e)
          return Response.json([said, no.message, no.code])
        },
      }`,
    )
    let { default: entry } = await import(`file://${dir}/entry.js`)
    let asked: Request[] = []
    let answers = [
      Response.json({ response: 'hello' }),
      Response.json(
        { error: { code: 'limit', message: 'the allowance is spent' } },
        { status: 429 },
      ),
    ]
    let env = {
      KERNEL: {
        fetch: (r: Request) => {
          asked.push(r)
          return Promise.resolve(answers.shift()!)
        },
      },
    }
    let res = await entry.fetch(
      new Request('https://jeff.yaks.app/vale/', {
        headers: {
          'x-yak-grant': 'the-grant',
          'x-yak-app-grant': 'the-app-grant',
          'x-yak-app': 'vale',
        },
      }),
      env,
      {},
    )
    assertEquals(await res.json(), [
      { response: 'hello' },
      'the allowance is spent',
      'limit',
    ])
    assertEquals(asked[0].url, 'https://jeff.yaks.app/vale/api/ai/run')
    assertEquals(asked[0].method, 'POST')
    assertEquals(asked[0].headers.get('x-session-affinity'), 'worker-chat')
    assertEquals(await asked[0].json(), {
      model: 'typesafe/jev',
      input: { prompt: 'hi' },
    })
    // Asked as the app, whoever is looking.
    assertEquals(asked[0].headers.get('x-yak-grant'), 'the-app-grant')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// ── The Workers API side, against the exchange the docs record ─────────────
//
// The upload and the three secret doors are HTTP against api.cloudflare.com,
// so `fetch` is the seam: each test stands in for the API and asserts the
// request the platform makes — the endpoint, the multipart shape, and, for a
// secret, that the value goes out once and comes back never. Answers are the
// documented envelope
// (https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/methods/update/).

let api = { CF_ACCOUNT: 'acct', CF_WORKERS_TOKEN: 'a-token' } as Env

type Call = { method: string; url: string; auth: string; body: unknown }

// Cloudflare's own reply, and the calls the platform made to get it.
let recorded = async (
  reply: (r: Request) => Response,
  run: () => Promise<unknown>,
) => {
  let calls: Call[] = []
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let r = new Request(input as string, init)
    let type = r.headers.get('content-type') ?? ''
    calls.push({
      method: r.method,
      url: r.url,
      auth: r.headers.get('authorization') ?? '',
      // Fetch receives the FormData itself; decoding a synthetic wire copy
      // adds a second multipart implementation to this account API fixture.
      body: type.startsWith('multipart/') && init?.body instanceof FormData
        ? init.body
        : await r.text(),
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

let AT = 'https://api.cloudflare.com/client/v4/accounts/acct/workers/dispatch' +
  '/namespaces/yak-apps/scripts'

let source = (text: string) => new TextEncoder().encode(text)

test('an upload sends the shim, the app, and one way home', async () => {
  let { calls } = await recorded(
    () => ok({ startup_time_ms: 3, id: 'jeff_recipes' }),
    () =>
      upload(api, 'jeff/recipes', [
        {
          name: 'worker.js',
          bytes: source('export default { fetch: () => {} }'),
        },
      ]),
  )
  assertEquals(calls.length, 1)
  assertEquals(calls[0].method, 'PUT')
  assertEquals(calls[0].url, `${AT}/jeff_recipes`)
  assertEquals(calls[0].auth, 'Bearer a-token')
  let form = calls[0].body as FormData
  let meta = JSON.parse(await (form.get('metadata') as File).text())
  // The entry is ours, and the app's own module rides beside it.
  assertEquals(meta.main_module, '__yak_entry.js')
  assertEquals(await (form.get('__yak_entry.js') as File).text(), SHIM)
  assertEquals(
    await (form.get('worker.js') as File).text(),
    'export default { fetch: () => {} }',
  )
  // One binding, and it is the way back to the kernel — there is nothing
  // else for an app's code to hold.
  assertEquals(meta.bindings, [{
    type: 'service',
    name: 'KERNEL',
    service: 'yak',
  }])
  // A deploy replaces the binding list whole, so this is what carries what
  // the app's connections bound across one (connections.ts `rebind`).
  assertEquals(meta.keep_bindings, ['secret_text'])
  assertEquals(meta.limits, { cpu_ms: 50, subrequests: 50 })
})

test('a secret goes out once and is never answered back', async () => {
  let { out, calls } = await recorded(
    () => ok({ name: 'WEATHER_KEY', type: 'secret_text' }),
    () => setSecret(api, 'jeff/recipes', 'WEATHER_KEY', 'the-key-itself'),
  )
  assertEquals(calls[0].url, `${AT}/jeff_recipes/secrets`)
  assertEquals(calls[0].method, 'PUT')
  assertEquals(JSON.parse(calls[0].body as string), {
    name: 'WEATHER_KEY',
    text: 'the-key-itself',
    type: 'secret_text',
  })
  // What the platform hands its caller carries no value, which is the shape
  // a tool answers from.
  assert(!JSON.stringify(out).includes('the-key-itself'))
})

test('a list is names, whatever the API sends', async () => {
  // Cloudflare's list is documented as name and type; its schema would allow
  // a value, so the platform reads the name off and drops the rest.
  let { out } = await recorded(
    () =>
      ok([
        { name: 'WEATHER_KEY', type: 'secret_text', text: 'leaked?' },
        { name: 'STRIPE', type: 'secret_text' },
      ]),
    () => secrets(api, 'jeff/recipes'),
  )
  assertEquals(out, ['WEATHER_KEY', 'STRIPE'])
  assert(!JSON.stringify(out).includes('leaked?'))
})

test('no script yet is nowhere to bind, and a removal names one', async () => {
  let { out } = await recorded(
    () => new Response('nope', { status: 404 }),
    () => secrets(api, 'jeff/recipes'),
  )
  assertEquals(out, null)
  let { calls } = await recorded(
    () => ok(null),
    () => dropSecret(api, 'jeff/recipes', 'WEATHER_KEY'),
  )
  assertEquals(calls[0].method, 'DELETE')
  assertEquals(calls[0].url, `${AT}/jeff_recipes/secrets/WEATHER_KEY`)
})

// Cloudflare refusing the upload with `message`: the error upload throws.
let refusedWith = (message: string) =>
  recorded(
    () =>
      Response.json({
        success: false,
        errors: [{ code: 10021, message }],
        result: null,
      }, { status: 400 }),
    () =>
      upload(api, 'jeff/recipes', [
        { name: 'worker.js', bytes: source('export default {') },
        { name: 'lib/util.js', bytes: source('export let x = 1') },
      ]).then(() => null, (e) => e),
  ).then(({ out }) => out as Error)

// Each refusal, by what its first line names: the app's own file is the
// agent's to fix (a CallError), the wrapper or no module at all is ours.
let theirs = [
  'Uncaught SyntaxError: missing ) after argument list\n  at worker.js:117:27\n',
  'Uncaught TypeError: x is not a function\n  at f (lib/util.js:3:9)\n  at worker.js:1:8',
  'Uncaught Error: No such module "lib/gone.js".\n  imported from "worker.js"',
  "Uncaught SyntaxError: The requested module './worker.js' does not provide an export named 'default'\n  at __yak_entry.js:1:7\n",
  "Uncaught SyntaxError: The requested module './util.js' does not provide an export named 'y'\n  at lib/util.js:1:9",
]
let ours = [
  'Uncaught SyntaxError: Unexpected token\n  at __yak_entry.js:4:1',
  'Uncaught Error: No such module "worker.js".\n  imported from "__yak_entry.js"',
  "Uncaught SyntaxError: The requested module './gone.js' does not provide an export named 'default'\n  at __yak_entry.js:1:7",
  'Uncaught SyntaxError',
  'Invalid binding',
]
for (let message of theirs) {
  let line = message.split('\n')[0]
  test(`the app's own code failing to load is the agent's to fix: ${line}`, async () => {
    let e = await refusedWith(message)
    assert(e instanceof CallError, message)
    assertEquals(e.code, 'arguments')
    assert(e.message.includes(line), e.message)
  })
}
for (let message of ours) {
  let line = message.split('\n')[0]
  test(`a load failure in the wrapper, or naming no module, is ours: ${line}`, async () => {
    let e = await refusedWith(message)
    assert(!(e instanceof CallError), message)
    assert(e.message.includes(line), e.message)
  })
}

// ── A worker of more than one file, wasm included (T-34263) ────────────────
//
// An app's worker used to be exactly one string: `worker.js` read out of the
// bucket and sent as the only module beside the shim. A worker compiled from
// another language is not one file — it is a `.wasm` and the `.js` that
// instantiates it — so the wasm was never uploaded, the script did not link,
// and a deploy answered Cloudflare's `No such module`.

let fixture = (name: string) =>
  Deno.readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

let WASM = fixture('add.wasm')
let APP = fixture('worker.js')

// The app's files, as `carried` reads them: what a worker imports, and what
// only its pages use.
let filesOf =
  (files: Record<string, Uint8Array<ArrayBuffer>>) => (path: string) =>
    Promise.resolve(files[path] ?? null)

test('a module is typed by what it IS, not by what a file is served as', () => {
  // The serving mime and the module type are different questions: `.js` is
  // served as text/javascript and uploaded as an ES module, and anything the
  // runtime has no module kind for arrives as bytes.
  assertEquals(moduleType('worker.js'), 'application/javascript+module')
  assertEquals(moduleType('lib/thing.mjs'), 'application/javascript+module')
  assertEquals(moduleType('add.wasm'), 'application/wasm')
  assertEquals(moduleType('rows.txt'), 'text/plain')
  assertEquals(moduleType('table.bin'), 'application/octet-stream')
})

test('the script carries worker.js and everything it imports', async () => {
  let got = await carried(filesOf({
    'worker.js': APP,
    'add.wasm': WASM,
    // The page's own script, which no worker imports: it is the app's, not
    // the script's, and uploading it would put a page's code in the worker.
    'app.js': source('export let go = () => {}'),
    'index.html': source('<h1>hi</h1>'),
  }))
  assertEquals(got.map((m) => m.name), ['worker.js', 'add.wasm'])
  assertEquals(got[1].bytes, WASM)
})

test('the walk follows a chain, survives a cycle, and stays inside the app', async () => {
  let got = await carried(filesOf({
    'worker.js': source(
      `import './lib/a.js'\nimport gone from './nowhere.js'\n` +
        `import w from '../add.wasm'\n`,
    ),
    'lib/a.js': source(`export * from './b.js'`),
    // Names its own importer: the walk must not follow it back round.
    'lib/b.js': source(`import '../worker.js'\nimport d from './data.bin'`),
    'lib/data.bin': new Uint8Array([1, 2, 3]),
    // `../` from the top pops nothing, so this is the file the specifier
    // above names — no specifier can reach outside the app.
    'add.wasm': WASM,
  }))
  assertEquals(got.map((m) => m.name), [
    'worker.js',
    'lib/a.js',
    'lib/b.js',
    'lib/data.bin',
    'add.wasm',
  ])
})

test('a wasm module goes up as a module part of its own type', async () => {
  let { calls } = await recorded(
    () => ok({ startup_time_ms: 5, id: 'jeff_adder' }),
    async () =>
      upload(
        api,
        'jeff/adder',
        await carried(filesOf({ 'worker.js': APP, 'add.wasm': WASM })),
      ),
  )
  let form = calls[0].body as FormData
  let meta = JSON.parse(await (form.get('metadata') as File).text())
  assertEquals(meta.main_module, '__yak_entry.js')
  // Every part named by the module name that imports it, and typed by what
  // the runtime must do with it: link the two ES modules, compile the wasm.
  let part = (name: string) => form.get(name) as File
  assertEquals(part('__yak_entry.js').type, 'application/javascript+module')
  assertEquals(part('worker.js').type, 'application/javascript+module')
  assertEquals(part('add.wasm').type, 'application/wasm')
  // And the wasm's bytes are the file's, unchanged — a module the upload
  // decoded as text would arrive as mojibake and fail to compile.
  assertEquals(
    new Uint8Array(await part('add.wasm').arrayBuffer()),
    WASM,
  )
  assertEquals(await part('worker.js').text(), new TextDecoder().decode(APP))
})

let anonymousPolicyGrant = await granting(SECRET, 'jeff/recipes', {
  person: null,
  role: null,
})
let personPolicyGrant = await granting(SECRET, 'jeff/recipes', {
  person: 'ada',
  role: 'viewer',
}, 7)
test('a current mode still governs anonymous grants while person standing needs its epoch', async () => {
  let request = (token: string) =>
    new Request('https://jeff.yaks.app/recipes/api/query', {
      headers: { 'x-yak-grant': token },
    })
  assertEquals(
    (await granted(request(anonymousPolicyGrant), SECRET, 'jeff/recipes', 8))
      ?.role,
    null,
  )
  assertEquals(
    await granted(request(personPolicyGrant), SECRET, 'jeff/recipes', 8),
    null,
  )
  assertEquals(
    (await granted(request(personPolicyGrant), SECRET, 'jeff/recipes', 7))
      ?.role,
    'viewer',
  )
})
