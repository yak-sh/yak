// The pure seams of the platform client: where a store answers, what a
// session says about itself, which letter carries the code, and how a tool's
// reply reads once the envelope is off.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import type { Row } from './client.ts'
import {
  addressIn,
  argOf,
  argsOf,
  claimsOf,
  codeIn,
  cookieOf,
  feeNow,
  listedOn,
  plain,
  renewing,
  saidBy,
  saidOn,
  storeUrl,
} from './yaks_api.ts'
import { timing, watching } from './timing.ts'

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

Deno.test('the address a session signed in as is read off what about says', async () => {
  let said = 'yaks.app is a place to make small web apps.\n\n' +
    'You are signed in as Jeff <jeff@yak.sh>, through a connector you signed ' +
    'in to, until 2026-10-01T00:00:00.000Z.'
  assertEquals(addressIn(said), 'jeff@yak.sh')
  // Signed out, `about` says the same paragraph and no sentence about anyone.
  assertEquals(addressIn('yaks.app is a place to make small web apps.'), '')
  // A person known by their address alone still has one to read.
  assertEquals(
    addressIn(
      'You are signed in as <a.b+c@x.co>, in a signed-in ' +
        'browser.',
    ),
    'a.b+c@x.co',
  )
  // And the sentence itself is the platform's, so a drift there is caught
  // here rather than in a `whoami` that quietly stops recording (T-35376).
  let tools = await Deno.readTextFile(
    new URL('../workers/yak/tools.ts', import.meta.url),
  )
  assertStringIncludes(tools, 'You are signed in as ${')
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

// The sliding session, this end (T-35380): the platform re-mints a cookie past
// half its life, so any answer may carry a new value for the same account and
// the box must write it down — src/yak.ts puts the account file behind
// `renewing`. The fetch is stubbed, and the answer is as little of one as the
// client reads: what it says, and the header a renewal would arrive in. A web
// `Response` would cost this process its whole fetch warm-up for a test that
// never leaves it.
let fee = (set?: string) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name: string) => (name == 'set-cookie' ? set ?? null : null),
  },
  text: () => Promise.resolve('{"bps":250,"rate":"2.5%"}'),
})

let answering = (res: ReturnType<typeof fee>) => {
  let real = globalThis.fetch
  let sent: Record<string, string>[] = []
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent.push(init.headers as Record<string, string>)
    return Promise.resolve(res)
  }) as unknown as typeof fetch
  return { sent, done: () => void (globalThis.fetch = real) }
}

Deno.test('a renewed cookie is handed on, and an ordinary answer is quiet', async () => {
  let fresh: string[] = []
  renewing((v) => fresh.push(v))
  let renewed = answering(
    fee('yak_session=slid.token; Domain=yaks.app; Path=/; Max-Age=7776000'),
  )
  try {
    await feeNow('old.token')
    assertEquals(renewed.sent[0].cookie, 'yak_session=old.token')
    assertEquals(fresh, ['slid.token'])
  } finally {
    renewed.done()
  }
  // Nothing set, and the very cookie that was sent echoed back: neither is a
  // renewal, and neither touches the account.
  for (let set of [undefined, 'yak_session=old.token; Path=/']) {
    let quiet = answering(fee(set))
    try {
      await feeNow('old.token')
      assertEquals(fresh, ['slid.token'])
    } finally {
      quiet.done()
    }
  }
  renewing(() => {})
})

// `yak --timing`, this end: the account's calls do not go through the
// connector door, so `sent` says the same line for them (timing.ts). The stub
// answers the header a platform answer would carry.
Deno.test('--timing says one line per account call, and none without', async () => {
  let said: string[] = []
  let say = timing.say
  timing.say = (line) => said.push(line)
  let stub = answering({
    ...fee(),
    headers: {
      get: (name: string) =>
        name == 'server-timing' ? 'hops;dur=2, all;dur=31' : null,
    },
  })
  try {
    watching(true)
    await feeNow('a.token')
    watching(false)
    await feeNow('a.token')
  } finally {
    timing.say = say
    stub.done()
  }
  assertEquals(said, ['GET /api/fee 200  hops;dur=2, all;dur=31'])
})
