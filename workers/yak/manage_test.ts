// A space at the apex (T-39354, T-140507): its address opens a chat with its
// Operator, its settings are behind Manage, reachable whatever app owns its
// front page, and the dashboard's old addresses move there. These requests
// use the browser's cookie and form paths, including the boundaries that keep
// another person, and another page, from changing this account.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  client,
  connector,
  fresh,
  kernel,
  meta,
  onPlus,
  owned,
  saveAccount,
  signIn,
  spaceAct,
} from './probe.ts'
import {
  chatPath,
  LOGOUT,
  MANAGE,
  managePath,
  talkPath,
} from '@yaks/platform/routes'
import { WAKE } from './door.ts'
import { CHAT, WHO } from '@yaks/platform/site-nav'
import { system } from '@yaks/fp'
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

test('the apex opens a chat with the space’s Operator, whose Manage opens its settings', async () => {
  let first = await get(MANAGE)
  assertEquals(first.status, 302)
  assertEquals(first.headers.get('location'), to(home))
  // The space's own address is a new chat with its Operator, and Manage its
  // settings (D-473).
  assertEquals(home, `/${slug}`)
  let landed = await get(home)
  assertEquals(landed.status, 200)
  let { document } = parseHTML(await landed.text())
  assert(document.querySelector('.Talk [data-conversation]'))
  assertEquals(
    [...document.querySelectorAll('a')].find((a) => a.textContent == 'Manage')
      ?.getAttribute('href'),
    apps,
  )
  assertStringIncludes(
    await (await get(apps)).text(),
    `href="https://${host}/private-notes/"`,
  )
  assertEquals((await get(`${MANAGE}/${slug}/missing`)).status, 404)
  // A name no space holds is nothing, and none may take a name the apex
  // serves a page at.
  assertEquals((await get('/no-such-space')).status, 404)
  assertEquals((await get(`/${slug}/apps`)).status, 404)
  await assertRejects(
    () => agent.answer('space_new', { slug: 'gallery', title: 'Gallery' }),
    Error,
    'kept for yaks.app itself',
  )
  let login = await k.at('yaks.app', MANAGE, { redirect: 'manual' })
  assertEquals(login.status, 303)
  assertEquals(
    new URL(login.headers.get('location')!).searchParams.get('return'),
    to(MANAGE),
  )
  await login.body?.cancel()
})

let wakeProbe = async () => {
  let now = Date.now()
  let site = await fresh({}, (env) => {
    env.CLOCK = { ...system, now: () => now }
  })
  let person = await signIn(site)
  let slug = person.email.split('@')[0]
  let builder = site.builder((await site.dir.space(slug))!.eid)
  await site.settled()
  let wakes = 0
  let fetch = builder.fetch.bind(builder)
  builder.fetch = (r) => (new URL(r.url).pathname == WAKE && wakes++, fetch(r))
  let cool = () => void (now += 10_000)
  cool() // Let the sign-in redirect's wake expire.
  return {
    slug,
    cool,
    wakes: () => wakes,
    ask: async (path: string, cookie = person.cookie) => {
      let answer = await site.at('yaks.app', path, {
        redirect: 'manual',
        headers: { cookie },
      })
      await site.settled()
      return answer
    },
  }
}

test('the apex and a space’s pages share a speculative Operator wake', async () => {
  let { slug, ask, cool, wakes } = await wakeProbe()
  let apps = managePath('apps', slug)
  await (await ask(MANAGE)).body?.cancel()
  await (await ask(apps)).body?.cancel()
  assertEquals(wakes(), 1)
  cool()
  await (await ask(MANAGE, '')).body?.cancel()
  assertEquals(wakes(), 1)
  await (await ask(apps)).body?.cancel()
  assertEquals(wakes(), 2)
})

test('the home sign-in check opts into waking only the signed-in Operator', async () => {
  let { slug, ask, wakes } = await wakeProbe()
  let who = async (path: string, cookie?: string) => {
    let { signedIn, chat } = await (await ask(path, cookie)).json()
    return { signedIn, chat, wakes: wakes() }
  }
  let opening = `${WHO}?${CHAT}`
  assertEquals(await who(opening, ''), {
    signedIn: false,
    chat: undefined,
    wakes: 0,
  })
  assertEquals(await who(WHO), {
    signedIn: true,
    chat: undefined,
    wakes: 0,
  })
  assertEquals(await who(opening), {
    signedIn: true,
    chat: chatPath(slug),
    wakes: 1,
  })
})

// Where the dashboard was, letters and answers still send people: each page
// moves to its own, the space in the path, the rest of the query kept, and a
// form posted there kept a form.
let ID = '0b5e6a52-3c1d-4f2e-9a8b-7c6d5e4f3a2b'
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
      // The Operator's pages moved to the space's own address (D-473).
      ['yaks.app', `/manage/${slug}?app=site`, `${home}?app=site`],
      ['yaks.app', `/manage/${slug}/operator/new`, home],
      ['yaks.app', `/manage/${slug}/operator/${ID}`, `${home}/${ID}`],
      ['yaks.app', `/manage/${slug}/updates`, `${home}/updates`, 'POST'],
      ['yaks.app', '/manage/updates?waiting', '/updates?waiting'],
      ['yaks.app', `/manage/updates?space=${slug}`, `/updates?space=${slug}`],
      ['yaks.app', `/updates?space=${slug}`, `${home}/updates`],
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
  let named = await saveAccount(k, them, { name: 'Dana' })
  assertEquals(named.status, 200)
  assertEquals((await named.json())[0].account.name, 'Dana')
  assertEquals(await title(), 'Dana')
  assertStringIncludes(await (await get(profile)).text(), 'value="Dana"')
})

// The side collapses to a rail of its icons (T-151458): the choice is the
// person's, kept on their row, so every settings page of theirs draws it;
// each icon keeps its name as its title and its words. The Operator's page
// draws the same side, folded the same.
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
  for (let path of [people, profile, chatPath(slug)]) {
    let page = await drawn(path)
    assert(page.querySelector('#menu.Sidebar-rail'), path)
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
  assertEquals(page.querySelector('#menu.Sidebar-rail'), null)
  assertEquals(page.querySelector('#menu .SideNav-rail'), null)
  // A form never sends the person off these pages.
  for (let back of ['https://elsewhere.test/manage', '/help']) {
    assertEquals(
      (await fold('open', back)).headers.get('location'),
      to(profile),
    )
  }
})

// What sits at the right of the conversation (frame.ts `Aside`) is put away
// and opened again by its toggle: the choice is the person's, kept on their
// row, so every page of theirs draws it so.
test('the aside is put away and opened again, and every page keeps it', async () => {
  let toggle = (aside: string, back: string) =>
    k.at('yaks.app', profile, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: them.cookie,
        origin: 'https://yaks.app',
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ aside, back }),
    })
  let chat = chatPath(slug)
  let drawn = async () => {
    let { document } = parseHTML(await (await get(chat)).text())
    let button = document.querySelector('.Frame_Bar .Frame_AsideFolder')!
    return [
      document.querySelector('#aside')!.closest('.Shell')!.classList
        .contains('Shell-shut'),
      button.getAttribute('aria-expanded'),
      button.getAttribute('aria-label'),
    ]
  }
  assertEquals(await drawn(), [false, 'true', 'Hide the conversation panel'])
  let shut = await toggle('shut', chat)
  assertEquals(shut.status, 303)
  assertEquals(shut.headers.get('location'), to(chat))
  assertEquals(await drawn(), [true, 'false', 'Show the conversation panel'])
  await toggle('open', chat)
  assertEquals(await drawn(), [false, 'true', 'Hide the conversation panel'])
})

// The space's Settings: its address and homepage, its name, and the way to
// delete it; none of it the person's own name.
test('a space’s Settings save its address and its name through the page graph', async () => {
  let name = await title()
  let space = (await dir.query(`.space.slug=${slug}`))[0].entity.eid
  let page = await (await get(settings)).text()
  assertStringIncludes(page, `data-save="${settings}"`)
  assertStringIncludes(page, `href="https://yaks.app/space/${slug}/delete"`)
  assertStringIncludes(page, `href="${managePath('trash', slug)}"`)
  let save = (change: Record<string, unknown>) =>
    spaceAct(k, them, space, { spaceSettings: change })
  assertEquals((await save({ slug })).status, 200)
  let refused = await save({ slug: 'Not An Address' })
  assertEquals(refused.status, 400)
  assertStringIncludes((await refused.json()).message, 'lowercase letters')
  await save({ title: 'Peterson Reunion 2027', slug })
  assertStringIncludes(
    await (await get(settings)).text(),
    'name="title" maxlength="60" value="Peterson Reunion 2027"',
  )
  assertEquals(await title(), name)
  // The posts the page no longer makes are no page's.
  assertEquals((await post(settings, { title: 'Posted' })).status, 404)
})

test('a deleted app comes back from the Trash', async () => {
  let discarded = (await dir.query('.app.slug=discarded'))[0].entity.eid
  let space = (await dir.query(`.space.slug=${slug}`))[0].entity.eid
  await agent.tool('app_delete', { space: slug, app: 'discarded' })
  let trash = managePath('trash', slug)
  assertStringIncludes(
    await (await get(trash)).text(),
    `data-restore="${discarded}"`,
  )
  await agent.tool('app_new', { space: slug, slug: 'discarded', title: 'New' })
  let restored = await spaceAct(k, them, space, {
    restoreBinned: { item: discarded },
  })
  assertEquals(restored.status, 200)
  assertStringIncludes(
    (await restored.json())[0].restoreBinned.said,
    'Its previous address was /discarded/; it is now /discarded-2/.',
  )
  assertStringIncludes(
    await (await get(apps)).text(),
    `href="https://${host}/discarded-2/"`,
  )
})

// An Operator conversation opens in its chat app. Its side holds the space's
// apps, each opening a chat about it with the app beside it, and Updates
// opens beside it.
test('the chat’s side opens each app beside it, and Updates', async () => {
  let chat = await get(home)
  assertEquals(chat.status, 200)
  assertStringIncludes(await chat.text(), `href="${home}?app=site"`)
  let about = await (await get(`${home}?app=site`)).text()
  assertEquals(
    parseHTML(about).document.querySelector('iframe[data-frame=live]')
      ?.getAttribute('src'),
    `https://${host}/site/`,
  )
  let updates = await get(talkPath('updates', slug))
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
    (await get(talkPath('updates', slug), other.cookie)).status,
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

  await saveAccount(k, ada, { first: fresh })
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
      'Nothing is billed.',
      '0 of 5',
      'Models and voice',
      'from this space’s budget',
      '0% used',
      '30 of 100',
    ]
  ) assertStringIncludes(html, text)
  assert(!html.includes('Built-in builds'))
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

// The platform's own space is a seat like any other to its owner: the side's
// selector offers it, as the admin's directory lists it, and its pages open.
test('the yak space’s owner finds it in the selector, and its pages open', async () => {
  let page = parseHTML(await (await get(profile, k.owner.cookie)).text())
  let offered = [...page.document.querySelectorAll('.Sidebar_Whose a')]
    .map((a) => a.getAttribute('href'))
  assert(offered.includes(`${profile}?space=yak`), String(offered))
  for (let path of [chatPath('yak'), managePath('settings', 'yak')]) {
    let res = await get(path, k.owner.cookie)
    assertEquals(res.status, 200, path)
    await res.body?.cancel()
  }
})

test('every manage page’s side lists the same entries', async () => {
  // Selling shows only where the platform takes sellers, as a kernel with a
  // key for its payment provider does.
  let sells = await fresh({ STRIPE_KEY: 'sk_test_side' })
  let { cookie, email } = await signIn(sells)
  let side = async (path: string) => {
    let res = await sells.at('yaks.app', path, { headers: { cookie } })
    let { document } = parseHTML(await res.text())
    return [...document.querySelectorAll('[aria-labelledby="side-space"] a')]
      .map((a) => a.textContent?.trim())
  }
  let space = await side(managePath('settings', email.split('@')[0]))
  assert(space.includes('Selling'), String(space))
  assertEquals(await side(managePath('profile')), space)
})
