// Deploying by dropping a file, through the whole kernel (T-34230). The point of the
// door is that it needs no assistant and no script, so the test is a plain
// multipart POST — what a `<form>` sends — and it reads the page that comes
// back, the way whoever dropped the file would.
//
// What has to hold: a zip becomes an app at its own address, one index.html is
// an app too, the same name again is an UPDATE and a version later, and the
// three refusals are sentences on a page rather than a stack trace — a path
// out of the app, more than the ceiling, and nobody signed in.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { kernel, type Packed, seed, signIn, zipped } from './probe.ts'
import { MAX } from './unzip.ts'
import { managePath } from './route.ts'

// The form a browser sends: the file under `file`, the name beside it.
let drops = (
  k: Awaited<ReturnType<typeof kernel>>,
  host: string,
  file: File,
  slug?: string,
  cookie?: string,
  origin?: string,
) => {
  let form = new FormData()
  form.set('file', file)
  if (slug != null) form.set('slug', slug)
  return k.at(host, '/deploy', {
    method: 'POST',
    body: form,
    headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
  })
}

let zip = async (name: string, entries: Packed[]) =>
  new File([await zipped(entries)], name, { type: 'application/zip' })

Deno.test('a dropped zip becomes an app at its own address', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff14', apps: [] }])
    // A zip made from a folder, which is how one is made: every entry sits
    // under `recipes/`, and the app is already called recipes.
    let file = await zip('recipes.zip', [
      { path: 'recipes/' },
      { path: 'recipes/index.html', content: '<h1>Lemon cake</h1>' },
      { path: 'recipes/style.css', content: 'body { color: teal }' },
      { path: 'recipes/__MACOSX/._index.html', content: 'junk' },
    ])
    let out = await drops(k, 'jeff14.yaks.app', file, '', them.cookie)
    assertEquals(out.status, 200)
    let page = await out.text()
    // The answer is the page: the address, and what went in.
    assertStringIncludes(page, 'https://jeff14.yaks.app/recipes/')
    assertStringIncludes(page, 'index.html')
    assertStringIncludes(page, 'style.css')
    assert(!page.includes('__MACOSX'), page)
    // And the app is serving, at the address the page named, with the folder
    // prefix gone.
    let live = await k.at('jeff14.yaks.app', '/recipes/')
    assertEquals(live.status, 200)
    assertStringIncludes(await live.text(), 'Lemon cake')
    let css = await k.at('jeff14.yaks.app', '/recipes/style.css')
    assertEquals(css.status, 200)
    assertStringIncludes(await css.text(), 'teal')

    // The same name again is the same app, one version later — dropping the
    // zip twice is how a person redeploys.
    let again = await drops(
      k,
      'jeff14.yaks.app',
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
      await (await k.at('jeff14.yaks.app', '/recipes/')).text(),
      'Lemon drizzle',
    )
  } finally {
    await k.stop()
  }
})

// The other door a wasm-compiled worker can arrive by (T-34263). A zip is the
// natural way one travels — the compiler wrote a `.wasm` and a `.js` beside
// it — so what has to hold here is that the bytes survive the trip: a drop
// carries a file that is not text through unchanged, and the deploy behind it
// is the same `app_deploy` that walks worker.js's imports.
Deno.test('a dropped zip carries a worker and the wasm it imports', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff15', apps: [] }])
    let wasm = Deno.readFileSync(
      new URL('./fixtures/add.wasm', import.meta.url),
    )
    let out = await drops(
      k,
      'jeff15.yaks.app',
      await zip('adder.zip', [
        { path: 'index.html', content: '<h1>2 + 3</h1>' },
        {
          path: 'worker.js',
          content: Deno.readFileSync(
            new URL('./fixtures/worker.js', import.meta.url),
          ),
        },
        { path: 'add.wasm', content: wasm, deflate: true },
      ]),
      'adder',
      them.cookie,
    )
    assertEquals(out.status, 200)
    assertStringIncludes(await out.text(), 'https://jeff15.yaks.app/adder/')
    // Byte for byte, and typed as wasm — a file the door decoded as text
    // would arrive as mojibake and never compile.
    let back = await k.at('jeff15.yaks.app', '/adder/add.wasm')
    assertEquals(back.status, 200)
    assertEquals(back.headers.get('content-type'), 'application/wasm')
    assertEquals(new Uint8Array(await back.arrayBuffer()), wasm)
    // The worker is the app's inside, here as anywhere: it is deployed, not
    // served (apps.ts manifest).
    assertEquals(
      (await k.at('jeff15.yaks.app', '/adder/worker.js')).status,
      404,
    )
  } finally {
    await k.stop()
  }
})

Deno.test('a bare index.html is an app, once it is named', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff16', apps: [] }])
    let page = () =>
      new File(['<h1>Hello</h1>'], 'index.html', { type: 'text/html' })
    // Unnamed, the file says nothing about what to call the app, so the door
    // asks rather than guessing `index`.
    let asked = await drops(k, 'jeff16.yaks.app', page(), '', them.cookie)
    assertEquals(asked.status, 400)
    assertStringIncludes(await asked.text(), 'needs a name typed')

    let out = await drops(k, 'jeff16.yaks.app', page(), 'greeting', them.cookie)
    assertEquals(out.status, 200)
    assertStringIncludes(await out.text(), 'https://jeff16.yaks.app/greeting/')
    let live = await k.at('jeff16.yaks.app', '/greeting/')
    assertEquals(live.status, 200)
    assertStringIncludes(await live.text(), 'Hello')
  } finally {
    await k.stop()
  }
})

Deno.test('what the door will not take, it says in a sentence', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff17', apps: [] }])
    // A path that would land outside the app.
    let escaping = await drops(
      k,
      'jeff17.yaks.app',
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
    let over = await drops(k, 'jeff17.yaks.app', big, 'big', them.cookie)
    assertEquals(over.status, 400)
    assertStringIncludes(await over.text(), 'the most one drop may be')

    // Neither app was made: a refusal leaves the space exactly as it was.
    assertEquals((await k.at('jeff17.yaks.app', '/bad/')).status, 404)
    assertEquals((await k.at('jeff17.yaks.app', '/big/')).status, 404)

    // Nobody, and somebody who is nobody here: the first is sent to sign in,
    // the second is told whose space it is.
    let cold = await drops(
      k,
      'jeff17.yaks.app',
      await zip('mine.zip', [{ path: 'index.html', content: 'page' }]),
      'mine',
    )
    assertEquals(cold.status, 401)
    assertStringIncludes(await cold.text(), 'Sign in')
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let guest = await drops(
      k,
      'jeff17.yaks.app',
      await zip('mine.zip', [{ path: 'index.html', content: 'page' }]),
      'mine',
      ann.cookie,
    )
    assertEquals(guest.status, 403)
    assertStringIncludes(await guest.text(), 'not yours to deploy')
    assertEquals((await k.at('jeff17.yaks.app', '/mine/')).status, 404)
  } finally {
    await k.stop()
  }
})

// The app library leads to the New app page, where uploading lives alongside
// building. A stranger must not be offered a form that will only refuse them.
// The page is the dashboard's, at the apex, and its form posts to the space's
// own door, which takes it from there and from nowhere else but the space.
Deno.test("the drop zone is on the owner's New app page", async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff18', apps: ['recipes'] }])
    let path = managePath('new', 'jeff18')
    let library = await k.at('yaks.app', managePath('apps', 'jeff18'), {
      headers: { cookie: them.cookie },
    })
    assertStringIncludes(await library.text(), `href="${path}"`)
    let mine = await (await k.at('yaks.app', path, {
      headers: { cookie: them.cookie },
    })).text()
    assertStringIncludes(mine, 'action="https://jeff18.yaks.app/deploy"')
    assertStringIncludes(mine, 'type="file"')
    let file = new File(['<h1>Hi</h1>'], 'index.html', { type: 'text/html' })
    let sent = await drops(
      k,
      'jeff18.yaks.app',
      file,
      'greeting',
      them.cookie,
      'https://yaks.app',
    )
    assertEquals(sent.status, 200)
    await sent.body?.cancel()
    let forged = await drops(
      k,
      'jeff18.yaks.app',
      file,
      'greeting',
      them.cookie,
      'https://evil.yaks.app',
    )
    assertEquals(forged.status, 403)
    await forged.body?.cancel()
    let cold = await (await k.at('jeff18.yaks.app', '/')).text()
    assert(!cold.includes('/deploy'), cold)
    let shut = await k.at('yaks.app', path, { redirect: 'manual' })
    assertEquals(shut.status, 303)
    assertStringIncludes(shut.headers.get('location') ?? '', '/login?return=')
    await shut.body?.cancel()
  } finally {
    await k.stop()
  }
})
