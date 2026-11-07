import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { claimed, serves, stamped } from './site-data.ts'

let page = (type = 'text/html; charset=utf-8', status = 200) =>
  new Response(null, { status, headers: { 'content-type': type } })
let ask = (cookie?: string) =>
  new Request('https://ada.yaks.app/cookbook/', {
    headers: cookie ? { cookie } : {},
  })
let said = (res: Response) => [
  res.headers.get('clear-site-data'),
  res.headers.getSetCookie().find((c) => c.startsWith('yak_space='))
    ?.split(';')[0] ?? null,
]

test('a page clears the storage another space left, once', () => {
  let cases: [string | undefined, Response, (string | null)[]][] = [
    [undefined, page(), [null, 'yak_space=ada.5e1f00']],
    ['yak_space=ada.5e1f00', page(), [null, null]],
    ['a=1; yak_space=rex.0d0d0d', page(), [
      '"storage"',
      'yak_space=ada.5e1f00',
    ]],
    ['yak_space=rex.0d0d0d', page('text/html', 304), [
      '"storage"',
      'yak_space=ada.5e1f00',
    ]],
    ['yak_space=rex.0d0d0d', page('text/javascript'), [null, null]],
    ['yak_space=rex.0d0d0d', page('text/html', 301), [null, null]],
  ]
  for (let [cookie, res, want] of cases) {
    assertEquals(said(claimed(ask(cookie), res, 'ada.5e1f00')), want, cookie)
  }
})

test('only an answer of a space is told whose its storage is', () => {
  let req = ask('yak_space=rex.0d0d0d')
  assertEquals(said(stamped(req, page())), [null, null])
  serves(req, 'ada.5e1f00')
  assertEquals(said(stamped(req, page())), [
    '"storage"',
    'yak_space=ada.5e1f00',
  ])
})
