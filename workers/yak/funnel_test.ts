// yaks.app's own funnel (funnel.ts): what a step writes, and what the counts
// read back as.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { funnel, step } from './funnel.ts'
import { FUNNEL, isHome } from './view-point.ts'
import { analytics, dataset } from './testing.ts'
import type { Env } from './env.ts'

let BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit Safari'
let visit = (ua = BROWSER, path = '/') =>
  new Request(`https://yaks.app${path}`, {
    headers: { 'user-agent': ua, referer: 'https://news.example.com/item?q=1' },
  })

test('a step is written under the platform, saying what a view says and its campaign', () => {
  let views = dataset()
  step({ VIEWS: views }, 'code_sent', visit())
  step({ VIEWS: views }, 'returned')
  step(
    { VIEWS: views },
    'home',
    visit(BROWSER, '/?utm_source=meta&utm_campaign=pilot'),
  )
  assertEquals(views.points, [
    {
      indexes: [FUNNEL],
      blobs: ['', 'code_sent', '/', '', 'news.example.com', 'browser', ''],
      doubles: [0],
    },
    {
      indexes: [FUNNEL],
      blobs: ['', 'returned', '', '', '', '', ''],
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
      ],
      doubles: [0],
    },
  ])
})

test('the home page is visited by a browser asking for /, not a crawler', () => {
  let ok = new Response('<html>', { status: 200 })
  assertEquals(isHome(visit(), '/', ok), true)
  assertEquals(isHome(visit(), '/', new Response(null, { status: 304 })), true)
  assertEquals(isHome(visit('Googlebot/2.1'), '/', ok), false)
  assertEquals(isHome(visit(BROWSER, '/gallery'), '/gallery', ok), false)
})

test('the funnel reads each step, a share of the one it follows, and where visitors came from', async () => {
  let sql = analytics((q) =>
    q.includes("blob2 = 'home'")
      ? [{ site: 'news.example.com', n: 3 }]
      : q.includes('blob7')
      ? [
        { campaign: 'meta//pilot', step: 'home', n: 9 },
        { campaign: 'meta//pilot', step: 'signup', n: '2' },
      ]
      : [{ step: 'home', n: 40 }, { step: 'code_sent', n: '10' }]
  )
  try {
    let env = { CF_ANALYTICS_TOKEN: 't', CF_ACCOUNT: 'a' } as Env
    let f = (await funnel(env, 7))!
    let of = Object.fromEntries(f.steps.map((s) => [s.name, s]))
    assertEquals(of.home.n, 40)
    assertEquals(of.code_sent.share, 0.25)
    assertEquals(of.signed_in.share, 0)
    // A share of a step nobody took is no share at all.
    assertEquals(of.signup, { name: 'signup', say: 'First sign-ins', n: 0 })
    assertEquals(f.from, [{ site: 'news.example.com', n: 3 }])
    assertEquals(f.campaigns, [{ campaign: 'meta//pilot', home: 9, signup: 2 }])
    assertEquals(
      sql.asked.every((q) => q.includes(`index1 = '${FUNNEL}'`)),
      true,
    )
  } finally {
    sql.done()
  }
  assertEquals(await funnel({} as Env), null)
})
