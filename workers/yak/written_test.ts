// What an app's files hold between deploys, held through app_files: a write
// stores each file once at its address, one sent again sends only what did
// not land, a path answers its own past and is put back without moving bytes,
// and two writers at once lose neither write.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { platform } from './testing.ts'
import * as dirPart from './directory.ts'
import { call, type Ctx } from './tools.ts'
import { r2RawObjects } from './lib/objects.ts'
import { histories } from './carried.ts'
import { addressed, pinned, sha256 } from './versions.ts'
import { drafting } from './written.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let encode = (text: string) => new TextEncoder().encode(text)
let sha = (text: string) => sha256(encode(text))

// A space with one app nothing has deployed, and the doors these tests use.
let made = async (p: ReturnType<typeof platform>) => {
  let dir = dirPart.directory({ fetch: (r) => dirPart.fetch(r, p.env) }, true)
  let ctx: Ctx = { env: p.env, dir, person: ADA }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'notes', title: 'Notes' })
  let files = (op: string, more: Record<string, unknown> = {}) =>
    call(ctx, 'app_files', { space: 'ada', app: 'notes', op, ...more })
  let write = (sent: Record<string, string>) =>
    call(ctx, 'app_files', {
      space: 'ada',
      app: 'notes',
      files: Object.entries(sent).map(([path, content]) => ({ path, content })),
    })
  let read = async (path: string) => (await files('read', { path })).text
  // Every put the bucket is asked for, from here on.
  let puts: string[] = []
  let put = p.env.BLOBS.put.bind(p.env.BLOBS)
  p.env.BLOBS.put = (key, value) => {
    puts.push(key)
    return put(key, value)
  }
  let app = async () => (await dir.app((await dir.space('ada'))!, 'notes'))!
  return { dir, ctx, files, write, read, puts, app }
}

test('a write sent again sends only what did not land, and says so', async () => {
  await using p = platform('written-resend')
  let { write, puts } = await made(p)
  let first = await write({ 'a.txt': 'one', 'b.txt': 'two' })
  assertStringIncludes(first.text, 'wrote 2 files')
  assertEquals(
    puts.sort(),
    [addressed(await sha('one')), addressed(await sha('two'))].sort(),
  )
  // The same call again, as a write cut off and resent is, with one more.
  puts.length = 0
  let again = await write({ 'a.txt': 'one', 'b.txt': 'two', 'c.txt': 'three' })
  assertEquals(puts, [addressed(await sha('three'))])
  assertEquals(again.value, { wrote: ['c.txt'], already: ['a.txt', 'b.txt'] })
  assertStringIncludes(again.text, 'wrote 1 of 3 files')
  assertStringIncludes(again.text, 'b.txt — 3 bytes')
  assertStringIncludes(again.text, 'already there')
})

test('a path answers its own past, and is put back without moving bytes', async () => {
  await using p = platform('written-history')
  let { files, write, read, puts } = await made(p)
  await write({ 'page.html': 'one' })
  await new Promise((done) => setTimeout(done, 5))
  let between = new Date().toISOString()
  await new Promise((done) => setTimeout(done, 5))
  await write({ 'page.html': 'two' })
  let past = (await files('history', { path: 'page.html' })).text
  assertStringIncludes(past, `now — 3 B, sha256 ${await sha('two')}`)
  assertMatch(
    past,
    new RegExp(`- until \\S+ — 3 B, sha256 ${await sha('one')}`),
  )
  // Undo the last write, with nothing to remember: no byte moves.
  puts.length = 0
  await files('restore', { path: 'page.html' })
  assertEquals(puts, [])
  assertEquals(await read('page.html'), 'one')
  // A restore is a write, so it can itself be undone, by sha or by moment.
  await files('restore', { path: 'page.html', sha: await sha('two') })
  assertEquals(await read('page.html'), 'two')
  await files('restore', { path: 'page.html', at: between })
  assertEquals(await read('page.html'), 'one')
  // Four writes took something away; the first took nothing.
  assertEquals(
    (await files('history', { path: 'page.html' })).text.split('\n- ').length,
    5,
  )
})

test('a file deleted comes back, and a delete sent again says so', async () => {
  await using p = platform('written-delete')
  let { files, write, read } = await made(p)
  await write({ 'a.txt': 'one', 'b.txt': 'two' })
  await files('delete', { path: 'a.txt' })
  let listed = (await files('list')).value as { files: { path: string }[] }
  assertEquals(listed.files.map((f) => f.path), ['b.txt'])
  assertStringIncludes(
    (await files('delete', { path: 'a.txt' })).text,
    'already deleted a.txt',
  )
  await files('restore', { path: 'a.txt' })
  assertEquals(await read('a.txt'), 'one')
})

test('two writers at once lose neither write', async () => {
  await using p = platform('written-race')
  let { files, write, read } = await made(p)
  await Promise.all([write({ 'a.txt': 'one' }), write({ 'b.txt': 'two' })])
  assertEquals(await read('a.txt'), 'one')
  assertEquals(await read('b.txt'), 'two')
  // Two writes of one path: the later one stands, the other is its past.
  await Promise.all([write({ 'a.txt': 'left' }), write({ 'a.txt': 'right' })])
  let now = await read('a.txt')
  assert(['left', 'right'].includes(now), now)
  let past = (await files('history', { path: 'a.txt' })).text
  for (let text of ['left', 'right']) {
    assertStringIncludes(past, await sha(text))
  }
})

test('an old history log becomes rows once, and answers as it did', async () => {
  await using p = platform('written-carry')
  let { dir, files, read, app } = await made(p)
  // An app served in place, its page as the last logged write left it, and
  // the log that write kept: newest first, the bytes each write replaced,
  // the oldest still under the app's own per-app key.
  let raw = r2RawObjects(p.env.BLOBS)
  let prefix = 'ada/notes/'
  await raw.put(`${prefix}page.html`, encode('three'))
  await dir.stamp({
    entities: [{ entity: { eid: (await app()).eid }, app: { version: 1 } }],
  })
  await raw.put(addressed(await sha('two')), encode('two'))
  await raw.put(pinned(prefix, await sha('one')), encode('one'))
  let log = [
    { sha: await sha('two'), size: 3, at: '2026-10-02T00:00:00.000Z', by: ADA },
    { sha: await sha('one'), size: 3, at: '2026-10-01T00:00:00.000Z', by: ADA },
  ]
  await raw.put(`${prefix}history/page.html.json`, encode(JSON.stringify(log)))
  let draft = await drafting(raw, dir, (await dir.space('ada'))!, await app())
  let carry = () =>
    histories(
      raw,
      dir,
      prefix,
      draft.app,
      () => Promise.resolve(draft.files),
      new Set(),
      10,
    )
  assertEquals(await carry(), 1)
  assertEquals(await carry(), 0)
  assertEquals(await raw.has(addressed(await sha('one'))), true)
  let past = (await files('history', { path: 'page.html' })).text
  for (let text of ['one', 'two', 'three']) {
    assertStringIncludes(past, await sha(text))
  }
  // What the page held on each day, as the log said.
  let on = async (at: string) => {
    await files('restore', { path: 'page.html', at })
    return await read('page.html')
  }
  assertEquals(await on('2026-10-01T12:00:00.000Z'), 'two')
  assertEquals(await on('2026-09-30T00:00:00.000Z'), 'one')
  assertEquals(await on('2026-10-03T00:00:00.000Z'), 'three')
})
