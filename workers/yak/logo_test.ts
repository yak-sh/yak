// A space's logo (T-140199): its owner chooses a picture in Settings, and the
// space wears it where its letter stood, served to the space's people alone.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { kernel, signIn } from './probe.ts'
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
