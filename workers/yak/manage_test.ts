// A space at the apex (T-39354, T-140507): its address opens a chat with its
// Operator, its settings are behind Manage, reachable whatever app owns its
// front page, and the dashboard's old addresses move there. These requests
// use the browser's cookie and form paths, including the boundaries that keep
// another person, and another page, from changing this account.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
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
import { WAKE } from './door.ts'
import { parseHTML } from 'linkedom'

// One space, built as the file loads: a homepage app, a private one, one to
// discard, and one that held `manage` before the name was reserved.
let k = await kernel()
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
let at = (path: string) =>
  k.at(host, path, { headers: { cookie: them.cookie } })
let to = (path: string) => `https://yaks.app${path}`
let title = async () => {
  let [person] = await dir.query(`.entity.eid=${them.person}&?doc`)
  return (person.doc as { title: string }).title
}
let home = chatPath(slug)
let apps = managePath('apps', slug)
let settings = managePath('settings', slug)
let profile = managePath('profile')

for (let app of ['site', 'private-notes', 'discarded']) {
  await agent.tool('app_new', { space: slug, slug: app, title: app })
}
// `manage` is reserved now (directory.ts RESERVED), and an app that held the
// name before that keeps it: made under another slug, then renamed in the
// directory the way it stood before the reservation.
let held = String(
  (await agent.answer('app_new', { space: slug, slug: 'held', title: 'held' }))
    .value?.eid,
)
await dir.apply([{ entity: { eid: held }, app: { slug: 'manage' } }])
await agent.tool('app_set', { space: slug, app: 'site', home: true })
await agent.tool('app_set', {
  space: slug,
  app: 'private-notes',
  access: 'private',
})
for (
  let [app, page] of [
    ['site', '<!doctype html><h1>My front page</h1>'],
    ['manage', '<!doctype html><h1>My manage app</h1>'],
  ]
) {
  await (await client(k, host, app, them.cookie).put('/index.html', page))
    .body?.cancel()
  await agent.tool('app_deploy', { space: slug, app })
}
let other = await signIn(k)

test('a space’s own address is its apps’, all of it', async () => {
  assertStringIncludes(await (await at('/')).text(), '<h1>My front page</h1>')
  assertStringIncludes(
    await (await at('/manage/')).text(),
    '<h1>My manage app</h1>',
  )
})

test('the apex opens a chat with the space’s Operator, its settings behind Manage', async () => {
  let first = await get(MANAGE)
  assertEquals(first.status, 302)
  assertEquals(first.headers.get('location'), to(home))
  // The space's own address is a new chat with its Operator, as its old
  // address for one still is.
  assertEquals(home, `${MANAGE}/${slug}`)
  for (let path of [home, `${home}/operator/new`]) {
    let landed = await get(path)
    assertEquals(landed.status, 200)
    let { document } = parseHTML(await landed.text())
    assert(document.querySelector('.Talk [data-conversation]'), path)
    assertEquals(
      [...document.querySelectorAll('a')].find((a) => a.textContent == 'Manage')
        ?.getAttribute('href'),
      apps,
    )
  }
  assertStringIncludes(
    await (await get(apps)).text(),
    `href="https://${host}/private-notes/"`,
  )
  assertEquals((await get(`${MANAGE}/${slug}/missing`)).status, 404)
  let login = await k.at('yaks.app', MANAGE, { redirect: 'manual' })
  assertEquals(login.status, 303)
  assertEquals(
    new URL(login.headers.get('location')!).searchParams.get('return'),
    to(MANAGE),
  )
  await login.body?.cancel()
})

// The chat asks the space's Operator before anything, so the page that sends
// a person there wakes it as it answers, as does every other page of the
// space they may open the chat from (build-door.ts `woken`).
test('the apex and a space’s pages wake its Operator for the chat opened next', async () => {
  let builder = k.builder((await k.dir.space(slug))!.eid)
  let woke = 0
  let fetch = builder.fetch.bind(builder)
  builder.fetch = (r) => (new URL(r.url).pathname == WAKE && woke++, fetch(r))
  let woken = async (path: string, cookie?: string) => {
    let before = woke
    await (await get(path, cookie)).body?.cancel()
    await k.settled()
    return woke - before
  }
  assertEquals(
    [await woken(MANAGE), await woken(apps), await woken(MANAGE, '')],
    [1, 1, 0],
  )
})

// Where the dashboard was, letters and answers still send people: each page
// moves to its own, the space in the path, the rest of the query kept, and a
// form posted there kept a form.
test('the dashboard’s old addresses move to their pages', async () => {
  let billing = `/manage/${slug}/billing?paid=1`
  for (
    let [from, was, now, method] of [
      [host, '/_yaks', home],
      [host, '/_yaks/', home],
      [host, '/_yaks/billing?paid=1', billing],
      ['yaks.app', `/manage/billing?space=${slug}&paid=1`, billing],
      ['yaks.app', '/manage/settings', `/manage/${slug}/settings`],
      ['yaks.app', '/manage/connect', managePath('agents')],
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
})

test('an icon linked from the setup page downloads from the apex', async () => {
  let setup = await (await get(managePath('agents'))).text()
  let icon = new URL(/href="([^"]+)" download="yaks-app.png"/.exec(setup)![1])
  let download = await k.at(icon.hostname, icon.pathname)
  assertEquals(
    download.headers.get('content-disposition'),
    'attachment; filename="yaks-app.png"',
  )
  assert((await download.arrayBuffer()).byteLength < 10_000)
})

test('the name is the person’s, saved on their Profile', async () => {
  let named = await post(profile, { name: 'Dana' })
  assertEquals(named.status, 303)
  assertEquals(named.headers.get('location'), to(`${profile}?saved=1`))
  assertEquals(await title(), 'Dana')
  let confirmed = await (await get(`${profile}?saved=1`)).text()
  assertStringIncludes(confirmed, 'role="status"')
  assertStringIncludes(confirmed, 'value="Dana"')
})

// The side collapses to a rail of its icons (T-151458): the choice is the
// person's, kept on their row, so every settings page of theirs draws it;
// each icon keeps its name as its title and its words. The chat's menu is
// behind its bar's button, so it has no rail.
test('the side collapses to its icons on every settings page, and opens again', async () => {
  let fold = (sidebar: string, back: string, accept = 'text/html') =>
    k.at('yaks.app', profile, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: them.cookie,
        origin: 'https://yaks.app',
        accept,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ sidebar, back }),
    })
  let drawn = async (path: string) =>
    parseHTML(await (await get(path)).text()).document
  let people = managePath('people', slug)
  let folded = await fold('collapsed', people)
  assertEquals(folded.status, 303)
  assertEquals(folded.headers.get('location'), to(people))
  for (
    let [path, rail] of [
      [people, 'Desk-rail'],
      [profile, 'Desk-rail'],
    ]
  ) {
    let page = await drawn(path)
    assert(page.body.classList.contains(rail), path)
    let links = [...page.querySelectorAll('#menu .SideNav_Link')]
    assert(links.length > 3, path)
    for (let a of links) {
      let label = a.querySelector('.SideNav_Label')?.textContent
      assert(a.closest('.SideNav')!.classList.contains('SideNav-rail'), label)
      assert(a.querySelector('.Icon, img'), `${label} has an icon`)
      assertEquals(a.getAttribute('title'), label)
    }
    let button = page.querySelector('#menu .Sidebar_Folder')!
    assertEquals(button.getAttribute('aria-expanded'), 'false')
    assertEquals(button.getAttribute('aria-label'), 'Expand the sidebar')
  }
  // As the page's script sends it: kept, and nothing more drawn.
  let opened = await fold('open', people, '*/*')
  assertEquals(opened.status, 204)
  let page = await drawn(people)
  assert(!page.body.classList.contains('Desk-rail'))
  assertEquals(page.querySelector('#menu .SideNav-rail'), null)
  // A form never sends the person off these pages.
  for (let back of ['https://elsewhere.test/manage', '/help']) {
    assertEquals(
      (await fold('open', back)).headers.get('location'),
      to(profile),
    )
  }
})

// The space's Settings: its address and homepage, its name, and the way to
// delete it; none of it the person's own name.
test('a space’s Settings save its address and its name', async () => {
  let name = await title()
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
  await post(settings, { title: 'Peterson Reunion 2027', space: slug })
  assertStringIncludes(
    await (await get(settings)).text(),
    'name="title" maxlength="60" value="Peterson Reunion 2027"',
  )
  assertEquals(await title(), name)
})

test('a deleted app comes back from the Trash', async () => {
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
})

test('selling stops from its page', async () => {
  let selling = managePath('selling', slug)
  let stopped = await post(selling, { sell: 'stop' })
  assertEquals(stopped.headers.get('location'), to(selling))
})

// An Operator conversation opens in its chat app. Its side holds the space's
// apps, each opening a chat about it with the app beside it, and Updates
// opens beside it.
test('the chat’s side opens each app beside it, and Updates', async () => {
  let chat = await get(home)
  assertEquals(chat.status, 200)
  let chatted = await chat.text()
  assertStringIncludes(chatted, 'class="Talk Talk-beside"')
  assertStringIncludes(chatted, `href="${home}?app=site"`)
  let about = await (await get(`${home}?app=site`)).text()
  assertEquals(
    parseHTML(about).document.querySelector('iframe[data-frame=live]')
      ?.getAttribute('src'),
    `https://${host}/site/`,
  )
  let updates = await get(managePath('updates', slug))
  assertEquals(updates.status, 200)
  assertStringIncludes(await updates.text(), 'aria-current="page"')
})

// Somebody else, naming this space, is shown nothing of it, and `/manage`
// opens their own. Nobody but its owner moves the space, and no other page
// names them.
test('nobody else sees or changes the space', async () => {
  let signedOut = await get(settings, '')
  assertEquals(signedOut.status, 303)
  let back = new URL(signedOut.headers.get('location')!)
  assertEquals(back.searchParams.get('return'), to(settings))
  for (let view of ['apps', 'settings', 'trash'] as const) {
    let hidden = await get(managePath(view, slug), other.cookie)
    assertEquals(hidden.status, 404)
    assert(!(await hidden.text()).includes('private-notes'))
  }
  assertEquals((await get(home, other.cookie)).status, 404)
  assertEquals(
    (await get(managePath('updates', slug), other.cookie)).status,
    404,
  )
  assertEquals(
    (await get(MANAGE, other.cookie)).headers.get('location'),
    to(chatPath(other.email.split('@')[0])),
  )
  let name = await title()
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
  assertEquals(await title(), name)
  assertStringIncludes(await (await at('/')).text(), '<h1>My front page</h1>')
})

// The person's own pages: a new space, the one they open first, and signing
// out, each through the form its page posts.
test('a person makes a space, opens it first, and signs out', async () => {
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
  let mine = `https://yaks.app${chatPath(own)}`
  assertEquals(await opens(), mine)
  // Her one free space on the Plus plan makes room for another.
  let [first] = await meta(k).query(`.space.slug=${own}`)
  await onPlus(k, first.entity.eid)

  let made = await post(managePath('space'), { title: 'Books', slug: fresh })
  assertEquals(made.status, 303)
  let theirs = `https://yaks.app${chatPath(fresh)}`
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
})

// The Billing page (T-131895), through the kernel: the space's own allowances.
test('billing shows the space’s allowances', async () => {
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
})

test('old connection detail links redirect to hashes without losing search or testing context', async () => {
  for (let key of ['add', 'connect']) {
    let response = await get(
      `${managePath('connections', slug)}?${key}=hubspot&enable=hubspot&q=crm`,
    )
    assertEquals(response.status, 303)
    assertEquals(
      response.headers.get('location'),
      to(`${managePath('connections', slug)}?enable=hubspot&q=crm#hubspot`),
    )
  }
})

test('a connection detail fetch returns the service modal at the existing page door', async () => {
  let response = await get(
    `${managePath('connections', slug)}?detail=openrouter`,
  )
  assertEquals(response.status, 200)
  let { document } = parseHTML(await response.text())
  let dialog = document.querySelector('dialog[data-modal-key="openrouter"]')!
  assert(dialog)
  assert(dialog.querySelector('.Modal_Body'))
  assertStringIncludes(dialog.textContent!, 'OpenRouter')
})
