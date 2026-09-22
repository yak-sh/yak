// Per-source ceilings on the doors anybody can knock on without signing in
// (T-37884): asking for a sign-in code, registering an OAuth client, calling
// the connector anonymously, sending feedback anonymously, and reading an
// open or public app's data. Each door has its own Workers Rate Limiting
// binding (wrangler.toml `[[ratelimits]]`, where the numbers live), keyed by
// the address Cloudflare saw the request come from. A visitor writing to an
// open app is held the same way, per app (apps.ts `visiting`, `VISITS`).
//
// The per-address cap on sign-in letters (signin.ts SENDS) stays: that one
// protects an inbox from a stranger, this one protects the platform from a
// loop. A counter a stranger can spend for everybody (the shared feedback
// bucket this replaced) is the thing never to build: one loop would silence
// every other stranger.
//
// The binding is a fixed window counted per Cloudflare location, so it is a
// brake, not an exact ledger. That is what these doors want: a person clicks
// a few times a minute and a loop thousands.
//
// A request with no `cf-connecting-ip` did not come in from the internet (a
// Worker's own subrequest, an in-process test) and is not limited; Cloudflare
// sets the header on every request that reaches the edge and a client cannot
// choose it. A limiter that throws is not a refusal either: a broken counter
// never locks a person out.
import { caught } from './sentry.ts'

// The binding's shape (@cloudflare/workers-types `RateLimit`), spelled here so
// no Cloudflare type name leaks into env.ts.
export type Limiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** The address a request came from, or '' when it came from inside. */
export let source = (req: Request) => req.headers.get('cf-connecting-ip') ?? ''

/** May this source go on through this door? */
export let within = async (lim: Limiter | undefined, key: string) => {
  if (!lim || !key) return true
  try {
    return (await lim.limit({ key })).success
  } catch (e) {
    caught(e, { request: 'rate limit' })
    return true
  }
}

// Every binding's period is a minute (wrangler.toml), so a minute is when to
// come back.
export let RETRY = 60

/** The refusal a door answers when a source is over its rate, for a door that
 * answers HTTP rather than a tool result. */
export let tooMany = (said = 'Too many requests from one place. ') =>
  new Response(`${said}Try again in a minute.`, {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(RETRY),
    },
  })
