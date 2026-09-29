// The file door, through the whole kernel (probe.ts `kernel`): a page hands the
// app bytes through the served client's `upload`, gets a content-addressed
// address back, and reads the same bytes out of it. What is proved here is
// what C-32675 found missing — there was nowhere to put a photo — plus the
// four edges that make the door safe to hand a person: the same file twice is
// one row, a picture arrives measured, a file over the ceiling is refused in
// words a guest can act on, and a stranger on a `public` app is sent to sign
// in.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { browser, connector, kernel, seed } from './probe.ts'

// The client module the kernel serves, loaded the way a page loads it.
let served = async (
  k: Awaited<ReturnType<typeof kernel>>,
  dir: string,
  host: string,
) => {
  let source = await (await k.at(host, '/photos/api/client.js')).text()
  Deno.writeTextFileSync(`${dir}/client.js`, source)
  return await import(`file://${dir}/client.js`)
}

// A tiny PNG and a tiny JPEG: header bytes a picture would really open with,
// so the mime a page sends is a mime a page means and the door can read the
// size out of them the way it reads one out of a phone's photo (@yaks/blob).
let bytes = (...xs: (number | number[] | string)[]) =>
  new Uint8Array(
    xs.flatMap((x) =>
      typeof x == 'string'
        ? [...x].map((c) => c.charCodeAt(0))
        : typeof x == 'number'
        ? [x]
        : x
    ),
  )

let be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
let be32 = (n: number) => [...be16(n >>> 16), ...be16(n & 0xffff)]

let png = bytes(
  '\x89PNG\r\n\x1a\n',
  be32(13),
  'IHDR',
  be32(1600),
  be32(900),
  new Array(24).fill(0).map((_, i) => i),
)

let jpg = bytes(
  0xff,
  0xd8,
  0xff,
  0xc0,
  be16(17),
  8,
  be16(480),
  be16(640),
  new Array(10).fill(7),
)

let hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

test('a named media upload stays seekable when its metadata changes', async () => {
  let k = await kernel()
  let them = await seed(k, [{ slug: 'mediabox', apps: ['player'] }])
  let host = 'mediabox.yaks.app'
  let path = '/player/api/blob'
  let media = bytes(be32(24), 'ftyp', 'isom', be32(0), 'isom', 'mp41')
  let upload = async (mime: string, name: string) => {
    let res = await k.at(host, path, {
      method: 'POST',
      headers: {
        cookie: them.cookie,
        'content-type': mime,
        'x-yak-name': encodeURIComponent(name),
      },
      body: media,
    })
    assertEquals(res.status, 200)
    return await res.json() as File
  }
  let file = await upload('application/octet-stream', '旅行—draft.MP4')
  assertEquals(file.mime, 'video/mp4')
  let get = (url: string, headers: HeadersInit = {}, method = 'GET') =>
    k.at(host, url, { method, headers })
  let first = await get(file.url)
  assertEquals(first.status, 200)
  assertEquals(first.headers.get('content-type'), 'video/mp4')
  assertMatch(
    first.headers.get('content-disposition') ?? '',
    /filename\*=UTF-8''%E6%97%85/,
  )
  assertEquals(first.headers.get('cache-control'), 'private, no-cache')
  let etag = first.headers.get('etag')!
  await first.body?.cancel()
  let part = await get(file.url, { range: 'bytes=2-4', 'if-range': etag })
  assertEquals(part.status, 206)
  assertEquals(part.headers.get('content-range'), `bytes 2-4/${media.length}`)
  assertEquals(new Uint8Array(await part.arrayBuffer()), media.slice(2, 5))
  let head = await get(file.url, {}, 'HEAD')
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), String(media.length))
  assertEquals(await head.text(), '')

  // A later upload can rename the attachment, but the old URL keeps its
  // original download name and validator.
  let again = await upload('audio/mp4', 'theme.m4a')
  assertEquals(again.eid, file.eid)
  assert(file.url != again.url)
  let changed = await get(again.url, { 'if-none-match': etag })
  assertEquals(changed.status, 200)
  assertEquals(changed.headers.get('content-type'), 'video/mp4')
  assertMatch(changed.headers.get('content-disposition') ?? '', /theme\.m4a/)
  let next = changed.headers.get('etag')!
  assert(next != etag)
  await changed.body?.cancel()
  let oldRange = await get(file.url, { range: 'bytes=2-', 'if-range': etag })
  assertEquals(oldRange.status, 206)
  assertMatch(
    oldRange.headers.get('content-disposition') ?? '',
    /filename\*=UTF-8''%E6%97%85/,
  )
  assertEquals(new Uint8Array(await oldRange.arrayBuffer()), media.slice(2))
  let valid = await get(again.url, { 'if-none-match': next })
  assertEquals(valid.status, 304)
  let alias = await k.at(host, `${path}/${file.eid}`, { redirect: 'manual' })
  assertEquals(alias.status, 302)
  assertEquals(new URL(alias.headers.get('location')!).pathname, again.url)
  let agent = connector(k, them.cookie)
  await agent.tool('app_set', {
    space: 'mediabox',
    app: 'player',
    access: 'private',
  })
  assertEquals((await get(file.url)).status, 401)
  let owner = await k.at(host, file.url, {
    headers: { cookie: them.cookie },
  })
  assertEquals(owner.status, 200)
  assertEquals(owner.headers.get('cache-control'), 'private, no-store')
  await owner.body?.cancel()
})

type File = {
  eid: string
  url: string
  mime: string
  bytes: number
  w?: number
  h?: number
}
type Row = {
  entity: { eid: string }
  attachment?: { mime: string; name: string; blob: string }
  image?: { w: number; h: number }
}

test('the file door: a page uploads bytes and gets an address', async () => {
  let k = await kernel()
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-blob-' })
  let them = await seed(k, [{ slug: 'jeff5', apps: ['photos'] }])
  let mine = browser(k, 'jeff5.yaks.app', them.cookie)
  let anyone = browser(k, 'jeff5.yaks.app')
  try {
    let mod = await served(k, dir, 'jeff5.yaks.app')
    let store = mod.store(`${mine.origin}/photos/api/`)

    // The guide's own two lines: a file in, its address back.
    let file: File = await store.upload(
      new File([png], 'cake.png', { type: 'image/png' }),
    )
    assertEquals(file.eid, await hex(png))
    assertEquals(file.mime, 'image/png')
    assertEquals(file.bytes, png.byteLength)
    assertMatch(
      file.url,
      new RegExp(`^/photos/api/blob/${file.eid}/[0-9a-f]{64}$`),
    )
    // …and what the picture measures, read off its header in the door: the
    // page that just picked it can hold its space open before it renders.
    assertEquals([file.w, file.h], [1600, 900])

    // The bytes come back whole, as what they are, cached forever — a content
    // address can never name different bytes.
    let got = await fetch(`${mine.origin}${file.url}`)
    assertEquals(got.status, 200)
    assertEquals(got.headers.get('content-type'), 'image/png')
    assertEquals(got.headers.get('cache-control'), 'private, no-cache')
    assertEquals(new Uint8Array(await got.arrayBuffer()), png)

    // And it is a row: the app's own store knows what the file is called, and
    // an ordinary listing shows the file and not the bytes behind it — a
    // doc's body is a blob row too, and nobody saved that.
    let files: Row[] = await store.query('.attachment')
    assertEquals(files.length, 1)
    assertEquals(files[0].attachment?.blob, file.eid)
    assertEquals(files[0].attachment?.mime, 'image/png')
    assertEquals(files[0].attachment?.name, 'cake.png')

    // The same bytes again are the same file: one address, one row, renamed
    // by whatever the page calls them the second time.
    let again: File = await store.upload(
      new File([png], 'the cake.png', { type: 'image/png' }),
    )
    assertEquals(again.eid, file.eid)
    let one: Row[] = await store.query('.attachment')
    assertEquals(one.length, 1)
    assertEquals(one[0].entity.eid, files[0].entity.eid)
    assertEquals(one[0].attachment?.name, 'the cake.png')

    // …and a third that names nothing keeps the name it had: the same file is
    // the same file, whatever a canvas had to call it.
    await store.upload(new Blob([png], { type: 'image/png' }))
    let still: Row[] = await store.query('.attachment')
    assertEquals(still.length, 1)
    assertEquals(still[0].attachment?.name, 'the cake.png')

    // Another kind of picture states its size another way, and the door reads
    // that one too; a file that is not a picture says nothing, and gets no
    // `image` rather than a guess.
    let shot: File = await store.upload(
      new File([jpg], 'ring.jpg', { type: 'image/jpeg' }),
    )
    assertEquals([shot.w, shot.h], [640, 480])
    let list: File = await store.upload(
      new File([new TextEncoder().encode('aunt mary\n')], 'guests.txt', {
        type: 'text/plain',
      }),
    )
    assertEquals([list.w, list.h], [undefined, undefined])
    // The size sits on the content row, at the sha a photo row points at, so
    // a wall reads it by the eid it already holds.
    let sizes = new Map(
      (await store.query('.image') as Row[]).map((
        r,
      ) => [r.entity.eid, r.image]),
    )
    assertEquals(sizes.size, 2)
    assertEquals(sizes.get(file.eid), { w: 1600, h: 900 })
    assertEquals(sizes.get(shot.eid), { w: 640, h: 480 })
    assertEquals(sizes.get(list.eid), undefined)

    // A row of the app's own that points at the bytes — the guide's photo.
    await store.apply({ comment: { target: file.eid } })
    let [aimed] = await store.query('.comment')
    assertEquals(aimed.comment.target, file.eid)
    // …and the guide's look-before-you-write: a row already aimed at these
    // bytes, so a second send does not put the same photo on the wall twice.
    assertEquals(
      (await store.query(`.comment.target=${file.eid}`) as Row[]).length,
      1,
    )

    // Over the ceiling, refused with a sentence a person can act on. Sent at
    // the wire: a page would never build this, and the door must not read it.
    let over = await k.at('jeff5.yaks.app', '/photos/api/blob', {
      method: 'POST',
      headers: { cookie: them.cookie, 'content-type': 'image/png' },
      body: new Uint8Array(21 * 1024 * 1024),
    })
    assertEquals(over.status, 413)
    let said = await over.json()
    assertEquals(said.error.code, 'too_large')
    // The code is the developer's half; the sentence is read by a guest at
    // the party through `show(e.message)`, so it asks them for a smaller
    // photo and leaves the downscale recipe to the guide (C-32706 item 3).
    assertEquals(
      said.error.message,
      'that file is too big to send — try a smaller one',
    )

    // A stranger on a `public` app may look at the bytes and may not add any:
    // the write rule is the app's own, and the refusal says where to sign in.
    let strangers = mod.store(`${anyone.origin}/photos/api/`)
    let no = await strangers.upload(
      new File([png], 'theirs.png', { type: 'image/png' }),
    ).catch((e: Error & { signIn?: string }) => e)
    assertEquals(no.message, 'sign in to change this app')
    assertMatch(no.signIn ?? '', /^https:\/\/yaks\.app\/login\?return=/)
    assertEquals(
      (await fetch(`${anyone.origin}${file.url}`)).status,
      200,
    )

    // On an `open` app, though, a stranger is a writer: the door that lets
    // anyone with the link save a row lets them put a photo beside it.
    let agent = connector(k, them.cookie)
    await agent.tool('app_set', {
      space: 'jeff5',
      app: 'photos',
      access: 'open',
    })
    let theirs: File = await strangers.upload(
      new File([new Uint8Array([1, 2, 3])], 'theirs.bin'),
    )
    assert(theirs.eid != file.eid)
    assertEquals(theirs.mime, 'application/octet-stream')
  } finally {
    await mine.stop()
    await anyone.stop()
    Deno.removeSync(dir, { recursive: true })
    await k.stop()
  }
})
