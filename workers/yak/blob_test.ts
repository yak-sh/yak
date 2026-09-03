// The file door, held in workerd (probe.ts boots the kernel): a page hands the
// app bytes through the served client's `upload`, gets a content-addressed
// address back, and reads the same bytes out of it. What is proved here is
// what C-32675 found missing — there was nowhere to put a photo — plus the
// three edges that make the door safe to hand a person: the same file twice is
// one row, a file over the ceiling is refused with a sentence, and a stranger
// on a `public` app is sent to sign in.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { browser, connector, kernel, seed } from './probe.ts'

// The client module the kernel serves, loaded the way a page loads it.
let served = async (k: Awaited<ReturnType<typeof kernel>>, dir: string) => {
  let source = await (await k.at('jeff.yaks.app', '/photos/api/client.js'))
    .text()
  Deno.writeTextFileSync(`${dir}/client.js`, source)
  return await import(`file://${dir}/client.js`)
}

// A tiny PNG: a real header, so the mime a page sends is a mime a page means.
let png = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(64).fill(0).map((_, i) => i),
])

let hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

type File = { eid: string; url: string; mime: string; bytes: number }
type Row = {
  entity: { eid: string }
  attachment?: { mime: string; name: string; blob: string }
}

slow('the file door: a page uploads bytes and gets an address', async () => {
  let k = await kernel()
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-blob-' })
  let them = await seed(k, [{ slug: 'jeff', apps: ['photos'] }])
  let mine = browser(k, 'jeff.yaks.app', them.cookie)
  let anyone = browser(k, 'jeff.yaks.app')
  try {
    let mod = await served(k, dir)
    let store = mod.store(`${mine.origin}/photos/api/`)

    // The guide's own two lines: a file in, its address back.
    let file: File = await store.upload(
      new File([png], 'cake.png', { type: 'image/png' }),
    )
    assertEquals(file.eid, await hex(png))
    assertEquals(file.mime, 'image/png')
    assertEquals(file.bytes, png.byteLength)
    assertEquals(file.url, `/photos/api/blob/${file.eid}`)

    // The bytes come back whole, as what they are, cached forever — a content
    // address can never name different bytes.
    let got = await fetch(`${mine.origin}${file.url}`)
    assertEquals(got.status, 200)
    assertEquals(got.headers.get('content-type'), 'image/png')
    assertMatch(got.headers.get('cache-control') ?? '', /immutable/)
    assertEquals(new Uint8Array(await got.arrayBuffer()), png)

    // And it is a ROW: the app's own store knows what the file is called, and
    // an ordinary listing shows the file and not the bytes behind it — a
    // doc's body is a blob row too, and nobody saved that.
    let files: Row[] = await store.query('.attachment!')
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
    let one: Row[] = await store.query('.attachment!')
    assertEquals(one.length, 1)
    assertEquals(one[0].entity.eid, files[0].entity.eid)
    assertEquals(one[0].attachment?.name, 'the cake.png')

    // …and a third that names nothing keeps the name it had: the same file is
    // the same file, whatever a canvas had to call it.
    await store.upload(new Blob([png], { type: 'image/png' }))
    let still: Row[] = await store.query('.attachment!')
    assertEquals(still.length, 1)
    assertEquals(still[0].attachment?.name, 'the cake.png')

    // A row of the app's own that points at the bytes — the guide's photo.
    await store.apply({ comment: { target: file.eid } })
    let [aimed] = await store.query('.comment!')
    assertEquals(aimed.comment.target, file.eid)

    // Over the ceiling, refused with a sentence a person can act on. Sent at
    // the wire: a page would never build this, and the door must not read it.
    let over = await k.at('jeff.yaks.app', '/photos/api/blob', {
      method: 'POST',
      headers: { cookie: them.cookie, 'content-type': 'image/png' },
      body: new Uint8Array(21 * 1024 * 1024),
    })
    assertEquals(over.status, 413)
    let said = await over.json()
    assertEquals(said.error.code, 'too_large')
    assertMatch(said.error.message, /20 MB/)

    // A stranger on a `public` app may LOOK at the bytes and may not add any:
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

    // On an `open` app, though, a stranger IS a writer: the door that lets
    // anyone with the link save a row lets them put a photo beside it.
    let agent = connector(k, them.cookie)
    await agent.tool('app_set', {
      space: 'jeff',
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
