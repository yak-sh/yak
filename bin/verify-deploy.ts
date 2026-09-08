#!/usr/bin/env -S deno run -A
// bin/verify-deploy — what a human did by hand after the last two deploys
// (T-33808 C-34027, T-34085 C-34090), written down so CI can do it.
//
// Three questions, in the order a break would show up:
//
//   1. do public pages answer 200 and /connect preserve its sign-in destination
//   2. does the connector door still list its one public tool
//   3. does three minutes of live traffic carry a 5xx or an exception
//
// It is CREDENTIAL-FREE on purpose. Every door below is reachable by a
// stranger, and a check that cannot sign in cannot mint a person, spend a
// sign-in code, send a letter or open a Stripe session — the doors right next
// to these that do exactly that (identity.ts POST /login, billing.ts
// /api/billing/*). The one tool it calls is `about`, which reads nothing
// (preauth.ts PUBLIC). Nothing here writes.
//
//   deno task verify:yak                         # doors, /mcp, 3 min of tail
//   deno task verify:yak --staging               # yaks.fyi and yak-staging
//   deno run -A bin/verify-deploy.ts --tail 0    # doors and /mcp, no credential
//
// Exit 0 means the deploy is good; anything else is the list of what broke, one
// line each, and the answer is `npx wrangler rollback <prior version>`.
//
// Run by hand after a Workers Builds deploy goes green, not by CI — the reason
// is in workers/yak/README.md, and it is that nothing in CI knows when the new
// version went live, nor holds the token the tail needs.

export let SITE = 'https://yaks.app'

// The doors a visitor actually walks through: the four nav links, the CTA,
// help, and the guide the connector serves as its one resource. Spelled
// without `.html` — the assets binding answers a spelled-out page with a 307.
export let DOORS = [
  '/',
  '/pricing',
  '/technical',
  '/help',
  '/login',
  '/connect',
  '/guide.md',
]

// The pricing page's live contract (billing_workerd_test.ts): the price is on
// the page, and the page does not leak the checkout door to a stranger.
export let PRICING = { has: '$4', hasnt: 'checkout.stripe.com' }

export type Fetch = typeof fetch

// One door, one verdict. `null` is fine; a string is what to print.
export let door = async (get: Fetch, site: string, path: string) => {
  let res = await get(site + path, { redirect: 'manual' })
    .catch((e: Error) => e)
  if (res instanceof Error) return `${path}: ${res.message}`
  let body = await res.text()
  // identity.ts `theirs` sends an anonymous visitor through sign-in while
  // preserving the setup destination. A different redirect is a broken door.
  if (path == '/connect') {
    let want = '/login?return=%2Fconnect'
    let location = res.headers.get('location')
    return res.status == 303 && location == want
      ? null
      : `${path}: ${res.status} ${
        location ?? '(no location)'
      }, want 303 ${want}`
  }
  if (res.status != 200) return `${path}: ${res.status}, want 200`
  if (path != '/pricing') return null
  if (!body.includes(PRICING.has)) {
    return `${path}: no ${PRICING.has} on the page`
  }
  if (body.includes(PRICING.hasnt)) return `${path}: leaks ${PRICING.hasnt}`
  return null
}

// The connector door, anonymous: one stateless JSON-RPC POST, no handshake and
// no Origin header (route.ts refuses a foreign one). It must list `about`.
export let connector = async (get: Fetch, site: string) => {
  let res = await get(`${site}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  }).catch((e: Error) => e)
  if (res instanceof Error) return `/mcp: ${res.message}`
  if (res.status != 200) return `/mcp: ${res.status}, want 200`
  let seen = await res.json().catch(() => null)
  let names = (seen?.result?.tools ?? []).map((t: { name: string }) => t.name)
  return names.includes('about')
    ? null
    : `/mcp: tools/list has no \`about\` (${names.join(', ') || 'nothing'})`
}

/// fault({ event: { response: { status: 500 }, request: { url: '/x' } } }) -> '5xx /x'
/// fault({ event: { response: { status: 404 } } }) -> null
/// fault({ exceptions: [{ name: 'TypeError', message: 'nope' }] }) -> 'TypeError: nope'
/// fault({}) -> null
// A line of `wrangler tail --format json`. A 4xx is a visitor asking for
// something that is not there; a 5xx or a thrown exception is us.
type Row = {
  event?: { response?: { status?: number }; request?: { url?: string } }
  exceptions?: { name?: string; message?: string }[]
  [rest: string]: unknown
}
export let fault = (row: Row) => {
  let thrown = row.exceptions?.[0]
  if (thrown) return `${thrown.name}: ${thrown.message}`
  let status = row.event?.response?.status ?? 0
  return status >= 500 ? `5xx ${row.event?.request?.url ?? '?'}` : null
}

// The doors and the connector, as one list of complaints.
export let verify = async (get: Fetch = fetch, site = SITE) => {
  let out = await Promise.all([
    ...DOORS.map((p) => door(get, site, p)),
    connector(get, site),
  ])
  return out.filter((x): x is string => x != null)
}

// Live traffic for `secs`, through the Worker's one wrangler door
// (workers/yak/wrangler.ts: the pinned version, install included). Returns
// [events, faults]: a tail that saw nothing is not a pass and not a failure —
// it is a quiet Saturday — so the caller prints the count and only the faults
// decide.
export let WRANGLER = [
  'run',
  '--allow-read',
  '--allow-write',
  '--allow-run=npm,npx',
  'workers/yak/wrangler.ts',
]

/// events('{"a":1}\n{\n  "b": 2\n}\nwarning\n{\n  "c": 3') -> [[{ a: 1 }, { b: 2 }], '{\n  "c": 3']
// `wrangler tail --format json` pretty-prints each event over many lines and
// mixes its own diagnostics into the same stdout, so an event is the text from
// a line that opens an object to the line that closes it, and anything that
// does not parse is a diagnostic. Returns the rows plus the unfinished tail.
export let events = (text: string): [Row[], string] => {
  let rows: Row[] = []
  let open: string[] = []
  let lines = text.split('\n')
  let rest = lines.pop() ?? ''
  for (let line of lines) {
    if (!open.length && !line.startsWith('{')) continue
    open.push(line)
    if (line == '}' || (open.length == 1 && line.endsWith('}'))) {
      try {
        rows.push(JSON.parse(open.join('\n')))
      } catch {
        // a diagnostic that happened to open with a brace
      }
      open = []
    }
  }
  return [rows, [...open, rest].join('\n')]
}

export let tail = async (secs: number, staging = false) => {
  let faults: string[] = []
  let seen = 0
  let child = new Deno.Command(Deno.execPath(), {
    args: [
      ...WRANGLER,
      'tail',
      '--format',
      'json',
      ...(staging ? ['--env', 'staging'] : []),
    ],
    stdout: 'piped',
    stderr: 'null',
  }).spawn()
  let stop = setTimeout(() => child.kill('SIGINT'), secs * 1000)
  let rest = ''
  for await (let chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
    let rows: Row[]
    ;[rows, rest] = events(rest + chunk)
    for (let row of rows) {
      seen++
      let bad = fault(row)
      if (bad) faults.push(bad)
    }
  }
  clearTimeout(stop)
  await child.status
  return [seen, faults] as const
}

export let main = async (args = Deno.args, get = fetch, follow = tail) => {
  let staging = args.includes('--staging')
  let site = staging ? 'https://yaks.fyi' : SITE
  let secs = args.includes('--tail') ? +args[args.indexOf('--tail') + 1] : 180
  let broke = await verify(get, site)
  for (let line of broke) console.error(`FAIL ${line}`)
  if (!broke.length) {
    console.log(`ok  ${site}: ${DOORS.length} doors, /mcp lists about`)
  }
  if (broke.length || !secs) return broke.length ? 1 : 0

  let [events, faults] = await follow(secs, staging)
  for (let line of faults) console.error(`FAIL ${line}`)
  console.log(`ok  ${secs}s tail: ${events} events, ${faults.length} faults`)
  return faults.length ? 1 : 0
}

if (import.meta.main) Deno.exit(await main())
