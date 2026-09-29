import { assert, assertEquals } from '@std/assert'
import { routes } from './routes.ts'

Deno.test('/ui answers the style guide, dressed, with no script', async () => {
  let [ui] = routes()
  assertEquals([ui.method, ui.path], ['GET', '/ui'])
  let res = await ui.handle(new Request('http://box/ui'))
  assertEquals(res.headers.get('content-type'), 'text/html; charset=utf-8')
  let page = await res.text()
  assert(page.includes('<span class="Dot Dot-ring"></span>'))
  assert(page.includes('--bg:'))
  assert(!page.includes('<script'))
})
