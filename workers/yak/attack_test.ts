// Sign-in and identity, attacked, held in workerd (T-37872). Each test is one
// hole the 2026-09-22 audit proved on a local kernel, fired again at the
// kernel exactly as it was fired then, beside the traffic that must keep
// working. The root that made most of them reachable is the platform's shape:
// yaks.app is not on the Public Suffix List, so every `<space>.yaks.app` app is
// same-site with the apex, and anybody can serve code from a free space.
import { assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { COOKIE } from '../../src/token.ts'
import { kernel, signIn } from './probe.ts'
import { granting } from './dispatch.ts'

slow(
  'a token minted for anything but a session is no cookie (T-37873)',
  async () => {
    let k = await kernel()
    try {
      let me = await signIn(k)
      // What an app's worker is handed for every signed-in visitor: sealed by
      // the kernel, naming the person, alive for a minute. Set as the cookie,
      // it must not mint a standing link, the door that turned it into a year.
      let visit = await granting(k.secret, 'eve/trap', {
        person: me.person,
        role: 'owner',
      })
      let mintLink = (cookie: string) =>
        k.at('yaks.app', '/login/link', {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'days=365',
        })
      let stolen = await mintLink(`${COOKIE}=${visit}`)
      assertEquals(stolen.status, 401)
      assertEquals(stolen.headers.get('set-cookie'), null)
      await stolen.body?.cancel()
      // The session itself still mints one.
      let own = await mintLink(me.cookie)
      assertEquals(own.status, 200)
      await own.body?.cancel()
    } finally {
      await k.stop()
    }
  },
)
