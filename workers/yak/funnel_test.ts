// yaks.app's own funnel (funnel.ts): what a step writes, and what the counts
// read back as.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { clicked, CTAS, funnel, step, type Who } from './funnel.ts'
import { FUNNEL, isHome, type Visited } from './view-point.ts'
import { analytics, dataset } from './testing.ts'
import { page } from './site/mod.ts'
import type { Env } from './env.ts'
import { kernel, mailed, unique } from './probe.ts'

let BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit Safari'
let visit = (ua = BROWSER, path = '/', cf?: Visited['cf']) =>
  Object.assign(
    new Request(`https://yaks.app${path}`, {
      headers: {
        'user-agent': ua,
        referer: 'https://news.example.com/item?q=1',
      },
    }),
    { cf },
  )

test("a step is written under the platform, saying what a view says and its campaign, and a crawler's or a script's is not", () => {
  let views = dataset()
  step({ VIEWS: views }, 'code_sent', visit())
  step({ VIEWS: views }, 'signup', visit('yaks-e2e-bot'))
  step({ VIEWS: views }, 'started', visit('ClaudeBot/1.0'))
  step({ VIEWS: views }, 'returned')
  step({ VIEWS: views }, 'first_app', undefined, { who: 'e2e@bot.yak.sh' })
  step(
    { VIEWS: views },
    'home',
    visit(BROWSER, '/?utm_source=meta&utm_campaign=pilot'),
  )
  assertEquals(views.points, [
    {
      indexes: [FUNNEL],
      blobs: [
        '',
        'code_sent',
        '/',
        '',
        'news.example.com',
        'browser',
        '',
        '',
        '',
      ],
      doubles: [0],
    },
    {
      indexes: [FUNNEL],
      blobs: ['', 'returned', '', '', '', '', '', '', ''],
      doubles: [0],
    },
    // A test account's step is written to be counted apart.
    {
      indexes: [FUNNEL],
      blobs: ['', 'first_app', '', '', '', 'test', '', '', ''],
      doubles: [0],
    },
    {
      indexes: [FUNNEL],
      blobs: [
        '',
        'home',
        '/',
        '',
        'news.example.com',
        'browser',
        'meta//pilot',
        '',
        '',
      ],
      doubles: [0],
    },
  ])
})

test("a step for a test account, or for a space only test accounts own, is a test's", () => {
  let views = dataset()
  let client = (who: Who) => {
    step({ VIEWS: views }, 'paid', undefined, { who })
    return views.points.at(-1)!.blobs![5]
  }
  let cases: [Who, string][] = [
    ['snappy-survey@bot.yak.sh', 'test'],
    ['nobody@example.invalid', 'test'],
    [['a@bot.yak.sh', 'b@bot.yak.sh'], 'test'],
    // The platform's own admin and the demo's holder are not throwaways.
    ['admin@bot.yak.sh', ''],
    ['ada@example.com', ''],
    [['a@bot.yak.sh', 'ada@example.com'], ''],
    [['a@bot.yak.sh', null], ''],
    [null, ''],
    [[], ''],
  ]
  assertEquals(cases.map(([who]) => client(who)), cases.map(([, c]) => c))
})

test('the home page is visited by a browser asking for /, not a crawler', () => {
  let ok = new Response('<html>', { status: 200 })
  assertEquals(isHome(visit(), '/', ok), true)
  assertEquals(isHome(visit(), '/', new Response(null, { status: 304 })), true)
  assertEquals(isHome(visit('Googlebot/2.1'), '/', ok), false)
  assertEquals(isHome(visit(BROWSER, '/', { asn: 32934 }), '/', ok), false)
  assertEquals(isHome(visit(BROWSER, '/gallery'), '/gallery', ok), false)
})

test('the funnel reads each step, a share of the one it follows, and where visitors came from', async () => {
  let sql = analytics((q) =>
    q.includes("blob2 = 'home'")
      ? [{ site: 'news.example.com', n: 3 }]
      : q.includes('blob7')
      ? [
        { key: 'meta//pilot', step: 'home', n: 9 },
        { key: 'meta//pilot', step: 'click', n: 4 },
        { key: 'meta//pilot', step: 'signup', n: '2' },
        { key: 'meta//pilot', step: 'checkout', n: 1 },
      ]
      : q.includes('blob9')
      ? [
        { key: 'ask', step: 'home', n: 20 },
        { key: 'operator', step: 'home', n: 18 },
        { key: 'operator', step: 'click', n: 5 },
        { key: 'operator', step: 'signup', n: 3 },
      ]
      : q.includes('blob8')
      ? [{ button: 'start', n: 6 }, { button: 'gone', n: 1 }]
      : q.includes('NOT blob6')
      ? [{ client: 'test', step: 'signup', n: '2' }, {
        client: 'bot',
        step: 'home',
        n: 5,
      }]
      : [
        { step: 'home', n: 40 },
        { step: 'click', n: 10 },
        { step: 'code_sent', n: '10' },
        { step: 'signup', n: 8 },
        { step: 'checkout', n: 4 },
        { step: 'paid', n: 1 },
      ]
  )
  try {
    let env = { CF_ANALYTICS_TOKEN: 't', CF_ACCOUNT: 'a' } as Env
    let since = new Date(Math.floor(Date.now() / 1000 - 2 * 86_400) * 1000)
    let f = (await funnel(env, since))!
    assertEquals(f.since, since.toISOString())
    let of = Object.fromEntries(f.steps.map((s) => [s.name, s]))
    assertEquals(of.home.n, 40)
    assertEquals(of.click.share, 0.25)
    assertEquals(of.code_sent.share, 0.25)
    assertEquals(of.signed_in.share, 0)
    // A share of a step nobody took is no share at all.
    assertEquals(of.signup, { name: 'signup', say: 'First sign-ins', n: 8 })
    // A checkout is a share of the sign-ups, and a plan bought of the
    // checkouts.
    assertEquals(of.checkout.share, 0.5)
    assertEquals(of.paid.share, 0.25)
    assertEquals(f.from, [{ site: 'news.example.com', n: 3 }])
    // A button the page no longer has is no call to action.
    assertEquals(f.buttons, [
      { button: 'start', say: CTAS[0].say, n: 6 },
    ])
    assertEquals(f.campaigns, [
      { name: 'meta//pilot', home: 9, click: 4, signup: 2, checkout: 1 },
    ])
    assertEquals(f.variants, [
      { name: 'ask', home: 20, click: 0, signup: 0, checkout: 0 },
      { name: 'operator', home: 18, click: 5, signup: 3, checkout: 0 },
    ])
    // Crawlers, agents and test accounts are counted apart, in no count
    // above: every other query reads a person's steps alone.
    assertEquals(f.apart, [
      { client: 'test', step: 'signup', n: 2 },
      { client: 'bot', step: 'home', n: 5 },
    ])
    assertEquals(
      sql.asked.filter((q) => q.includes("NOT blob6 IN ('browser', '')"))
        .length,
      1,
    )
    assertEquals(
      sql.asked.every((q) =>
        q.includes(`index1 = '${FUNNEL}'`) &&
        q.includes(`toDateTime(${since.getTime() / 1000})`)
      ),
      true,
    )
  } finally {
    sql.done()
  }
  assertEquals(await funnel({} as Env), null)
})

// A beacon from the home page, as public/cta.js sends it.
let beacon = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://yaks.app/api/click', {
    method: 'POST',
    body,
    headers: {
      'user-agent': BROWSER,
      'sec-fetch-site': 'same-origin',
      cookie: 'yak_came=utm_source=meta&utm_campaign=pilot&at=5',
      ...headers,
    },
  })

test('a click on a call to action is counted by its button and campaign', async () => {
  let views = dataset()
  let env = { VIEWS: views } as never
  let said = await clicked(beacon('start'), env)
  assertEquals(said.status, 204)
  assertEquals(views.points.map((p) => p.blobs), [
    ['', 'click', '/api/click', '', '', 'browser', 'meta//pilot', 'start', ''],
  ])
  // No such button, another site's page, a crawler: answered alike, counted
  // as nothing.
  for (
    let req of [
      beacon('nope'),
      beacon('start', { 'sec-fetch-site': 'cross-site' }),
      beacon('start', { 'user-agent': 'Googlebot/2.1' }),
    ]
  ) assertEquals((await clicked(req, env)).status, 204)
  assertEquals(views.points.length, 1)
  assertEquals((await clicked(new Request(beacon('x').url), env)).status, 405)
})

test("each of the home page's calls to action sends its name when clicked", async () => {
  let { document } = parseHTML(page('index.html'))
  let named = [...document.querySelectorAll('[data-cta]')]
  assertEquals(
    named.map((b) => b.getAttribute('data-cta')),
    CTAS.map((c) => c.name),
  )
  assertEquals(
    !!document.querySelector('script[src="cta.js"]'),
    true,
  )
  let code = await Deno.readTextFile(
    new URL('./public/cta.js', import.meta.url),
  )
  // What each click sends, by a browser whose beacon `queues` (true), refuses
  // to queue (false) or is missing, as an in-app browser's may be.
  let clicks = (queues?: boolean) => {
    let on: (e: unknown) => void = () => {}
    let sent: string[][] = []
    new Function('addEventListener', 'navigator', 'fetch', code)(
      (_: string, fn: (e: unknown) => void) => on = fn,
      queues == undefined ? {} : {
        sendBeacon: (to: string, name: string) => (
          sent.push(['beacon', to, name]), queues
        ),
      },
      (to: string, { body, keepalive }: RequestInit) => {
        sent.push([keepalive ? 'keepalive' : 'fetch', to, String(body)])
        return Promise.resolve()
      },
    )
    for (let b of named) on({ target: b.querySelector('*') ?? b })
    on({ target: document.querySelector('h1') })
    return sent
  }
  let each = (...how: string[]) =>
    CTAS.flatMap((c) => how.map((h) => [h, '/api/click', c.name]))
  assertEquals(clicks(true), each('beacon'))
  assertEquals(clicks(false), each('beacon', 'keepalive'))
  assertEquals(clicks(), each('keepalive'))
})

test("signing in through the doors in a browser counts a person's steps, and a test account's apart", async () => {
  let k = await kernel()
  let signs = async (address: string) => {
    let form = (path: string, fields: Record<string, string>) =>
      k.at(k.host, path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': BROWSER,
        },
        body: new URLSearchParams(fields).toString(),
      })
    let before = k.views.points.length
    await (await form('/login', { address })).body?.cancel()
    let inn = await form('/login/code', {
      address,
      code: await mailed(k, address),
    })
    assertEquals(inn.status, 303)
    await inn.body?.cancel()
    return k.views.points.slice(before)
      .filter((p) => p.indexes?.[0] == FUNNEL)
      .map((p) => `${p.blobs?.[1]} ${p.blobs?.[5]}`)
  }
  assertEquals(await signs(`${unique('snappy-survey')}@bot.yak.sh`), [
    'code_sent test',
    'signed_in test',
    'signup test',
  ])
  assertEquals(await signs(`${unique('ada')}@example.com`), [
    'code_sent browser',
    'signed_in browser',
    'signup browser',
  ])
})
