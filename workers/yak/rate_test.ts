// The anonymous doors spend their own binding's allowance and leave other
// sources alone. Small counters exercise the same boundary in a few requests.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { connector, fresh, seed, unique } from './probe.ts'
import { limiter } from './binding-probe.ts'

let source = unique('rate').slice(-8)
let from = (ip: string, prefix = source.slice(0, 4)) => ({
  'cf-connecting-ip': `2001:db8:${prefix}:${source.slice(4)}::${ip}`,
})

let seen = async (r: Response) => ({
  status: r.status,
  text: await r.text(),
  retry: r.headers.get('retry-after'),
})

// `n` sends at once.
let burst = <T>(n: number, send: () => Promise<T>) =>
  Promise.all(Array.from({ length: n }, send))

// The one answer of a burst the door turned away.
let one = <T>(answers: T[], away: (a: T) => boolean) => {
  let out = answers.filter(away)
  assertEquals(out.length, 1, `${out.length} of ${answers.length} turned away`)
  return out[0]
}

let rated58 = unique('rated58')

test(
  'a stranger is held to a rate per source at every anonymous door',
  async () => {
    let k = await fresh({
      SIGNIN_RATE: limiter(2, 60),
      REGISTER_RATE: limiter(2, 60),
      TOOL_RATE: limiter(2, 60),
      FEEDBACK_RATE: limiter(1, 60),
      API_RATE: limiter(2, 60),
    })
    try {
      let them = await seed(k, [{ slug: rated58, apps: ['board'] }])
      await connector(k, them.cookie).tool('app_set', {
        space: rated58,
        app: 'board',
        access: 'public',
      })

      // Sign-in codes are shared by all addresses in one /48.
      let login = (headers: Record<string, string>) =>
        k.at(k.host, '/login', {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            email: `${unique('rate')}@${k.host}`,
          }).toString(),
        }).then(seen)
      let codes = await burst(2, () => login(from('198.51.100.1')))
      assertEquals(codes.map((r) => r.status), [200, 200])
      let held = await login({
        'cf-connecting-ip': `2001:db8:${source.slice(0, 4)}::2`,
      })
      assertEquals(held.status, 429)
      assertStringIncludes(held.text, 'Too many codes')
      let other = (parseInt(source.slice(0, 4), 16) ^ 1).toString(16)
      assertEquals((await login(from('198.51.100.1', other))).status, 200)

      // OAuth client registration uses its own counter.
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
      let clients = await burst(3, () => register('198.51.100.3'))
      let refused = one(clients, (r) => r.status != 201)
      assertEquals(refused.status, 429)
      assertEquals(JSON.parse(refused.text).error, 'too_many_requests')

      // Feedback has its own count on top of the anonymous connector limit,
      // so one stranger's note leaves another's alone.
      let n = 0
      let call = async (ip: string, name: string, args: unknown = {}) => {
        let r = await k.at(k.host, '/mcp?auth=mixed', {
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
      let calls = await burst(3, () => call('198.51.100.7', 'about'))
      assertStringIncludes(one(calls, (c) => c.err).text, 'Too many calls')

      // A public app's data counts strangers and lets its own people through.
      let read = (ip: string, cookie?: string) =>
        k.at(`${rated58}.yaks.app`, '/board/api/query?.doc', {
          headers: { ...from(ip), ...(cookie ? { cookie } : {}) },
        }).then(seen)
      let reads = await burst(3, () => read('198.51.100.6'))
      let over = one(reads, (r) => r.status != 200)
      assertEquals([over.status, over.retry], [429, '60'])
      assertEquals((await read('198.51.100.6', them.cookie)).status, 200)

      // A file read by its address is not the app's data: the same stranger,
      // past the number, still gets the answer the file has (here, none).
      let file = await k.at(
        `${rated58}.yaks.app`,
        `/board/api/blob/${'0'.repeat(64)}/${'1'.repeat(64)}`,
        { headers: from('198.51.100.6') },
      )
      assertEquals(file.status, 404)
    } finally {
      await k.stop()
    }
  },
)
