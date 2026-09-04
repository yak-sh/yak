// The pure seams of the platform client: where a store answers, what a
// session says about itself, which letter carries the code, and how a tool's
// reply reads once the envelope is off.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import type { Row } from './client.ts'
import {
  argOf,
  argsOf,
  claimsOf,
  codeIn,
  cookieOf,
  listedOn,
  plain,
  saidBy,
  saidOn,
  storeUrl,
} from './yaks_api.ts'

let row = (title: string, to: string, at: string): Row => ({
  eid: crypto.randomUUID(),
  num: 1,
  kind: 'mail',
  comps: { doc: { title }, mail: { to_addr: to, received_at: at } },
})

Deno.test('an app store answers under its space, the front page at the root', () => {
  assertEquals(
    storeUrl('jeff/recipes', '/query', 'yaks.app'),
    'https://jeff.yaks.app/recipes/api/query',
  )
  assertEquals(
    storeUrl('jeff', '/apply', 'yaks.app'),
    'https://jeff.yaks.app/api/apply',
  )
  assertThrows(() => storeUrl('', '/query', 'yaks.app'))
})

Deno.test('a session says whose it is without the secret', () => {
  let body = btoa(JSON.stringify({ person: 'p-1', space: null, exp: 42 }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  assertEquals(claimsOf(`${body}.mac`), { person: 'p-1', space: null, exp: 42 })
  assertEquals(claimsOf('not-a-token'), null)
  assertEquals(claimsOf(''), null)
})

Deno.test('the session is read off the card’s own set-cookie', () => {
  assertEquals(
    cookieOf('yak_session=tok.en; Domain=yaks.app; Path=/; HttpOnly'),
    'tok.en',
  )
  assertEquals(cookieOf('other=1; Path=/'), null)
  assertEquals(cookieOf(null), null)
})

Deno.test('the code is the newest letter to THIS address since the ask', () => {
  let rows = [
    row(
      '111111 is your yaks.app code',
      'probe@bot.yak.sh',
      '2026-09-04T12:00:00Z',
    ),
    row(
      '222222 is your yaks.app code',
      'probe@bot.yak.sh',
      '2026-09-04T12:05:00Z',
    ),
    row(
      '333333 is your yaks.app code',
      'other@bot.yak.sh',
      '2026-09-04T12:06:00Z',
    ),
    row('a letter about nothing', 'probe@bot.yak.sh', '2026-09-04T12:07:00Z'),
  ]
  let since = Date.parse('2026-09-04T11:59:00Z')
  assertEquals(codeIn(rows, 'probe@bot.yak.sh', since), '222222')
  // A code that predates the ask is a stale one: it would fail its own mac.
  assertEquals(
    codeIn(rows, 'probe@bot.yak.sh', Date.parse('2026-09-04T12:06:00Z')),
    null,
  )
  assertEquals(codeIn(rows, 'nobody@bot.yak.sh', since), null)
  assertEquals(codeIn([], 'probe@bot.yak.sh', since), null)
})

Deno.test('a tool answers its words, and an erring one throws them', () => {
  assertEquals(
    saidBy({ content: [{ type: 'text', text: 'made notes' }] }),
    'made notes',
  )
  assertEquals(saidBy({}), '')
  let no = assertThrows(() =>
    saidBy({
      content: [{ type: 'text', text: 'no space notes' }],
      isError: true,
    })
  )
  assertStringIncludes((no as Error).message, 'no space notes')
})

Deno.test('a tool argument keeps its type when it has one', () => {
  assertEquals(argOf('slug=notes'), ['slug', 'notes'])
  assertEquals(argOf('count=3'), ['count', 3])
  assertEquals(argOf('open=true'), ['open', true])
  assertEquals(argOf('files=[{"path":"a"}]'), ['files', [{ path: 'a' }]])
  // An `=` inside the value belongs to the value.
  assertEquals(argOf('q=a=b'), ['q', 'a=b'])
  assertThrows(() => argOf('bare'))
  assertEquals(argsOf(['a=1', 'b=x']), { a: 1, b: 'x' })
})

Deno.test('a kernel page is read back as the words it says', () => {
  // The shape workers/yak/pages.ts `shell` renders, with everything it
  // interpolated escaped on the way out (T-33166).
  let page =
    '<body><main><h1>That&#39;s done.</h1><p>shoplab.yaks.app is gone: 1 ' +
    'app, 2 files, everything they saved.</p>' +
    '<ol><li>The Shop (https://shoplab.yaks.app/shop/)</li>' +
    '<li>dana &amp; sam lose their way in</li></ol></main></body>'
  assertStringIncludes(plain(saidOn(page).title), "That's done.")
  assertStringIncludes(plain(saidOn(page).lead), 'shoplab.yaks.app is gone')
  assertEquals(listedOn(page).map(plain), [
    'The Shop (https://shoplab.yaks.app/shop/)',
    'dana & sam lose their way in',
  ])
  assertEquals(saidOn('not a page'), { title: '', lead: '' })
})
