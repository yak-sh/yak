import { assertEquals } from '@std/assert'
import { type Route, routed } from '@yaks/api'
import { docDoc } from '@yaks/doc'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { taskDoc } from '@yaks/task'
import { loadVocab } from '@yaks/vocab'
import { letters, routes, shell } from './routes.ts'

let vocab = loadVocab([kernelDoc, docDoc, taskDoc], [kernelKeywords])
let table = routes({ config: { name: 'yak' }, vocab })

let reached = (path: string): Route | undefined =>
  table.find((r) => routed(r, 'GET', path))

Deno.test('every id letter the vocabulary uses has a route, in both cases', () => {
  let ls = letters(vocab)
  for (let l of ['T', 't', 'D', 'd']) assertEquals(ls.includes(l), true, l)
  for (let path of ['/', '/T-9', '/t-9', '/T', '/D-3']) {
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

Deno.test('the page escapes the name it is titled with', () => {
  assertEquals(shell('<b>&').includes('<title>&#60;b&#62;&#38;</title>'), true)
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
