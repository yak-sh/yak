// A space's own address, held in workerd (T-33040). Two states, and both are
// a page rather than a redirect:
//
//   no front page   the apps this visitor may open, listed — the ordinary
//                   state, since being the first app claims nothing
//   a front page    that app, SERVED at the bare hostname; its own `/<app>/`
//                   forwards there, and every path no other app claims is
//                   its own
//
// The asset question is what the second test exists for. A page served at `/`
// carries the address it was served at as its `<base href>` (apps.ts
// `based`), so `photo.png` written in the page has to find the app's file.
// The test resolves the page's own relative URLs against the base the kernel
// gave it and fetches THOSE, rather than asserting a path by hand, so a base
// that moved would fail here.
//
// The listing's rule is that it names only what the viewer may open: a
// stranger must not learn that a private app exists by reading its name, so
// anonymous, member and owner are each asked separately.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { spaceIndex } from './pages.ts'
import { client, connector, kernel, seed, signIn } from './probe.ts'

// What the browser would ask for, given a page and a URL written in it: the
// page's `<base href>` resolved against the address it was served at.
let resolves = (page: string, at: string, href: string) => {
  let base = /<base href="([^"]+)">/.exec(page)?.[1]
  if (!base) throw new Error('the kernel served a page with no base')
  return new URL(href, new URL(base, new URL(at, 'https://jeff.yaks.app')))
    .pathname
}

slow('a space with no front page lists what you may open', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [
      { slug: 'jeff', apps: ['recipes', 'garden'] },
      { slug: 'bare', apps: [] },
    ])
    let agent = connector(k, them.cookie)
    await agent.tool('app_set', {
      space: 'jeff',
      app: 'garden',
      access: 'private',
    })
    let at = (cookie?: string) =>
      k.at('jeff.yaks.app', '/', {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
      })

    // A stranger: the public app by name, the private one not even as a
    // name, a way in, and what this place is.
    let out = await at()
    assertEquals(out.status, 200)
    let cold = await out.text()
    assertStringIncludes(cold, 'href="/recipes/"')
    assert(!cold.includes('garden'), cold)
    assertStringIncludes(cold, 'private')
    assertStringIncludes(cold, 'https://yaks.app/login?return=')
    assertStringIncludes(cold, 'What is yaks.app?')
    // Nothing about choosing a front page: the choice is not a stranger's.
    // The words move (7b586b44 reworded them); what has to hold is that only
    // the owner is offered the choice, so both halves name the thing the
    // block is ABOUT rather than the sentence it says it in.
    assert(!cold.includes('front page'), cold)

    // The owner: both apps, the block offering the front-page choice, and no
    // pitch or sign-in — they are home.
    let mine = await (await at(them.cookie)).text()
    assertStringIncludes(mine, 'href="/recipes/"')
    assertStringIncludes(mine, 'href="/garden/"')
    assertStringIncludes(mine, 'front page')
    assert(!mine.includes('What is yaks.app?'), mine)
    assert(!mine.includes('login?return='), mine)
    // And nothing is being held back from them, so nothing says so.
    assert(!mine.includes('private. Ask'), mine)

    // Someone signed in who is nobody here sees what the stranger sees, minus
    // the sign-in and the pitch: they have an account already.
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let guest = await (await at(ann.cookie)).text()
    assertStringIncludes(guest, 'href="/recipes/"')
    assert(!guest.includes('garden'), guest)
    assertStringIncludes(guest, 'private')
    assert(!guest.includes('What is yaks.app?'), guest)

    // A space with nothing in it is still a space, and still a 200: the
    // owner is told they can build here, a stranger is told nothing is open.
    let empty = await k.at('bare.yaks.app', '/')
    assertEquals(empty.status, 200)
    assertStringIncludes(await empty.text(), 'Nothing here is open')
    let ready = await k.at('bare.yaks.app', '/', {
      headers: { cookie: them.cookie },
    })
    assertStringIncludes(await ready.text(), 'build something here')

    // Only the bare address lists. A path under a space with no front page
    // names nothing, and says so.
    let deep = await k.at('jeff.yaks.app', '/nothing/at/all')
    assertEquals(deep.status, 404)
    assertStringIncludes(await deep.text(), 'Nothing here yet')
    // A hostname nobody made is still nobody's.
    assertEquals((await k.at('nowhere.yaks.app', '/')).status, 404)
  } finally {
    await k.stop()
  }
})

// The owner block's order (T-34242). On a space with nothing built the
// builder's question stands ahead of the connect steps: it is the one door
// that needs no assistant of the person's own, and somebody who has just
// signed in can use it now (what they are called leads both — T-34419, in the
// rendering tests below). Once something IS built, connecting an assistant
// leads again and the question moves under it.
slow("the builder's chat comes before the connect steps", async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [
      { slug: 'jeff', apps: ['recipes'] },
      { slug: 'bare', apps: [] },
    ])
    let at = (host: string, cookie?: string) =>
      k.at(host, '/', { headers: cookie ? { cookie } : {} })

    let empty = await (await at('bare.yaks.app', them.cookie)).text()
    assertStringIncludes(empty, 'action="/api/build"')
    assert(
      empty.indexOf('What do you want to build?') <
        empty.indexOf('Connect your assistant'),
      empty,
    )
    // Its live half is served on the space's own hostname, so the page needs
    // no asset of the apex.
    assertStringIncludes(empty, 'src="/api/build.js"')
    assertEquals((await k.at('bare.yaks.app', '/api/build.js')).status, 200)

    // With an app there, the instructions lead and the question follows.
    let some = await (await at('jeff.yaks.app', them.cookie)).text()
    assert(
      some.indexOf('Connect your assistant') <
        some.indexOf('Build something else'),
      some,
    )

    // A stranger is offered no door that would only ever refuse them.
    let cold = await (await at('bare.yaks.app')).text()
    assert(!cold.includes('/api/build'), cold)
  } finally {
    await k.stop()
  }
})

// The owner block itself, drawn straight (pages.ts `spaceIndex` is pure): the
// order it puts its blocks in, and what stands where the connect steps were.
// Every state a person passes through is one call here — landed, connected,
// something built — where reaching each through workerd is a sign-in, an
// OAuth grant and an app apiece (identity_test.ts holds those ends).
let block = (
  at: Partial<Parameters<typeof spaceIndex>[0]> = {},
) =>
  spaceIndex({
    space: 'dana',
    title: 'dana',
    apps: [],
    hidden: 0,
    role: 'owner',
    person: true,
    signIn: 'https://yaks.app/login',
    name: 'dana',
    ...at,
  }).text()

// T-34419. Jeff, 2026-09-05: "after putting in the code it didn't show the
// page to change the user name i don't think." It was there — under the
// builder's chat and under the connect steps at their full height, which is
// two screens down on a phone.
Deno.test('a fresh landing leads with the name and address form', async () => {
  let page = await block()
  let form = page.indexOf('name="name"')
  assert(form > 0, page)
  assert(form < page.indexOf('What do you want to build?'), page)
  assert(form < page.indexOf('<details'), page)
})

// The say-this list, on its own: the copy control is the page's one control
// and the connect instructions carry it too (pages.ts `copyable`, T-34412), so
// what this block is about is counted inside the block.
let saysIn = (page: string) =>
  page.split('<ul class="Says">')[1]?.split('</ul>')[0] ?? ''

// T-34420. Jeff, 2026-09-05: "after connecting there is ZERO instruction on
// what she should do next."
Deno.test('a connected space with nothing built says what to do next', async () => {
  let quiet = await block()
  assertEquals(saysIn(quiet), '')
  let page = await block({ connected: true })
  assertEquals(saysIn(page).match(/class="Copy_Go"/g)?.length, 3)
  // Above the builder's chat it points at, and under the form they land on.
  let next = page.indexOf('<ul class="Says">')
  assert(page.indexOf('name="name"') < next, page)
  assert(next < page.indexOf('<textarea'), page)
})

Deno.test('once an app is built, suggested prompts are hidden', async () => {
  let page = await block({
    connected: true,
    fixed: true,
    apps: [{ slug: 'recipes', title: 'Recipes' }],
  })
  assertEquals(saysIn(page), '')
  // And the form keeps the place it has always had, under the steps.
  assert(page.indexOf('<details') < page.indexOf('name="name"'), page)
})

// Who visited (views.ts, T-34497): the owner's block, drawn straight. What
// matters here is that it is the OWNER's, that it draws itself without a
// script, and that a platform with no analytics token says one sentence rather
// than an empty chart.
let VISITS = {
  slug: 'recipes',
  title: 'Recipes',
  stats: {
    days: 3,
    total: 9,
    daily: [
      { day: '2026-09-04', views: 2 },
      { day: '2026-09-05', views: 0 },
      { day: '2026-09-06', views: 7 },
    ],
    pages: [{ name: '/dinner', views: 6 }],
    from: [{ name: 'news.example.com', views: 4 }],
    countries: [{ name: 'US', views: 9 }],
  },
}

Deno.test('who visited: a bar per day and three lists, no script', async () => {
  let page = await block({
    apps: [{ slug: 'recipes', title: 'Recipes' }],
    views: [VISITS],
    viewDays: 3,
  })
  assertStringIncludes(page, 'Who visited')
  assertStringIncludes(page, '9 visits')
  // One rect per day, the tallest full height and the empty day absent.
  let bars = page.match(/class="Views_Bar"/g)
  assertEquals(bars?.length, 3)
  assertStringIncludes(page, 'height="40.00"')
  assertStringIncludes(page, 'height="0.00"')
  // The three lists, and the ends of the axis.
  assertStringIncludes(page, '/dinner')
  assertStringIncludes(page, 'news.example.com')
  assertStringIncludes(page, '>US<')
  assertStringIncludes(page, '4 Sep')
  assertStringIncludes(page, '6 Sep')
  // Nothing here runs: the chart is markup, not a canvas somebody paints.
  assertStringIncludes(page, '<svg class="Views_Chart"')

  // Not the owner's, not their business.
  let theirs = await block({
    role: null,
    apps: [{ slug: 'recipes', title: 'Recipes' }],
    views: [VISITS],
  })
  assert(!theirs.includes('Who visited'), theirs)
})

Deno.test('who visited: no token is one sentence, no chart', async () => {
  let page = await block({
    apps: [{ slug: 'recipes', title: 'Recipes' }],
    views: null,
    viewsOff: 'Visitor counts are not switched on for this platform yet.',
  })
  assertStringIncludes(page, 'Who visited')
  assertStringIncludes(page, 'not switched on')
  assert(!page.includes('<svg'), 'an empty chart is worse than a line')
})

Deno.test('who visited: an app nobody opened says so', async () => {
  let page = await block({
    apps: [{ slug: 'recipes', title: 'Recipes' }],
    views: [{
      ...VISITS,
      stats: {
        ...VISITS.stats,
        total: 0,
        daily: [],
        pages: [],
        from: [],
        countries: [],
      },
    }],
  })
  assertStringIncludes(page, 'Nobody has opened this one yet')
  assert(!page.includes('<svg'), page)
})

// The trash, on the page a person can actually reach without an assistant
// (T-34430): under the pills, one form per app, and one button that is the
// whole restore.
Deno.test('the owner sees the trash under the apps, with a button', async () => {
  let page = await block({
    apps: [{ slug: 'recipes', title: 'Recipes' }],
    trash: [{ slug: 'notes', title: 'Notes', days: 12 }],
  })
  assertStringIncludes(page, 'In the trash')
  assertStringIncludes(page, 'Notes — 12 days left')
  // A form, so it needs no script; posting to the page it is on, so it needs
  // no door of its own (apps.ts `saved`).
  assertStringIncludes(page, '<form method="post" action="/">')
  assertStringIncludes(page, 'name="restore" value="notes"')
  // Under the apps, which is what it is about.
  assert(page.indexOf('class="Pills"') < page.indexOf('In the trash'), page)
  // One day reads as a day.
  assertStringIncludes(
    await block({ trash: [{ slug: 'notes', title: 'Notes', days: 1 }] }),
    'Notes — 1 day left',
  )
  // Nobody else is told an app was ever there.
  assert(
    !(await block({
      role: 'editor',
      trash: [{ slug: 'notes', title: 'Notes', days: 12 }],
    })).includes('In the trash'),
  )
})

Deno.test("none of the owner block is anybody else's", async () => {
  let page = await block({ role: null, person: false, connected: true })
  assert(!page.includes('name="name"'), page)
  assertEquals(saysIn(page), '')
})

slow('the front page is served at the space root', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{
      slug: 'jeff',
      apps: ['site', 'garden'],
    }])
    let agent = connector(k, cookie)
    await agent.tool('app_set', { space: 'jeff', app: 'site', home: true })
    let owner = client(k, 'jeff.yaks.app', 'site', cookie)
    // A page written the way a site is: a relative image and stylesheet, and
    // a relative link to a place that is no file.
    let page = '<!doctype html><html><head>' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><h1>Her business</h1><img src="photo.png">' +
      '<a href="about">About</a></body></html>'
    await owner.put('/index.html', page)
    await owner.put('/photo.png', 'not really a png')
    await owner.put('/style.css', 'h1 { color: peru }')
    await owner.put('/deep/note.txt', 'down a directory')

    // The root IS the app: 200 with its page, not a 302 into `/site/`.
    let root = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
    assertEquals(root.status, 200)
    let served = await root.text()
    assertStringIncludes(served, '<h1>Her business</h1>')
    // Its reporter is at the root as well — report.js reads its own door out
    // of its src, so the tag has to name the address the page was served at.
    assertStringIncludes(served, '<script src="/api/report.js">')
    assertEquals((await k.at('jeff.yaks.app', '/api/report.js')).status, 200)

    // The page's own relative URLs, resolved as a browser would and then
    // fetched — from the root, and from a pretty path under it, where a
    // relative URL would otherwise resolve against the page's depth.
    for (let at of ['/', '/about', '/deep/anything']) {
      let served = await k.at('jeff.yaks.app', at)
      assertEquals(served.status, 200, at)
      let drawn = await served.text()
      assertStringIncludes(drawn, '<h1>Her business</h1>')
      for (
        let [href, want] of [
          ['photo.png', 'not really a png'],
          ['style.css', 'h1 { color: peru }'],
        ]
      ) {
        let to = resolves(drawn, at, href)
        let got = await k.at('jeff.yaks.app', to)
        assertEquals(got.status, 200, `${at} -> ${to}`)
        assertEquals(await got.text(), want, to)
      }
    }
    // A file down a directory, and a root-absolute address a page might
    // carry: the front page answers for every path no app claims.
    for (let path of ['/style.css', '/deep/note.txt']) {
      assertEquals((await k.at('jeff.yaks.app', path)).status, 200, path)
    }
    // Every path no app claims — except `/.well-known/`, which is the
    // PLATFORM's on a hostname of ours (route.ts `platform`). That is where a
    // site GRANTS AUTHORITY over its own name, and this name is not the
    // space's to grant on: `assetlinks.json` would hand a native Android app
    // the right to intercept URLs for `jeff.yaks.app`, and an
    // `acme-challenge` token would pass HTTP-01 at a public CA and yield a
    // trusted certificate for it. So the front page answers none of them,
    // however ordinary the file looks — the home app included, since it is
    // the app that would otherwise get them all.
    // domain_test.ts holds the other half: on a hostname one app owns
    // outright the name is theirs, so the authority is theirs to grant.
    let claims = [
      '/.well-known/acme-challenge/token',
      '/.well-known/pki-validation/ca3.txt',
      '/.well-known/assetlinks.json',
      '/.well-known/apple-app-site-association',
      '/.well-known/apple-developer-merchantid-domain-association',
      '/.well-known/security.txt',
    ]
    for (let path of claims) await owner.put(path, 'the app said so')
    for (let path of claims) {
      let r = await k.at('jeff.yaks.app', path)
      assertEquals(r.status, 404, `${path} reached the app`)
      assertEquals((await r.text()).includes('the app said so'), false, path)
    }
    // `robots.txt` is about the whole host too and is still the app's, which
    // is the line the rule is actually drawn on: a robots file grants nobody
    // anything, and the site's face is the home app. It is the obvious thing
    // to sweep in beside the others, so it is held here on purpose.
    await owner.put('/robots.txt', 'User-agent: *\nDisallow:')
    let robots = await k.at('jeff.yaks.app', '/robots.txt')
    assertEquals(robots.status, 200)
    assertEquals(await robots.text(), 'User-agent: *\nDisallow:')
    // Under the app's own prefix it is a file like any other: a grant is read
    // at the root, and this is not the root.
    let own = await k.at('jeff.yaks.app', '/site/.well-known/security.txt')
    assertEquals(own.status, 200)
    assertEquals(await own.text(), 'the app said so')
    // Its store's doors answer at the root too — named by the hostname and
    // nothing else, the way they are on a custom domain (domain_test.ts).
    let rows = await k.at('jeff.yaks.app', '/api/graph')
    assertEquals((await rows.json()).db, 'do:jeff/site')
    // But `/<x>/api/…` named an app that is not here: a page asking a store
    // at a wrong address hears a 404, never HTML it cannot parse.
    assertEquals((await k.at('jeff.yaks.app', '/gone/api/query')).status, 404)

    // Its own `/<app>/` forwards here rather than serving the same page at a
    // second address, and takes the query string with it.
    for (let at of ['/site', '/site/', '/site/?a=1']) {
      let sent = await k.at('jeff.yaks.app', at, { redirect: 'manual' })
      assertEquals(sent.status, 302, at)
      assertEquals(
        sent.headers.get('location'),
        at.endsWith('?a=1') ? '/?a=1' : '/',
        at,
      )
      await sent.body?.cancel()
    }
    // Deeper under that prefix is no forward: a link someone holds to a file
    // lands on the file.
    let deep = await k.at('jeff.yaks.app', '/site/deep/note.txt', {
      redirect: 'manual',
    })
    assertEquals(deep.status, 200)
    assertEquals(await deep.text(), 'down a directory')

    // Precedence, stated: the space's apps own the first path segment, and
    // the front page answers what is left. `/garden` is the garden app even
    // though the front page answers for any other path.
    let sibling = await k.at('jeff.yaks.app', '/garden', {
      redirect: 'manual',
    })
    assertEquals(sibling.status, 302)
    assertEquals(sibling.headers.get('location'), '/garden/')
    assertEquals((await k.at('jeff.yaks.app', '/garden/')).status, 404)

    // The front page moves, and the addresses move with it: the app that was
    // it serves at its own prefix again — no stale forward — and the root is
    // the new one's.
    await agent.tool('app_set', { space: 'jeff', app: 'garden', home: true })
    let back = await k.at('jeff.yaks.app', '/site/', { redirect: 'manual' })
    assertEquals(back.status, 200)
    assertStringIncludes(await back.text(), '<h1>Her business</h1>')
    assertEquals(
      (await (await k.at('jeff.yaks.app', '/api/graph')).json()).db,
      'do:jeff/garden',
    )
  } finally {
    await k.stop()
  }
})
