// The zip reader (T-34230), and mostly what it REFUSES: the bytes come off a
// file somebody dragged onto a page, so every no has to be a sentence they can
// act on, and each one is asserted by the words a person would look for.
//
// The fixtures are built here rather than checked in (probe.ts `zipped`), so
// what makes a case what it is — the folder prefix, the escaping path, the
// method nobody reads — is readable in the test.
import { assertEquals, assertRejects } from '@std/assert'
import { zipped } from './probe.ts'
import { escapes, MAX, unzip } from './unzip.ts'

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

let read = async (entries: Parameters<typeof zipped>[0], max = MAX) =>
  await unzip((await zipped(entries)).buffer as ArrayBuffer, max)

let refuses = async (
  entries: Parameters<typeof zipped>[0],
  saying: string,
  max = MAX,
) => {
  await assertRejects(
    async () => {
      await read(entries, max)
    },
    Error,
    saying,
  )
}

Deno.test('a path that escapes the app is one, whatever shape it takes', () => {
  assertEquals(escapes('index.html'), false)
  assertEquals(escapes('css/app.css'), false)
  assertEquals(escapes('..hidden.css'), false)
  assertEquals(escapes('../secrets'), true)
  assertEquals(escapes('a/../../b'), true)
  assertEquals(escapes('/etc/passwd'), true)
  assertEquals(escapes('a\\b'), true)
  assertEquals(escapes('C:/x'), true)
})

Deno.test('stored and deflated entries both come back whole', async () => {
  let out = await read([
    { path: 'index.html', content: '<h1>hi</h1>' },
    { path: 'style.css', content: 'body { color: red }', deflate: true },
  ])
  assertEquals(out.map((e) => e.path), ['index.html', 'style.css'])
  assertEquals(text(out[0].bytes), '<h1>hi</h1>')
  assertEquals(text(out[1].bytes), 'body { color: red }')
})

// A zip made by right-clicking a folder holds the folder, and the app is
// already named: `recipes/index.html` would serve at `/recipes/recipes/`.
Deno.test('one shared top-level folder is stripped', async () => {
  let out = await read([
    { path: 'recipes/' },
    { path: 'recipes/index.html', content: 'page' },
    { path: 'recipes/css/app.css', content: 'css' },
  ])
  assertEquals(out.map((e) => e.path), ['index.html', 'css/app.css'])
})

Deno.test('two top-level folders are both kept', async () => {
  let out = await read([
    { path: 'index.html', content: 'page' },
    { path: 'css/app.css', content: 'css' },
  ])
  assertEquals(out.map((e) => e.path), ['index.html', 'css/app.css'])
})

Deno.test("macOS's own leavings never become files", async () => {
  let out = await read([
    { path: '__MACOSX/._index.html', content: 'junk' },
    { path: 'site/__MACOSX/._index.html', content: 'junk' },
    { path: 'index.html', content: 'page' },
    { path: '.DS_Store', content: 'junk' },
    { path: 'css/.DS_Store', content: 'junk' },
  ])
  assertEquals(out.map((e) => e.path), ['index.html'])
})

// Written as a stream: the local header carries zeros and the index at the end
// carries the sizes. Deflated too, so the packed length has to come from the
// index for the walk to find the next header at all.
Deno.test('a data descriptor sends the reader to the index', async () => {
  let out = await read([
    { path: 'index.html', content: 'page', deflate: true, flags: 8 },
    { path: 'style.css', content: 'css', flags: 8 },
  ])
  assertEquals(out.map((e) => e.path), ['index.html', 'style.css'])
  assertEquals(text(out[0].bytes), 'page')
  assertEquals(text(out[1].bytes), 'css')
})

Deno.test('a path out of the app is refused, by name', () =>
  refuses([{ path: '../secrets.txt', content: 'no' }], 'points outside'))

Deno.test('an absolute path is refused', () =>
  refuses([{ path: '/etc/passwd', content: 'no' }], 'points outside'))

Deno.test('a method nobody reads is refused, and named', () =>
  refuses([{ path: 'index.html', content: 'x', method: 12 }], 'method 12'))

Deno.test('an encrypted entry is refused', () =>
  refuses([{ path: 'index.html', content: 'x', flags: 1 }], 'password'))

Deno.test('more than the ceiling is refused', () =>
  refuses([{ path: 'big.txt', content: 'x'.repeat(600) }], 'more than', 500))

// The ceiling is counted on the way OUT of the decompressor: 600 KB of one
// letter deflates to almost nothing, so a zip that lies about its size is
// still stopped by what it produces.
Deno.test('a zip that unpacks past the ceiling is refused', () =>
  refuses(
    [{ path: 'big.txt', content: 'x'.repeat(600_000), deflate: true }],
    'more than',
    1000,
  ))

// A zip of a folder and macOS's leavings holds no file anybody meant to send.
Deno.test('a zip with nothing in it to serve is refused', () =>
  refuses(
    [{ path: 'recipes/' }, { path: '__MACOSX/._index.html', content: 'x' }],
    'no files',
  ))

// A zip with no entries at all is an end record and nothing else, so it never
// reaches the walk: it is refused as not being a zip, which is what it looks
// like to a person too.
Deno.test('an empty zip is refused', () => refuses([], "isn't a zip"))

Deno.test('bytes that are not a zip are refused', async () => {
  let page = new TextEncoder().encode('<h1>not a zip</h1>')
  await assertRejects(
    async () => {
      await unzip(page.buffer as ArrayBuffer)
    },
    Error,
    "isn't a zip",
  )
})
