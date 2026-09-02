// The route table as data: hostname + path in, (space, app, path) out.
import { assertEquals } from '@std/assert'
import { hostOf, route } from './route.ts'

let cases: [string, string, ReturnType<typeof route>][] = [
  ['yaks.app', '/', { space: null, app: null, path: '/' }],
  ['yaks.app', '/login', { space: null, app: null, path: '/login' }],
  ['yak.workers.dev', '/x', { space: null, app: null, path: '/x' }],
  ['127.0.0.1', '/', { space: null, app: null, path: '/' }],
  ['jeff.yaks.app', '/', { space: 'jeff', app: null, path: '/' }],
  ['jeff.yaks.app', '/recipes', { space: 'jeff', app: 'recipes', path: '' }],
  ['jeff.yaks.app', '/recipes/', { space: 'jeff', app: 'recipes', path: '/' }],
  ['jeff.yaks.app', '/recipes/api/query', {
    space: 'jeff',
    app: 'recipes',
    path: '/api/query',
  }],
  ['jeff.yaks.app', '/Not_A_Slug/x', {
    space: 'jeff',
    app: null,
    path: '/Not_A_Slug/x',
  }],
  // two levels down is nobody's space; neither is another domain
  ['a.b.yaks.app', '/', { space: null, app: null, path: '/' }],
  ['example.com', '/', { space: null, app: null, path: '/' }],
]

Deno.test('route: hostname and path name the space, app, and the rest', () => {
  for (let [host, path, want] of cases) {
    assertEquals(route(host, path), want, `${host}${path}`)
  }
})

Deno.test('hostOf: x-yak-host stands in on a dev host only', () => {
  let at = (url: string, host?: string) =>
    hostOf(new Request(url, { headers: host ? { 'x-yak-host': host } : {} }))
  assertEquals(at('http://127.0.0.1:8787/', 'Jeff.yaks.app'), 'jeff.yaks.app')
  assertEquals(at('http://yak.workers.dev/', 'jeff.yaks.app'), 'jeff.yaks.app')
  assertEquals(at('http://127.0.0.1:8787/'), '127.0.0.1')
  assertEquals(at('https://yaks.app/', 'jeff.yaks.app'), 'yaks.app')
  assertEquals(at('https://maya.yaks.app/', 'jeff.yaks.app'), 'maya.yaks.app')
})
