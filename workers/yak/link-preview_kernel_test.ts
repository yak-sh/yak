import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { kernel } from './probe.ts'

let k = await kernel()

test('signed-out links keep sign-in navigation while previewing their destination', async () => {
  for (
    let [path, title] of [
      ['/manage/private-space/connections', 'Connections · yaks.app'],
      [
        '/manage/private-space/operator/15ae7fb4-dc03-48f8-b3b6-31a62133ccf9',
        'A conversation with an Operator · yaks.app',
      ],
      ['/connect', 'Connect an assistant · yaks.app'],
      ['/admin', 'Platform administration · yaks.app'],
      ['/tv/pair', 'A screen on yaks.app'],
    ]
  ) {
    let first = await k.at('yaks.app', path)
    assert([302, 303].includes(first.status), `${path}: ${first.status}`)
    let to = new URL(first.headers.get('location')!, 'https://yaks.app')
    let login = await k.at(to.host, to.pathname + to.search)
    let { document } = parseHTML(await login.text())
    assertEquals(document.title, title)
    assertEquals(
      document.querySelector('meta[property="og:title"]')?.getAttribute(
        'content',
      ),
      title,
    )
    assertEquals(
      document.querySelector('h1')?.textContent,
      'Sign in or sign up',
    )
    assert(document.querySelector('form[action="/login"]'))
    let original = document.querySelector('input[name="return"]')?.getAttribute(
      'value',
    )
    assertEquals(new URL(original!, 'https://yaks.app').pathname, path)
  }
})
