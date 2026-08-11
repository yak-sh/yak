// The graph palette lets a word settle before asking the single server loop
// to search it.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { group, Search, searchOpen } from './Search.tsx'

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

Deno.test('search sends only the settled query while typing', async () => {
  let prior = Object.entries({
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
  })
  let { document, window } = parseHTML('<main></main>')
  let asked: string[] = []
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    fetch: {
      value: (input: string | URL | Request) => {
        asked.push(
          new URL(String(input), 'http://tasks.test').searchParams
            .get('q') ?? '',
        )
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
    await new Promise((resolve) => setTimeout(resolve, 225))
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
