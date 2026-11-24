// A change to an app reaches the space's other people in their Updates
// (updates.ts), through the kernel's own doors: the connector deploys, and
// the Updates page says who changed what.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { connector, kernel, seed, signIn, unique } from './probe.ts'
import { ADMIN, chatPath, managePath, talkPath } from '@yaks/platform/routes'
import { renderToString } from 'preact-render-to-string'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { lastDayLine, updates } from './updates.ts'
import { AHEAD } from '@yaks/ui/navigate'
import type { Telling } from './operator-updates.ts'
import { SPACE } from './build-door.ts'

let k = await kernel()
let slug = unique('told')
let { cookie, person, eids } = await seed(k, [{ slug, apps: ['notes'] }])
let other = await signIn(k)
await k.dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: { space: eids[slug], person: other.person, role: 'editor' },
  }],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let agent = connector(k, cookie)
await agent.tool('app_files', {
  space: slug,
  app: 'notes',
  files: [{ path: 'index.html', content: '<h1>Notes</h1>' }],
})
await agent.tool('app_deploy', { space: slug, app: 'notes' })
await k.settled()

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

test('a change to an app tells the space’s other people, and not who made it', async () => {
  let words = await said(other.cookie)
  assertEquals(words.length, 1)
  assertEquals(words[0]!.endsWith(' changed notes.'), true)
  assertEquals(await said(cookie), [])
})

test('the last day in a line: visits and the busiest app', () => {
  let apps = ['Recipe box', 'Chores', 'Book club']
    .map((title, i) => ({ eid: `a${i}`, slug: `a${i}`, title }))
  let line = (views: [string, number][] | undefined, of = apps) =>
    lastDayLine(of, views && new Map(views))
  assertEquals(
    line([['a0', 70], ['a1', 16]]),
    'In the last day, your apps had 86 visits. Recipe box was the busiest.',
  )
  assertEquals(line([['a2', 1]]), 'In the last day, your apps had 1 visit.')
  assertEquals(line([]), 'Nobody visited your apps in the last day.')
  // Visits not switched on, or no apps to count: nothing to say.
  assertEquals(line(undefined), '')
  assertEquals(line([['a0', 5]], []), '')
})

test('an update’s words, and a question that needs the person, are drawn from their Markdown', () => {
  let at = new Date().toISOString()
  let page = parseHTML(renderToString(updates(
    {} as Env,
    { slug: 'told', operator: 'Elihu' } as Space,
    {
      waiting: 1,
      updates: [
        {
          eid: 'n',
          needs: false,
          unread: false,
          dismissed: false,
          at,
          words: 'Fixed **Chores**:\n\n- `due` dates',
        },
        {
          eid: 'd',
          needs: true,
          unread: false,
          dismissed: false,
          at,
          words: 'Keep *both*?',
          choices: [],
        },
      ],
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
  let waiting = async () =>
    await (await get(`${talkPath('updates')}?waiting`, 'application/json'))
      .json() as Record<string, number>
  // What the space's own Updates badge says, beside its chat.
  let badge = async (space: Space) => {
    let d = parseHTML(await (await get(chatPath(space.slug))).text()).document
    return Number(
      d.querySelector(
        `a[href="${talkPath('updates', space.slug)}"] [data-waiting]`,
      )
        ?.getAttribute('data-waiting'),
    )
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
  let ahead = await get(talkPath('updates'), 'text/html', {
    [AHEAD]: 'prefetch',
  })
  await ahead.body?.cancel()
  assertEquals(await waiting(), counted, 'a page fetched ahead reads nothing')
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
  assertEquals(badges.sort(), ['', club.slug, own.slug].sort())
  assertEquals(page.includes(`${talkPath('updates')}?waiting`), true)
  let all = group.previousElementSibling?.querySelector('a')
  assert(all?.querySelector('[data-across=""]'))
  let current = group.querySelector('[aria-current="page"]')
  assertEquals(current?.getAttribute('href'), updates)
  let links = [...group.querySelectorAll('a.SideNav_Link')].map((a) =>
    a.getAttribute('href')
  )
  assertEquals(links, [
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
    chatPath(club.slug),
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
