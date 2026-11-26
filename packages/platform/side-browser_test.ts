import { clock, equal, test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { pair } from '../sync/testing.ts'
import { bindSide, drawSide } from './side-browser.ts'
import { section, sideParts, type SideView } from './side-parts.ts'
import {
  appRows,
  type Picked,
  SIDE_SPACES,
  sideApps,
  sideWords,
  spaceRows,
} from './side-rows.ts'
import {
  UPDATE_WAITING,
  waitingBundle,
  waitingWords,
} from './update-waiting.ts'

let ADA = 'person-ada'
let space = (slug: string, more: Partial<Picked> = {}) => ({
  eid: `space-${slug}`,
  slug,
  title: slug.toUpperCase(),
  owner: true,
  own: slug == 'ada',
  operator: 'Otto',
  ...more,
})
let ada = space('ada')
let club = space('club', { owner: false, whose: 'Bea' })
let app = (slug: string, title = slug) => ({
  eid: `app-${slug}`,
  slug,
  title,
  source: null,
})

let talk: SideView = {
  person: ADA,
  here: ada,
  talk: { space: ada.eid, open: 'new', all: false, at: 'https://ada.yaks.app' },
}

// The side as the server draws it before any rows are in the page graph:
// the selector, the space's apps, nothing across spaces.
let drawn = (view: SideView, spaces: Picked[], apps = [app('notes')]) => {
  let parts = sideParts(view, spaces, apps)
  let html = renderToString(
    h(
      'nav',
      { class: 'Sidebar', 'data-side-view': JSON.stringify(view) },
      parts.personal ? section(parts.personal, false) : null,
      h(
        'div',
        { class: 'Sidebar_Space' },
        h('div', { class: 'Sidebar_Whose' }, parts.picker),
        parts.apps ? section(parts.apps, false) : null,
      ),
    ),
  )
  return parseHTML(`<html><body>${html}</body></html>`).document
    .querySelector<HTMLElement>('nav')!
}

let rows = (
  spaces: (Picked & { eid: string })[],
  apps: ReturnType<typeof app>[],
  waiting?: Record<string, number>,
) => ({
  spaces: spaceRows(ADA, spaces),
  apps: appRows(ADA, ada.eid, apps),
  waiting: waiting &&
    Object.entries(waiting).map(([slug, count]) =>
      waitingBundle(ADA, { space: `space-${slug}`, slug, count })
    ),
})

let said = (root: Element) => ({
  apps: [
    ...root.querySelectorAll('[data-side-part="side-apps"] a .SideNav_Label'),
  ]
    .map((l) => l.textContent),
  spaces: [...root.querySelectorAll('.Sidebar_Whose .Identity_Name')]
    .map((n) => n.textContent),
  across: !!root.querySelector('[data-side-part="side-personal"]'),
  badges: Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>('[data-across]')]
      .filter((b) => !b.hasAttribute('hidden'))
      .map((b) => [b.dataset.across || 'all', b.textContent]),
  ),
})

test('the side draws the apps its rows hold: one made, one renamed, one gone', () => {
  let root = drawn(talk, [ada])
  let link = root.querySelector('[data-side-part="side-apps"] a')
  drawSide(root, talk, rows([ada], [app('notes', 'Notes'), app('lists')]))
  equal(said(root).apps, ['Notes', 'lists'])
  equal(root.querySelector('[data-side-part="side-apps"] a'), link)
  drawSide(root, talk, rows([ada], [app('lists')]))
  equal(said(root).apps, ['lists'])
  drawSide(root, talk, rows([ada], []))
  equal(
    root.querySelector('.Sidebar_None')?.textContent,
    'None yet. Ask Otto to make one.',
  )
})

test('a second space puts Updates across spaces in, and its leaving takes it out', () => {
  let root = drawn(talk, [ada])
  drawSide(root, talk, rows([ada, club], [], { ada: 2, club: 1 }))
  equal(said(root), {
    apps: [],
    spaces: ['ADA', 'ADA', 'CLUB'],
    across: true,
    badges: { all: '3', ada: '2', club: '1' },
  })
  equal(
    root.firstElementChild?.getAttribute('data-side-part'),
    'side-personal',
  )
  drawSide(root, talk, rows([ada], []))
  equal(said(root).across, false)
  equal(said(root).spaces, ['ADA'])
})

test('a selector held open stays open as its badges change', () => {
  let root = drawn(talk, [ada, club])
  let menu = root.querySelector('details')!
  menu.setAttribute('open', '')
  drawSide(root, talk, rows([ada, club], [], { ada: 1 }))
  equal(root.querySelector('details'), menu)
  equal(menu.hasAttribute('open'), true)
  equal(said(root).badges, { all: '1', ada: '1' })
})

test('the sidebar keeps its badge DOM until the count watch answers again', async () => {
  let root = drawn(talk, [ada, club])
  let doc = root.ownerDocument
  let time = clock()
  let socket = pair().client
  let graph = client(loadVocab([sideWords, waitingWords]), [], {
    url: 'http://page.test',
    connect: () => socket,
    timer: (fn, ms) => void time.after(ms, fn),
    time: time.now,
    vault: false,
    wireVault: false,
  })
  let stop = bindSide(doc, () => graph)
  let mutations = 0
  let observer = new doc.defaultView!.MutationObserver((records) => {
    mutations += records.length
  })
  let changes = () => mutations + observer.takeRecords().length
  let unchanged = () => {
    equal(changes(), 0)
    equal(said(root).badges, { all: '3', ada: '2', club: '1' })
  }
  let answer = (query: string, bundles: Bundle[]) => {
    let asked = (socket.sent as { subscribe?: string; id?: string }[])
      .find((m) => m.subscribe == query)!
    socket.emit('message', JSON.stringify({ id: asked.id, bundles }))
  }
  let initial = rows([ada, club], [app('notes')], { ada: 2, club: 1 })
  let side = () => {
    answer(SIDE_SPACES, initial.spaces)
    answer(sideApps(ada.eid), initial.apps)
  }
  try {
    socket.emit('open')
    side()
    answer(UPDATE_WAITING, initial.waiting!)
    observer.observe(root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    })
    for (let counts of [{ ada: 2, club: 1 }, { ada: 4, club: 1 }]) {
      socket.close()
      unchanged()
      socket = pair().client
      await time.advance(500)
      socket.emit('open')
      side()
      unchanged()
      answer(UPDATE_WAITING, rows([ada, club], [], counts).waiting!)
      if (counts.ada == 2) unchanged()
    }
    equal(said(root).badges, { all: '5', ada: '4', club: '1' })
    equal(changes(), 2) // Ada and the All Updates total update once each.
    answer(UPDATE_WAITING, rows([ada, club], [], { ada: 0, club: 0 }).waiting!)
    equal(said(root).badges, {})
  } finally {
    observer.disconnect()
    stop()
    graph.close()
  }
})

test('what has not answered stays as the server drew it', () => {
  let root = drawn(talk, [ada, club])
  let before = root.outerHTML
  drawSide(root, talk, { apps: rows([ada], []).apps })
  equal(root.outerHTML, before)
  drawSide(root, talk, { spaces: rows([ada, club], []).spaces })
  equal(said(root).apps, ['notes'])
  equal(said(root).badges, {})
})

test('the dashboard’s selector leads each space to the setting open', () => {
  let desk: SideView = { person: ADA, here: ada, desk: { view: 'people' } }
  let root = drawn(desk, [ada])
  drawSide(root, desk, rows([ada, club], []))
  equal(
    [...root.querySelectorAll('.Sidebar_Whose a[href]')]
      .map((a) => a.getAttribute('href')),
    ['/manage/ada/people', '/manage/club/operator', '/manage/account/space'],
  )
  equal(said(root).across, false)
})

test('rows of another space’s apps are not this side’s', () => {
  let root = drawn(talk, [ada])
  let theirs: Bundle[] = appRows(ADA, club.eid, [app('dues')])
  drawSide(root, talk, { spaces: rows([ada], []).spaces, apps: theirs })
  equal(said(root).apps, [])
})
