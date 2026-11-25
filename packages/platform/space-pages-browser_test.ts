import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { bindSpace } from './space-pages-browser.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import {
  binnedRows,
  domainOffers,
  offerRows,
  settingsEid,
  settingsRow,
  spaceSettings,
  spaceTrash,
} from './space-pages.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  domain,
  held,
  lines,
  page,
  settings,
  SPACE,
  spaceView,
} from './space-pages_fixture_test.ts'
import type { SpacePage } from './space-pages-view.ts'

// A space page bound to a page graph holding `rows`, each write answered by
// `answer`.
let bound = (
  { on = 'settings' as SpacePage, rows = held(), answer = ok } = {},
) => {
  let root = page(spaceView(on), rows)
  let g = graph(answer)
  for (let [line, kept] of lines(rows)) g.set(line, kept)
  let went: string[] = []
  bindSpace(root, g, (to) => went.push(to))
  let save = (fields: Record<string, string | string[]>) => {
    let body = new FormData()
    for (let [k, v] of Object.entries(fields)) {
      for (let one of [v].flat()) body.append(k, one)
    }
    return root.querySelector<SavingForm>('form[data-save]')![SAVE_THROUGH]!(
      body,
    )
  }
  let submit = (form: Element) =>
    form.dispatchEvent(
      new (root.ownerDocument.defaultView!).Event('submit', {
        bubbles: true,
        cancelable: true,
      }),
    )
  return { root, g, save, submit, went }
}
let ok = (b: Bundle[]) => Promise.resolve(b)
let said = (words: string) => (b: Bundle[]) =>
  Promise.resolve(b.map(({ entity, ...comps }) => {
    let [[word, value]] = Object.entries(comps)
    return { entity, [word]: { ...value as object, said: words } }
  }))
let refused = (message: string) => (b: Bundle[]) =>
  Promise.reject(new WriteRefused(b, { error: 'arguments', message } as never))
let acts = (g: ReturnType<typeof bound>['g']) =>
  g.wrote.map((b) =>
    b.map(({ entity, ...comps }) =>
      entity.eid == settingsEid(SPACE) ? { eid: entity.eid, ...comps } : comps
    )
  )
let tick = () => new Promise((go) => setTimeout(go))
let shown = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll(selector)].filter((n) => !n.hasAttribute('hidden'))
    .map((n) => n.textContent)

test('Settings save the space’s settings through the graph, and a new address moves the page there', async () => {
  let { g, save } = bound()
  let out = await save({
    title: ' Family ',
    space: 'ada',
    home: '',
    byline: ['', 'on'],
  })
  equal(out, undefined)
  equal(acts(g), [[{
    eid: settingsEid(SPACE),
    spaceSettings: {
      space: SPACE,
      title: 'Family',
      slug: 'ada',
      home: '',
      byline: true,
    },
  }]])
  let moving = bound({
    answer: (b) => {
      moving.g.set(spaceSettings(SPACE), [
        settingsRow(SPACE, settings({ slug: 'grove' })),
      ])
      return Promise.resolve(b)
    },
  })
  equal(await moving.save({ space: 'Grove' }), {
    to: '/manage/grove/settings',
  })
})

test('a setting the door refuses is said on the Save bar', async () => {
  let { save } = bound({ answer: refused('That address is taken.') })
  equal(
    await save({ space: 'taken' }).catch((e) => e.message),
    'That address is taken.',
  )
})

test('a space renamed elsewhere is drawn again without a reload', () => {
  let { root, g } = bound()
  g.set(spaceSettings(SPACE), [
    settingsRow(SPACE, settings({ title: 'Grove' })),
  ])
  equal(
    root.querySelector<HTMLInputElement>('[name=title]')?.value,
    'Grove',
  )
})

test('Remove logo writes the space without one', async () => {
  let { root, g } = bound({
    rows: held({ s: settings({ logo: '/logo.png' }) }),
  })
  root.querySelector<HTMLElement>('[data-unlogo]')!.click()
  await tick()
  equal(acts(g), [[{
    eid: settingsEid(SPACE),
    spaceSettings: { space: SPACE, logo: null },
  }]])
})

let trashed = held({ binned: [{ item: 'a1', kind: 'app', name: 'Notes' }] })

test('Restore takes the row off at once, and says where the app is back', async () => {
  let { root, g } = bound({
    on: 'trash',
    rows: trashed,
    answer: said('Restored at /notes/.'),
  })
  root.querySelector<HTMLElement>('[data-restore]')!.click()
  equal(root.querySelector('[data-restore]'), null)
  await tick()
  equal(acts(g), [[{ restoreBinned: { space: SPACE, item: 'a1' } }]])
  g.set(spaceTrash(SPACE), binnedRows(SPACE, []))
  equal(shown(root, '[data-said]'), ['Restored at /notes/.'])
})

test('a refused restore puts the row back and says why', async () => {
  let { root } = bound({
    on: 'trash',
    rows: trashed,
    answer: refused('That is no longer in the trash.'),
  })
  root.querySelector<HTMLElement>('[data-restore]')!.click()
  await tick()
  equal(root.querySelectorAll('[data-restore]').length, 1)
  equal(shown(root, '[data-said]'), ['That is no longer in the trash.'])
})

test('a domain pointed or offered is written as its act, and what it came to said beside it', async () => {
  let { root, g, submit } = bound({
    on: 'domains',
    rows: held({ domains: [domain()] }),
    answer: said('Offered to oak.'),
  })
  let point = root.querySelector('[data-domain-target]')!
  submit(point)
  await tick()
  let offer = root.querySelector('[data-domain-transfer]')!
  offer.querySelector<HTMLInputElement>('[name=receiving_space]')!.value =
    ' Oak '
  submit(offer)
  await tick()
  equal(acts(g), [
    [{ pointDomain: { space: SPACE, name: 'ada.test', destination: '' } }],
    [{ offerDomain: { space: SPACE, name: 'ada.test', to: 'oak' } }],
  ])
  equal(shown(root, '[data-domain-message]'), [
    'Offered to oak.',
    'Offered to oak.',
  ])
})

test('a search watches the registrar’s offers for what was typed', () => {
  let { root, g, submit } = bound({ on: 'domains' })
  root.querySelector<HTMLInputElement>('#domain-query')!.value = 'oak '
  submit(root.querySelector('[data-domain-search]')!)
  equal(shown(root, '[data-search-status]'), ['Searching…'])
  g.set(
    domainOffers('oak'),
    offerRows('oak', [{ name: 'oak.test', first: '$10', renewal: '$12' }]),
  )
  equal(shown(root, '[data-search-status]'), ['1 domain available.'])
  equal(root.textContent!.includes('oak.test'), true)
})

test('until each row is in, the page stays as the server drew it', () => {
  let root = page(spaceView('trash'), trashed)
  let before = root.innerHTML
  bindSpace(root, graph(ok))
  equal(root.innerHTML, before)
})
