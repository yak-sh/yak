// An app's `_redirects` (redirects.ts): how a rule reads, and which one answers.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse, sentOn } from './redirects.ts'

let go = (rules: string, path: string, search = '') =>
  sentOn(parse(rules), path, search)

let cases: [string, string, string, string, ReturnType<typeof go>][] = [
  ['a path, whatever its trailing slash', '/a /b 301', '/a/', '', {
    to: '/b',
    status: 301,
  }],
  ['302 unless it says', '/a /b', '/a', '', { to: '/b', status: 302 }],
  ['the first rule wins', '/a /1\n/a /2', '/a', '', { to: '/1', status: 302 }],
  ['a splat carries the rest', '/s/* /t/:splat', '/s/x/y', '', {
    to: '/t/x/y',
    status: 302,
  }],
  ['a placeholder is one segment', '/b/:y/:slug /p/:slug', '/b/2020/hi', '', {
    to: '/p/hi',
    status: 302,
  }],
  ['a placeholder is not two', '/b/:y /p', '/b/1/2', '', null],
  ['the query goes on with a rule that names none', '/a /b', '/a', '?q=1', {
    to: '/b?q=1',
    status: 302,
  }],
  ['a query in a source is no rule', '/?id=7 /seven', '/', '?id=7', null],
  ['an address elsewhere stays', '/a https://x.example/y:z', '/a', '', {
    to: 'https://x.example/y:z',
    status: 302,
  }],
  [
    'comments, blanks and half a rule are skipped',
    '# c\n\n/lone\n/a /b 399\n/a /b # c',
    '/a',
    '',
    {
      to: '/b',
      status: 302,
    },
  ],
]
for (let [name, rules, path, search, want] of cases) {
  test(`redirects: ${name}`, () => assertEquals(go(rules, path, search), want))
}
