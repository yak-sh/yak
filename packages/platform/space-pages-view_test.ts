import { equal, test } from '@yaks/testing'
import { offerRows } from './space-pages.ts'
import {
  domain,
  held,
  page,
  settings,
  spaceView,
} from './space-pages_fixture_test.ts'

let value = (at: HTMLElement, name: string) =>
  at.querySelector<HTMLInputElement>(`[name=${name}]`)?.getAttribute('value')
let says = (at: HTMLElement, selector: string) =>
  at.querySelector(selector)?.textContent?.trim()
let apps = [
  { eid: 'a1', slug: 'notes', title: 'Notes' },
  { eid: 'a2', slug: 'shop', title: '' },
]

test('Settings change only the space: its name, address, what it opens, and Delete', () => {
  let at = page(
    spaceView(),
    held({ s: settings({ home: 'shop' }), apps }),
  )
  let form = at.querySelector('[name=space]')!.closest('form')!
  equal(form.getAttribute('data-save'), '/manage/ada/settings')
  equal([value(at, 'title'), value(at, 'space')], ['Ada', 'ada'])
  equal(at.querySelector('[name=name]'), null)
  equal(
    [...at.querySelectorAll('[name=home] option')].map((o) => [
      o.getAttribute('value'),
      o.textContent,
      o.hasAttribute('selected'),
    ]),
    [['', 'Your app library', false], ['notes', 'Notes', false], [
      'shop',
      'shop',
      true,
    ]],
  )
  equal(
    at.querySelector('.Card-danger .Button')?.getAttribute('href'),
    'https://yaks.app/space/ada/delete',
  )
})

test('the byline is offered on a paid plan, and Remove logo only with a logo', () => {
  let free = page(spaceView(), held({ s: settings({ paying: false }) }))
  equal(free.querySelector('[name=byline]'), null)
  equal(free.querySelector('[data-unlogo]'), null)
  let paid = page(
    spaceView(),
    held({ s: settings({ byline: true, logo: '/logo.png' }) }),
  )
  equal(
    paid.querySelector('[name=byline][type=checkbox]')?.hasAttribute('checked'),
    true,
  )
  equal(!!paid.querySelector('[data-unlogo]'), true)
})

test('a space with no apps says its address opens its library', () => {
  equal(
    page().textContent!.includes('ada.yaks.app opens its app library.'),
    true,
  )
})

test('Domains lists the space’s domains with their actions, and buying only on a plan that includes it', () => {
  let rows = held({
    apps,
    domains: [domain({ destination: 'a1' }), domain({ name: 'b.test' })],
  })
  let at = page(spaceView('domains'), rows)
  equal(
    [...at.querySelectorAll('[data-owned-domain]')].map((d) => d.id),
    ['ada.test', 'b.test'],
  )
  equal(
    at.querySelector<HTMLSelectElement>('#ada\\.test [name=destination]')
      ?.querySelector('[selected]')?.getAttribute('value'),
    'a1',
  )
  let free = page(
    spaceView('domains'),
    held({ s: settings({ included: false }) }),
  )
  equal(
    free.textContent!.includes('Buying a domain comes with the Plus plan.'),
    true,
  )
})

test('a search says it is searching, then draws what the registrar offered', () => {
  let view = spaceView('domains')
  let searching = page(view, { ...held(), query: 'oak' })
  equal(says(searching, '[data-search-status]'), 'Searching…')
  let offered = offerRows('oak', [
    {
      name: 'oak.test',
      first: '$10',
      renewal: '$12',
      cents: 1000,
      renews: 1200,
    },
    { name: 'oak.com', unavailable: 'Taken.' },
  ])
  let found = page(view, { ...held(), query: 'oak', offers: offered })
  equal(says(found, '[data-search-status]'), '1 domain available.')
  equal(
    [...found.querySelectorAll('[data-domain-buy] [name=domain]')].map((i) =>
      i.getAttribute('value')
    ),
    ['oak.test'],
  )
  let down = page(view, {
    ...held(),
    query: 'oak',
    offers: offerRows('oak', [], 'Domain search is unavailable.'),
  })
  equal(says(down, '.Notice-negative'), 'Domain search is unavailable.')
})

test('what a press on a domain came to is said where it was pressed', () => {
  let at = page(spaceView('domains'), {
    ...held({ domains: [domain()] }),
    notes: {
      'point:ada.test': { words: 'Saved.' },
      'transfer:ada.test': { words: 'No space oak.', refused: true },
    },
  })
  let said = [...at.querySelectorAll('[data-domain-message]')]
    .filter((n) => !n.hasAttribute('hidden'))
    .map((n) => [n.textContent, n.classList.contains('Notice-negative')])
  equal(said, [['No space oak.', true], ['Saved.', false]])
})

test('the trash lists apps and numbers with Restore, a number with its price and its way out', () => {
  let at = page(
    spaceView('trash'),
    held({
      binned: [
        { item: 'a1', kind: 'app', name: 'Notes' },
        { item: 'n1', kind: 'number', name: '269-555-0142', monthly: '$1.15' },
      ],
    }),
  )
  equal(
    [...at.querySelectorAll('[data-restore]')].map((b) =>
      b.getAttribute('data-restore')
    ),
    ['a1', 'n1'],
  )
  equal(at.textContent!.includes('$1.15 a month'), true)
  equal(
    at.querySelector('a[href*="numbererase"]')?.getAttribute('href'),
    'https://yaks.app/space/ada/confirm/numbererase/n1',
  )
  equal(
    page(spaceView('trash')).textContent!.includes('Trash is empty'),
    true,
  )
})
