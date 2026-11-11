// The page over the box's own doors: a host composed in this process serves
// the deck and takes the taps, and the page runs on a linkedom document.

import { equal, ok, test, until } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { parseHTML } from 'linkedom'
import { mount } from './page.ts'
import { load } from './round.ts'
import { PAGE } from './routes.ts'
import type { RoundFile } from './skill.ts'

// deno-lint-ignore no-explicit-any
type Any = any

let attempt = (variant: string, headline: string) => ({
  key: `office.${variant}.blank.1`,
  case: 'office',
  variant,
  persona: false,
  output: {
    headline,
    brief: `${headline} in brief.`,
    more: `${headline} at length.`,
  },
})
let file: RoundFile = {
  key: 'r1',
  title: 'Round one',
  skill: 'copy',
  output: ['headline', 'brief', 'more'],
  variants: ['none', 'plain', 'story'].map((key) => ({
    key,
    title: key,
    body: key,
  })),
  cases: [{ key: 'office', title: 'The office', body: 'facts' }],
  attempts: [
    attempt('none', 'A'),
    attempt('plain', 'B'),
    attempt('story', 'C'),
  ],
  pairs: [
    ['office.none.blank.1', 'office.plain.blank.1'],
    ['office.plain.blank.1', 'office.story.blank.1'],
  ],
}

let open = async () => {
  let host = await compose(
    {
      db: ':memory:',
      person: 'the-owner',
      plugins: [
        '@yaks/kernel',
        '@yaks/provenance',
        '@yaks/id',
        '@yaks/key',
        '@yaks/alias',
        '@yaks/doc',
        '@yaks/api',
        '@yaks/web',
        '@yaks/model',
        '@yaks/trial',
      ],
    },
    ['graph', 'web'],
    undefined,
    { process: false },
  )
  let [owner] = await host.graph.apply([{
    entity: { eid: '$owner' },
    alias: { name: 'the-owner' },
    doc: { title: 'The owner' },
  }])
  await load(host.graph, file)
  let kept = new Map<string, string>()
  let visit = async () => {
    let { document, Event } = parseHTML(PAGE) as Any
    let main = document.querySelector('main')!
    fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }))
    let n = 0
    await mount(main, {
      fetch: (input, init) =>
        Promise.resolve(
          host.handler!(new Request(`http://box${input}`, init)),
        ),
      path: '/trial/r1',
      store: {
        getItem: (k) => kept.get(k) ?? null,
        setItem: (k, v) => void kept.set(k, v),
        removeItem: (k) => void kept.delete(k),
      },
      uuid: () => crypto.randomUUID(),
      later: () => ++n,
    })
    return main as Any
  }
  let rows = async (comp: string): Promise<Any[]> =>
    await host.graph.read(`.${comp} *`)
  return { host, owner: owner.entity.eid, visit, rows }
}

// The page's own Event, set as it is visited: linkedom dispatches no other.
let fire: (el: Any, type: string) => void = () => {}
let tap = (el: Any) => fire(el, 'click')
let some = (read: () => Promise<Any[]>): Promise<Any[]> =>
  until(async () => {
    let all = await read()
    return all.length ? all : undefined
  })
let headlines = (main: Any) =>
  [...main.querySelectorAll('.pitch h2')].map((h: Any) => h.textContent)

test('a tap on the page is a row the owner wrote, and the page comes back to where they were', async () => {
  let { host, owner, visit, rows } = await open()
  try {
    let main = await visit()
    equal(main.querySelector('.place').textContent, '1 of 2 · Round one')
    equal(main.querySelector('.about').textContent, 'The office')
    equal(headlines(main).sort(), ['A', 'B'])
    ok(!/none|plain|story/.test(main.textContent))
    ok(main.querySelector('.more').hasAttribute('hidden'))

    let [first, second] = main.querySelectorAll('.pitch')
    let chosen = second.querySelector('h2').textContent
    tap(second.querySelector('.grab'))
    main.querySelector('.why').value = 'says who it is for'
    fire(main.querySelector('.why'), 'input')
    tap(main.querySelectorAll('.pitch')[1].querySelector('h2'))
    equal(main.querySelector('.place').textContent, '2 of 2 · Round one')

    let [p] = await some(() => rows('preference'))
    equal(p.created.by, owner)
    equal(p.preference, {
      first: first.getAttribute('data-eid'),
      second: second.getAttribute('data-eid'),
      chose: second.getAttribute('data-eid'),
      why: 'says who it is for',
    })
    let [g] = await some(() => rows('grabbed'))
    equal([g.created.by, g.grabbed.attempt], [owner, p.preference.chose])

    tap(main.querySelector('.neither'))
    await until(async () => (await rows('preference')).length == 2)
    equal(main.querySelector('.done').textContent, 'That is all 2. 0 skipped.')

    tap(main.querySelector('.back'))
    tap(main.querySelector('.add'))
    let form = main.querySelector('form')
    form.querySelector('[name=headline]').value = 'Mine'
    fire(form, 'submit')
    let [mine] = await some(async () =>
      (await rows('writing')).filter((w) => !w.writing.variant)
    )
    equal(mine.created.by, owner)
    equal(mine.writing.output.headline, 'Mine')
    await until(() => main.querySelector('.place').textContent.includes('of 5'))

    let again = await visit()
    equal(again.querySelector('.place').textContent, '3 of 5 · Round one')
    ok(headlines(again).includes('Mine'))
    tap(again.querySelector('.back'))
    tap(again.querySelector('.back'))
    equal(again.querySelector('.pitch.chosen h2').textContent, chosen)
    equal(
      again.querySelector('.why').getAttribute('value'),
      'says who it is for',
    )
    tap(again.querySelector('.pitch.chosen .grab'))
    await until(async () => (await rows('grabbed')).length == 0)
  } finally {
    await host.close()
  }
})
