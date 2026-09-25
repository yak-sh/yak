import './testing.ts'
import { assertEquals } from '@std/assert'
import { type Route, routed } from '@yaks/api'
import { docDoc } from '@yaks/doc'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { taskDoc } from '@yaks/task'
import { loadVocab } from '@yaks/vocab'
import { letters, routes } from './routes.ts'

let vocab = loadVocab([kernelDoc, docDoc, taskDoc], [kernelKeywords])
let table = routes({ vocab })

let reached = (path: string): Route | undefined =>
  table.find((r) => routed(r, 'GET', path))

Deno.test('every id letter the vocabulary uses has a route, in both cases', () => {
  let ls = letters(vocab)
  for (let l of ['T', 't', 'D', 'd']) assertEquals(ls.includes(l), true, l)
  for (
    let path of [
      '/',
      '/T-9',
      '/t-9',
      '/T',
      '/T%23abc123',
      '/D-3',
      '/admin/task',
    ]
  ) {
    assertEquals(reached(path)?.method, 'GET', path)
  }
})

Deno.test('the doors the api serves are not claimed', () => {
  for (
    let path of ['/query', '/apply', '/ws', '/mcp', '/blob/abc', '/page/x']
  ) {
    assertEquals(reached(path), undefined, path)
  }
})

Deno.test('every address answers the one page, which loads the bundled app', async () => {
  let page = await reached('/T-9')!.handle(new Request('http://x/T-9'))
  assertEquals(page.headers.get('content-type'), 'text/html; charset=utf-8')
  assertEquals((await page.text()).includes('src="/web/app.js"'), true)
})

Deno.test('the vocabulary is served with a tag the browser revalidates', async () => {
  let get = (headers: HeadersInit = {}) =>
    reached('/web/vocab.json')!.handle(
      new Request('http://x/web/vocab.json', { headers }),
    )
  let first = await get()
  assertEquals(JSON.parse(await first.text()).length, 3)
  let tag = first.headers.get('etag')!
  assertEquals((await get({ 'if-none-match': tag })).status, 304)
})
