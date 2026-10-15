// The zip reader (T-34230), and mostly what it refuses: the bytes come off a
// file somebody dragged onto a page, so every no has to be a sentence they can
// act on, and each one is asserted by the words a person would look for.
//
// The fixtures are built here rather than checked in (probe.ts `zipped`), so
// what makes a case what it is — the folder prefix, the escaping path, the
// method nobody reads — is readable in the test. Each is read as a stream
// hands it over, seven bytes at a time, so every header, size and descriptor
// lands across a chunk's edge somewhere.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { zipped } from './probe.ts'
import { type Entry, escapes, unfolded, unzip } from './unzip.ts'

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function* chunked(bytes: Uint8Array<ArrayBuffer>) {
  for (let at = 0; at < bytes.length; at += 7) {
    yield bytes.subarray(at, at + 7)
  }
}

let unpacked = async (bytes: Uint8Array<ArrayBuffer>, max = Infinity) => {
  let out: Entry[] = []
  for await (let entry of unzip(chunked(bytes), max)) out.push(entry)
  return unfolded(out)
}

let read = async (entries: Parameters<typeof zipped>[0], max = Infinity) =>
  await unpacked(await zipped(entries), max)

let refuses = async (
  entries: Parameters<typeof zipped>[0],
  saying: string,
  max = Infinity,
) => {
  await assertRejects(
    async () => {
      await read(entries, max)
    },
    Error,
    saying,
  )
}

test('a path that escapes the app is one, whatever shape it takes', () => {
  assertEquals(escapes('index.html'), false)
  assertEquals(escapes('css/app.css'), false)
  assertEquals(escapes('..hidden.css'), false)
  assertEquals(escapes('../secrets'), true)
  assertEquals(escapes('a/../../b'), true)
  assertEquals(escapes('/etc/passwd'), true)
  assertEquals(escapes('a\\b'), true)
  assertEquals(escapes('C:/x'), true)
})

// A zip is made once, as the file it stands for is: its reading is the test.
let mixed = await zipped([
  { path: 'index.html', content: '<h1>hi</h1>' },
  { path: 'style.css', content: 'body { color: red }', deflate: true },
])

test('stored and deflated entries both come back whole', async () => {
  let out = await unpacked(mixed)
  assertEquals(out.map((e) => e.path), ['index.html', 'style.css'])
  assertEquals(text(out[0].bytes), '<h1>hi</h1>')
  assertEquals(text(out[1].bytes), 'body { color: red }')
})

// A zip made by right-clicking a folder holds the folder, and the app is
// already named: `recipes/index.html` would serve at `/recipes/recipes/`.
test('one shared top-level folder is stripped', async () => {
  let out = await read([
    { path: 'recipes/' },
    { path: 'recipes/index.html', content: 'page' },
    { path: 'recipes/css/app.css', content: 'css' },
  ])
  assertEquals(out.map((e) => e.path), ['index.html', 'css/app.css'])
})

test('two top-level folders are both kept', async () => {
  let out = await read([
    { path: 'index.html', content: 'page' },
    { path: 'css/app.css', content: 'css' },
  ])
  assertEquals(out.map((e) => e.path), ['index.html', 'css/app.css'])
})

test("macOS's own leavings never become files", async () => {
  let out = await read([
    { path: '__MACOSX/._index.html', content: 'junk' },
    { path: 'site/__MACOSX/._index.html', content: 'junk' },
    { path: 'index.html', content: 'page' },
    { path: '.DS_Store', content: 'junk' },
    { path: 'css/.DS_Store', content: 'junk' },
  ])
  assertEquals(out.map((e) => e.path), ['index.html'])
})

// Written as a stream: the local header carries zeros and a descriptor after
// the bytes carries the sizes, with its signature or, as the format allows,
// without. Stored bytes holding a descriptor's signature of their own are
// still one file: the end is where a descriptor records the size read so far.
let fake = 'a PK\x07\x08 that is not the end'
let streamed = await zipped([
  { path: 'index.html', content: 'page', deflate: true, flags: 8 },
  { path: 'style.css', content: 'css', flags: 8 },
  { path: 'fake.txt', content: fake, flags: 8 },
  { path: 'bare.txt', content: fake, flags: 8, bare: true },
  { path: 'last.txt', content: 'last', deflate: true, flags: 8, bare: true },
])

test('an entry written as a stream ends at its descriptor', async () => {
  let out = await unpacked(streamed)
  assertEquals(out.map((e) => [e.path, text(e.bytes)]), [
    ['index.html', 'page'],
    ['style.css', 'css'],
    ['fake.txt', fake],
    ['bare.txt', fake],
    ['last.txt', 'last'],
  ])
})

// One stored file is a 40-byte header and its 4 bytes: cut inside them, and
// cut where the index should begin.
test('a zip cut short is refused', async () => {
  let whole = await zipped([{ path: 'index.html', content: 'page' }])
  await assertRejects(
    () => unpacked(whole.slice(0, 42)),
    Error,
    'middle of index.html',
  )
  await assertRejects(() => unpacked(whole.slice(0, 44)), Error, 'its end')
})

// One byte that names a deflate block type there is no such thing as.
test('a deflate that will not inflate is refused, by name', () =>
  refuses([{ path: 'index.html', content: '\x07', method: 8 }], 'damaged'))

test('a path out of the app is refused, by name', () =>
  refuses([{ path: '../secrets.txt', content: 'no' }], 'points outside'))

test('an absolute path is refused', () =>
  refuses([{ path: '/etc/passwd', content: 'no' }], 'points outside'))

test('a method nobody reads is refused, and named', () =>
  refuses([{ path: 'index.html', content: 'x', method: 12 }], 'method 12'))

test('an encrypted entry is refused', () =>
  refuses([{ path: 'index.html', content: 'x', flags: 1 }], 'password'))

test('more than the room is refused', () =>
  refuses([{ path: 'big.txt', content: 'x'.repeat(600) }], 'more than', 500))

// The ceiling is counted on the way out of the decompressor, so a zip that
// lies about its size is still stopped by what it produces.
test('a zip that unpacks past the room is refused', () =>
  refuses(
    [{ path: 'big.txt', content: 'x'.repeat(2000), deflate: true, size: 10 }],
    'more than',
    1000,
  ))

// A zip of a folder and macOS's leavings holds no file anybody meant to send.
test('a zip with nothing in it to serve is refused', () =>
  refuses(
    [{ path: 'recipes/' }, { path: '__MACOSX/._index.html', content: 'x' }],
    'no files',
  ))

// A zip with no entries at all is an end record and nothing else, so it never
// reaches the walk: it is refused as not being a zip, which is what it looks
// like to a person too.
test('an empty zip is refused', () => refuses([], "isn't a zip"))

test('bytes that are not a zip are refused', async () => {
  let page = new TextEncoder().encode('<h1>not a zip</h1>')
  await assertRejects(() => unpacked(page), Error, "isn't a zip")
})
