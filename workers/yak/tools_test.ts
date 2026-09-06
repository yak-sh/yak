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
  // Only a .json file is parsed: a .js file full of braces is not JSON and
  // saying so of it would be noise on every write.
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
  assertStringIncludes(parses(bytes('{"a": ')), 'NOT valid JSON')
  assertEquals(parses(bytes('[]')), 'parsed')
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
  ])
  for (let arg of ['find', 'replace', 'url']) {
    assertEquals(typeof input.properties[arg], 'object', `${arg} is described`)
  }
  for (let word of ['sha256', 'parses', 'op: patch', 'op: fetch']) {
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
