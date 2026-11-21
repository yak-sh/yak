// yaks.app's own funnel (funnel.ts): what a step writes, and what the counts
// read back as.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import {
  clicked,
  CTAS,
  funnel,
  LOADED,
  loaded,
  shaped,
  STAGES,
  step,
  type Who,
} from './funnel.ts'
import { stopped } from '@yaks/platform/funnel'
import { FUNNEL, isHome, type Visited } from './view-point.ts'
import { VARIANTS } from './variant.ts'
import { analytics, dataset } from './testing.ts'
import { page } from './site/mod.ts'
import type { Env } from './env.ts'
import { connector, kernel, mailed, signIn, unique } from './probe.ts'
import { ADMIN, DEMO } from '@yaks/platform/bots'

let BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
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

test("a step is written under the platform, saying what a view says, its campaign and the home page it is on, and a crawler's or a script's is not", () => {
  let views = dataset()
  step({ VIEWS: views }, 'code_sent', visit())
  step({ VIEWS: views }, 'signup', visit('yaks-e2e-bot'))
  step({ VIEWS: views }, 'started', visit('ClaudeBot/1.0'))
  step({ VIEWS: views }, 'returned')
  step({ VIEWS: views }, 'first_app', undefined, { who: 'e2e@bot.yak.sh' })
  step({ VIEWS: views }, 'first_deploy', undefined, { campaign: 'meta//pilot' })
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
        'ask',
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
    // One taken away from a request counts under its taker's campaign.
    {
      indexes: [FUNNEL],
      blobs: ['', 'first_deploy', '', '', '', '', 'meta//pilot', '', ''],
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
        'ask',
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
    // The platform's own admin and the demo's holder are no person either.
    ['admin@bot.yak.sh', 'test'],
    ['yourname@bot.yak.sh', 'test'],
    ['ada@example.com', ''],
    [['a@bot.yak.sh', 'ada@example.com'], ''],
    [['a@bot.yak.sh', null], ''],
    [null, ''],
    [[], ''],
  ]
  assertEquals(cases.map(([who]) => client(who)), cases.map(([, c]) => c))
})

test('a home page is visited by a browser asking for it, not a crawler', () => {
  let ok = new Response('<html>', { status: 200 })
  assertEquals(isHome(visit(), '/', ok), true)
  assertEquals(isHome(visit(), '/', new Response(null, { status: 304 })), true)
  assertEquals(isHome(visit('Googlebot/2.1'), '/', ok), false)
  assertEquals(isHome(visit(BROWSER, '/', { asn: 32934 }), '/', ok), false)
  assertEquals(isHome(visit(BROWSER, '/gallery'), '/gallery', ok), false)
  // A home page's own address is a visit to it too (variant.ts).
  assertEquals(isHome(visit(BROWSER, '/churches'), '/churches', ok), true)
})

test('the funnel reads each step, a share of the one it follows, and where visitors came from', async () => {
  let sql = analytics((q) =>
    q.includes('AS site')
      ? [{ site: 'news.example.com', n: 3 }]
      : q.includes('blob7 AS key')
      ? [
        { key: 'meta//pilot', step: 'home', n: 9 },
        { key: 'meta//pilot', step: 'click', n: 4 },
        { key: 'meta//pilot', step: 'signup', n: '2' },
        { key: 'meta//pilot', step: 'checkout', n: 1 },
      ]
      : q.includes('blob9')
      ? [
        { key: 'ask', step: 'home', n: 20 },
        { key: 'ask', step: 'home_loaded', n: 7 },
        { key: 'operator', step: 'home', n: 18 },
        { key: 'operator', step: 'click', n: 5 },
        { key: 'operator', step: 'signup', n: 3 },
        { key: 'operator', step: 'started', n: 2 },
      ]
      : q.includes('blob8')
      ? [{ button: 'start', n: 6 }, { button: 'gone', n: 1 }]
      : q.includes('NOT if(')
      ? [{ client: 'test', step: 'signup', n: '2' }, {
        client: 'bot',
        step: 'home',
        n: 5,
      }]
      : [
        { step: 'home', n: 40 },
        { step: 'home_loaded', n: 4 },
        { step: 'click', n: 10 },
        { step: 'connector_start', n: 6 },
        { step: 'started', n: 4 },
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
    // A stage counts its step, and is a share of the stage it follows: a
    // connector's sign-in and a build begun are two doors, each its own count.
    assertEquals(
      f.stages!.map((s) => [s.name, s.n, s.share]),
      [
        ['visit', 40, undefined],
        ['built', 4, 0.1],
        ['connected', 6, undefined],
        ['signup', 8, undefined],
        ['first_app', 0, 0],
        ['back', 0, undefined],
      ],
    )
    assertEquals(stopped(f.stages)?.after.name, 'signup')
    let of = Object.fromEntries(f.steps.map((s) => [s.name, s]))
    assertEquals(of.home.n, 40)
    // The visits the page's script counted, beside those its request did.
    assertEquals(of.home_loaded.share, 0.1)
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
      {
        name: 'meta//pilot',
        home: 9,
        home_loaded: 0,
        click: 4,
        started: 0,
        signup: 2,
        checkout: 1,
      },
    ])
    assertEquals(f.variants, [
      {
        name: 'ask',
        home: 20,
        home_loaded: 7,
        click: 0,
        started: 0,
        signup: 0,
        checkout: 0,
      },
      {
        name: 'operator',
        home: 18,
        home_loaded: 0,
        click: 5,
        started: 2,
        signup: 3,
        checkout: 0,
      },
    ])
    // Crawlers, agents and test accounts are counted apart, in no count
    // above: every other query reads a person's steps alone.
    assertEquals(f.apart, [
      { client: 'test', step: 'signup', n: 2 },
      { client: 'bot', step: 'home', n: 5 },
    ])
    // An agent's check, tagged so in its link, is a test account's step,
    // whatever client it was written with, and so is each build begun by
    // the check of /churches on 2026-11-10 whose link did not say so.
    let check = [1794343657, 1794344110, 1794344303, 1794344376].map((t) =>
      ` OR blob2 = 'started' AND timestamp = toDateTime(${t})`
    ).join('')
    let who = `if(blob7 LIKE 'agent-check/%'${check}, 'test', blob6)`
    assertEquals(
      sql.asked.filter((q) => q.includes(`NOT ${who} IN ('browser', '')`))
        .length,
      1,
    )
    assertEquals(
      sql.asked.every((q) => q.includes(`${who} IN ('browser', '')`)),
      true,
    )
    // Each build begun on 2026-11-20 by somebody signed in, written before
    // the step said so, is read as theirs.
    let signed = [1795150492, 1795151880].map((t) =>
      `blob2 = 'started' AND timestamp = toDateTime(${t})`
    ).join(' OR ')
    assertStringIncludes(
      sql.asked.find((q) => q.includes('GROUP BY step'))!,
      `if(${signed}, 'started_signed_in', blob2) AS step`,
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
      cookie: 'yak_came=utm_source=meta&utm_campaign=pilot&at=5&page=church',
      ...headers,
    },
  })

test('a click on a call to action is counted by its button, campaign and the home page its visitor opened', async () => {
  let views = dataset()
  let env = { VIEWS: views } as never
  let said = await clicked(beacon('start'), env)
  assertEquals(said.status, 204)
  assertEquals(views.points.map((p) => p.blobs), [
    [
      '',
      'click',
      '/api/click',
      '',
      '',
      'browser',
      'meta//pilot',
      'start',
      'church',
    ],
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

test("a home page's visit is counted by its own script, by the page it names and its visitor's campaign, and nothing else is", async () => {
  let views = dataset()
  let env = { VIEWS: views } as never
  let post = (body: string, headers: Record<string, string> = {}) =>
    loaded(
      new Request(`https://yaks.app${LOADED}`, beacon(body, headers)),
      env,
    )
  assertEquals((await post('/organizations')).status, 204)
  assertEquals(views.points.map((p) => p.blobs), [
    [
      '',
      'home_loaded',
      LOADED,
      '',
      '',
      'browser',
      'meta//pilot',
      '',
      'organization',
    ],
  ])
  // A page that is no home page, another site's page, a crawler: answered
  // alike, counted as nothing.
  for (
    let res of [
      await post('/pricing'),
      await post('/', { 'sec-fetch-site': 'cross-site' }),
      await post('/', { 'user-agent': 'Googlebot/2.1' }),
    ]
  ) assertEquals(res.status, 204)
  assertEquals(views.points.length, 1)
  assertEquals(
    (await loaded(new Request(`https://yaks.app${LOADED}`), env)).status,
    405,
  )
})

test('every home page, opened and run in a browser, counts its visit twice, by its request and by its script; a fetch that never runs it, once', async () => {
  let k = await kernel()
  let code = await Deno.readTextFile(
    new URL('./public/cta.js', import.meta.url),
  )
  let funnelled = (before: number) =>
    k.views.points.slice(before)
      .filter((p) => p.indexes?.[0] == FUNNEL)
      .map((p) => [p.blobs![1], p.blobs![8]])
  for (let { name, path } of VARIANTS) {
    let before = k.views.points.length
    let opened = await k.at(k.host, path, {
      headers: { 'user-agent': BROWSER },
    })
    let { document } = parseHTML(await opened.text())
    assertEquals(
      [path, !!document.querySelector('script[src="cta.js"]')],
      [path, true],
    )
    let cookie = opened.headers.get('set-cookie')!.split(';')[0]
    // What the page's script sends as it runs, sent as a browser sends it.
    let sent: [string, string][] = []
    new Function('addEventListener', 'navigator', 'fetch', 'location', code)(
      () => {},
      {
        sendBeacon: (to: string, body: string) => (sent.push([to, body]), true),
      },
      () => Promise.resolve(),
      { pathname: path },
    )
    for (let [to, body] of sent) {
      let r = await k.at(k.host, to, {
        method: 'POST',
        body,
        headers: {
          'user-agent': BROWSER,
          'sec-fetch-site': 'same-origin',
          cookie,
        },
      })
      assertEquals(r.status, 204)
    }
    assertEquals(funnelled(before), [['home', name], ['home_loaded', name]])
  }
  let before = k.views.points.length
  let scanned = await k.at(k.host, '/', { headers: { 'user-agent': BROWSER } })
  await scanned.body?.cancel()
  assertEquals(funnelled(before), [['home', 'ask']])
})

test("each of the home page's calls to action sends its name when clicked", async () => {
  let { document } = parseHTML(page('index.html'))
  let named = [...document.querySelectorAll('[data-cta]')]
  let names = named.map((b) => b.getAttribute('data-cta')!)
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
    new Function('addEventListener', 'navigator', 'fetch', 'location', code)(
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
      { pathname: '/' },
    )
    for (let b of named) on({ target: b.querySelector('*') ?? b })
    on({ target: document.querySelector('h1') })
    return sent
  }
  // The page's visit is sent once, as it runs, before any click.
  let each = (...how: string[]) => [
    ...how.map((h) => [h, LOADED, '/']),
    ...names.flatMap((name) => how.map((h) => [h, '/api/click', name])),
  ]
  assertEquals(clicks(true), each('beacon'))
  assertEquals(clicks(false), each('beacon', 'keepalive'))
  assertEquals(clicks(), each('keepalive'))
  let views = dataset()
  for (let [, to, name] of clicks(true)) {
    if (to == '/api/click') {
      await clicked(beacon(name), { VIEWS: views } as never)
    }
  }
  assertEquals(views.points.map((p) => p.blobs![7]), names)
})

test("signing in through the doors in a browser counts a person's steps, and a test account's apart", async () => {
  let k = await kernel()
  let signs = async (address: string) => {
    let browser = ''
    let form = (path: string, fields: Record<string, string>) =>
      k.at(k.host, path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': BROWSER,
          ...browser ? { cookie: browser } : {},
        },
        body: new URLSearchParams(fields).toString(),
      })
    let before = k.views.points.length
    let asked = await form('/login', { address })
    browser =
      asked.headers.getSetCookie().find((c) => c.startsWith('yak_session='))!
        .split(';')[0]
    await asked.body?.cancel()
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

// What the funnel's counts would answer for the steps the kernel wrote: a
// person's alone, by step, as `counts` asks the SQL API.
let read = (points: { indexes?: string[]; blobs?: string[] }[]) => {
  let people = points.filter((p) =>
    p.indexes?.[0] == FUNNEL && ['browser', ''].includes(p.blobs![5])
  )
  let by = Map.groupBy(people, (p) => p.blobs![1])
  return shaped(
    new Date(),
    [...by].map(([step, all]) => ({ step, n: all.length })),
  )
}

test('a landing page visited at its own address is a home page visit counted under it, and so are the steps after it', async () => {
  let k = await kernel()
  for (
    let [path, kicker, name] of [
      ['/churches', 'For church offices', 'church'],
      ['/organizations', 'For churches, clubs, town offices', 'organization'],
      ['/townships', 'For Michigan townships', 'township'],
    ]
  ) {
    let before = k.views.points.length
    let seen = await k.at(k.host, path, {
      headers: { 'user-agent': BROWSER },
    })
    assertStringIncludes(await seen.text(), kicker)
    let cookie = seen.headers.get('set-cookie')!.split(';')[0]
    // A sign-in code asked for afterwards counts under the page too.
    let address = `${unique('in')}@example.com`
    let asked = await k.at(k.host, '/login', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': BROWSER,
        cookie,
      },
      body: new URLSearchParams({ address }).toString(),
    })
    await asked.body?.cancel()
    await mailed(k, address)
    assertEquals(
      k.views.points.slice(before)
        .filter((p) => p.indexes?.[0] == FUNNEL)
        .map((p) => [p.blobs![1], p.blobs![8]]),
      [['home', name], ['code_sent', name]],
    )
  }
})

test("a stranger's way is read stage by stage, a crawler's and Meta's reviewer's left out, and where they stop is the stage most go no further than", async () => {
  let k = await kernel()
  let before = k.views.points.length
  let opens = async (ua: string, cf?: Visited['cf']) => {
    let r = await k.at(k.host, '/', {
      headers: { 'user-agent': ua },
      ...cf ? { cf } : {},
    } as RequestInit)
    await r.body?.cancel()
  }
  await opens(BROWSER)
  await opens(BROWSER)
  await opens('Googlebot/2.1')
  await opens('facebookexternalhit/1.1')
  let address = `${unique('ada')}@example.com`
  let browser = ''
  let form = (path: string, fields: Record<string, string>) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': BROWSER,
        ...browser ? { cookie: browser } : {},
      },
      body: new URLSearchParams(fields).toString(),
    })
  let asked = await form('/login', { address })
  browser =
    asked.headers.getSetCookie().find((c) => c.startsWith('yak_session='))!
      .split(';')[0]
  await asked.body?.cancel()
  let inn = await form('/login/code', {
    address,
    code: await mailed(k, address),
  })
  await inn.body?.cancel()
  let cookie = inn.headers.get('set-cookie')!.split(';')[0]
  await connector(k, cookie).tool('app_new', {
    slug: unique('first'),
    title: 'First',
  })
  let f = read(k.views.points.slice(before))
  assertEquals(
    f.stages!.map((s) => [s.name, s.n]),
    STAGES.map((s) => [
      s.name,
      { visit: 2, built: 0, connected: 0, signup: 1, first_app: 1, back: 0 }[
        s.name
      ],
    ]),
  )
  assertEquals(stopped(f.stages), { after: f.stages![0], went: 0 })
})

test("a build begun in the home page's box is a stranger's only when a newcomer began it, and a person's only when a person did", async () => {
  let k = await kernel()
  let builds = async (cookie = '') => {
    let before = k.views.points.length
    let r = await k.at(k.host, '/start', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': BROWSER,
        origin: 'https://yaks.app',
        ...cookie ? { cookie } : {},
      },
      body: new URLSearchParams({ say: 'A prayer list' }).toString(),
    })
    await r.body?.cancel()
    let [at] = k.views.points.slice(before)
      .filter((p) => p.indexes?.[0] == FUNNEL)
    let session = r.headers.getSetCookie()
      .find((c) => c.startsWith('yak_session='))?.split(';')[0]
    return {
      step: at?.blobs?.[1],
      client: at?.blobs?.[5],
      session: session ?? cookie,
    }
  }
  let stranger = await builds()
  assertEquals([stranger.step, stranger.client], ['started', 'browser'])
  // A newcomer building again is still a stranger; somebody signed in, whose
  // box builds in their own space, is not.
  assertEquals((await builds(stranger.session)).step, 'started')
  let known = await builds(
    (await signIn(k, `${unique('ada')}@example.com`)).cookie,
  )
  assertEquals([known.step, known.client], ['started_signed_in', 'browser'])
  // An agent's check's newcomer, building again once its link no longer
  // says so, is still nobody's (directory.ts `testIs`).
  let check = await builds(
    'yak_came=utm_source=agent-check&utm_campaign=box&at=5',
  )
  assertEquals((await builds(check.session)).client, 'test')
  for (let address of [ADMIN, DEMO]) {
    assertEquals(
      (await builds((await signIn(k, address)).cookie)).client,
      'test',
    )
  }
})
