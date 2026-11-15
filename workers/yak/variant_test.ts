// Which home page a request is shown (variant.ts): the one at its path.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { shown } from './variant.ts'

let visit = (path: string, cookie = '') =>
  new Request(`https://yaks.app${path}`, { headers: { cookie } })

test('every visitor to / is shown "ask", whatever cookie they hold', () => {
  for (let cookie of ['', 'yak_home=describe', 'yak_home=church']) {
    assertEquals(shown(visit('/', cookie))?.name, 'ask', cookie)
  }
})

test('a home page shows at its own address', () => {
  for (
    let [path, name] of [['/build', 'describe'], ['/churches', 'church']]
  ) {
    assertEquals(shown(visit(path))?.name, name)
  }
})

test('a request for any other page shows none', () => {
  assertEquals(shown(visit('/login', 'yak_home=church')), undefined)
})
