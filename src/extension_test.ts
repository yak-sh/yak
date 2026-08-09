// The browser popup's pure draft seam: popup lifetimes and network responses
// may end in either order, but neither may erase text the user did not file.
import { assertEquals } from '@std/assert'
import { filed, recall, remember } from '../extension/draft.js'

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
