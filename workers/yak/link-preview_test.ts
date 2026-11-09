import { test } from '@yaks/testing'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { parseHTML } from 'linkedom'
import { destination, tags } from './link-preview.ts'
import { askEmail } from './signin-pages.ts'
import { shell, spaceIndex } from './pages.ts'

let read = (html: string) => {
  let { document } = parseHTML(html)
  let meta = (key: string) =>
    document.querySelector(
      `meta[${key.startsWith('og:') ? 'property' : 'name'}="${key}"]`,
    )?.getAttribute('content')
  return { document, meta }
}

test('a sign-in card describes the destination without reading private information', async () => {
  for (
    let [path, kind] of [
      [
        '/manage/secret-space/operator/15ae7fb4-dc03-48f8-b3b6-31a62133ccf9',
        'A conversation with an Operator',
      ],
      ['/manage/secret-space', 'A conversation with an Operator'],
      ['/manage/secret-space/connections', 'Connections'],
      ['/manage/account/profile', 'Your profile'],
      ['/manage/connections?space=secret-space', 'Connections'],
      ['https://secret-space.yaks.app/secret-app/', 'An app on yaks.app'],
    ]
  ) {
    let html = await askEmail({ back: path }).text()
    let { document, meta } = read(html)
    assertEquals(
      document.title,
      kind == 'An app on yaks.app' ? kind : `${kind} · yaks.app`,
    )
    assertEquals(meta('og:title'), document.title)
    for (
      let key of [
        'og:title',
        'og:description',
        'og:image',
        'og:site_name',
        'twitter:card',
      ]
    ) {
      assert(meta(key), key)
      assertFalse(meta(key)!.includes('secret'), key)
      assertFalse(meta(key)!.includes('15ae7fb4'), key)
    }
    assert(document.querySelector('form[action="/login"]'))
    assertEquals(
      document.querySelector('input[name="return"]')?.getAttribute('value'),
      path,
    )
    assertEquals(
      document.querySelector('h1')?.textContent,
      'Sign in or sign up',
    )
  }
})

test('a destination outside the platform cannot supply a preview', () => {
  for (
    let back of [
      'https://elsewhere.example/manage/private/connections',
      '//elsewhere.example',
      '/\\elsewhere.example',
      'javascript:alert(1)',
    ]
  ) {
    assertEquals(destination(back), undefined)
  }
  assertEquals(
    destination('https://private.yaks.fyi/app/', { APEX: 'yaks.fyi' })?.title,
    'An app on yaks.app',
  )
})

test('preview text is escaped once and the image follows the configured platform', () => {
  let { document, meta } = read(`<head>${
    tags({ APEX: 'yaks.fyi' }, {
      title: 'Recipes & "friends" <script>',
      description: 'A <b>recipe</b> & a meal.',
    })
  }</head>`)
  assertEquals(meta('og:title'), 'Recipes & "friends" <script>')
  assertEquals(meta('og:description'), 'A <b>recipe</b> & a meal.')
  assertEquals(meta('og:image'), 'https://yaks.fyi/og.png')
  assertEquals(document.querySelectorAll('script').length, 0)
})

test('a public space page previews the title and description it shows visitors', async () => {
  let { document, meta } = read(
    await spaceIndex({
      space: 'public-space',
      title: 'Recipes & meals',
      apps: [],
      hidden: 0,
      person: false,
      role: null,
      signIn: '/login',
    }).text(),
  )
  assertEquals(meta('og:title'), document.title)
  assertEquals(meta('og:title'), 'Recipes & meals · yaks.app')
  assertEquals(
    meta('og:description'),
    document.querySelector('main > p')?.textContent,
  )
})

test('legacy page shells serialize an already escaped title once', async () => {
  let { document, meta } = read(
    await shell({}, 'Fish &amp; chips', null, 200).text(),
  )
  assertEquals(meta('og:title'), document.title)
  assertEquals(meta('og:title'), 'Fish & chips · yaks.app')
})
