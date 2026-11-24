// A space's logo (T-140199): its owner chooses a picture in Settings, or has
// its Operator set it with space_set (T-151744), and the space wears it where
// its letter stood, served to the space's people alone.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { encodeBase64 } from '@std/encoding/base64'
import { parseHTML } from 'linkedom'
import { connector, fresh, kernel, signIn } from './probe.ts'
import { managePath } from '@yaks/platform/routes'
import { digest } from '@yaks/graph/sha256'
import { logoAt } from './logo.ts'
import type { Images } from './env.ts'
import { bodyOf, gathered, hashing } from '@yaks/blob'

let PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

test('a space wears the logo its owner chooses, and its letter without one', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let other = await signIn(k)
    let slug = them.email.split('@')[0]
    let settings = managePath('settings', slug)
    let get = (path: string, cookie = them.cookie) =>
      k.at('yaks.app', path, { redirect: 'manual', headers: { cookie } })
    let send = (body: FormData) =>
      k.at('yaks.app', settings, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: them.cookie, origin: 'https://yaks.app' },
        body,
      })
    let picture = (bytes: Uint8Array<ArrayBuffer>, name = 'logo.png') => {
      let form = new FormData()
      form.set('logo', new File([bytes], name, { type: 'image/png' }))
      return form
    }
    let tile = async () => {
      let html = await (await get(settings)).text()
      return parseHTML(html).document.querySelector(
        '.Identity .Identity_Avatar',
      )!
    }

    assertEquals((await tile()).tagName, 'SPAN')
    let page = await (await get(settings)).text()
    assertStringIncludes(page, 'enctype="multipart/form-data"')
    assert(!page.includes('name="unlogo"'))

    let sent = await send(picture(PNG))
    assertEquals(sent.status, 303)
    let at = `/manage/${slug}/logo/${await digest(PNG)}`
    assertEquals((await tile()).getAttribute('src'), at + '?size=avatar')
    assertStringIncludes(await (await get(settings)).text(), 'name="unlogo"')

    let served = await get(at)
    assertEquals(served.status, 200)
    assertEquals(served.headers.get('content-type'), 'image/png')
    assertEquals(new Uint8Array(await served.arrayBuffer()), PNG)
    assertEquals((await get(at, other.cookie)).status, 404)

    // What is not a picture, or does not open, is refused and changes nothing.
    for (let bytes of [new TextEncoder().encode('<svg/>'), PNG.slice(0, 50)]) {
      let no = await send(picture(bytes))
      assertEquals(no.status, 400)
      assertStringIncludes(await no.text(), 'logo')
      assertEquals((await tile()).getAttribute('src'), at + '?size=avatar')
    }

    let unlogo = new FormData()
    unlogo.set('unlogo', '1')
    assertEquals((await send(unlogo)).status, 303)
    assertEquals((await tile()).tagName, 'SPAN')
    assertEquals((await get(at)).status, 404)
  } finally {
    await k.stop()
  }
})

test('space_set sets the logo its Operator is given and apps keep their own icons', async () => {
  let calls: number[] = []
  let k = await fresh({ IMAGES: images(calls) })
  try {
    let them = await signIn(k)
    let slug = them.email.split('@')[0]
    let agent = connector(k, them.cookie)
    let set = (args: Record<string, unknown>) =>
      agent.tool('space_set', { space: slug, ...args })
    let tile = async () => {
      let html = await (await k.at('yaks.app', managePath('settings', slug), {
        headers: { cookie: them.cookie },
      })).text()
      return parseHTML(html).document.querySelector(
        '.Identity .Identity_Avatar',
      )!
    }
    await agent.tool('app_new', { space: slug, slug: 'notes', title: 'Notes' })
    await agent.tool('app_deploy', { space: slug, app: 'notes' })
    let icon = async () =>
      new Uint8Array(
        await (await k.at(`${slug}.yaks.app`, '/notes/icon.png', {
          headers: { cookie: them.cookie },
        })).arrayBuffer(),
      )
    let yak = await icon()

    assertStringIncludes(await set({ logo_base64: encodeBase64(PNG) }), 'logo')
    let at = `/manage/${slug}/logo/${await digest(PNG)}`
    assertEquals((await tile()).getAttribute('src'), at + '?size=avatar')
    assertEquals(await icon(), yak)
    assertEquals(calls, [128, 512])

    let no = await assertRejects(
      () => set({ logo_base64: encodeBase64('<svg/>') }),
      Error,
    )
    assertStringIncludes(no.message, 'a logo is a PNG, JPEG, WebP or GIF')
    await assertRejects(() => set({ logo: 'f'.repeat(64) }), Error, 'keeps no')
    assertEquals((await tile()).getAttribute('src'), at + '?size=avatar')

    assertStringIncludes(await set({ logo: 'none' }), 'logo is off')
    assertEquals((await tile()).tagName, 'SPAN')
    assertEquals(await icon(), yak)
  } finally {
    await k.stop()
  }
})

test('logoAt reads a picture from an https address, and says why not', async () => {
  let at = (status: number, body: BodyInit | null) => () =>
    Promise.resolve(new Response(body, { status }))
  let source = await logoAt('https://cdn.test/i.png', at(200, PNG))
  assert(typeof source != 'string')
  assertEquals(await gathered(source), PNG)
  let large = new Uint8Array(10_000_000)
  let fetched = await logoAt('https://cdn.test/big', at(200, large))
  assert(typeof fetched != 'string')
  assertEquals((await gathered(fetched)).length, large.length)
  assertEquals(
    await logoAt('https://cdn.test/gone', at(404, null)),
    'cdn.test answered 404 for that picture',
  )
  assertEquals(
    await logoAt('http://cdn.test/i.png', at(200, PNG)),
    'a logo is read from an https address',
  )
})

let images = (calls: number[]): Images => ({
  input: (body) => ({
    transform({ width }) {
      calls.push(width)
      return this
    },
    async output({ format }) {
      // Consume the same streaming input Cloudflare receives.
      for await (let _ of body) continue
      return {
        response: () =>
          new Response(PNG, { headers: { 'content-type': format } }),
      }
    },
  }),
})

test('Settings streams a 10 MB logo and pages use its precomputed display sizes', async () => {
  let calls: number[] = []
  let k = await fresh({ IMAGES: images(calls) })
  try {
    let them = await signIn(k)
    let slug = them.email.split('@')[0]
    let settings = managePath('settings', slug)
    let body = new FormData()
    let full = new Blob([PNG, new Uint8Array(10_000_000)], {
      type: 'image/png',
    })
    body.set('logo', full, 'logo.png')
    let headers = { cookie: them.cookie, origin: 'https://yaks.app' }
    let get = (path: string) => k.at('yaks.app', path, { headers })
    let sent = await k.at('yaks.app', settings, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body,
    })
    assertEquals(sent.status, 303)
    assertEquals(calls, [128, 512])

    let page = parseHTML(await (await get(settings)).text()).document
    let avatar = page.querySelector('img.Identity_Avatar')!.getAttribute('src')!
    assertEquals(
      page.querySelector('link[rel=icon]')?.getAttribute('href'),
      avatar,
    )
    let original = await get(avatar.split('?')[0])
    assertEquals(original.status, 200)
    assertEquals(Number(original.headers.get('content-length')), full.size)
    let { through, seen } = hashing()
    for await (let _ of original.body!.pipeThrough(through)) continue
    assertEquals(
      (await seen).sha,
      await digest(new Uint8Array(await full.arrayBuffer())),
    )

    let thumb = await get(avatar)
    assertEquals(thumb.headers.get('content-type'), 'image/webp')
    assertEquals((await gathered(bodyOf(thumb))).length, PNG.length)
    let manifest = await get(`/manage/${slug}/manifest.webmanifest`)
    let icon = (await manifest.json()).icons[0]
    assertEquals(icon.sizes, '512x512')
    assertEquals((await get(icon.src)).headers.get('content-type'), 'image/png')
    assertEquals(calls, [128, 512])
  } finally {
    await k.stop()
  }
})
