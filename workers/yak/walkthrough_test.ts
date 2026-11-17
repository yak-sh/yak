// The home page's walkthroughs: a recorded conversation's steps
// (walkthrough.ts `stepsOf`), and a served page filled with them
// (`walkedInto`), on the page as home.tsx draws it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { toolEid } from '@yaks/tools/result'
import { type Shown, stepsOf, walkedInto } from './walkthrough.ts'

// A page walking through two apps of two steps each, drawn as home.tsx draws
// one, by hand so the test names its own apps.
let step = (app: string, n: number) =>
  h(
    'li',
    { class: 'Walk_Step', 'data-walk-step': n },
    h('div', { class: 'Walk_Talk', 'data-walk-talk': `${app}/${n}` }),
    h('span', { class: 'Walk_Picture', 'data-walk-shot': `${app}/${n}` }),
  )
let file = renderToString(
  h(
    'main',
    null,
    h(
      'section',
      { class: 'Walk', 'data-walks': '' },
      h(
        'nav',
        null,
        ['menu', 'chores'].map((app) =>
          h('button', { 'data-walk-name': app }, app)
        ),
      ),
      ['menu', 'chores'].map((app, i) =>
        h(
          'article',
          { class: 'Walk_App', 'data-walk': app },
          h('ol', null, step(app, 1), step(app, 2)),
          h(
            'p',
            { class: 'Walk_Next', 'data-walk-next': i ? 'menu' : 'chores' },
            h('a', null, 'next'),
          ),
        )
      ),
    ),
    h('p', { id: 'after' }, 'after'),
  ),
)
let shown = (app: string, n = 2): Shown[] =>
  Array.from({ length: n }, (_, i) => ({
    html: `<p class="said">${app} step ${i + 1}</p>`,
    shot: `https://yaks.app/gallery/image/${app}/${i + 1}`,
  }))
let read = (shows: Record<string, Shown[]>) => {
  let { document } = parseHTML(walkedInto(file, shows))
  let all = (s: string, f: (e: Element) => string | null) =>
    [...document.querySelectorAll(s)].map(f)
  return {
    apps: all('[data-walk]', (e) => e.getAttribute('data-walk')),
    names: all('[data-walk-name]', (e) => e.textContent),
    next: all('[data-walk-next]', (e) => e.getAttribute('data-walk-next')),
    said: all('.said', (e) => e.textContent),
    shots: all('.Walk_Image', (e) => e.getAttribute('src')),
    walk: !!document.querySelector('.Walk'),
    after: !!document.querySelector('#after'),
  }
}

test('each recorded step is filled with its exchange and its picture', () => {
  let got = read({ menu: shown('menu'), chores: shown('chores') })
  assertEquals(got.apps, ['menu', 'chores'])
  assertEquals(got.said, [
    'menu step 1',
    'menu step 2',
    'chores step 1',
    'chores step 2',
  ])
  assertEquals(got.shots.length, 4)
})

test('an app short of a step or a picture is cut, with its name and the links to it', () => {
  let short = shown('chores')
  short[1] = { ...short[1], shot: '' }
  for (let chores of [shown('chores', 1), short, undefined]) {
    let got = read({ menu: shown('menu'), ...chores ? { chores } : {} })
    assertEquals(got.apps, ['menu'])
    assertEquals(got.names, ['menu'])
    assertEquals(got.next, [])
    assertEquals(got.said, ['menu step 1', 'menu step 2'])
  }
})

test('with no app recorded the walkthrough is cut whole, and the rest stays', () => {
  assertEquals(read({}).walk, false)
  assertEquals(read({}).after, true)
})

test('a step that released nothing leaves the app at the release before it', () => {
  let seq = 0
  let at = (rest: object) => ({
    entity: { eid: `e${++seq}` },
    entry: { session: 's', seq },
    ...rest,
  })
  let ask = (body: string) => at({ content: { body } })
  let deploy = (version: number) => [
    at({ call: { to: toolEid('app_deploy'), args: { app: 'guestbook' } } }),
    at({
      result: { call: `e${seq}`, value: { deployed: true, version } },
    }),
  ]
  let steps = stepsOf([
    ask('Text me when someone signs'),
    at({ call: { name: 'subscription_set', args: {} } }),
    ask('A guestbook'),
    ...deploy(1),
    ask('Text me when someone signs'),
    at({ call: { name: 'subscription_set', args: {} } }),
    ask('Add photos'),
    ...deploy(2),
  ], 'guestbook')
  assertEquals(steps.map((s) => s.version), [null, 1, 1, 2])
})
