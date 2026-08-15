// The browser popup's pure draft seam: popup lifetimes and network responses
// may end in either order, but neither may erase text the user did not file.
import { assertEquals } from '@std/assert'
import { filed, recall, remember } from '../extension/draft.js'
import { refs } from '../extension/tasks.js'

let storage = () => {
  let values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

Deno.test('the extension draft survives popup lifetimes byte for byte', () => {
  let saved = storage()
  remember(saved, 'https://one.test/page', '  P1 first line\nbody  ')
  assertEquals(
    recall(saved, 'https://one.test/page'),
    '  P1 first line\nbody  ',
  )
  assertEquals(recall(saved, 'https://two.test/page'), '')
})

Deno.test('a filing clears only the line it sent', () => {
  let saved = storage()
  let url = 'https://one.test/page'
  remember(saved, url, 'next thought')
  assertEquals(
    filed(saved, url, 'filed thought', 'next thought'),
    'next thought',
  )
  assertEquals(recall(saved, url), 'next thought')

  assertEquals(filed(saved, url, 'next thought', 'next thought'), '')
  assertEquals(recall(saved, url), '')
})

Deno.test('the extension badge carries kind in the graph query', async () => {
  let priorFetch = globalThis.fetch
  let priorChrome = Reflect.get(globalThis, 'chrome')
  let seen = ''
  Reflect.set(globalThis, 'chrome', {
    storage: { sync: { get: () => Promise.resolve({ host: '' }) } },
  })
  globalThis.fetch = ((url: string | URL | Request) => {
    seen = String(url)
    return Promise.resolve(Response.json([]))
  }) as typeof fetch
  try {
    await refs('https://one.test/page')
    let query = new URL(seen).searchParams
    assertEquals([...query.keys()], [
      '.web.url="https://one.test/page" .kind=web',
      'backlinks',
    ])
    assertEquals(query.has('kind'), false)
  } finally {
    globalThis.fetch = priorFetch
    if (priorChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome')
    else Reflect.set(globalThis, 'chrome', priorChrome)
  }
})
