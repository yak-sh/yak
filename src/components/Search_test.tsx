// The graph palette lets a word settle before asking the single server loop
// to search it.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { group, hitSlots, Search, searchOpen } from './Search.tsx'
import { slow, until } from '../testing.ts'

let hit = (num: number, kind: string, title: string) => ({
  eid: `${num}`,
  num,
  kind,
  title,
  snip: '',
  open: `${num}`,
})

Deno.test('search keeps exact ids and titles above kind groups', () => {
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

Deno.test('search fills tile titles and bodies with marked matches', () => {
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
// settle is the point, so it cannot be sub-ms; slow().
slow('search sends only the settled query while typing', async () => {
  let prior = Object.entries({
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
  })
  let { document, window } = parseHTML('<main></main>')
  let asked: string[] = []
  // The line rides /query as its leading bare term (hits.ts), not a param.
  let term = (input: string | URL | Request) =>
    decodeURIComponent(
      new URL(String(input), 'http://tasks.test').search.slice(1).split('&')[0],
    )
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
    searchOpen.value = false
    render(null, root)
    for (let [name, d] of prior) {
      if (d) Object.defineProperty(globalThis, name, d)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
})
