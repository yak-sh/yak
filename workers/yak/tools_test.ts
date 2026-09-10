// app_files' write path, at its seams (T-34337). The tool itself runs in
// workerd (mcp_test.ts), which is where the whole gesture is held; what is
// here is the four pieces a caller actually gets wrong — the op it did not
// say, the file it miscounted, the patch that matched twice, the URL it
// reached for — each a function, so a case is a line.
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { MAX } from './apps.ts'
import {
  call,
  type Ctx,
  fetched,
  opOf,
  parses,
  patched,
  sri,
  stored,
  TOOLS,
  uiMeta,
} from './tools.ts'
import { sha256 } from './versions.ts'
import { platform } from './harness.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { inApp } from './tool.ts'
import type { Address } from './post.ts'
import { letters } from './letters.ts'
import { appVocab } from './vocab.ts'
import { clock } from './timing.ts'
import { KERNEL, meta } from './meta.ts'
import { stages } from '../../bin/app-deploy-time.ts'

Deno.test('staging tool URLs and app mail use the same configured host', async () => {
  let delivered: { to: string; from: Address }[] = []
  let { env } = platform('staging-tool-secret', {
    APEX: 'yaks.fyi',
    MAIL: {
      send: (letter) => {
        delivered.push({ to: letter.to, from: letter.from })
        return Promise.resolve({ messageId: 'sent' })
      },
    },
  })
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ctx: Ctx = {
    env,
    dir,
    person: 'a0000000-0000-4000-8000-0000000000ad',
  }
  let space = await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  assertStringIncludes(space.text, 'https://ada.yaks.fyi/')
  let made = await call(ctx, 'app_new', {
    space: 'ada',
    slug: 'recipes',
    title: 'Recipes',
  })
  assertStringIncludes(made.text, 'https://ada.yaks.fyi/recipes/')
  let listed = await call(ctx, 'app_list', {})
  assertStringIncludes(listed.text, 'https://ada.yaks.fyi/recipes/')
  assertStringIncludes(listed.text, 'ada.recipes@yaks.fyi')
  assertStringIncludes(
    (await call(ctx, 'about', {})).text,
    'https://yaks.fyi/login',
  )
  await call(ctx, 'app_files', {
    space: 'ada',
    app: 'recipes',
    path: 'dishes.csv',
    content: 'title\nPudding\n',
  })
  await assertRejects(
    () =>
      call(ctx, 'store_load', {
        space: 'ada',
        app: 'recipes',
        path: 'dishes.csv',
        as: 'undeclared',
      }),
    Error,
    'https://yaks.fyi/guide.md',
  )
  await assertRejects(
    () =>
      call(ctx, 'domain_attach', { space: 'ada', hostname: 'test.yaks.fyi' }),
    Error,
    'test.yaks.fyi is on yaks.fyi',
  )

  let [listing, sending] = letters(ctx, appVocab())
  assertStringIncludes(sending.description!, '<space>.<app>@yaks.fyi')
  let out = await sending.run({
    space: 'ada',
    app: 'recipes',
    to: 'ana@books.example',
    title: 'Dinner',
    body: 'Bring pudding.',
  }, {} as never) as { mail: { from: string } }
  assertEquals(out.mail.from, 'ada.recipes@yaks.fyi')
  let sent = await listing.run({
    space: 'ada',
    app: 'recipes',
    direction: 'sent',
  }, {} as never) as { mail: { from: string } }[]
  assertEquals(sent.map((l) => l.mail.from), ['ada.recipes@yaks.fyi'])
  let { store } = await inApp(ctx, { space: 'ada', app: 'recipes' })
  let read = await store('/query?q=.mail!', {}, {
    'x-yak-person': ctx.person,
    'x-yak-role': 'owner',
  })
  assertEquals(read.status, 200)
  assertEquals((await read.json())[0].mail.from, 'ada.recipes@yaks.fyi')
  assertEquals(delivered, [{
    to: 'ana@books.example',
    from: 'ada.recipes@yaks.fyi',
  }])
})

// The listing answers WHO THE CALLER IS in each space it lists, off the
// directory's own `member` row (T-35384). It is the only door that says a role
// for every space at once: before this, a client had to ask each space's front
// app `/me`, one round trip apiece, for a fact the directory already held.
Deno.test('app_list says the caller’s role in each space it lists', async () => {
  let { env } = platform('member-role-secret', {
    MAIL: { send: () => Promise.resolve({ messageId: 'sent' }) },
  })
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let hers = 'a0000000-0000-4000-8000-00000000ada0'
  let ada: Ctx = { env, dir, person: hers }
  await call(ada, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ada, 'member_add', {
    space: 'ada',
    email: 'bo@books.example',
    role: 'viewer',
  })
  let bo = { env, dir, person: (await dir.personAt('bo@books.example'))! }
  await call(bo, 'space_new', { slug: 'bo', title: 'Bo' })

  let seen = async (as: Ctx) =>
    ((await call(as, 'app_list', {})).data as {
      spaces: { slug: string; role: string }[]
    }).spaces.map((s) => [s.slug, s.role])
  assertEquals(await seen(ada), [['ada', 'owner']])
  // Hers is her own; his is the seat she gave him, said as the directory
  // spells it — never guessed at from the fact that he can see it at all.
  assertEquals(await seen(bo), [['ada', 'viewer'], ['bo', 'owner']])
})

let bytes = (s: string) => new TextEncoder().encode(s)

// The tool as an agent reads it, since the description IS the contract and
// the builder gets it through the same roster (builder.ts).
let app_files = TOOLS.find((t) => t.name == 'app_files')!

Deno.test('bytes say a call is a write, and a bare path says nothing', () => {
  assertEquals(opOf({ path: 'index.html', content: '<h1>hi' }, 0), 'write')
  assertEquals(opOf({ path: 'a.wasm', base64: 'AGFzbQ==' }, 0), 'write')
  assertEquals(opOf({}, 2), 'write')
  // An empty string is content: a file may be emptied without being deleted.
  assertEquals(opOf({ path: 'x.css', content: '' }, 0), 'write')
  // What the caller said always wins over what it looks like.
  assertEquals(opOf({ op: 'read', path: 'index.html' }, 0), 'read')
  assertEquals(opOf({ op: 'patch', path: 'a', content: 'b' }, 0), 'patch')
  // And nothing is still nothing, so the refusal names the ops.
  assertEquals(opOf({}, 0), '')
  assertEquals(opOf({ path: 'index.html' }, 0), '')
})

Deno.test('a write answers what it stored, and json answers whether it parses', async () => {
  let page = bytes('<!doctype html><h1>hi</h1>')
  assertEquals(
    stored('index.html', page, await sha256(page)),
    '26 bytes, sha256 ' + await sha256(page),
  )
  // Only a declaration file is parsed: a .js file full of braces is not JSON
  // and saying so of it would be noise on every write.
  assertEquals(
    stored('app.js', bytes('{'), await sha256(bytes('{'))),
    `1 bytes, sha256 ${await sha256(bytes('{'))}`,
  )
  let ok = bytes('{"serves": 4}')
  assertStringIncludes(stored('vocab.json', ok, await sha256(ok)), ', parsed')
  // The bracket run miscounted in a transcription: the verdict rides the
  // same answer, and it carries the position.
  let broke = bytes(`{"a": [1, 2, 3}`)
  let said = stored('data.json', broke, await sha256(broke))
  assertStringIncludes(said, '15 bytes, sha256 ')
  assertStringIncludes(said, 'NOT valid JSON')
  assertStringIncludes(said, 'position 14')
  // A file cut short has its position too — the end of what arrived.
  assertStringIncludes(
    parses('data.json', bytes('{"a": ')),
    'NOT valid JSON',
  )
  assertEquals(parses('data.json', bytes('[]')), 'parsed')
  // And a .yml is read in its own language (@yaks/yaml, M-34605), so the
  // spelling an app writes its words in is checked where it is written.
  let yml = bytes('recipe:\n  serves: number\n')
  assertStringIncludes(stored('vocab.yml', yml, await sha256(yml)), ', parsed')
  assertStringIncludes(
    parses('vocab.yml', bytes('recipe:\n - a\n  b: c\n')),
    'NOT valid YAML',
  )
})

Deno.test('a patch replaces exactly one match, or refuses saying how many', () => {
  let page = '<h1>Old</h1>\n<p>Old news</p>\n'
  assertEquals(
    patched(page, '<h1>Old</h1>', '<h1>New</h1>', 'index.html'),
    '<h1>New</h1>\n<p>Old news</p>\n',
  )
  // Empty removes, which is how a line goes away.
  assertEquals(
    patched(page, '<p>Old news</p>\n', '', 'index.html'),
    '<h1>Old</h1>\n',
  )
  // A replacement is TEXT: `$&` is two characters, not a back-reference.
  assertEquals(patched('a b', 'b', '$& $`', 'x.js'), 'a $& $`')
  // Two matches would edit a place nobody looked at; none would answer
  // "patched" having changed nothing. Both say the count, which is what
  // tells the caller what to do next.
  assertStringIncludes(
    assertThrows(() => patched(page, 'Old', 'New', 'index.html'), Error)
      .message,
    'find matched 2 times in index.html — a patch replaces exactly one: ' +
      'lengthen find',
  )
  assertStringIncludes(
    assertThrows(() => patched(page, 'Nowhere', 'x', 'index.html'), Error)
      .message,
    'find matched 0 times in index.html — a patch replaces exactly one: ' +
      'read the file back',
  )
})

Deno.test('an integrity hash is base64 of the same digest, not the hex', async () => {
  // The empty string's sha256, in the spelling an <script integrity> wants.
  assertEquals(
    sri(await sha256(new Uint8Array())),
    '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
  )
})

// A stubbed web, so a fetch case is a header and a body.
let served = async <T>(
  answer: (at: URL) => Response,
  body: () => Promise<T>,
) => {
  let was = globalThis.fetch
  globalThis.fetch =
    ((at: string | URL | Request) =>
      Promise.resolve(answer(new URL(String(at))))) as typeof fetch
  try {
    return await body()
  } finally {
    globalThis.fetch = was
  }
}

let refuses = (saying: string, from: string) =>
  assertRejects(() => fetched(from), Error, saying)

Deno.test('a fetch takes https, a live answer, and nothing over the ceiling', async () => {
  await refuses('is not a URL', 'cdnjs.example/chess.js')
  await refuses('https only, not http', 'http://cdnjs.example/chess.js')
  await refuses('https only, not file', 'file:///etc/passwd')
  await served(
    () =>
      new Response('export let go = () => {}', {
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      }),
    async () => {
      let got = await fetched('https://cdnjs.example/chess.js')
      assertEquals(
        new TextDecoder().decode(got.bytes),
        'export let go = () => {}',
      )
      // The parameters are the response's business, not the app's.
      assertEquals(got.mime, 'text/javascript')
    },
  )
  await served(
    () => new Response('nope', { status: 404 }),
    () => refuses('answered 404', 'https://cdnjs.example/gone.js'),
  )
  // A header is a claim, so it is refused on the claim AND on the bytes.
  await served(
    () =>
      new Response('small', {
        headers: { 'content-length': String(MAX + 1) },
      }),
    () => refuses('20 MB at most', 'https://cdnjs.example/huge.js'),
  )
  await served(
    () => new Response(new Uint8Array(MAX + 1)),
    () => refuses('20 MB at most', 'https://cdnjs.example/lying.js'),
  )
})

Deno.test('the tool teaches every op it answers', () => {
  let input = app_files.input as {
    properties: Record<string, { enum?: string[] }>
  }
  assertEquals(input.properties.op.enum, [
    'list',
    'read',
    'write',
    'patch',
    'fetch',
    'delete',
    'history',
    'restore',
  ])
  for (let arg of ['find', 'replace', 'url', 'sha', 'at']) {
    assertEquals(typeof input.properties[arg], 'object', `${arg} is described`)
  }
  for (
    let word of [
      'sha256',
      'parses',
      'op: patch',
      'op: fetch',
      // Every destructive op names its way back in the description itself
      // (T-34508, T-34509): an agent reading the tool is told before it
      // hesitates, not after.
      'op: history',
      'op: restore',
    ]
  ) {
    assertStringIncludes(app_files.description, word)
  }
})

// What a host is told about a page it RENDERS (T-34350, T-34433). Both halves
// are mandatory once a plugin ships UI — a dedicated sandbox origin and the
// exact domains the page fetches from — and ChatGPT reads the older `openai/*`
// spelling, so both go out at once.
Deno.test('a view declares its sandbox origin and what it may reach', () => {
  let bare = uiMeta('https://yaks.app')
  assertEquals(bare.ui.domain, 'https://yaks.app')
  assertEquals(bare['openai/widgetDomain'], 'https://yaks.app')
  // An empty allowlist is a DECLARATION — this page fetches nothing — and is
  // what the platform's own two inline views say. Saying nothing at all is
  // what a host reads as no policy, and stamps "CSP off" on.
  assertEquals(bare.ui.csp, {})
  assertEquals(bare['openai/widgetCSP'], {
    connect_domains: [],
    resource_domains: [],
  })
  // An app's own view reaches back to its own site for the stylesheet beside
  // it, and names that site again for its `<base href>` to be honored.
  let site = 'https://jeff.yaks.app'
  let its = uiMeta(site, { resourceDomains: [site], baseUriDomains: [site] })
  assertEquals(its.ui.csp.resourceDomains, [site])
  assertEquals(its.ui.csp.baseUriDomains, [site])
  assertEquals(its['openai/widgetCSP'].resource_domains, [site])
  // `base-uri` has no older spelling; the standard surface carries it alone.
  assertEquals(its['openai/widgetCSP'].connect_domains, [])
})

// How many round trips a deploy took, on its own answer (timing.ts, hops.ts):
// `hops` is the store doors it went through (door.ts) and `r2` the bucket
// operations it made (blobs.ts `counted`), both counted where they are made.
// The numbers are asserted EXACTLY, and that is the point of the test: a
// duration says a deploy got slower, and only a count says it got slower
// because something started asking one file at a time. Read back through the
// bench's own parser (bin/app-deploy-time.ts `stages`), so what a run records
// is what the header says.
Deno.test('a deploy says how many round trips it took', async () => {
  let { env } = platform('hops-secret')
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ADA = 'a0000000-0000-4000-8000-0000000000ad'
  let setup: Ctx = { env, dir, person: ADA }
  await call(setup, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(setup, 'app_new', { space: 'ada', slug: 'recipes', title: 'R' })

  // A request is one Ctx and one clock (mcp.ts), so each gesture below gets
  // its own — a per-request memo shared across two calls would count the
  // second one short.
  let costs = async (name: string, args: Record<string, unknown>) => {
    let c = clock()
    let ctx: Ctx = { env, dir, person: ADA, clock: c }
    await c.counting(() => call(ctx, name, args))
    let said = stages(c.header())
    return { hops: said.hops, r2: said.r2 }
  }

  assertEquals(
    await costs('app_files', {
      space: 'ada',
      app: 'recipes',
      files: [
        { path: 'index.html', content: '<h1>hi</h1>' },
        { path: 'style.css', content: 'h1{color:teal}' },
      ],
    }),
    { hops: 5, r2: 4 },
  )
  assertEquals(
    await costs('app_deploy', { space: 'ada', app: 'recipes' }),
    { hops: 17, r2: 27 },
  )
})

// And what a LISTING costs (T-35431). The shape is what the exact numbers are
// here to hold: the directory is asked a FIXED five times however many spaces
// and apps the answer has — the caller's seats, the apps across them, what is
// bound to those apps — and only the one fact an app's own store alone holds
// (what is broken in it, unseen.ts `noted`) costs per app, two facets each,
// asked as one wave. Space by space and app by app it was 38.
Deno.test('a listing asks the directory a fixed number of times', async () => {
  let { env } = platform('listing-hops-secret')
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ADA = 'a0000000-0000-4000-8000-0000000000ad'
  let setup: Ctx = { env, dir, person: ADA }
  for (let space of ['one', 'two', 'three']) {
    await call(setup, 'space_new', { slug: space, title: space })
    for (let app of ['a', 'b', 'c']) {
      await call(setup, 'app_new', { space, slug: `${app}pp`, title: app })
    }
  }
  let costs = async (args: Record<string, unknown>) => {
    let c = clock()
    await c.counting(() =>
      call({ env, dir, person: ADA, clock: c }, 'app_list', args)
    )
    let said = stages(c.header())
    return { hops: said.hops, r2: said.r2 }
  }
  // 3 seats + 1 apps + 1 bindings, then 9 apps × 2 facets.
  assertEquals(await costs({}), { hops: 23, r2: 0 })
  // One space named is read and its seat asked for by name — 2 for 3 apps.
  assertEquals(await costs({ space: 'one' }), { hops: 10, r2: 0 })
})

// The other half of asking once: every row of the one answer has to find its
// way back to the app it is about. A binding names its own app, so it does.
Deno.test('one read of the bindings still lands each on its own app', async () => {
  let { env } = platform('listing-bindings-secret')
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ADA = 'a0000000-0000-4000-8000-0000000000ad'
  let ctx: Ctx = { env, dir, person: ADA }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'recipes', title: 'R' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'garden', title: 'G' })
  let [space] = await dir.spaces(ADA)
  let [recipes] = await dir.apps(space)
  await meta(env).apply([{
    entity: { eid: '$binding' },
    binding: {
      app: recipes.eid,
      name: 'DB',
      type: 'd1',
      id: '',
      resource: 'recipes-db',
    },
  }], KERNEL)
  let said = await call(ctx, 'app_list', {})
  let listed = (said.data as {
    spaces: { apps: { slug: string; bindings: unknown[] }[] }[]
  }).spaces[0].apps
  assertEquals(
    listed.map((a) => [a.slug, a.bindings.length]),
    [['recipes', 1], ['garden', 0]],
  )
})
