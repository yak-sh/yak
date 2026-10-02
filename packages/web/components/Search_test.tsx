// The graph palette lets a word settle before asking the single server loop
// to search it.
import { test } from '@yaks/testing'
import { until } from '../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { group, hitSlots, Search, searchOpen } from './Search.tsx'
import { config } from '../live.ts'

let hit = (num: number, kind: string, title: string) => ({
  eid: `${num}`,
  num,
  kind,
  title,
  snip: '',
  open: `${num}`,
})

test('search keeps exact ids and titles above kind groups', () => {
  let task = hit(1, 'task', 'mentions fleet base common persona')
  let memory = hit(2, 'memory', 'another mention')
  let persona = hit(3, 'persona', 'fleet base common persona')
  assertEquals(
    group([persona, memory, task], 'fleet base common persona'),
    [persona, task, memory],
  )
  assertEquals(group([persona, memory, task], 'N-3')[0], persona)
  assertEquals(
    group([persona, memory, task], '"fleet base common persona"')[0],
    persona,
  )
})

test('search fills tile titles and bodies with marked matches', () => {
  let slots = hitSlots({
    ...hit(1, 'task', 'One row'),
    title_hit: 'One \x01row\x02',
    snip: 'Body \x01match\x02',
  })
  let title = slots.title as unknown[]
  let body = slots.body
  assertEquals(title[0], 'One ')
  assertEquals((title[1] as { type: unknown }).type, 'mark')
  let snip = (body.props.children as unknown[]).flat()
  assertEquals(snip[0], 'Body ')
  assertEquals((snip[1] as { type: unknown }).type, 'mark')
})

// Polls a real debounce window to prove only the settled query is sent — the
// settle is the point, so it cannot be sub-ms.
test('search sends only the settled query while typing', async () => {
  let host = config.host
  // A location-less process no longer guesses a server. This test owns its
  // fetch below, so name that test endpoint rather than the operator's host.
  config.host = 'tasks.test'
  let prior = Object.entries({
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
  })
  let { document, window } = parseHTML('<main></main>')
  let asked: string[] = []
  // The line rides /query as `q`, the typed word its leading term (hits.ts).
  let term = (input: string | URL | Request) =>
    new URL(String(input), 'http://tasks.test').searchParams.get('q')
      ?.split('&')[0] ?? ''
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    fetch: {
      value: (input: string | URL | Request) => {
        asked.push(term(input))
        return Promise.resolve(Response.json([]))
      },
      configurable: true,
    },
  })
  let root = document.querySelector('main')!
  try {
    searchOpen.value = true
    render(h(Search, { open: () => {} }), root)
    let input = root.querySelector('input')!
    for (let value of ['t', 'ty', 'type']) {
      input.value = value
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    }
    assertEquals(input.value, 'type')
    assertEquals(asked, [])
    // Poll the debounce instead of guessing its window: only the settled
    // query is ever sent, so the first ask is the whole story.
    await until(() => asked.length ? asked : undefined, {
      label: 'the settled query to be sent',
    })
    assertEquals(asked, ['type'])
  } finally {
    config.host = host
    searchOpen.value = false
    render(null, root)
    for (let [name, d] of prior) {
      if (d) Object.defineProperty(globalThis, name, d)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
})

test('search page uses the palette query door and bare words remain text', async () => {
  let { SearchPage } = await import('./Search.tsx')
  let { searchAt, searchPath } = await import('../url.ts')
  let q = 'fleet .task&!completed'
  assertEquals(searchAt(searchPath(q)), q)
  assertEquals(searchAt('/T-1?q=fleet'), null)
  let host = config.host
  let priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let priorFetch = globalThis.fetch
  let { document } = parseHTML('<main></main>')
  let asked: string[] = []
  config.host = 'tasks.test'
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  globalThis.fetch = (input) => {
    asked.push(new URL(String(input)).searchParams.get('q')!)
    return Promise.resolve(Response.json([]))
  }
  let root = document.querySelector('main')!
  try {
    render(h(SearchPage, { query: 'fleet' }), root)
    await until(() => asked.length > 0, { label: 'search page query' })
    assertEquals(asked, ['fleet&.limit=20'])
    assertEquals(root.textContent, 'Search: fleet')
  } finally {
    render(null, root)
    config.host = host
    globalThis.fetch = priorFetch
    if (priorDocument) {
      Object.defineProperty(globalThis, 'document', priorDocument)
    } else delete (globalThis as Record<string, unknown>).document
  }
})

test('search chip is a draggable link, modifiers keep native navigation', async () => {
  let { fields } = await import('./fields.tsx')
  let { route } = await import('./nav.tsx')
  let priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let priorLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  let priorHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
  Object.defineProperty(globalThis, 'history', {
    value: { pushState: () => {} },
    configurable: true,
  })
  let { document, window } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'location', {
    value: { href: 'https://tasks.test/T-1' },
    configurable: true,
  })
  let root = document.querySelector('main')!
  let oldRoute = route.value
  try {
    fields.set('search', 'fleet .task')
    searchOpen.value = true
    render(h(Search, { open: () => {} }), root)
    let link = root.querySelector('a.Search_Page')!
    assertEquals(link.getAttribute('href'), '/?q=fleet%20.task')
    assertEquals(link.hasAttribute('draggable'), true)
    let payload: Record<string, string> = {}
    let drag = new window.Event('dragstart', { bubbles: true })
    Object.assign(drag, {
      dataTransfer: { setData: (k: string, v: string) => payload[k] = v },
    })
    link.dispatchEvent(drag)
    assertEquals(payload, {
      'text/uri-list': 'https://tasks.test/?q=fleet%20.task',
      'text/plain': 'https://tasks.test/?q=fleet%20.task',
    })
    for (
      let props of [
        { metaKey: true, button: 0 },
        { ctrlKey: true, button: 0 },
        { button: 1 },
      ]
    ) {
      let ev = new window.Event('click', { bubbles: true, cancelable: true })
      Object.assign(ev, props)
      link.dispatchEvent(ev)
      assertEquals(ev.defaultPrevented, false)
      assertEquals(searchOpen.value, true)
    }
    let ev = new window.Event('click', { bubbles: true, cancelable: true })
    Object.assign(ev, { button: 0 })
    link.dispatchEvent(ev)
    assertEquals(ev.defaultPrevented, true)
    assertEquals(route.value, '/?q=fleet%20.task')
    assertEquals(searchOpen.value, false)
  } finally {
    render(null, root)
    fields.set('search', '')
    searchOpen.value = false
    route.value = oldRoute
    for (
      let [key, desc] of [['history', priorHistory], [
        'document',
        priorDocument,
      ], [
        'location',
        priorLocation,
      ]] as const
    ) {
      if (desc) Object.defineProperty(globalThis, key, desc)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
})
