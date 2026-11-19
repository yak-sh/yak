/**
 * `@yaks/workerd/rate` — per-source ceilings on the doors anybody can knock
 * on without signing in. Each door has its own Workers Rate Limiting binding
 * (wrangler.toml `[[ratelimits]]`, where the numbers live), keyed by the
 * address Cloudflare saw the request come from.
 *
 * A counter a stranger can spend for everybody is the thing never to build:
 * one loop would silence every other stranger.
 *
 * The binding is a fixed window counted per Cloudflare location, so it is a
 * brake, not an exact ledger. That is what these doors want: a person clicks
 * a few times a minute and a loop thousands.
 *
 * A request with no `cf-connecting-ip` did not come in from the internet (a
 * Worker's own subrequest, an in-process test) and is not limited; Cloudflare
 * sets the header on every request that reaches the edge and a client cannot
 * choose it. A limiter that throws is not a refusal either: a broken counter
 * never locks a person out, and the caller hears what broke.
 *
 * ```ts
 * import { source, within } from '@yaks/workerd/rate'
 * import { assertEquals } from '@std/assert'
 * let req = new Request('https://x.test/', {
 *   headers: { 'cf-connecting-ip': '2001:db8::1' },
 * })
 * let full = { limit: () => Promise.resolve({ success: false }) }
 * assertEquals(await within(full, source(req), () => {}), false)
 * ```
 *
 * @module
 */

/** The binding's shape (@cloudflare/workers-types `RateLimit`), declared
 * here so no Cloudflare type name leaks into what is given one. */
export type Limiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** The address a request came from, or '' when it came from inside. */
export let source = (req: Request): string =>
  req.headers.get('cf-connecting-ip') ?? ''

/** The network an address belongs to, which is what a door counts: an IPv4
 * address as it is, an IPv6 address its /48, the first three groups written
 * out. A subscriber is handed a whole /64, /56 or /48 and can walk every
 * address in it, so counting a smaller prefix counts one source many times.
 *
 * ```ts
 * import { network } from '@yaks/workerd/rate'
 * import { assertEquals } from '@std/assert'
 * assertEquals(network('203.0.113.9'), '203.0.113.9')
 * assertEquals(network('2001:DB8:0:ff::7'), '2001:db8:0')
 * assertEquals(network('::1'), '0:0:0')
 * ```
 */
export let network = (ip: string): string => {
  if (!ip.includes(':')) return ip
  let [head, tail = ''] = ip.toLowerCase().split('::')
  let front = head ? head.split(':') : []
  let back = ip.includes('::') && tail ? tail.split(':') : []
  let groups = [
    ...front,
    ...Array(8 - front.length - back.length).fill('0'),
    ...back,
  ]
  return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '')).join(':')
}

/** The network a request came from (`network`), the key a door's limiter
 * counts, or '' when it came from inside. */
export let place = (req: Request): string => network(source(req))

/** Who a visitor at a door is: their person, else the address they came
 * from, else (a request from inside) one stranger. */
export let visitorKey = (
  who: { person: string | null },
  req: Request,
): string => who.person ?? (source(req) || 'stranger')

/** May this source go on through this door? A door with no limiter, or a
 * request from inside (no `key`), may. A limiter that throws lets it through,
 * and `failed` hears what it threw. */
export let within = async (
  lim: Limiter | undefined,
  key: string,
  failed: (error: unknown) => void,
): Promise<boolean> => {
  if (!lim || !key) return true
  try {
    return (await lim.limit({ key })).success
  } catch (e) {
    failed(e)
    return true
  }
}

/** Every binding's period is a minute, so a minute is when to come back. */
export let RETRY = 60

/** The refusal a door answers when a source is over its rate, for a door that
 * answers HTTP rather than a tool result. */
export let tooMany = (said = 'Too many requests from one place. '): Response =>
  new Response(`${said}Try again in a minute.`, {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(RETRY),
    },
  })
