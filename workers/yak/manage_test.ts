// The dashboard, at the apex (T-39354): reachable whatever app owns a space's
// front page, and the old addresses on the space moving there. These requests
// use the browser's cookie and form paths, including the boundaries that keep
// another person, and another page, from changing this account.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import {
  client,
  connector,
  kernel,
  meta,
  onPlus,
  owned,
  signIn,
} from './probe.ts'
import { chatPath, LOGOUT, MANAGE, managePath } from './route.ts'
import type { App } from './directory.ts'
import { library } from './pages.ts'
import { folds, type Plain, plain, type Seen } from './unseen.ts'

test('the dashboard is at the apex, whatever serves the space', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let slug = them.email.split('@')[0]
    let host = `${slug}.yaks.app`
    let agent = connector(k, them.cookie)
    let dir = meta(k)
    let get = (path: string, cookie = them.cookie) =>
      k.at('yaks.app', path, { redirect: 'manual', headers: { cookie } })
    let post = (
      path: string,
      fields: Record<string, string>,
      cookie = them.cookie,
      origin = 'https://yaks.app',
    ) =>
      k.at('yaks.app', path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie,
          origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      })
    let title = async () => {
      let [person] = await dir.query(`.entity.eid=${them.person}&?doc`)
      return (person.doc as { title: string }).title
    }

    for (let app of ['site', 'private-notes', 'discarded']) {
      await agent.tool('app_new', { space: slug, slug: app, title: app })
    }
    // `manage` is reserved now (route.ts RESERVED), and an app that held the
    // name before that keeps it: made under another slug, then renamed in
    // the directory the way it stood before the reservation.
    let held = String(
      (await agent.answer('app_new', {
        space: slug,
        slug: 'held',
        title: 'held',
      }))
        .value?.eid,
    )
    await dir.apply([{ entity: { eid: held }, app: { slug: 'manage' } }])
    await agent.tool('app_set', { space: slug, app: 'site', home: true })
    await agent.tool('app_set', {
      space: slug,
      app: 'private-notes',
      access: 'private',
    })
    let site = client(k, host, 'site', them.cookie)
    await (await site.put(
      '/index.html',
      '<!doctype html><h1>My front page</h1>',
    ))
      .body?.cancel()
    let existing = client(k, host, 'manage', them.cookie)
    await (await existing.put(
      '/index.html',
      '<!doctype html><h1>My manage app</h1>',
    ))
      .body?.cancel()
    await agent.tool('app_deploy', { space: slug, app: 'site' })
    await agent.tool('app_deploy', { space: slug, app: 'manage' })

    // The space's own address is its apps', all of it.
    let at = (path: string) =>
      k.at(host, path, { headers: { cookie: them.cookie } })
    assertStringIncludes(await (await at('/')).text(), '<h1>My front page</h1>')
    assertStringIncludes(
      await (await at('/manage/')).text(),
      '<h1>My manage app</h1>',
    )
    let apps = managePath('apps', slug)
    let first = await get(MANAGE)
    assertEquals(first.status, 302)
    assertEquals(first.headers.get('location'), `https://yaks.app${apps}`)
    assertStringIncludes(
      await (await get(apps)).text(),
      `href="https://${host}/private-notes/"`,
    )
    assertEquals((await get(`${MANAGE}/${slug}/missing`)).status, 404)
    let login = await k.at('yaks.app', MANAGE, { redirect: 'manual' })
    assertEquals(login.status, 303)
    assertEquals(
      new URL(login.headers.get('location')!).searchParams.get('return'),
      'https://yaks.app/manage',
    )
    await login.body?.cancel()

    // Where the dashboard was, letters and answers still send people: each
    // page moves to its own, the space in the path, the rest of the query
    // kept, and a form posted there kept a form.
    let to = (path: string) => `https://yaks.app${path}`
    let billing = `/manage/${slug}/billing?paid=1`
    for (
      let [from, was, now, method] of [
        [host, '/_yaks', apps],
        [host, '/_yaks/', apps],
        [host, '/_yaks/billing?paid=1', billing],
        ['yaks.app', `/manage/billing?space=${slug}&paid=1`, billing],
        ['yaks.app', '/manage/settings', `/manage/${slug}/settings`],
        ['yaks.app', '/manage/connect', managePath('agents')],
        ['yaks.app', `/manage/${slug}`, apps],
        [
          'yaks.app',
          `/manage/people?space=${slug}`,
          `/manage/${slug}/people`,
          'POST',
        ],
      ]
    ) {
      let res = await k.at(from, was, {
        method,
        redirect: 'manual',
        headers: { cookie: them.cookie, origin: 'https://yaks.app' },
      })
      await res.body?.cancel()
      assertEquals(
        [res.status, res.headers.get('location')],
        [method ? 308 : 301, to(now)],
        was,
      )
    }
    assertEquals((await k.at(host, '/_yaks/missing')).status, 404)

    // An icon linked from the setup page still downloads from the apex.
    let setup = await (await get(managePath('agents'))).text()
    let icon = new URL(/href="([^"]+)" download="yaks-app.png"/.exec(setup)![1])
    let download = await k.at(icon.hostname, icon.pathname)
    assertEquals(
      download.headers.get('content-disposition'),
      'attachment; filename="yaks-app.png"',
    )
    assert((await download.arrayBuffer()).byteLength < 10_000)

    // The name is the person's, saved on their Profile.
    let profile = managePath('profile')
    let named = await post(profile, { name: 'Dana' })
    assertEquals(named.status, 303)
    assertEquals(named.headers.get('location'), to(`${profile}?saved=1`))
    assertEquals(await title(), 'Dana')
    let confirmed = await (await get(`${profile}?saved=1`)).text()
    assertStringIncludes(confirmed, 'role="status"')
    assertStringIncludes(confirmed, 'value="Dana"')

    // The space's Settings: its address and homepage, and the way to delete it.
    let settings = managePath('settings', slug)
    let page = await (await get(settings)).text()
    assertStringIncludes(page, `action="${settings}"`)
    assertStringIncludes(page, `href="https://yaks.app/space/${slug}/delete"`)
    assertStringIncludes(page, `href="${managePath('trash', slug)}"`)
    let saved = await post(settings, { space: slug })
    assertEquals(saved.status, 303)
    assertEquals(saved.headers.get('location'), to(`${settings}?saved=1`))
    assertStringIncludes(
      await (await get(`${settings}?saved=1`)).text(),
      'role="status"',
    )
    assertEquals(await title(), 'Dana')

    let discarded = (await dir.query('.app.slug=discarded'))[0].entity.eid
    await agent.tool('app_delete', { space: slug, app: 'discarded' })
    let trash = managePath('trash', slug)
    assertStringIncludes(
      await (await get(trash)).text(),
      `name="restore" value="${discarded}"`,
    )
    let restored = await post(trash, { restore: discarded })
    assertEquals(restored.status, 303)
    assertEquals(restored.headers.get('location'), to(trash))
    assertStringIncludes(
      await (await get(apps)).text(),
      `href="https://${host}/discarded/"`,
    )
    let selling = managePath('selling', slug)
    let stopped = await post(selling, { sell: 'stop' })
    assertEquals(stopped.headers.get('location'), to(selling))

    let signedOut = await get(settings, '')
    assertEquals(signedOut.status, 303)
    let back = new URL(signedOut.headers.get('location')!)
    assertEquals(back.searchParams.get('return'), to(settings))
    // Somebody else, naming this space, is shown nothing of it, and
    // `/manage` opens their own.
    let other = await signIn(k)
    for (let view of ['apps', 'settings', 'trash'] as const) {
      let hidden = await get(managePath(view, slug), other.cookie)
      assertEquals(hidden.status, 404)
      assert(!(await hidden.text()).includes('private-notes'))
    }
    // An Operator conversation opens in its chat app, for nobody else.
    let chat = await get(chatPath(slug))
    assertEquals(chat.status, 200)
    assertStringIncludes(await chat.text(), 'class="Talk"')
    assertEquals((await get(chatPath(slug), other.cookie)).status, 404)
    let theirs = (await get(MANAGE, other.cookie)).headers.get('location')!
    assertEquals(
      theirs,
      to(managePath('apps', other.email.split('@')[0])),
    )
    // Nobody but its owner moves the space, and no other page names them.
    let away = { space: `away-${crypto.randomUUID().slice(0, 6)}` }
    assertEquals((await post(settings, away, '')).status, 303)
    assertEquals((await post(settings, away, other.cookie)).status, 404)
    assertEquals(
      (await post(settings, away, them.cookie, 'https://other.yaks.app'))
        .status,
      403,
    )
    assertEquals(
      (await post(profile, { name: 'C' }, them.cookie, 'https://x.yaks.app'))
        .status,
      403,
    )
    assertEquals(await dir.query(`.space.slug=${away.space}`), [])
    assertEquals(await title(), 'Dana')
    assertStringIncludes(await (await at('/')).text(), '<h1>My front page</h1>')
  } finally {
    await k.stop()
  }
})

// The person's own pages: a new space, the one they open first, and signing
// out, each through the form its page posts.
test('a person makes a space, opens it first, and signs out', async () => {
  let k = await kernel()
  try {
    let ada = await signIn(k)
    let fresh = `n${crypto.randomUUID().slice(0, 6)}`
    let post = (path: string, fields: Record<string, string>) =>
      k.at('yaks.app', path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: ada.cookie,
          origin: 'https://yaks.app',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      })
    let opens = async (cookie = ada.cookie) =>
      (await k.at('yaks.app', MANAGE, {
        redirect: 'manual',
        headers: { cookie },
      }))
        .headers.get('location')
    let own = ada.email.split('@')[0]
    let mine = `https://yaks.app${managePath('apps', own)}`
    assertEquals(await opens(), mine)
    // Her one free space on the Plus plan makes room for another.
    let [first] = await meta(k).query(`.space.slug=${own}`)
    await onPlus(k, first.entity.eid)

    let made = await post(managePath('space'), { title: 'Books', slug: fresh })
    assertEquals(made.status, 303)
    let theirs = `https://yaks.app${managePath('apps', fresh)}`
    assertEquals(made.headers.get('location'), theirs)
    assertEquals(await opens(), mine)

    await post(managePath('profile'), { first: fresh })
    assertEquals(await opens(), theirs)

    let out = await post(LOGOUT, {})
    assertEquals(out.status, 303)
    let cookie = out.headers.get('set-cookie')!.split(';')[0]
    assertEquals(
      new URL((await opens(cookie))!).pathname,
      '/login',
    )
  } finally {
    await k.stop()
  }
})

// Two reports of one throw, as the tracker holds them, are one break.
let chores = { eid: 'a1', slug: 'chores' } as App
let report = (eid: string): Seen => ({
  app: chores,
  hit: {
    kind: 'error',
    entity: { eid },
    error: {
      message: 'chores is not a function',
      at: `2026-10-14T00:0${eid}`,
    },
  },
})
let page = (errors: Plain[]) =>
  library(
    {
      space: 'fixme',
      apps: [
        { eid: 'a1', slug: 'chores', title: 'chores', errors },
        { eid: 'a2', slug: 'notes', title: 'notes' },
      ],
    } as Parameters<typeof library>[0],
    {},
  )

let reports = [report('1'), report('2')]
test('an app that throws is marked on the dashboard, with what to ask', () => {
  let html = page(folds(reports).map(plain))
  // One mark, on the app that broke, linking to what to do about it.
  assertEquals(html.match(/Apps_Tag-warn[^>]*>[^<]*/g)?.length, 1)
  assertMatch(
    html,
    /<strong>chores<\/strong>.*?<a class="Apps_Tag Apps_Tag-warn" href="#fix-chores">1 error<\/a>/s,
  )
  let fix = html.slice(html.indexOf('id="fix-chores"'))
  assertStringIncludes(fix, 'chores is not a function')
  assertStringIncludes(fix, '2 times')
  assertStringIncludes(fix, 'Fix the errors in my chores app on yaks.app')
})

test('a fixed app has no dashboard error mark or repair request', () => {
  assert(!/Apps_Tag-warn|class="Card Fix"/.test(page([])))
})

// The Billing page (T-131895), through the kernel: the space's own allowances.
test('billing shows the space’s allowances', async () => {
  let k = await kernel()
  try {
    let ada = await signIn(k)
    let slug = `b${crypto.randomUUID().slice(0, 6)}`
    let other = await owned(k, ada.person, slug, 'Books')
    let month = new Date().toISOString().slice(0, 7)
    await meta(k).apply([
      { entity: { eid: other }, meter: { month, emails: 30 } },
    ])
    let html = await (await k.at('yaks.app', managePath('billing', slug), {
      headers: { cookie: ada.cookie },
    })).text()
    for (
      let text of [
        'Get the Plus plan for Books — $9 a month',
        'Nothing is billed.',
        '0 of 5',
        '0% used',
        '30 of 100',
      ]
    ) assertStringIncludes(html, text)
  } finally {
    await k.stop()
  }
})

// What the space's Operator made of a break stands beside it (T-136297):
// working, its answer, or why it could not finish, with the way to its work.
test("a break says what the space's Operator made of it", () => {
  let [broke] = folds(reports).map(plain)
  let shown = (operator?: Plain['operator']) => {
    let html = page([{ ...broke, operator }])
    return html.slice(html.indexOf('id="fix-chores"'))
  }
  assert(!shown().includes('The Operator'), 'a break it never heard of')
  assertStringIncludes(shown({}), 'The Operator is fixing it.')
  assertStringIncludes(
    shown({ answer: 'Defined chores and deployed.' }),
    'The Operator: Defined chores and deployed.',
  )
  assertStringIncludes(
    shown({ failed: 'This space has spent its model budget.' }),
    'The Operator could not fix it. This space has spent its model budget.',
  )
  assertStringIncludes(
    shown({}),
    `href="${chatPath('fixme', broke.fix)}"`,
  )
})
