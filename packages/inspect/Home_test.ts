/** The schema map: a slice at a time, the packages a tree, every count from
 * the census, painted from the vocabulary before the census answers. */
import { equal, ok, test } from '@yaks/testing'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { EDGE_URI, edgeKeywords } from '@yaks/edge'
import { docs as uxDocs } from '@yaks/ux/vocab'
import { h, render } from 'preact'
import { act } from 'npm:preact@^10.29.1/test-utils'
import { parseHTML } from 'linkedom'
import { inspector } from './door.ts'
import { docs } from './front.ts'
import { views } from './registry.ts'
import { CENSUS } from './census.ts'
import { compEid, packEid } from './schema.ts'
import type { Answer, Host } from './host.ts'

let vocab = loadVocab([{
  $vocabulary: { [EDGE_URI]: true },
  package: '@test/work',
  description: 'Work and what holds it up.',
  $defs: {
    task: {
      component: true,
      description: 'Work to be done.',
      properties: {
        status: { type: 'string', description: 'where it stands' },
        owner: { type: 'string' },
      },
    },
    done: { component: true, description: 'It was done.' },
    task_close: {
      effect: true,
      created: ['done'],
      description: 'Close the task when it is done.',
    },
    blocks: {
      component: true,
      edge: 'blocks',
      reversed: 'blocked by',
      properties: {},
    },
  },
}, { package: '@test/more', $defs: {} }], [edgeKeywords])

let names = new Map([
  ...vocab.all.map((n) => [compEid(n), n] as const),
  ...['@test/work', '@test/more'].map((p) => [packEid(p), p] as const),
])

// Three sets of components: 3 tasks, 2 done tasks and 4 blocks edges.
let set = (eid: string, tables: string[]) => ({
  entity: { eid },
  archetype: { tables: JSON.stringify(tables) },
})
let counted: Record<string, Answer> = {
  [CENSUS.sets]: {
    rows: [
      set('a1', ['task']),
      set('a2', ['done', 'task']),
      set('a3', ['blocks']),
    ],
    ready: true,
  },
  [CENSUS.tally]: { rows: [], ready: true, tally: { a1: 3, a2: 2, a3: 4 } },
}

let unanswered: Record<string, Answer> = {
  [CENSUS.sets]: { rows: [], ready: false },
  [CENSUS.tally]: { rows: [], ready: false },
}

type Step = { open: string } | { tab: string } | 'remount'

// Draw the map in a page graph of its own, take the steps a reader would,
// and read what shows. The census answers when `census` says so.
let page = async (
  steps: Step[],
  census: Record<string, Answer> = counted,
) => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let front = client(loadVocab([...docs, ...uxDocs]), [], {
    vault: false,
    wireVault: false,
  })
  let pending: Promise<unknown> = Promise.resolve()
  let host: Host = {
    vocab,
    front,
    edits: true,
    useAnswers: (asks) =>
      Object.fromEntries(
        Object.entries(asks).map(([key, a]) => [
          key,
          census[typeof a == 'string' ? a : a.query] ??
            { rows: [], ready: true },
        ]),
      ),
    apply: () => {},
    get: () => undefined,
    link: (eid) => `/${eid}`,
    find: (query) => `/?q=${encodeURIComponent(query)}`,
    go: () => {},
    id: (b) => b.entity.eid,
    kind: () => 'entity',
    name: (eid) => names.get(eid) ?? eid,
    when: (at) => at,
  }
  let nativeMutate = front.mutate.bind(front)
  front.mutate = (bs) => pending = Promise.resolve(nativeMutate(bs))
  let { Door } = inspector(views, host)
  let root = document.querySelector('main')!
  let draw = () =>
    render(
      h(Door, { e: { entity: { eid: 'map' } }, view: 'Inspect.Map' }),
      root,
    )
  let press = async (button?: { click: () => void } | null) => {
    // A missing control is seen by the assertions, not thrown at load.
    if (button) {
      await act(async () => {
        button.click()
        await pending
      })
    }
  }
  let rowsOf = () =>
    [...root.querySelectorAll('.Table_Body [role="row"]')].map((r) =>
      [...r.querySelectorAll('[role="cell"]')].map((c) => c.textContent!.trim())
    )
  try {
    act(draw)
    for (let step of steps) {
      if (step == 'remount') {
        act(() => render(null, root))
        act(draw)
      } else if ('tab' in step) {
        await press(
          [...root.querySelectorAll('.Tabs_Tab')].find((b) =>
            b.textContent == step.tab
          ) as HTMLElement | undefined,
        )
      } else {
        let row = [...root.querySelectorAll('[role="row"]')].find((r) =>
          r.querySelector('[role="cell"]')?.textContent?.trim() == step.open
        )
        await press(row?.querySelector('.Table_Toggle') as HTMLElement | null)
      }
    }
    return {
      facts: root.querySelector('.Head_Facts')?.textContent ?? '',
      tab: root.querySelector('.Tabs_Tab-on')?.textContent,
      heading: root.querySelector('.Section_Title')?.textContent ?? '',
      rows: rowsOf(),
      levels: [...root.querySelectorAll('[aria-level]')].map((r) =>
        r.getAttribute('aria-level')
      ),
      loading: root.querySelectorAll('[role="status"]').length,
      links: [...root.querySelectorAll('[role="row"] a')].map((a) => ({
        text: a.textContent,
        href: a.getAttribute('href'),
      })),
    }
  } finally {
    act(() => render(null, root))
    front.close()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

let waiting = await page([], unanswered)
let initial = await page([])
let packaged = await page([{ open: '@test/work' }])
let properties = await page([{ open: '@test/work' }, { open: 'task' }])
let remembered = await page([
  { open: '@test/work' },
  { open: 'task' },
  { open: '@test/work' },
  'remount',
  { open: '@test/work' },
])
let components = await page([{ tab: 'Components' }])
let relations = await page([{ tab: 'Relations' }])
let archetypes = await page([{ tab: 'Archetypes' }])
let archetypesWaiting = await page([{ tab: 'Archetypes' }], unanswered)
let kept = await page([{ tab: 'Relations' }, 'remount'])

test('the map paints its packages from the vocabulary before the census answers', () => {
  equal(waiting.tab, 'Packages')
  equal(waiting.rows.map((r) => r[0]), ['@test/more', '@test/work'])
  ok(waiting.loading > 0)
  ok(waiting.facts.includes('2 packages'))
  ok(waiting.facts.includes('3 components'))
})

test('the map counts packages, components, relations, archetypes and entities', () => {
  equal(
    initial.facts,
    '2 packages·3 components·1 effect·1 relation·3 archetypes·9 entities',
  )
  equal(initial.rows, [
    ['@test/more', '0 components', '', '0'],
    [
      '@test/work',
      '3 components · 1 effect',
      'Work and what holds it up.',
      '9',
    ],
  ])
  equal(initial.loading, 0)
})

test('opening a package shows its components and effects, what each holds and carries', () => {
  equal(packaged.rows.slice(1), [
    [
      '@test/work',
      '3 components · 1 effect',
      'Work and what holds it up.',
      '9',
    ],
    ['blocks', 'a mark', '', '4'],
    ['done', 'a mark', 'It was done.', '2'],
    ['task', '2 properties', 'Work to be done.', '5'],
    ['task_close', 'an effect', 'Close the task when it is done.', ''],
  ])
  equal(packaged.levels, ['1', '1', '2', '2', '2', '2'])
  ok(packaged.links.some((l) => l.text == 'task_close'))
})

test('opening a component shows its properties, typed and linked', () => {
  equal(properties.rows.filter((r) => ['status', 'owner'].includes(r[0])), [
    ['status', 'text', 'where it stands', ''],
    ['owner', 'text', '', ''],
  ])
  ok(properties.links.some((l) => l.text == 'status'))
})

test('closing a package hides what it holds, and its open rows stay open across a remount', () => {
  equal(remembered.rows.map((r) => r[0]), [
    '@test/more',
    '@test/work',
    'blocks',
    'done',
    'task',
    'status',
    'owner',
    'task_close',
  ])
})

test('the components slice lists every component, the most carried first', () => {
  equal(components.heading.startsWith('Components'), true)
  equal(components.rows, [
    ['task', '@test/work', 'Work to be done.', '5'],
    ['blocks', '@test/work', '', '4'],
    ['done', '@test/work', 'It was done.', '2'],
  ])
})

test('the relations slice says each relation from the far end and its edges', () => {
  equal(relations.rows, [['blocks', 'blocked by', '4', '@test/work']])
})

test('the archetypes slice lists each set, its count listing its entities', () => {
  equal(archetypes.rows.map((r) => r.at(-1)), ['4', '3', '2'])
  ok(
    archetypes.links.some((l) =>
      l.href == `/?q=${encodeURIComponent('.entity.archetype=a3')}`
    ),
  )
})

test('the archetypes slice waits for the census before saying none', () => {
  ok(archetypesWaiting.loading > 0)
  equal(archetypesWaiting.rows, [])
})

test('the slice shown stays across a remount', () => {
  equal(kept.tab, 'Relations')
})
