// The per-source ceilings on the anonymous doors (rate.ts, T-37884), held by
// the Workers Rate Limiting bindings wrangler.toml declares. `wrangler dev`
// enforces those locally, so this drives the kernel the way a loop would:
// from one address, past each door's number, and then from another address
// that is still let in. The window is a fixed minute counted from the epoch,
// so the whole run starts where half a minute is left in it.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow, until } from '../../bin/testing.ts'
import { connector, kernel, seed } from './probe.ts'

let from = (ip: string) => ({ 'cf-connecting-ip': ip })

slow(
  'a stranger is held to a rate per source at every anonymous door',
  async () => {
    let k = await kernel()
    try {
      let them = await seed(k, [{ slug: 'rated', apps: ['board'] }])
      await connector(k, them.cookie).tool('app_set', {
        space: 'rated',
        app: 'board',
        access: 'public',
      })
      await until(() => Date.now() % 60_000 < 30_000, {
        timeout: 60_000,
        poll: 250,
        label: 'the start of a rate window',
      })

      // Sign-in codes: five a minute from one place, whatever the address.
      let login = (ip: string) =>
        k.at(k.host, '/login', {
          method: 'POST',
          headers: {
            ...from(ip),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            email: `rate-${crypto.randomUUID().slice(0, 8)}@${k.host}`,
          }).toString(),
        })
      for (let i = 0; i < 5; i++) {
        let r = await login('198.51.100.1')
        assertEquals(r.status, 200, await r.text())
      }
      let held = await login('198.51.100.1')
      assertEquals(held.status, 429)
      assertStringIncludes(await held.text(), 'Too many codes')
      let other = await login('198.51.100.2')
      assertEquals(other.status, 200)
      await other.body?.cancel()

      // OAuth client registration: ten a minute.
      let register = (ip: string) =>
        k.at(k.host, '/oauth/register', {
          method: 'POST',
          headers: { ...from(ip), 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'a rate probe',
            redirect_uris: ['https://probe.invalid/cb'],
            token_endpoint_auth_method: 'none',
          }),
        })
      for (let i = 0; i < 10; i++) {
        let r = await register('198.51.100.3')
        assertEquals(r.status, 201, await r.text())
      }
      let refused = await register('198.51.100.3')
      assertEquals(refused.status, 429)
      assertEquals((await refused.json()).error, 'too_many_requests')

      // Anonymous connector calls: sixty a minute. Feedback, one a minute, is
      // its own count on top, so one stranger's note leaves another's alone.
      let n = 0
      let call = async (ip: string, name: string, args: unknown = {}) => {
        let r = await k.at(k.host, '/mcp', {
          method: 'POST',
          headers: { ...from(ip), 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++n,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        })
        assertEquals(r.status, 200)
        let out = (await r.json()).result
        return { text: String(out.content[0].text), err: !!out.isError }
      }
      let note = { text: 'The rate probe says hello.' }
      assertEquals((await call('198.51.100.4', 'feedback', note)).err, false)
      let again = await call('198.51.100.4', 'feedback', note)
      assert(again.err)
      assertStringIncludes(again.text, 'one already this minute')
      assertEquals((await call('198.51.100.5', 'feedback', note)).err, false)
      for (let i = 0; i < 58; i++) {
        assertEquals((await call('198.51.100.4', 'about')).err, false, `${i}`)
      }
      let stopped = await call('198.51.100.4', 'about')
      assert(stopped.err)
      assertStringIncludes(stopped.text, 'Too many calls')

      // A public app's data: three hundred requests a minute from a stranger,
      // and its own people are not counted at all.
      let read = (ip: string, cookie?: string) =>
        k.at('rated.yaks.app', '/board/api/query?.doc', {
          headers: { ...from(ip), ...(cookie ? { cookie } : {}) },
        })
      for (let i = 0; i < 300; i++) {
        let r = await read('198.51.100.6')
        assertEquals(r.status, 200, `${i}`)
        await r.body?.cancel()
      }
      let over = await read('198.51.100.6')
      assertEquals(over.status, 429)
      assertEquals(over.headers.get('retry-after'), '60')
      await over.body?.cancel()
      let owner = await read('198.51.100.6', them.cookie)
      assertEquals(owner.status, 200)
      await owner.body?.cancel()
    } finally {
      await k.stop()
    }
  },
)
