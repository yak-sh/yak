import { equal, test } from '@yaks/testing'
import { authorize, canaryHeaders, sign } from './auth.ts'

let now = Date.now(), secret = 'reader-key'
let scope = crypto.randomUUID()
let access = { scope, person: 'person', exp: Math.floor(now / 1000) + 60 }
let token = await sign(access, secret)
let bearer = { authorization: `Bearer ${token}` }
let socket = { upgrade: 'websocket' }
for (
  let [name, path, headers, accepted] of [
    ['header', '/query', bearer, true],
    ['query string', `/query?ticket=${token}`, {}, false],
    ['WebSocket ticket', `/ws?ticket=${token}`, socket, true],
    ['plain HTTP socket path', `/ws?ticket=${token}`, {}, false],
  ] as const
) {
  test(`tracker authorizes ${name} only on its intended transport`, async () => {
    equal(
      !!await authorize(
        new Request(`https://tracker.test${path}`, { headers }),
        secret,
        scope,
        now,
      ),
      accepted,
    )
  })
}
let hash = 'a'.repeat(64)
let canary = new Request('https://tracker.test/canary', {
  headers: await canaryHeaders('build-key', hash, now),
})
test('canary capabilities expire and grant only their bundle under their own key', async () => {
  for (
    let [key, asked, time, accepted] of [
      ['build-key', hash, now, true],
      [secret, hash, now, false],
      ['build-key', 'b'.repeat(64), now, false],
      ['build-key', hash, now + 60_000, false],
    ] as const
  ) {
    equal(!!await authorize(canary, key, `canary:${asked}`, time), accepted)
  }
  equal(await authorize(canary, 'build-key', 'platform', now), null)
})
