// The per-source ceilings on the anonymous doors (rate.ts, T-37884), held by
// the Workers Rate Limiting bindings wrangler.toml declares. `wrangler dev`
// enforces those locally, counting in fixed minutes from the epoch, so each
// door gets one burst sent at once where its minute has time left: one past
// the door's number from one address, of which exactly one is turned away,
// and then another address that is still let in.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { until } from '../../bin/testing.ts'
import { connector, kernel, seed } from './probe.ts'

let from = (ip: string) => ({ 'cf-connecting-ip': ip })

let seen = async (r: Response) => ({
  status: r.status,
  text: await r.text(),
  retry: r.headers.get('retry-after'),
})

// `n` sends at once, ten seconds or more before the minute turns.
let burst = async <T>(n: number, send: () => Promise<T>) => {
  await until(() => Date.now() % 60_000 < 50_000, {
    timeout: 15_000,
    poll: 250,
    label: 'ten seconds left in a rate window',
  })
  return await Promise.all(Array.from({ length: n }, send))
}

// The one answer of a burst the door turned away.
let one = <T>(answers: T[], away: (a: T) => boolean) => {
  let out = answers.filter(away)
  assertEquals(out.length, 1, `${out.length} of ${answers.length} turned away`)
  return out[0]
}

Deno.test(
  'a stranger is held to a rate per source at every anonymous door',
  async () => {
    let k = await kernel()
    try {
      let them = await seed(k, [{ slug: 'rated58', apps: ['board'] }])
      await connector(k, them.cookie).tool('app_set', {
        space: 'rated58',
        app: 'board',
        access: 'public',
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
        }).then(seen)
      let codes = await burst(6, () => login('198.51.100.1'))
      let held = one(codes, (r) => r.status != 200)
      assertEquals(held.status, 429)
      assertStringIncludes(held.text, 'Too many codes')
      assertEquals((await login('198.51.100.2')).status, 200)

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
        }).then(seen)
      let clients = await burst(11, () => register('198.51.100.3'))
      let refused = one(clients, (r) => r.status != 201)
      assertEquals(refused.status, 429)
      assertEquals(JSON.parse(refused.text).error, 'too_many_requests')

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
      let notes = await burst(2, () => call('198.51.100.4', 'feedback', note))
      assertStringIncludes(
        one(notes, (c) => c.err).text,
        'one already this minute',
      )
      assertEquals((await call('198.51.100.5', 'feedback', note)).err, false)
      let calls = await burst(61, () => call('198.51.100.7', 'about'))
      assertStringIncludes(one(calls, (c) => c.err).text, 'Too many calls')

      // A public app's data: three hundred requests a minute from a stranger,
      // and its own people are not counted at all.
      let read = (ip: string, cookie?: string) =>
        k.at('rated58.yaks.app', '/board/api/query?.doc', {
          headers: { ...from(ip), ...(cookie ? { cookie } : {}) },
        }).then(seen)
      let reads = await burst(301, () => read('198.51.100.6'))
      let over = one(reads, (r) => r.status != 200)
      assertEquals([over.status, over.retry], [429, '60'])
      assertEquals((await read('198.51.100.6', them.cookie)).status, 200)
    } finally {
      await k.stop()
    }
  },
)
