/// <reference lib="deno.ns" />
// The door: what a Worker request carries, and what the api makes of it.

import { assertEquals, assertRejects } from '@std/assert'
import { Unauthorized } from '@yaks/api'
import { bearer, cookies, door } from './door.ts'
import { req } from './harness.ts'

let carrying = (headers: Record<string, string>) => req('/query', { headers })

Deno.test('cookies come back by name, and a missing header is empty', () => {
  assertEquals(
    cookies(carrying({ cookie: 'a=1; shop_session=t%20ok; b=2' })),
    { a: '1', shop_session: 't ok', b: '2' },
  )
  assertEquals(cookies(carrying({})), {})
  assertEquals(cookies(carrying({ cookie: 'nonsense; =2' })), {})
  assertEquals(cookies(carrying({ cookie: 'a=%%' })), { a: '%%' })
})

Deno.test('a bearer token is read whatever case the scheme is in', () => {
  assertEquals(bearer(carrying({ authorization: 'Bearer abc' })), 'abc')
  assertEquals(bearer(carrying({ authorization: 'bearer abc' })), 'abc')
  assertEquals(bearer(carrying({ authorization: 'Basic abc' })), null)
  assertEquals(bearer(carrying({ authorization: 'Bearer' })), null)
  assertEquals(bearer(carrying({})), null)
})

Deno.test('the cookie is read first, the bearer second', async () => {
  let seen: string[] = []
  let ada = door({
    cookie: 'shop_session',
    verify: (token) => {
      seen.push(token)
      return { eid: 'm1' }
    },
  })

  assertEquals(
    await ada(
      carrying({ cookie: 'shop_session=c', authorization: 'Bearer b' }),
    ),
    { eid: 'm1' },
  )
  assertEquals(await ada(carrying({ authorization: 'Bearer b' })), {
    eid: 'm1',
  })
  assertEquals(seen, ['c', 'b'])
})

Deno.test('nobody writes unattributed, unless the door is required', async () => {
  let open = door({ verify: () => null })
  assertEquals(await open(carrying({})), null)
  assertEquals(await open(carrying({ authorization: 'Bearer b' })), null)

  let shut = door({ verify: () => null, required: true })
  await assertRejects(() => Promise.resolve(shut(carrying({}))), Unauthorized)
  await assertRejects(
    () => Promise.resolve(shut(carrying({ authorization: 'Bearer b' }))),
    Unauthorized,
  )
})
