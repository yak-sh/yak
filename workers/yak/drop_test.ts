// Deploying by dropping a file, held in workerd (T-34230). The point of the
// door is that it needs no assistant and no script, so the test is a plain
// multipart POST — what a `<form>` sends — and it reads the page that comes
// back, the way whoever dropped the file would.
//
// What has to hold: a zip becomes an app at its own address, one index.html is
// an app too, the same name again is an UPDATE and a version later, and the
// three refusals are sentences on a page rather than a stack trace — a path
// out of the app, more than the ceiling, and nobody signed in.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { kernel, type Packed, seed, signIn, zipped } from './probe.ts'
import { MAX } from './unzip.ts'

// The form a browser sends: the file under `file`, the name beside it.
let drops = (
  k: Awaited<ReturnType<typeof kernel>>,
  host: string,
  file: File,
  slug?: string,
  cookie?: string,
) => {
  let form = new FormData()
  form.set('file', file)
  if (slug != null) form.set('slug', slug)
  return k.at(host, '/deploy', {
    method: 'POST',
    body: form,
    headers: cookie ? { cookie } : {},
  })
}

let zip = async (name: string, entries: Packed[]) =>
  new File([await zipped(entries)], name, { type: 'application/zip' })

slow('a dropped zip becomes an app at its own address', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff', apps: [] }])
    // A zip made from a folder, which is how one is made: every entry sits
    // under `recipes/`, and the app is already called recipes.
    let file = await zip('recipes.zip', [
      { path: 'recipes/' },
      { path: 'recipes/index.html', content: '<h1>Lemon cake</h1>' },
      { path: 'recipes/style.css', content: 'body { color: teal }' },
      { path: 'recipes/__MACOSX/._index.html', content: 'junk' },
    ])
    let out = await drops(k, 'jeff.yaks.app', file, '', them.cookie)
    assertEquals(out.status, 200)
    let page = await out.text()
    // The answer is the page: the address, and what went in.
    assertStringIncludes(page, 'https://jeff.yaks.app/recipes/')
    assertStringIncludes(page, 'index.html')
    assertStringIncludes(page, 'style.css')
    assert(!page.includes('__MACOSX'), page)
    // And the app is SERVING, at the address the page named, with the folder
    // prefix gone.
    let live = await k.at('jeff.yaks.app', '/recipes/')
    assertEquals(live.status, 200)
    assertStringIncludes(await live.text(), 'Lemon cake')
    let css = await k.at('jeff.yaks.app', '/recipes/style.css')
    assertEquals(css.status, 200)
    assertStringIncludes(await css.text(), 'teal')

    // The same name again is the same app, one version later — dropping the
    // zip twice is how a person redeploys.
    let again = await drops(
      k,
      'jeff.yaks.app',
      await zip('recipes.zip', [
        {
          path: 'index.html',
          content: '<h1>Lemon drizzle</h1>',
          deflate: true,
        },
      ]),
      'recipes',
      them.cookie,
    )
    assertEquals(again.status, 200)
    assertStringIncludes(await again.text(), 'Version 2')
    assertStringIncludes(
      await (await k.at('jeff.yaks.app', '/recipes/')).text(),
      'Lemon drizzle',
    )
  } finally {
    await k.stop()
  }
})

slow('a bare index.html is an app, once it is named', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff', apps: [] }])
    let page = () =>
      new File(['<h1>Hello</h1>'], 'index.html', { type: 'text/html' })
    // Unnamed, the file says nothing about what to call the app, so the door
    // asks rather than guessing `index`.
    let asked = await drops(k, 'jeff.yaks.app', page(), '', them.cookie)
    assertEquals(asked.status, 400)
    assertStringIncludes(await asked.text(), 'needs a name typed')

    let out = await drops(k, 'jeff.yaks.app', page(), 'hello', them.cookie)
    assertEquals(out.status, 200)
    assertStringIncludes(await out.text(), 'https://jeff.yaks.app/hello/')
    let live = await k.at('jeff.yaks.app', '/hello/')
    assertEquals(live.status, 200)
    assertStringIncludes(await live.text(), 'Hello')
  } finally {
    await k.stop()
  }
})

slow('what the door will not take, it says in a sentence', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff', apps: [] }])
    // A path that would land outside the app.
    let escaping = await drops(
      k,
      'jeff.yaks.app',
      await zip('bad.zip', [
        { path: 'index.html', content: 'page' },
        { path: '../secrets.txt', content: 'no' },
      ]),
      'bad',
      them.cookie,
    )
    assertEquals(escaping.status, 400)
    assertStringIncludes(await escaping.text(), 'points outside')

    // More than one drop may be. The file itself is over the ceiling, so the
    // door refuses it before it unpacks anything.
    let big = new File(
      [new Uint8Array(MAX + 1024)],
      'big.zip',
      { type: 'application/zip' },
    )
    let over = await drops(k, 'jeff.yaks.app', big, 'big', them.cookie)
    assertEquals(over.status, 400)
    assertStringIncludes(await over.text(), 'the most one drop may be')

    // Neither app was made: a refusal leaves the space exactly as it was.
    assertEquals((await k.at('jeff.yaks.app', '/bad/')).status, 404)
    assertEquals((await k.at('jeff.yaks.app', '/big/')).status, 404)

    // Nobody, and somebody who is nobody HERE: the first is sent to sign in,
    // the second is told whose space it is.
    let cold = await drops(
      k,
      'jeff.yaks.app',
      await zip('mine.zip', [{ path: 'index.html', content: 'page' }]),
      'mine',
    )
    assertEquals(cold.status, 401)
    assertStringIncludes(await cold.text(), 'Sign in')
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let guest = await drops(
      k,
      'jeff.yaks.app',
      await zip('mine.zip', [{ path: 'index.html', content: 'page' }]),
      'mine',
      ann.cookie,
    )
    assertEquals(guest.status, 403)
    assertStringIncludes(await guest.text(), 'not yours to deploy')
    assertEquals((await k.at('jeff.yaks.app', '/mine/')).status, 404)
  } finally {
    await k.stop()
  }
})

// The owner's own page carries the door, and nobody else's does: dropping a
// file is a member's act, and a stranger reading the page must not be offered
// a form that will only ever refuse them.
slow("the drop zone is on the owner's space page", async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let mine = await (await k.at('jeff.yaks.app', '/', {
      headers: { cookie: them.cookie },
    })).text()
    assertStringIncludes(mine, 'action="/deploy"')
    assertStringIncludes(mine, 'type="file"')
    let cold = await (await k.at('jeff.yaks.app', '/')).text()
    assert(!cold.includes('/deploy'), cold)
  } finally {
    await k.stop()
  }
})
