// App release notices reach the space's people through the Updates page.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { bearerFor, connector, kernel, seed, signIn, unique } from './probe.ts'
import { ADMIN as ADMIN_ACCOUNT } from '@yaks/platform/bots'
import {
  ADMIN,
  chatPath,
  dashboardPath,
  managePath,
  talkPath,
} from '@yaks/platform/routes'
import { REACH } from '@yaks/platform/page-graph'
import { UPDATE_WAITING, waitingCounts } from '@yaks/platform/update-waiting'
import type { Bundle } from '@yaks/graph'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { updates } from './updates.ts'
import { AGAIN, AHEAD } from '@yaks/ui/navigate'
import type { Telling } from './operator-updates.ts'
import { SPACE } from './build-door.ts'

let k = await kernel()
let slug = unique('told')
let { cookie, person, eids } = await seed(k, [{ slug, apps: ['notes'] }])
let other = await signIn(k)
let bot = await signIn(k, ADMIN_ACCOUNT)
await k.dir.apply({
  entities: [other, bot].map((member) => ({
    entity: { eid: crypto.randomUUID() },
    member: { space: eids[slug], person: member.person, role: 'editor' },
  })),
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })

let said = async (as: string) => {
  let page = await k.at('yaks.app', talkPath('updates', slug), {
    headers: { cookie: as },
  })
  return [
    ...parseHTML(await page.text()).document.querySelectorAll(
      '.Update:not(.Update-day) .Update_Words',
    ),
  ].map((p) => p.textContent)
}

let deploy = async (
  caller: ReturnType<typeof connector>,
  title: string,
  message?: string,
) => {
  let app = { space: slug, app: 'notes' }
  await caller.tool('app_files', {
    ...app,
    files: [{ path: 'index.html', content: `<h1>${title}</h1>` }],
  })
  let release = await caller.answer('app_deploy', { ...app, message })
  assertEquals(release.value?.deployed, true)
  await k.settled()
  return await said(other.cookie)
}

let agent = connector(k, undefined, await bearerFor(k, cookie))
let byAgent = await deploy(agent, 'Agent notes', 'Add an agent notes page.')
let byBot = await deploy(
  connector(k, bot.cookie),
  'Bot notes',
  'Add a bot notes page.',
)
let hand = connector(k, cookie)
let unsummarized = await deploy(hand, 'Notes')
let summary = 'Add the meeting notes.'
let described = await deploy(
  hand,
  'Meeting notes',
  `${summary}\n\nThese include attendance from both meetings.`,
)

test('releases by an agent and by the fleet admin make no Update', () => {
  assertEquals(byAgent, [])
  assertEquals(byBot, [])
})

test('a person’s release tells the other members what changed when it has a description', async () => {
  assertEquals(unsummarized, [])
  assertEquals(described, [summary])
  assertEquals(await said(cookie), [])
})

test('an update’s words, and a question that needs the person, are drawn from their Markdown', () => {
  let at = new Date().toISOString()
  let space = { slug: 'told', operator: 'Elihu' } as Space
  let page = parseHTML(renderToString(updates(
    {} as Env,
    space,
    {
      person: '',
      friends: false,
      lists: null,
      news: {
        waiting: 1,
        updates: [
          {
            eid: 'n',
            needs: false,
            unread: false,
            dismissed: false,
            at,
            words: 'Fixed **Chores**:\n\n- `due` dates',
            space,
          },
          {
            eid: 'd',
            needs: true,
            unread: false,
            dismissed: false,
            at,
            words: 'Keep *both*?',
            choices: [],
            space,
          },
        ],
      },
    },
  ))).document
  let drawn = (eid: string, css: string) =>
    page.querySelector(`#u-${eid} .Update_Words ${css}`)?.textContent
  assertEquals(drawn('n', 'strong'), 'Chores')
  assertEquals(drawn('n', 'li code'), 'due')
  assertEquals(drawn('d', 'em'), 'both')
  assertEquals(page.querySelector('#u-n')!.textContent!.includes('**'), false)
})

// Someone in two spaces, the club's and their own: what each space's
// Operator writes them, read together and one space at a time.
let across = async () => {
  let own = (await k.dir.own(other.person))!
  let club = (await k.dir.at(eids[slug]))!
  let get = (path: string, accept = 'text/html', more = {}) =>
    k.at('yaks.app', path, {
      redirect: 'manual',
      headers: { cookie: other.cookie, accept, ...more },
    })
  let waiting = async () => {
    let res = await get(
      `${REACH}/query?q=${encodeURIComponent(UPDATE_WAITING)}`,
      'application/json',
    )
    assertEquals(res.status, 200)
    return Object.fromEntries(waitingCounts(await res.json() as Bundle[]))
  }
  // What the space's own Updates badge says, beside its chat.
  let badge = async (space: Space) => {
    let html = await (await get(chatPath(space.slug))).text()
    let d = parseHTML(html).document
    let conversation = d.querySelector('[data-operator-opening]')
      ?.getAttribute('data-operator-opening')
    if (conversation) {
      let response = await get(conversation)
      assertEquals(response.status, 200)
      html = await response.text()
      d = parseHTML(html).document
    }
    let initial = Number(
      d.querySelector(
        `a[href="${talkPath('updates', space.slug)}"] [data-waiting]`,
      )
        ?.getAttribute('data-waiting'),
    )
    if (!d.querySelector('[data-later]')) return initial
    // The chat can draw while its lists are still being read. Follow the
    // page's lists request and count what the browser adds to the bell.
    let from = html.match(/fetch\("([^"]+lists=1[^"]*)"/)?.[1]
    assert(from, 'the chat tells the browser where to read its lists')
    let response = await get(from, 'application/json')
    assertEquals(response.status, 200)
    return initial + (await response.json()).waiting
  }
  // The Operator telling them, as the kernel brings it (updates.ts `tell`).
  let tell = async (space: Space, telling: Telling) => {
    let res = await k.builder(space.eid).fetch(
      new Request('https://builder/operator/tell', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-yak-kernel': '1',
          [SPACE]: space.eid,
        },
        body: JSON.stringify(telling),
      }),
    )
    assertEquals(res.ok, true)
    await res.body?.cancel()
  }
  return { own, club, get, waiting, badge, tell }
}

test('every space’s Updates in one place: labelled, counted from each space’s own read, and read once seen', async () => {
  let { own, club, get, waiting, badge, tell } = await across()
  await tell(club, { to: other.person, words: 'The club met.' })
  await new Promise((r) => setTimeout(r, 2))
  await tell(own, { to: other.person, words: 'Your barn is up.' })
  let counted = await waiting()
  assertEquals(counted[club.slug] >= 1 && counted[own.slug] >= 1, true)
  assertEquals(counted[club.slug], await badge(club))
  assertEquals(counted[own.slug], await badge(own))
  let retired = await get(`${talkPath('updates')}?waiting`, 'application/json')
  assertEquals(retired.status, 410)
  assertEquals(await waiting(), counted)
  let ahead = await get(talkPath('updates'), 'text/html', {
    [AHEAD]: 'prefetch',
  })
  await ahead.body?.cancel()
  assertEquals(await waiting(), counted, 'a page fetched ahead reads nothing')
  assertEquals(ahead.headers.has(AGAIN), true, 'and asks to be read again')
  let page = parseHTML(await (await get(talkPath('updates'))).text())
    .document
  let cards = [...page.querySelectorAll('.Update')].map((c) => ({
    where: c.querySelector('.Update_Where')?.textContent,
    words: c.querySelector('.Update_Words')?.textContent?.trim(),
    back: c.querySelector('input[name=back]')?.getAttribute('value'),
  }))
  let of = (words: string) => cards.find((c) => c.words == words)
  assertEquals(of('The club met.')?.where?.startsWith(club.title || slug), true)
  assertEquals(of('Your barn is up.')?.where?.startsWith(own.title), true)
  assertEquals(of('Your barn is up.')?.back, talkPath('updates'))
  // The newer first.
  assertEquals(
    cards.findIndex((c) => c.words == 'Your barn is up.') <
      cards.findIndex((c) => c.words == 'The club met.'),
    true,
  )
  assertEquals(await waiting(), { [club.slug]: 0, [own.slug]: 0 })
})

test('All updates sits above the space picker and opens with that space still selected', async () => {
  let { own, club, get } = await across()
  let updates = talkPath('updates', club.slug)
  let page = await (await get(updates)).text()
  let { document } = parseHTML(page)
  let picker = document.querySelector('.Sidebar_Whose')!
  let group = picker.closest('.Sidebar_Space')!
  let badges = [...picker.querySelectorAll('[data-across]')]
    .map((b) => b.getAttribute('data-across'))
  assertEquals(badges.sort(), [club.slug, own.slug].sort())
  assert(page.includes('_inbox-actions'))
  assert(group.closest('[data-side-view]'))
  let all = group.previousElementSibling?.querySelector('a')
  assert(all?.querySelector('[data-across=""]'))
  let current = group.querySelector('[aria-current="page"]')
  assertEquals(current?.getAttribute('href'), updates)
  let links = [...group.querySelectorAll('a.SideNav_Link')].map((a) =>
    a.getAttribute('href')
  )
  assertEquals(links, [
    dashboardPath(club.slug),
    chatPath(club.slug),
    updates,
    `${chatPath(club.slug, 'new')}?app=notes`,
    managePath('operator', club.slug),
  ])
  let acrossPage = parseHTML(
    await (await get(all!.getAttribute('href')!)).text(),
  ).document
  assertEquals(
    acrossPage.querySelector('#menu [aria-current="page"]')
      ?.getAttribute('href'),
    `${talkPath('updates')}?in=${club.slug}`,
  )
  assertEquals(
    acrossPage.querySelector('.Sidebar_Whose .Menu_Item[aria-current="true"]')
      ?.getAttribute('href'),
    dashboardPath(club.slug),
  )
})

test('the chat and All updates sidebars link to Admin only for the platform admin', async () => {
  let link = async (path: string, cookie: string) => {
    let res = await k.at(k.host, path, { headers: { cookie } })
    let { document } = parseHTML(await res.text())
    assertEquals(res.status, 200, path)
    return document.querySelector(`#menu a[href="${ADMIN}"]`)?.textContent
      ?.trim() ?? null
  }
  for (let [person, expected] of [[k.owner, 'Admin'], [other, null]] as const) {
    let own = (await k.dir.own(person.person))!
    for (let path of [chatPath(own.slug), talkPath('updates')]) {
      assertEquals(await link(path, person.cookie), expected, path)
    }
  }
})

test('an address from before the space was in the path still opens that space’s Updates', async () => {
  let { get } = await across()
  let sent = await get(`${talkPath('updates')}?space=${slug}`)
  await sent.body?.cancel()
  assertEquals(
    new URL(sent.headers.get('location')!).pathname,
    talkPath('updates', slug),
  )
})
