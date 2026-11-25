// The app beside the chat drawn again from the page graph as its rows move:
// what it is made of filling in, the person's pick kept until a newer stage
// is reached, and a rename made elsewhere.
import { equal, test } from '@yaks/testing'
import { bindCanvas } from './app-canvas-browser.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  lines,
  made,
  page,
  RECIPES,
  released,
  settled,
  view,
} from './app-canvas_fixture_test.ts'
import { appMaking, type Making, makingRow } from './app-canvas.ts'
import { appRows, sideApps } from './side-rows.ts'
import type { MarkedApp } from './routes.ts'

let bound = (app: MarkedApp = RECIPES, making?: Making) => {
  let root = page(view(app))
  let g = graph(() => Promise.resolve([]))
  for (let [line, held] of lines([app], making)) g.set(line, held)
  bindCanvas(root, g)
  settled(root)
  let making_ = (next: Making) =>
    g.set(appMaking(app.eid), [makingRow('ada-person', app.eid, next)])
  let renamed = (next: MarkedApp) =>
    g.set(sideApps('plum-space'), appRows('ada-person', 'plum-space', [next]))
  let on = (name: string) =>
    [...root.querySelectorAll<HTMLInputElement>(`[name=${name}]`)]
      .find((i) => i.checked)?.value
  let stage = () => on('made')
  // The person's pick, which unchecks the rest as a browser does.
  let pick = (id: string) => {
    for (let i of root.querySelectorAll<HTMLInputElement>('[name=made]')) {
      i.checked = i.value == id
    }
  }
  let names = (part: string) =>
    [...root.querySelectorAll(`[data-part=${part}] .Rows_Name`)].map((e) =>
      e.textContent
    )
  return { root, making: making_, renamed, stage, on, pick, names }
}

test('what an app is made of fills in as the page graph brings it, and the stage is no longer busy', () => {
  let c = bound()
  equal(c.root.querySelector('.Talk_Stage')?.getAttribute('aria-busy'), 'true')
  c.making(made(['Recipe']))
  equal(c.names('keeps'), ['Recipe'])
  equal(c.root.querySelector('.Talk_Stage')?.hasAttribute('aria-busy'), false)
})

test("the person's pick stays as the Operator works, until a newer stage is reached", () => {
  let c = bound(RECIPES, made(['Recipe']))
  c.pick('does')
  c.making(made(['Recipe', 'Meal']))
  equal([c.stage(), c.names('keeps')], ['does', ['Recipe', 'Meal']])
  let draft = 'https://plum.yaks.app/recipes/~abcdefabcdef/'
  c.making(made(['Recipe', 'Meal'], draft))
  equal(c.stage(), 'preview')
  equal(c.root.querySelector('iframe')?.getAttribute('src'), draft)
})

test('renamed or released elsewhere, the app redraws without a reload', () => {
  let c = bound(RECIPES, made(['Recipe']))
  c.renamed(released({ ...RECIPES, title: 'Family recipes' }))
  equal(
    c.root.querySelector('.Identity_Text b')?.textContent,
    'Family recipes',
  )
  equal(c.stage(), 'preview')
  equal(
    c.root.querySelector('[data-frame=live]')?.getAttribute('src'),
    'https://plum.yaks.app/recipes/',
  )
})

test('a draft arriving beside a live app leaves the live app loaded', () => {
  let c = bound(released(), made(['Recipe']))
  let live = c.root.querySelector('[data-frame=live]')
  c.making(made(['Recipe'], 'https://plum.yaks.app/recipes/~abcdefabcdef/'))
  equal(c.root.querySelector('[data-frame=live]') === live, true)
  equal(
    [...c.root.querySelectorAll('iframe')].map((f) => f.dataset.frame),
    ['draft', 'live'],
  )
})

test('a page shown from Commands brings Preview and its frame forward', () => {
  let c = bound(released(), {
    ...made(['Recipe'], 'https://plum.yaks.app/recipes/~abcdefabcdef/'),
    pages: [{ path: 'index.html', title: 'Recipes' }],
  })
  c.pick('does')
  c.root.querySelector<HTMLElement>('[data-shows]')!.click()
  equal(c.stage(), 'preview')
  equal(c.on('preview'), 'draft')
})

test('drawn again as the Operator works, its frames stay loaded and keep where their page went, and Open goes there', () => {
  let draft = 'https://plum.yaks.app/recipes/~abcdefabcdef/'
  let c = bound(released(), made(['Notice'], draft))
  let frame = c.root.querySelector<HTMLIFrameElement>('[data-frame=draft]')!
  let went = draft + 'notices?q=tea#today'
  frame.dataset.at = went
  c.making(made(['Notice', 'Meal'], draft))
  equal(c.names('keeps'), ['Notice', 'Meal'])
  equal(c.root.querySelector('[data-frame=draft]') === frame, true)
  equal(frame.dataset.at, went)
  equal(c.root.querySelector('[data-open]')?.getAttribute('href'), went)
})
