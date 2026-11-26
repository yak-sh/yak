import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { bindDashboard } from './dashboard-browser.ts'
import {
  agentWork,
  dismissal,
  fixRows,
  operatorFixes,
  suggestionRows,
  suggestions,
  workRows,
} from './dashboard.ts'
import { type DashboardView, VIEW_ATTR } from './dashboard-view.ts'
import { graph } from './page-graph_fixture_test.ts'
import { managePath } from './routes.ts'
import { listedRows, spaceApps } from './space-apps.ts'
import { updateCards, updateRows } from './update-rows.ts'

let SPACE = 'space-ada'
let ADA = 'person-ada'
let view: DashboardView = {
  person: ADA,
  space: { eid: SPACE, slug: 'ada', title: 'Ada', operator: 'Hazel' },
  at: 'https://ada.yaks.test',
  chat: '/ada/operator',
  updates: '/ada/updates',
}

let apps = listedRows(ADA, SPACE, [
  { eid: 'r', slug: 'roster', title: 'Roster', visits: 41 },
  { eid: 'p', slug: 'packing', title: 'Packing List', visits: 58 },
  { eid: 's', slug: 'strides', title: 'Strides', visits: 90, installed: true },
  { eid: 'n', slug: 'notes', title: 'Notes' },
])
let work = workRows(ADA, SPACE, [
  {
    app: 'r',
    version: 5,
    at: '2026-11-25T10:00:00Z',
    by: 'c',
    name: 'Claude Code',
  },
  {
    app: 'r',
    version: 4,
    at: '2026-11-24T10:00:00Z',
    by: 'c',
    name: 'Claude Code',
  },
  { app: 'p', version: 1, at: '2026-11-20T10:00:00Z', by: 'y', name: 'yak' },
])
let fixes = fixRows(ADA, SPACE, [
  {
    request: 'q',
    app: 'p',
    at: '2026-11-26T09:00:00Z',
    said: 'Saves **wait** now.',
  },
  { request: 'w', app: 'r', at: '2026-11-26T10:00:00Z', working: true },
])
let offered = suggestionRows(ADA, SPACE, [
  {
    name: 'people',
    says: 'Invite family to sign in to Strides',
    app: 'strides',
    ask: 'I’d like my family to sign in to Strides.',
  },
  {
    name: 'install',
    says: 'Add Packing List to your home screen',
    app: 'packing',
    ask: 'How do I add Packing List?',
  },
])
let news = updateRows(ADA, SPACE, [
  {
    eid: 'u1',
    needs: true,
    at: '2026-11-26T08:00:00Z',
    unread: true,
    words: 'Maya asked to join Roster.',
    about: 'r',
    dismissed: false,
    choices: [{ label: 'Approve', description: 'Let her in' }],
    recommended: 'Approve',
  },
  {
    eid: 'u2',
    needs: false,
    at: '2026-11-25T08:00:00Z',
    unread: false,
    words: 'Township had 112 visitors yesterday.\n\nThat is twice its usual.',
    dismissed: false,
  },
])

// The Dashboard bound to a page graph holding the space's rows, and what it
// draws.
let bound = () => {
  let { document } = parseHTML(
    `<div data-view="dashboard" ${VIEW_ATTR}='${JSON.stringify(view)}'></div>`,
  )
  let root = document.querySelector<HTMLElement>('[data-view]')!
  let g = graph((b: Bundle[]) => Promise.resolve(b))
  g.set(spaceApps(SPACE), apps)
  g.set(agentWork(SPACE), work)
  g.set(operatorFixes(SPACE), fixes)
  g.set(suggestions(SPACE), offered)
  g.set(updateCards(SPACE), news)
  bindDashboard(root, g)
  let texts = (sel: string) =>
    [...root.querySelectorAll(sel)].map((e) =>
      e.textContent!.replace(/\s+/g, ' ').trim()
    )
  return { root, g, texts }
}

test('the Dashboard draws its apps most opened first, what its agents did, its suggestions and its Updates', () => {
  let { root, texts } = bound()
  equal(texts('.Dash_AppName'), ['Strides', 'Packing List', 'Roster', 'Notes'])
  equal(texts('.Dash_AppSub'), ['From the gallery', '58 opens', '41 opens', ''])
  equal(
    [...root.querySelectorAll('.Dash_App')].map((a) => a.getAttribute('href')),
    [
      'https://ada.yaks.test/strides/',
      'https://ada.yaks.test/packing/',
      'https://ada.yaks.test/roster/',
      'https://ada.yaks.test/notes/',
    ],
  )
  equal(texts('.Dash_Now'), ['Working now: fixing a break in Roster'])
  equal(texts('.Dash_DidTitle'), [
    'Hazel fixed a break in Packing List',
    'Claude Code updated Roster ×2',
    'yak made Packing List',
  ])
  equal(texts('.Dash_Did .Dash_DidMeta'), ['Saves wait now.'])
  equal(
    [...root.querySelectorAll('.Dash_Suggest a')].map((a) =>
      a.getAttribute('href')
    ),
    [
      '/ada/operator?say=I%E2%80%99d+like+my+family+to+sign+in+to+Strides.',
      '/ada/operator?say=How+do+I+add+Packing+List%3F',
    ],
  )
  equal(texts('.Dash_UpdateTitle'), [
    'Maya asked to join Roster.',
    'Township had 112 visitors yesterday.',
  ])
  equal(root.querySelectorAll('.Dash_Needs').length, 1)
  equal(
    [...root.querySelectorAll('[data-inbox-action="choose"] button')].map((b) =>
      b.getAttribute('value')
    ),
    ['Approve'],
  )
  equal(texts('.Dash_Updates .Dash_Head .Badge'), ['1'])
})

test('a pressed suggestion writes its longer request in the box, which sends to the Operator', () => {
  let { root } = bound()
  let box = root.querySelector<HTMLTextAreaElement>('.Dash_AskBox')!
  let pill = root.querySelector<HTMLElement>('[data-ask]')!
  let press = new root.ownerDocument.defaultView!.Event('click', {
    bubbles: true,
    cancelable: true,
  })
  pill.dispatchEvent(press)
  equal(press.defaultPrevented, true)
  equal(box.value, 'I’d like my family to sign in to Strides.')
  let form = box.closest('form')!
  equal(
    [form.getAttribute('action'), form.getAttribute('enctype'), box.name],
    [managePath('operator', 'ada'), 'multipart/form-data', 'say'],
  )
})

test('a dismissed suggestion is written through the page graph and gone once held', () => {
  let { root, g, texts } = bound()
  let press = root.querySelector<HTMLElement>('[data-dismiss="people"]')!
  press.dispatchEvent(
    new root.ownerDocument.defaultView!.Event('click', { bubbles: true }),
  )
  equal(g.wrote, [[dismissal(SPACE, 'people')]])
  g.set(`.dismissSuggestion.space=${SPACE}`, [dismissal(SPACE, 'people')])
  equal(texts('.Dash_Suggest a'), ['Add Packing List to your home screen'])
})

test('a release that lands is in Recent work at once', () => {
  let { g, texts } = bound()
  g.set(agentWork(SPACE), [
    ...workRows(ADA, SPACE, [
      {
        app: 'n',
        version: 2,
        at: '2026-11-26T11:00:00Z',
        by: 's',
        name: 'Hazel',
        operator: true,
      },
    ]),
    ...work,
  ])
  equal(texts('.Dash_DidTitle')[0], 'Hazel updated Notes')
})
