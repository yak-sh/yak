// A space's logo (T-140199): its owner chooses a picture in Settings, or has
// its Operator set it with space_set (T-151744), and the space wears it where
// its letter stood, served to the space's people alone, and as the icon of
// each of its apps with none of its own.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { encodeBase64 } from '@std/encoding/base64'
import { parseHTML } from 'linkedom'
import { connector, kernel, signIn } from './probe.ts'
import { managePath } from './route.ts'
import { sha256 } from './versions.ts'

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
      return parseHTML(html).document.querySelector('.Desk_Space .Desk_Tile')!
    }

    assertEquals((await tile()).tagName, 'SPAN')
    let page = await (await get(settings)).text()
    assertStringIncludes(page, 'enctype="multipart/form-data"')
    assert(!page.includes('name="unlogo"'))

    let sent = await send(picture(PNG))
    assertEquals(sent.status, 303)
    let at = `/manage/${slug}/logo/${await sha256(PNG)}`
    assertEquals((await tile()).getAttribute('src'), at)
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
      assertEquals((await tile()).getAttribute('src'), at)
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

test('space_set sets the logo its Operator is given, and an app with no icon wears it', async () => {
  let k = await kernel()
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
      return parseHTML(html).document.querySelector('.Desk_Space .Desk_Tile')!
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
    let at = `/manage/${slug}/logo/${await sha256(PNG)}`
    assertEquals((await tile()).getAttribute('src'), at)
    // No RASTER in a test run, so the logo as it is rather than its drawing.
    assertEquals(await icon(), PNG)

    let no = await assertRejects(
      () => set({ logo_base64: encodeBase64('<svg/>') }),
      Error,
    )
    assertStringIncludes(no.message, 'a logo is a PNG, JPEG, WebP or GIF')
    await assertRejects(() => set({ logo: 'f'.repeat(64) }), Error, 'keeps no')
    assertEquals((await tile()).getAttribute('src'), at)

    assertStringIncludes(await set({ logo: 'none' }), 'logo is off')
    assertEquals((await tile()).tagName, 'SPAN')
    assertEquals(await icon(), yak)
  } finally {
    await k.stop()
  }
})
