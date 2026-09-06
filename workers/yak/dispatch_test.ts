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
//   - the script carries every module the app's worker imports, each typed by
//     what the runtime must do with it — a wasm compiled, a `.js` linked
import { assert, assertEquals, assertRejects } from '@std/assert'
import { COOKIE, seal, sign } from '../../src/token.ts'
import { slow } from '../../src/testing.ts'
import type { App, Space } from './directory.ts'
import {
  carried,
  dropSecret,
  granted,
  granting,
  itsApp,
  moduleType,
  NO_WORKER,
  owning,
  ran,
  scriptName,
  secrets,
  setSecret,
  SHIM,
  upload,
} from './dispatch.ts'
import type { Env } from './env.ts'
import { script } from './probe.ts'
import { nobody } from './session.ts'

let SECRET = 'a-probe-secret'

let space: Space = {
  eid: 's1',
  slug: 'jeff',
  title: 'jeff',
  tier: null,
  plan: null,
  meter: null,
  told: false,
  trashed: null,
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
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  gallery: null,
  seeded: null,
  trashed: null,
}

// Every entity the kernel wrote while a test ran, and WHICH store it went
// into (door.ts `storeOf` names it on every request) — so a break can be read
// back the way `app_errors` reads one, and whose store it landed in is part of
// what a test can say.
type Wrote = {
  store: string
  bundles: { exception: Record<string, unknown> }[]
}
let wrote: Wrote[] = []

// The env `ran` asks for: the namespace under test, the secret it seals a
// grant with, and a store that keeps what it was told. Only a JSON body is
// kept: `serving` reads the directory through this same stub, and its empty
// query answer throws out of the parse before anything is recorded.
let envOf = (get: (name: string) => { fetch(r: Request): Promise<Response> }) =>
  ({
    SESSION_SECRET: SECRET,
    DISPATCH: { get },
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (r: Request) => {
          // The graph's own write door: a bare array of bundles in, the batch
          // as applied back.
          let bundles = JSON.parse(await r.text())
          wrote.push({ store: r.headers.get('x-store') ?? '', bundles })
          return Response.json(bundles)
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
    visit('/hello', {
      'x-yak-grant': 'mine',
      'x-yak-app-grant': 'mine too',
      'x-yak-app': 'photos',
    }),
    nobody,
  )
  let sent = m.seen()
  assertEquals(sent.headers.get('x-yak-app'), 'recipes')
  assertEquals(sent.headers.get('x-yak-person'), null)
  assertEquals(await granted(sent, SECRET, 'jeff/recipes'), nobody)
  // The app's own grant is the kernel's word too, and what a client sent
  // under that name is gone before the kernel wrote it.
  assertEquals(
    await granted(
      new Request('https://jeff.yaks.app/recipes/api/apply', {
        headers: { 'x-yak-grant': sent.headers.get('x-yak-app-grant')! },
      }),
      SECRET,
      'jeff/recipes',
    ),
    { person: 'a1', role: 'editor' },
  )
})

// ── env.APP (T-34303): the second grant, naming the APP as the actor, so a
// worker can be the gatekeeper on a store its visitors may not touch.

Deno.test('a worker is handed the app itself, and only on its own store', async () => {
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
  assertEquals(await back(mine), { person: 'a1', role: 'editor' })
  // And it opens nowhere else, exactly like the visitor's.
  assertEquals(await back(mine, 'jeff/photos'), null)
  assertEquals(
    await back(await owning('another-secret', 'jeff/recipes', app)),
    null,
  )
})

Deno.test('the app acting as itself is told apart from any visitor', () => {
  assert(itsApp({ person: 'a1', role: 'editor' }, app))
  assert(!itsApp(who, app))
  assert(!itsApp(nobody, app))
  assert(!itsApp(null, app))
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
  // And so is a namespace BOUND where it cannot be reached: `wrangler dev`
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
Deno.test("a worker's own no is not a break; its 5xx is", async () => {
  wrote = []
  let no = await ran(envOf(mirror(401).get), space, app, visit(), who)
  assertEquals(no!.status, 401)
  assertEquals(await no!.text(), 'from the worker')
  assertEquals(wrote.length, 0, 'a refusal filed something')
  let out = await ran(envOf(mirror(503).get), space, app, visit(), who)
  assertEquals(out!.status, 503)
  assertEquals(wrote[0].store, 'jeff/recipes')
  let broke = wrote[0].bundles[0].exception
  assertEquals(broke.version, 7)
  assertEquals(broke.request, 'worker GET /recipes/hello')
  assertEquals(broke.message, "the app's worker answered 503")
})

// THE SEAM (T-33234). `worker.fetch` is the one line in the kernel where the
// code running belongs to the app, so it is the one place a throw may be filed
// as the APP's break — and it is filed HERE, rather than left to index.ts's
// catch-all, which files by ROUTE and so wore the same entity for anything the
// PLATFORM broke on a URL that happened to name an app.
//
// A throw and an answered 5xx are one event, so they are one entity: the app's
// own store, its serving version, and the soft page the visitor already got.
Deno.test("a worker that throws is the app's break, and is filed here", async () => {
  wrote = []
  let boom = () => ({
    fetch: () => Promise.reject(new Error('undefined is not an object')),
  })
  let out = await ran(envOf(boom), space, app, visit(), who)
  assertEquals(out!.status, 500, 'the visitor gets the soft page')
  assertEquals(wrote.length, 1, 'one break, and only one')
  assertEquals(wrote[0].store, 'jeff/recipes', "the app's own store")
  let broke = wrote[0].bundles[0].exception
  assertEquals(broke.version, 7)
  assertEquals(broke.request, 'worker GET /recipes/hello')
  assertEquals(broke.message, 'undefined is not an object')
  assert(String(broke.stack).includes('undefined is not an object'))
})

// And the same rule the answered status reads: a no the app's worker relayed
// by THROWING what one of our doors told it is an answer carried out, not
// something that fell over.
Deno.test('a no the worker threw is not the app breaking', async () => {
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
      'https://jeff.yaks.app/recipes/api/query?.doc!',
    )
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
      body: type.startsWith('multipart/') ? await r.formData() : await r.text(),
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

Deno.test('an upload sends the shim, the app, and one way home', async () => {
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
  // The entry is OURS, and the app's own module rides beside it.
  assertEquals(meta.main_module, 'entry.js')
  assertEquals(await (form.get('entry.js') as File).text(), SHIM)
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
  // A deploy replaces the binding list whole, so this is what carries the
  // app's secrets across one.
  assertEquals(meta.keep_bindings, ['secret_text'])
  assertEquals(meta.limits, { cpu_ms: 50, subrequests: 50 })
})

Deno.test('a secret goes out once and is never answered back', async () => {
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

Deno.test('a list is names, whatever the API sends', async () => {
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

Deno.test('no script yet is no secrets, and a removal names one', async () => {
  let { out } = await recorded(
    () => new Response('nope', { status: 404 }),
    () => secrets(api, 'jeff/recipes'),
  )
  assertEquals(out, [])
  let { calls } = await recorded(
    () => ok(null),
    () => dropSecret(api, 'jeff/recipes', 'WEATHER_KEY'),
  )
  assertEquals(calls[0].method, 'DELETE')
  assertEquals(calls[0].url, `${AT}/jeff_recipes/secrets/WEATHER_KEY`)
})

// A secret before the worker that would read it is the natural order, and
// Cloudflare's own words for it name nothing anyone can do (C-32869 item 1).
Deno.test('a secret before any worker says to deploy one', async () => {
  for (
    let call of [
      () => setSecret(api, 'jeff/recipes', 'WEATHER_KEY', 'k'),
      () => dropSecret(api, 'jeff/recipes', 'WEATHER_KEY'),
    ]
  ) {
    await recorded(
      () =>
        Response.json({
          success: false,
          errors: [{
            code: 10007,
            message: 'This Worker does not exist on your account.',
          }],
          result: null,
        }, { status: 404 }),
      () => assertRejects(call, Error, NO_WORKER),
    )
  }
})

Deno.test("cloudflare's refusal is what the agent is told", async () => {
  await recorded(
    () =>
      Response.json({
        success: false,
        errors: [{ code: 10021, message: 'Uncaught SyntaxError' }],
        result: null,
      }, { status: 400 }),
    () =>
      assertRejects(
        () =>
          upload(api, 'jeff/recipes', [
            { name: 'worker.js', bytes: source('export default {') },
          ]),
        Error,
        'Uncaught SyntaxError',
      ),
  )
})

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

Deno.test('a module is typed by what it IS, not by what a file is served as', () => {
  // The serving mime and the module type are different questions: `.js` is
  // served as text/javascript and uploaded as an ES module, and anything the
  // runtime has no module kind for arrives as bytes.
  assertEquals(moduleType('worker.js'), 'application/javascript+module')
  assertEquals(moduleType('lib/thing.mjs'), 'application/javascript+module')
  assertEquals(moduleType('add.wasm'), 'application/wasm')
  assertEquals(moduleType('rows.txt'), 'text/plain')
  assertEquals(moduleType('table.bin'), 'application/octet-stream')
})

Deno.test('the script carries worker.js and everything it imports', async () => {
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

Deno.test('the walk follows a chain, survives a cycle, and stays inside the app', async () => {
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

Deno.test('a wasm module goes up as a module part of its own type', async () => {
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
  assertEquals(meta.main_module, 'entry.js')
  // Every part named by the module name that imports it, and typed by what
  // the runtime must do with it: link the two ES modules, compile the wasm.
  let part = (name: string) => form.get(name) as File
  assertEquals(part('entry.js').type, 'application/javascript+module')
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

/**
 * And the modules RUN. A dispatch namespace has no local implementation, so
 * what the account would run cannot be exercised here; this runs the same
 * module set — the shim, the app's worker.js, and the wasm it imports — in
 * the same runtime (probe.ts `script`), which is where a mislabelled or
 * missing module shows itself. The upload's own shape is the test above,
 * against the API's documented multipart form.
 */
slow('workerd links the shim, the app, and its wasm', async () => {
  let w = await script({
    'entry.js': SHIM,
    'worker.js': new TextDecoder().decode(APP),
    'add.wasm': WASM,
  })
  try {
    let r = await w.at('/api/add?a=2&b=3')
    assertEquals(r.status, 200)
    assertEquals(await r.text(), '5')
    // The worker's 404 is the pass verdict the kernel reads (`ran`), so the
    // fixture answers one for everything that is not its route.
    let pass = await w.at('/index.html')
    assertEquals(pass.status, 404)
    await pass.body?.cancel()
  } finally {
    await w.stop()
  }
})
