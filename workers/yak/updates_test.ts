// A change to an app reaches the space's other people in their Updates
// (updates.ts), through the kernel's own doors: the connector deploys, and
// the Updates page says who changed what.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { connector, kernel, seed, signIn, unique } from './probe.ts'
import { managePath } from '@yaks/platform/routes'
import { renderToString } from 'preact-render-to-string'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { lastDayLine, updates } from './updates.ts'

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
  let page = await k.at('yaks.app', managePath('updates', slug), {
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

test('the last day in a line: visits, the busiest app, and what needs the person', () => {
  let apps = ['Recipe box', 'Chores', 'Book club']
    .map((title, i) => ({ eid: `a${i}`, slug: `a${i}`, title }))
  let line = (views: [string, number][] | undefined, needs = 0, of = apps) =>
    lastDayLine(of, views && new Map(views), needs)
  assertEquals(
    line([['a0', 70], ['a1', 16]], 1),
    'In the last day, your apps had 86 visits. Recipe box was the busiest. One thing needs you.',
  )
  assertEquals(
    line([['a2', 1]]),
    'In the last day, your apps had 1 visit. Nothing needs you.',
  )
  assertEquals(
    line([], 3),
    'Nobody visited your apps in the last day. Three things need you.',
  )
  // Visits not switched on, or no apps to count: what needs them alone.
  assertEquals(line(undefined, 12), '12 things need you.')
  assertEquals(line([['a0', 5]], 0, []), 'Nothing needs you.')
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
          at,
          words: 'Fixed **Chores**:\n\n- `due` dates',
        },
        {
          eid: 'd',
          needs: true,
          unread: false,
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
