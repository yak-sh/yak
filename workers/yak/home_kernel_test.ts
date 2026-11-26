// A space's own address, through the whole kernel (T-33040). Two states, and both are
// a page rather than a redirect:
//
//   no front page   the apps this visitor may open, listed — the ordinary
//                   state, since being the first app claims nothing
//   a front page    that app, served at the bare hostname; its own `/<app>/`
//                   forwards there, and every path no other app claims is
//                   its own
//
// The asset question is what the second test exists for. A page served at `/`
// carries the address it was served at as its `<base href>` (apps.ts
// `based`), so `photo.svg` written in the page has to find the app's file.
// The test resolves the page's own relative URLs against the base the kernel
// gave it and fetches those, rather than asserting a path by hand, so a base
// that moved would fail here.
//
// The listing's rule is that it names only what the viewer may open: a
// stranger must not learn that a private app exists by reading its name, so
// anonymous, member and owner are each asked separately.

import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { parseHTML } from 'linkedom'
import { chatPath, dashboardPath, managePath } from '@yaks/platform/routes'
import {
  accepted,
  connector,
  kernel,
  pressPeople,
  seed,
  signIn,
  spaceAct,
  unique,
} from './probe.ts'
import { spaceRobots } from './seo.ts'

// What the cases read, made once for the file by the first that asks: one
// owner, and a space of each case's own, so that no case reads another's
// writes. A space and its apps are most of what a case would otherwise cost.
let build = async () => {
  let k = await kernel()
  let at = {
    shown: unique('shown'),
    bare: unique('bare'),
    homing: unique('homing'),
    front: unique('front'),
    trips: unique('trips'),
    reached: unique('reached'),
    whose: unique('whose'),
    crawled: unique('crawled'),
  }
  let them = await seed(k, [
    { slug: at.shown, apps: ['recipes', 'garden'] },
    { slug: at.bare, apps: [] },
    { slug: at.homing, apps: ['site', 'garden'] },
    { slug: at.front, apps: ['site', 'garden'] },
    { slug: at.trips, apps: ['one', 'two'] },
    { slug: at.reached, apps: [] },
    { slug: at.whose, apps: [] },
    { slug: at.crawled, apps: ['site'] },
  ])
  let agent = connector(k, them.cookie)
  // The listed space shows a stranger an app once it is released: before, it
  // answers nothing at its address. Its garden is released, and private.
  for (let app of ['recipes', 'garden']) {
    await agent.tool('app_deploy', { space: at.shown, app })
  }
  await agent.tool('app_set', {
    space: at.shown,
    app: 'garden',
    access: 'private',
  })
  return { k, at, them, agent }
}
let built: ReturnType<typeof build> | undefined
let world = () => built ??= build()

// What the browser would ask for, given a page and a URL written in it: the
// page's `<base href>` resolved against the address it was served at.
let resolves = (page: string, at: string, href: string) => {
  let base = /<base href="([^"]+)">/.exec(page)?.[1]
  if (!base) throw new Error('the kernel served a page with no base')
  return new URL(href, new URL(base, new URL(at, 'https://jeff.yaks.app')))
    .pathname
}

test('a space with no front page lists what you may open', async () => {
  let { k, at: { shown: jeff21, bare: bare21Space }, them } = await world()
  let at = (cookie?: string) =>
    k.at(`${jeff21}.yaks.app`, '/', {
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
  // block is about rather than the sentence it says it in.
  assert(!cold.includes('front page'), cold)

  // The owner is sent to the space's Dashboard at the apex, where its apps
  // and its Operator are, and no app's code here can reach them.
  let mine = await at(them.cookie)
  assertEquals(mine.status, 302)
  assertEquals(
    mine.headers.get('location'),
    `https://yaks.app${dashboardPath(jeff21)}`,
  )

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
  let empty = await k.at(`${bare21Space}.yaks.app`, '/')
  assertEquals(empty.status, 200)
  assertStringIncludes(await empty.text(), 'Nothing here is open')
  let ready = await k.at(`${bare21Space}.yaks.app`, '/', {
    headers: { cookie: them.cookie },
    redirect: 'manual',
  })
  await ready.body?.cancel()
  assertEquals(
    ready.headers.get('location'),
    `https://yaks.app${dashboardPath(bare21Space)}`,
  )

  // An API address is still a machine door when no app answers there: a
  // missing space, a bare space with no front app, and a missing named app
  // all refuse in JSON. Returning the human 404 page here made clients
  // parse an entire HTML document as an unexpected defect.
  for (
    let [host, path] of [
      ['nowhere21.yaks.app', '/api/query'],
      [`${bare21Space}.yaks.app`, '/api/query'],
      [`${jeff21}.yaks.app`, '/missing/api/query'],
    ]
  ) {
    let missing = await k.at(host, path)
    assertEquals(missing.status, 404, `${host}${path}`)
    assertStringIncludes(
      missing.headers.get('content-type') ?? '',
      'application/json',
    )
    assertEquals(await missing.json(), {
      error: { code: 'not_found', message: 'no app at that address' },
    })
  }

  // Only the bare address lists. A path under a space with no front page
  // names nothing, and says so.
  let deep = await k.at(`${jeff21}.yaks.app`, '/nothing/at/all')
  assertEquals(deep.status, 404)
  assertStringIncludes(await deep.text(), 'Nothing here yet')
  // A hostname nobody made is still nobody's.
  assertEquals((await k.at('nowhere.yaks.app', '/')).status, 404)
})

// Asking for a new app and setting up an agent are separate destinations.
test('management separates app creation from agent setup', async () => {
  let { k, at: { bare: bare22Space }, them: { cookie } } = await world()
  let at = (view: Parameters<typeof managePath>[0]) =>
    k.at('yaks.app', managePath(view, bare22Space), { headers: { cookie } })
  let library = await (await at('apps')).text()
  assert(!library.includes('<textarea'), library)
  assert(!library.includes('type="file"'), library)
  // The page is the apex's: its words go to the space's Operator there, and
  // a drop to the space's own door.
  let fresh = await (await at('new')).text()
  assertStringIncludes(
    fresh,
    `action="${managePath('operator', bare22Space)}"`,
  )
  assertStringIncludes(
    fresh,
    `action="https://${bare22Space}.yaks.app/deploy"`,
  )
  assert(!fresh.includes('build.js'), fresh)
  assert(!fresh.includes('name="agent"'), fresh)
  let setup = await (await at('agents')).text()
  assertEquals(
    parseHTML(setup).document.querySelector('h1')?.textContent,
    'Agents',
  )
  assertStringIncludes(setup, 'Connect another agent')
  assertStringIncludes(setup, 'name="agent"')
  assert(!setup.includes('<textarea'), setup)
})

// The New app screen is a shortcut into the person's Operator conversation:
// its form, posted as the browser posts it, lands there.
test("the New app screen's words open the person's conversation", async () => {
  let { k, at: { bare: space }, them: { cookie } } = await world()
  let page = await (await k.at('yaks.app', managePath('new', space), {
    headers: { cookie },
  })).text()
  let form = parseHTML(page).document.querySelector('form:has(textarea)')!
  let body = new FormData()
  for (let input of form.querySelectorAll('input[type=hidden]')) {
    body.set(input.getAttribute('name')!, input.getAttribute('value')!)
  }
  body.set('say', 'a list of the chores')
  let sent = await k.at('yaks.app', form.getAttribute('action')!, {
    method: 'POST',
    body,
    headers: { cookie, origin: 'https://yaks.app' },
  })
  assertEquals(sent.status, 303)
  let to = sent.headers.get('location')!
  assertEquals(to, chatPath(space, to.split('/').at(-1)))
})

test('Settings chooses the homepage the way app_set home does', async () => {
  let { k, at: { homing: slug }, them } = await world()
  let at = managePath('settings', slug)
  let space = (await k.dir.space(slug))!.eid
  let chosen = async () =>
    parseHTML(
      await (await k.at(k.host, at, { headers: { cookie: them.cookie } }))
        .text(),
    )
      .document.querySelector('#your-home option[selected]')
      ?.getAttribute('value')
  let choose = (home: string) =>
    spaceAct(k, them, space, { spaceSettings: { home } })
  assertEquals(await chosen(), '')
  assertEquals((await choose('garden')).status, 200)
  assertEquals(await chosen(), 'garden')
  await choose('site')
  assertEquals(await chosen(), 'site')
  await choose('')
  assertEquals(await chosen(), '')
})

test('the front page is served at the space root', async () => {
  let { k, at: { front: jeff23 }, agent } = await world()
  await agent.tool('app_set', { space: jeff23, app: 'site', home: true })
  // A page written the way a site is: a relative image and stylesheet, and
  // a relative link to a place that is no file.
  let photo = '<svg xmlns="http://www.w3.org/2000/svg"/>'
  let page = '<!doctype html><html><head>' +
    '<link rel="stylesheet" href="style.css">' +
    '</head><body><h1>Her business</h1><img src="photo.svg">' +
    '<a href="about">About</a></body></html>'
  // And the files a site grants authority over its name with, and its
  // robots file, written and released with the rest (what each is for is
  // below).
  let claims = [
    '/.well-known/acme-challenge/token',
    '/.well-known/pki-validation/ca3.txt',
    '/.well-known/assetlinks.json',
    '/.well-known/apple-app-site-association',
    '/.well-known/apple-developer-merchantid-domain-association',
    '/.well-known/security.txt',
  ]
  let files = {
    'index.html': page,
    'photo.svg': photo,
    'style.css': 'h1 { color: peru }',
    'deep/note.txt': 'down a directory',
    'robots.txt': 'User-agent: *\nDisallow:',
    ...Object.fromEntries(claims.map((c) => [c.slice(1), 'the app said so'])),
  }
  await agent.tool('app_files', {
    space: jeff23,
    app: 'site',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  })
  await agent.tool('app_deploy', { space: jeff23, app: 'site' })

  // The root is the app: 200 with its page, not a 302 into `/site/`.
  let root = await k.at(`${jeff23}.yaks.app`, '/', { redirect: 'manual' })
  assertEquals(root.status, 200)
  let served = await root.text()
  assertStringIncludes(served, '<h1>Her business</h1>')
  // Its reporter's doors are at the root as well — report.js reads them
  // off its tag, so the tag has to name the address the page was served at.
  assertStringIncludes(
    served,
    '<script data-yak-at="/" data-yak-version="1">',
  )

  // The page's own relative URLs, resolved as a browser would and then
  // fetched — from the root, and from a pretty path under it, where a
  // relative URL would otherwise resolve against the page's depth.
  for (let at of ['/', '/about', '/deep/anything']) {
    let served = await k.at(`${jeff23}.yaks.app`, at)
    assertEquals(served.status, 200, at)
    let drawn = await served.text()
    assertStringIncludes(drawn, '<h1>Her business</h1>')
    for (
      let [href, want] of [
        ['photo.svg', photo],
        ['style.css', 'h1 { color: peru }'],
      ]
    ) {
      let to = resolves(drawn, at, href)
      let got = await k.at(`${jeff23}.yaks.app`, to)
      assertEquals(got.status, 200, `${at} -> ${to}`)
      assertEquals(await got.text(), want, to)
    }
  }
  // A file down a directory, and a root-absolute address a page might
  // carry: the front page answers for every path no app claims.
  for (let path of ['/style.css', '/deep/note.txt']) {
    assertEquals((await k.at(`${jeff23}.yaks.app`, path)).status, 200, path)
  }
  // Every path no app claims — except `/.well-known/`, which is the
  // platform's on a hostname of ours (@yaks/platform/routes `platform`). That is where a
  // site grants authority over its own name, and this name is not the
  // space's to grant on: `assetlinks.json` would hand a native Android app
  // the right to intercept URLs for `jeff.yaks.app`, and an
  // `acme-challenge` token would pass HTTP-01 at a public CA and yield a
  // trusted certificate for it. So the front page answers none of them,
  // however ordinary the file looks — the home app included, since it is
  // the app that would otherwise get them all.
  // domain_test.ts holds the other half: on a hostname one app owns
  // outright the name is theirs, so the authority is theirs to grant.
  for (let path of claims) {
    let r = await k.at(`${jeff23}.yaks.app`, path)
    assertEquals(r.status, 404, `${path} reached the app`)
    assertEquals((await r.text()).includes('the app said so'), false, path)
  }
  // `robots.txt` is about the whole host too and is still the app's, which
  // is the line the rule is actually drawn on: a robots file grants nobody
  // anything, and the site's face is the home app. It is the obvious thing
  // to sweep in beside the others, so it is held here on purpose.
  let robots = await k.at(`${jeff23}.yaks.app`, '/robots.txt')
  assertEquals(robots.status, 200)
  assertEquals(await robots.text(), 'User-agent: *\nDisallow:')
  // Under the app's own prefix it is a file like any other: a grant is read
  // at the root, and this is not the root.
  let own = await k.at(`${jeff23}.yaks.app`, '/site/.well-known/security.txt')
  assertEquals(own.status, 200)
  assertEquals(await own.text(), 'the app said so')
  // Its store's doors answer at the root too — named by the hostname and
  // nothing else, the way they are on a custom domain (domain_test.ts).
  let rows = await k.at(`${jeff23}.yaks.app`, '/api/graph')
  assertStringIncludes((await rows.json()).db, `do:${jeff23}/site.`)
  // But `/<x>/api/…` named an app that is not here: a page asking a store
  // at a wrong address hears a 404, never HTML it cannot parse.
  let missing = await k.at(`${jeff23}.yaks.app`, '/gone/api/query')
  assertEquals(missing.status, 404)
  assertEquals(await missing.json(), {
    error: { code: 'not_found', message: 'no app at that address' },
  })

  // Its own `/<app>/` forwards here rather than serving the same page at a
  // second address, and takes the query string with it.
  for (let at of ['/site', '/site/', '/site/?a=1']) {
    let sent = await k.at(`${jeff23}.yaks.app`, at, { redirect: 'manual' })
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
  let deep = await k.at(`${jeff23}.yaks.app`, '/site/deep/note.txt', {
    redirect: 'manual',
  })
  assertEquals(deep.status, 200)
  assertEquals(await deep.text(), 'down a directory')

  // Precedence, stated: the space's apps own the first path segment, and
  // the front page answers what is left. `/garden` is the garden app even
  // though the front page answers for any other path.
  let sibling = await k.at(`${jeff23}.yaks.app`, '/garden', {
    redirect: 'manual',
  })
  assertEquals(sibling.status, 302)
  assertEquals(sibling.headers.get('location'), '/garden/')
  assertEquals((await k.at(`${jeff23}.yaks.app`, '/garden/')).status, 404)

  // The front page moves, and the addresses move with it: the app that was
  // it serves at its own prefix again — no stale forward — and the root is
  // the new one's.
  await agent.tool('app_set', { space: jeff23, app: 'garden', home: true })
  let back = await k.at(`${jeff23}.yaks.app`, '/site/', {
    redirect: 'manual',
  })
  assertEquals(back.status, 200)
  assertStringIncludes(await back.text(), '<h1>Her business</h1>')
  assertStringIncludes(
    (await (await k.at(`${jeff23}.yaks.app`, '/api/graph')).json()).db,
    `do:${jeff23}/garden.`,
  )
})

// Every trip to the directory is a wait from wherever the request landed, so a
// dashboard page asks everything it can at once: who the person is, where they
// sit, the space with every app in it, and the rows of a page's own, by the
// walk to the space's address.
test("a space whose apps have no robots file answers the platform's", async () => {
  let { k, at, agent } = await world()
  let robots = async (space: string) => {
    let r = await k.at(`${space}.yaks.app`, '/robots.txt')
    return [r.status, await r.text()]
  }
  let platform = [200, spaceRobots()]
  assertEquals(await robots(at.bare), platform)
  // A front page that has none passes it on, as it passes `/` to the index.
  await agent.tool('app_files', {
    space: at.crawled,
    app: 'site',
    files: [{ path: 'index.html', content: '<h1>Hers</h1>' }],
  })
  await agent.tool('app_deploy', { space: at.crawled, app: 'site' })
  await agent.tool('app_set', { space: at.crawled, app: 'site', home: true })
  assertEquals(await robots(at.crawled), platform)
  assertEquals(
    (await k.at(`${at.crawled}.yaks.app`, '/nothing.txt')).status,
    404,
  )
})

test('a dashboard page reads the directory in one trip', async () => {
  let { k, at: { trips: slug, reached: other }, them, agent } = await world()
  let { cookie } = them
  // Somebody else invited to the space and to an app, and another space's
  // Operator let in, so the People page and the Operator's settings have rows
  // of their own to name.
  let guest = await signIn(k)
  await agent.tool('member_add', { space: slug, email: guest.email })
  await agent.tool('member_add', {
    space: slug,
    email: guest.email,
    app: 'one',
  })
  let let_in = await pressPeople(k, them, slug, 'operatorAdmit', {
    operator: (await k.dir.space(other))!.eid,
    role: 'viewer',
  })
  assertEquals(let_in, { status: 200, said: 'Saved.' })
  let timing = async (path: string) => {
    await k.settled()
    let page = await k.at('yaks.app', path, { headers: { cookie } })
    await page.body?.cancel()
    assertEquals(page.status, 200)
    return page.headers.get('server-timing') ?? ''
  }
  let trips = async (path: string) =>
    /hops;dur=(\d+)/.exec(await timing(path))?.[1]
  for (
    let view of [
      'apps',
      'new',
      'settings',
      'billing',
      'trash',
      'connections',
      'people',
    ] as const
  ) {
    assertEquals(await trips(managePath(view, slug)), '1', view)
  }
  // The Operator's settings page also asks its store once, beside the
  // directory, for the settings its persona holds.
  let settings = await timing(managePath('operator', slug))
  assertEquals(/hops;dur=(\d+)/.exec(settings)?.[1], '2')
  assertMatch(settings, /operator_wait;dur=\d+/)
  // The first chunk has the editor. The same response fills in the
  // conversation around it.
  let opening = await k.at('yaks.app', chatPath(slug), { headers: { cookie } })
  assertEquals(opening.status, 200)
  let stream = opening.body!.getReader()
  let first = new TextDecoder().decode((await stream.read()).value)
  let shell = parseHTML(first).document
  let pending = shell.querySelector('[data-operator-opening]')!
  assert(pending.hasAttribute('data-operator-stream'))
  let early = shell.querySelector('#ask textarea[name=say]')!
  assert(early && !early.hasAttribute('readonly'))
  assertEquals(shell.querySelector('script[data-operator-answer]'), null)
  let tail = parseHTML(new TextDecoder().decode((await stream.read()).value))
    .document
  assertEquals((await stream.read()).done, true)
  let streamed = parseHTML(
    JSON.parse(
      tail.querySelector('script[data-operator-answer]')!.textContent!,
    ),
  ).document
  assertEquals(
    streamed.querySelector('#ask textarea')?.closest('[data-early-draft]')
      ?.getAttribute('data-key'),
    early.closest('[data-early-draft]')?.getAttribute('data-key'),
  )
  assertEquals(
    streamed.querySelector('[data-operator-opening]'),
    null,
  )
  let path = pending.getAttribute('data-operator-opening')!
  let drawn = await k.at('yaks.app', path, { headers: { cookie } })
  let chat = drawn.headers.get('server-timing') ?? ''
  assert(parseHTML(await drawn.text()).document.querySelector('#ask textarea'))
  assertEquals(/hops;dur=(\d+)/.exec(chat)?.[1], '2')
  assertMatch(chat, /operator_wait;dur=\d+/)
  // A page of the person's own asks only about them, at once.
  for (let view of ['profile', 'shared'] as const) {
    assertEquals(await trips(managePath(view)), '1', view)
  }
  // Their own space's connections also say which outside services hold a
  // grant from them, asked beside the directory's reads, once, and the wait
  // on them is said.
  let own = await k.at('yaks.app', managePath('connections'), {
    headers: { cookie },
  })
  await own.body?.cancel()
  let at = new URL(own.headers.get('location')!, 'https://yaks.app')
  let said = await timing(at.pathname)
  assertEquals(/hops;dur=(\d+)/.exec(said)?.[1], '1')
  assertMatch(said, /oauth_wait;dur=\d+/)
})

// A space with no front page answers its bare address from the one read that
// routed it: its listing to a stranger, and its owner sent to its Dashboard.
test("a space's listing reads the directory in one trip", async () => {
  let { k, at: { shown: slug }, them: { cookie } } = await world()
  for (let headers of [{}, { cookie }] as Record<string, string>[]) {
    await k.settled()
    let page = await k.at(`${slug}.yaks.app`, '/', {
      headers,
      redirect: 'manual',
    })
    if (headers.cookie) {
      assertEquals(page.status, 302)
      await page.body?.cancel()
    } else {
      assertEquals(page.status, 200)
      assertStringIncludes(await page.text(), 'href="/recipes/"')
    }
    assertEquals(
      /hops;dur=(\d+)/.exec(page.headers.get('server-timing') ?? '')?.[1],
      '1',
    )
  }
})

test("the selector names whose space each one you're a member of is", async () => {
  let { k, at: { whose: slug }, them, agent } = await world()
  let guest = await signIn(k)
  await agent.tool('member_add', {
    space: slug,
    email: guest.email,
    role: 'editor',
  })
  await accepted(k, guest.email, guest.cookie)
  let rows = async (cookie: string) => {
    await k.settled()
    let page = await k.at('yaks.app', managePath('profile'), {
      headers: { cookie },
    })
    return [...parseHTML(await page.text()).document.querySelectorAll('small')]
      .map((note) => note.textContent ?? '')
  }
  let owner = them.email.split('@')[0]
  // The owner's own row says nothing under its name; the member's names the
  // owner.
  assert(!(await rows(them.cookie)).some((r) => r.includes('member')))
  assert(
    (await rows(guest.cookie)).includes(`${owner}’s space · you’re a member`),
  )
})
