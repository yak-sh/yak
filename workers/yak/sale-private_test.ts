import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { artifactPermit, artifactTicket, mayReceive } from './sale-private.ts'
import { seal } from './lib/token.ts'

test('customer authority follows the person, with guest browser continuation', () => {
  assertEquals(
    mayReceive({ buyer: 'ana', via: 'browser' }, { person: 'ana' }),
    true,
  )
  assertEquals(
    mayReceive({ buyer: 'ana', via: 'browser' }, {
      person: 'bo',
      via: 'browser',
    }),
    false,
  )
  assertEquals(
    mayReceive({ via: 'browser' }, { person: 'ana', via: 'browser' }),
    true,
  )
  assertEquals(mayReceive({}, {}), false)
})

test('artifact tickets cannot change tenant, content, expiry or purpose', async () => {
  let token = await artifactTicket('app-a', 'pdf-a', 'secret', 1000)
  assertEquals(
    await artifactPermit(token, 'app-a', 'pdf-a', 'secret', 1001),
    true,
  )
  let session = await seal('session', {
    app: 'app-a',
    sha: 'pdf-a',
    exp: 901000,
  }, 'secret')
  assertEquals(
    await artifactPermit(session, 'app-a', 'pdf-a', 'secret', 1001),
    false,
  )
  for (
    let [app, sha, secret, now] of [
      ['app-b', 'pdf-a', 'secret', 1001],
      ['app-a', 'pdf-b', 'secret', 1001],
      ['app-a', 'pdf-a', 'other-secret', 1001],
      ['app-a', 'pdf-a', 'secret', 901000],
    ] as [string, string, string, number][]
  ) {
    assertEquals(await artifactPermit(token, app, sha, secret, now), false)
  }
})

test('earlier guest artifact entitlement follows only its person’s fresh browser claims', () => {
  assertEquals(
    mayReceive({ via: '00000000-0000-4000-8000-000000000001' }, {
      person: 'ana',
      via: '00000000-0000-4000-8000-000000000002',
      browsers: ['00000000-0000-4000-8000-000000000001'],
    }),
    true,
  )
  assertEquals(
    mayReceive({ via: '00000000-0000-4000-8000-000000000001' }, {
      person: 'bo',
      via: '00000000-0000-4000-8000-000000000001',
      browsers: [],
    }),
    false,
  )
  assertEquals(
    mayReceive({ buyer: 'ana', via: '00000000-0000-4000-8000-000000000001' }, {
      person: 'bo',
      browsers: ['00000000-0000-4000-8000-000000000001'],
    }),
    false,
  )
})
