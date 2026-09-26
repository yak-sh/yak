// The kernel under test, and how a test drives it. `kernel` is the kernel in
// memory: kernel.ts's handler over the platform testing.ts stands up, one per
// test, on a port of its own. `workerd` is the one kernel a run shares in the
// runtime itself (probe-suite.ts), for what only the runtime has: a socket, a
// letter at its email door, a script beside the kernel. Both are driven over
// HTTP the way a browser or a headless client would — a hostname rides
// `x-yak-host`, since fetch refuses a Host header and the kernel honors ours
// on a dev host (route.ts) — and both are configured alike (`vars`). A test on
// the shared kernel keeps to data of its own: a person `signIn` mints, a space
// or an address nobody else uses.
//
// `script` below runs a Worker that is not the kernel at all — the modules an
// app's own script is made of — in the same workerd, beside it.
import { apex } from './host.ts'
import { b64u } from './mcp-probe.ts'
import { until } from '../../bin/testing.ts'
import { COOKIE, sign, verify } from './lib/token.ts'
import type { Custom } from './domains.ts'
import type { Bundle } from '@yaks/graph'
import { parse } from '@std/toml'

/** What the run's kernel checks a Stripe event against, at both doors
 * (probe-suite.ts). */
export let WEBHOOK_SECRET = 'probe-webhook-secret'

/** The OpenAI apps challenge token the run's kernel serves. */
export let CHALLENGE = 'probe-openai-apps-challenge'

// Every probe request arrives from a place of its own, since the kernel holds
// strangers to a rate per source (rate.ts) and a suite's dozen sign-ins are
// not one loop. A test about a rate names its source in the headers, which
// win, and an anonymous `client` keeps one for its life.
let byte = () => crypto.getRandomValues(new Uint8Array(1))[0]
let somewhere = () => ({ 'cf-connecting-ip': `198.18.${byte()}.${byte()}` })

/** A kernel at `base`, driven over HTTP: one request, at one hostname.
 * `log` is where its letters land and `cloudflare` the stand-in for
 * Cloudflare's API it talks to (`cloudflare`). */
export let driven = (
  base: string,
  secret: string,
  log: string,
  host: string,
  cloudflare: string,
) => ({
  base,
  secret,
  log,
  host,
  cloudflare,
  at: (at: string, path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...somewhere(),
        ...(init.headers as Record<string, string>),
        'x-yak-host': at,
      },
    }),
})

/** A person signed in (`signIn`): who, the cookie, and the code that did it. */
export type Person = {
  person: string
  cookie: string
  email: string
  code: string
  name: string
}

/** A kernel's door (`driven`). */
export type Door = ReturnType<typeof driven>

/** A kernel as a test holds it: its door, the person who owns its meta space
 * (`meta`), what the test bought in the Stripe sandbox, and its stop. */
export type Kernel = Door & {
  owner: Person
  bought: Set<string>
  stop: () => Promise<void>
}

let want = (name: string) => {
  let value = Deno.env.get(name)
  if (!value) {
    throw new Error(
      `${name} is unset: a workerd test runs in the workerd pass of ` +
        '`deno task test`, which starts the one kernel a run shares ' +
        '(probe-suite.ts)',
    )
  }
  return value
}

// What a test bought in the Stripe sandbox (`subscribed`) goes in `bought`: a
// subscription left active renews every month, and each renewal is a webhook
// to staging, so every test stops its kernel in a `finally` and the stop
// cancels whatever is still live, then `close`s what the kernel holds.
let owning = <K extends Door>(k: K, close = () => Promise.resolve()) => {
  let bought = new Set<string>()
  let stop = async () => {
    try {
      for (let id of bought) await unsubscribed(id)
    } finally {
      await close()
    }
  }
  return { ...k, bought, stop }
}

/**
 * What a test run's kernels are configured with beside wrangler.toml's own
 * vars: the session secret, Cloudflare's account API at `cloudflare` (the
 * stand-in, for mail and domains alike), the Stripe signing secrets, and the
 * Stripe sandbox when the run has a key (bin/test.ts).
 */
export let vars = (secret: string, cloudflare: string) => {
  let stripe = Deno.env.get('STRIPE_KEY')
  let price = Deno.env.get('STRIPE_PRICE')
  return {
    SESSION_SECRET: secret,
    MAIL_TOKEN: 'a-token',
    MAIL_API: cloudflare,
    CF_ZONE: 'zone',
    CF_HOSTNAMES_TOKEN: 'a-token',
    HOSTNAMES_API: cloudflare,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    OPENAI_APPS_CHALLENGE: CHALLENGE,
    ...stripe ? { STRIPE_KEY: stripe } : {},
    ...price ? { STRIPE_PRICE: price } : {},
  }
}

type Toml = {
  vars: Record<string, string>
  ratelimits: { name: string; simple: { limit: number; period: number } }[]
}
let toml = () =>
  parse(
    Deno.readTextFileSync(new URL('./wrangler.toml', import.meta.url)),
  ) as Toml

/**
 * The kernel in memory, for one test: kernel.ts's handler over the platform
 * testing.ts stands up, with wrangler.toml's vars and rate limits and the
 * run's config (`vars`), served on a port of its own. Its owner signs in
 * first, as the shared kernel's does, since the first person to sign in owns
 * the meta space.
 */
export let kernel = async (): Promise<Kernel> => {
  // Loaded when a test asks: the runner imports this module for its Stripe
  // helpers and has no use for the kernel's whole graph.
  let [{ handler }, { emailed, limiter, platform }] = await Promise.all([
    import('./kernel.ts'),
    import('./testing.ts'),
  ])
  let secret = crypto.randomUUID()
  let log = Deno.makeTempFileSync({ prefix: 'yak-mail-' })
  let cf = cloudflare(log)
  let { vars: own, ratelimits } = toml()
  let p = platform(secret, {
    ...own,
    ...vars(secret, cf.url),
    // What the runtime binds beside the config: this deploy's id, and the
    // `send_email` binding an app's letters leave through.
    CF_VERSION_METADATA: { id: crypto.randomUUID() },
    MAIL: cf.binding,
    ...Object.fromEntries(
      ratelimits.map((r) => [r.name, limiter(r.simple.limit, r.simple.period)]),
    ),
  })
  let server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (req) =>
      new URL(req.url).pathname == '/cdn-cgi/handler/email'
        ? emailed(req, handler.email, p.env)
        : handler.fetch(req, p.env),
  )
  let ticking = setInterval(p.ring, 10)
  let close = async () => {
    clearInterval(ticking)
    await server.shutdown()
    await cf.stop()
    p[Symbol.dispose]()
    Deno.removeSync(log)
  }
  let door = driven(
    `http://127.0.0.1:${server.addr.port}`,
    secret,
    log,
    apex(),
    cf.url,
  )
  try {
    return owning(
      { ...door, owner: await signIn(door, `owner@${apex()}`) },
      close,
    )
  } catch (e) {
    await close()
    throw e
  }
}

/** The run's kernel in workerd (probe-suite.ts), as one test holds it. */
export let workerd = () =>
  owning({
    ...driven(
      want('YAK_PROBE'),
      want('YAK_PROBE_SECRET'),
      want('YAK_PROBE_MAIL'),
      apex(),
      want('YAK_PROBE_CLOUDFLARE'),
    ),
    owner: JSON.parse(want('YAK_PROBE_OWNER')) as Person,
  })

let unsubscribed = async (id: string) => {
  let key = stripeKey()
  let path = `/v1/subscriptions/${id}`
  if ((await charged(key, path)).status == 'canceled') return
  await charged(key, path, undefined, undefined, 'DELETE')
}

/**
 * A Worker of a test's own, beside the kernel in the run's workerd
 * (probe-scripts.js): a set of modules, the entry named, and one `at(path)`.
 *
 * It is how a test runs code the platform would upload rather than serve. A
 * dispatch namespace has no local implementation (dispatch.ts), so an app's
 * own script can otherwise only be asserted as a multipart body; this runs
 * the same module set in the same runtime, each module typed by its name the
 * way the upload types it, which is where a module that is mislabelled or
 * missing shows itself (T-34263).
 */
export let script = async (
  files: Record<string, string | Uint8Array>,
  main = 'entry.js',
) => {
  let at = `${want('YAK_PROBE')}/__script/${crypto.randomUUID()}`
  let modules = Object.fromEntries(
    Object.entries(files).map(([name, body]) => [
      name,
      name.endsWith('.wasm')
        ? { wasm: btoa(String.fromCharCode(...body as Uint8Array)) }
        : typeof body == 'string'
        ? body
        : new TextDecoder().decode(body),
    ]),
  )
  let put = await fetch(at, {
    method: 'PUT',
    body: JSON.stringify({ main, modules }),
  })
  if (!put.ok) throw new Error(`script: ${put.status} ${await put.text()}`)
  return {
    at: (path: string, init?: RequestInit) => fetch(at + path, init),
  }
}

// An origin that stands in for `<space>.yaks.app` over HTTP: every request
// goes to the kernel wearing that hostname, and the person's cookie if they
// have one. What a browser gives a page and a test cannot is exactly this —
// the hostname a probe can only spell in `x-yak-host` (route.ts), and the
// cookie that says who is asking — so a client module running under Deno
// reaches an app's doors through here exactly as a page's would. The request
// passes through whole, bytes included: an upload is a body that is not text
// (apps.ts `/api/blob`).
export let browser = (k: Kernel, host: string, cookie?: string) => {
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    let url = new URL(req.url)
    let sent: Record<string, string> = {}
    for (let h of ['content-type', 'x-yak-name']) {
      let v = req.headers.get(h)
      if (v) sent[h] = v
    }
    return k.at(host, url.pathname + url.search, {
      method: req.method,
      headers: { ...(cookie ? { cookie } : {}), ...sent },
      body: req.method == 'GET' || req.method == 'HEAD'
        ? undefined
        : new Uint8Array(await req.arrayBuffer()),
    })
  })
  let { port } = server.addr as Deno.NetAddr
  return { origin: `http://127.0.0.1:${port}`, stop: () => server.shutdown() }
}

// An origin that stands for `<space>.yaks.app` on a socket. `new WebSocket`
// sends the URL's own Host and takes no headers, so `x-yak-host` — the header
// a fetch-driven probe sets (route.ts) — has to go on the wire itself: this
// relay inserts it (and a cookie) into the handshake it forwards, then copies
// bytes both ways, so the socket a test holds is the kernel's own, framing
// and all. HTTP through it works too, for one request per connection.
//
// `origin` is the third thing only the wire can say: Deno's WebSocket sends
// no `Origin` at all, and the page a handshake comes from is exactly what
// separates one space from another (route.ts `sameOrigin`), so a test that
// drives a cross-space socket puts it here.
export let relay = (
  k: Kernel,
  host: string,
  cookie?: string,
  origin?: string,
) => {
  let up = Number(new URL(k.base).port)
  let l = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let open = new Set<Deno.Conn>()
  let carry = async (down: Deno.Conn) => {
    open.add(down)
    let out = await Deno.connect({ hostname: '127.0.0.1', port: up })
    open.add(out)
    // The handshake is one write, and ASCII; read to its blank line.
    let head = ''
    let buf = new Uint8Array(4096)
    while (!head.includes('\r\n\r\n')) {
      let n = await down.read(buf)
      if (n == null) return
      head += new TextDecoder().decode(buf.subarray(0, n))
    }
    let extra = `x-yak-host: ${host}\r\n` +
      (cookie ? `cookie: ${cookie}\r\n` : '') +
      (origin ? `origin: ${origin}\r\n` : '')
    await out.write(
      new TextEncoder().encode(head.replace('\r\n', `\r\n${extra}`)),
    )
    await Promise.all([
      down.readable.pipeTo(out.writable).catch(() => {}),
      out.readable.pipeTo(down.writable).catch(() => {}),
    ])
  }
  let serving = (async () => {
    for await (let down of l) carry(down).catch(() => {})
  })().catch(() => {})
  return {
    origin: `http://127.0.0.1:${(l.addr as Deno.NetAddr).port}`,
    stop: async () => {
      l.close()
      for (let c of open) {
        try {
          c.close()
        } catch { /* the pipe closed it */ }
      }
      await serving
    },
  }
}

// A signed-in person's Cookie header, an hour long.
export let signedIn = async (k: Kernel, person: string) =>
  `${COOKIE}=${await sign(
    { person, space: null, exp: Math.floor(Date.now() / 1000) + 3600 },
    k.secret,
  )}`

// `num` is optional because a store may not have numbers at all: it is
// @yaks/id's property, which an app's store does not load and the fleet's does.
type Row = { entity: { eid: string; num?: number }; [k: string]: unknown }

// A client on one app's graph API, as one person (or nobody).
export let client = (
  k: Kernel,
  host: string,
  app: string,
  cookie?: string,
) => {
  // One client is one visitor: a stranger keeps one address for its life.
  let headers: Record<string, string> = cookie ? { cookie } : somewhere()
  let get = async (q: string) =>
    (await (await k.at(host, `/${app}/api/query?${q}`, { headers }))
      .json()) as Row[]
  let post = (body: unknown) =>
    k.at(host, `/${app}/api/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    })
  let applied = async (body: unknown) => {
    let r = await post(body)
    if (r.status != 200) throw new Error(`apply ${r.status}: ${await r.text()}`)
    return (await r.json()) as {
      ok: boolean
      aliases: Record<string, string>
      bundles: Bundle[]
    }
  }
  let put = (path: string, body: string, type?: string) =>
    k.at(host, `/${app}/api/files${path}`, {
      method: 'PUT',
      body,
      headers: { ...headers, ...(type ? { 'content-type': type } : {}) },
    })
  return { get, post, applied, put, headers }
}

// An agent on the connector: JSON-RPC over POST /mcp at the apex, as one
// signed-in person. `tool` answers the reply's text, throwing when the tool
// says it erred, so a test reads the words and not the envelope.
//
// `bearer` is the other credential the door takes — a CLI grant (grants.ts),
// which is how the terminal talks to this same door and carries no cookie at
// all.
export let connector = (
  k: Pick<Kernel, 'at' | 'host'>,
  cookie?: string,
  bearer?: string,
) => {
  let n = 0
  // The transport's session id: minted at `initialize` and sent back on every
  // later request, the way a client does — it names this client's stream and
  // the tool list it cached (mcp.ts).
  let session = ''
  let call = async (method: string, params: unknown = {}) => {
    let r = await k.at(k.host, '/mcp', {
      method: 'POST',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(session ? { 'mcp-session-id': session } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
    })
    session = r.headers.get('mcp-session-id') ?? session
    if (r.status != 200) throw new Error(`mcp ${r.status}: ${await r.text()}`)
    let reply = await r.json()
    if (reply.error) {
      throw new Error(`mcp ${reply.error.code}: ${reply.error.message}`)
    }
    return reply.result
  }
  let tool = async (name: string, args: unknown = {}) => {
    let out = await call('tools/call', { name, arguments: args })
    let text = String(out.content[0].text)
    if (out.isError) throw new Error(text)
    return text
  }
  return { call, tool }
}

// Every letter the kernel has sent to an address, oldest first, read off its
// log: the stand-in for Email Sending writes one line per letter
// (`cloudflare`), so no store anywhere holds a code a read could spend.
// A letter may be addressed to several readers at once (mail.ts `Letter`), so
// "to this address" is membership, not equality.
export type Letter = { to: string | string[]; subject: string; body: string }

export let letters = (k: Pick<Kernel, 'log'>, to: string): Letter[] =>
  [...Deno.readTextFileSync(k.log).matchAll(/yak-mail (\{.*\})/g)]
    .map((m) => JSON.parse(m[1]) as Letter)
    .filter((l) => [l.to].flat().includes(to))

// The latest letter to an address that says a thing, waited for — an
// invitation is sent while the tool is answering (T-32629).
export let letter = async (
  k: Pick<Kernel, 'log'>,
  to: string,
  saying: string,
  after = 0,
) =>
  (await until(
    () =>
      letters(k, to).slice(after).findLast((l) =>
        `${l.subject}\n${l.body}`.includes(saying)
      ),
    {
      timeout: 20_000,
      poll: 100,
      label: `a letter for ${to} saying ${saying}`,
    },
  ))!

// Wait past the letters already received before requesting another sign-in.
export let mailed = (k: Pick<Kernel, 'log'>, to: string, after = 0) =>
  until(
    () =>
      /\b(\d{6})\b/.exec(letters(k, to).slice(after).at(-1)?.subject ?? '')
        ?.[1] ?? '',
    { timeout: 20_000, poll: 100, label: `a letter for ${to}` },
  )

// An invitation's one click, the way its person makes it (invite.ts): the link
// out of the latest invitation letter to that address, opened with `cookie`
// (or none). Answers the door's response, unread.
export let clickInvite = async (k: Kernel, email: string, cookie?: string) => {
  let l = await letter(k, email, '/invite?t=')
  let link = new URL(/https:\/\/\S+\/invite\?t=\S+/.exec(l.body)![0])
  return k.at(link.host, link.pathname + link.search, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
}

// Accepted: the click, signed in as its person, landing where it points.
export let accepted = async (k: Kernel, email: string, cookie: string) => {
  let r = await clickInvite(k, email, cookie)
  await r.body?.cancel()
  if (r.status != 303) throw new Error(`accept: ${r.status}`)
  return r.headers.get('location')!
}

// A letter into the kernel, at the door workerd keeps for exactly this: the
// runtime's local email endpoint hands the body to `email()` as a message
// (index.ts, inbox.ts). The envelope rides the query string — `from` and `to`
// as the SMTP session gave them, which is why a message may be addressed at an
// app whose name is nowhere in its own headers — and the body is raw RFC 5322,
// which must carry a `Message-ID` or the runtime refuses to parse it.
//
// The answer is the handler's: 200 where the letter landed, 400 carrying the
// reason where it was rejected. A rejection only reaches the status because
// index.ts awaits `setReject` — the message is an RPC stub, and a rejection
// that is not awaited lands after the answer is built.
export let arrives = (
  k: Kernel,
  m: { from: string; to: string; raw: string },
) =>
  fetch(
    `${k.base}/cdn-cgi/handler/email?from=${encodeURIComponent(m.from)}` +
      `&to=${encodeURIComponent(m.to)}`,
    { method: 'POST', body: m.raw },
  )

/**
 * One letter as it travels: headers, a blank line, the words. `Message-ID` and
 * `From` are defaulted because the runtime's local door refuses a message
 * missing either — it parses both to build the message it hands the handler —
 * and a letter in life always carries them.
 */
export let rfc822 = (head: Record<string, string>, body: string) =>
  Object.entries({
    'Message-ID': `<${crypto.randomUUID()}@probe.example>`,
    From: 'Someone <someone@probe.example>',
    ...head,
  }).map(([k, v]) => `${k}: ${v}`).join('\r\n') + `\r\n\r\n${body}`

// A person signs in the way a browser does — an address, the code off the
// log, the cookie back — and the kernel mints their person row and their own
// space. The first sign-in on a fresh kernel owns the meta space, which is
// how any directory row comes to be written at all (identity.ts).
// A person, signed in: the code card asks what to call them the first time
// (T-32654), so `name` is what a probe answers it — left out, the front of
// their address is what the platform ends up calling them.
export let signIn = async (
  k: Pick<Kernel, 'at' | 'host' | 'log' | 'secret'>,
  email = `probe-${crypto.randomUUID().slice(0, 8)}@${k.host}`,
): Promise<Person> => {
  let form = (path: string, fields: Record<string, string>) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  let received = letters(k, email).length
  let asked = await form('/login', { email })
  if (asked.status != 200) throw new Error(`login: ${await asked.text()}`)
  await asked.body?.cancel()
  let code = await mailed(k, email, received)
  let inn = await form('/login/code', { email, code })
  if (inn.status != 303) throw new Error(`code: ${await inn.text()}`)
  await inn.body?.cancel()
  let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
  let claims = await verify(cookie.slice(COOKIE.length + 1), k.secret)
  if (!claims) throw new Error('the sign-in set no session')
  // Nobody has named them — the card asks nothing but the address and the code
  // (T-34236) — so what they are called is the front of their address
  // (signin.ts `nameOf`), which is what a byline says.
  return {
    person: claims.person,
    cookie,
    email,
    code,
    name: email.split('@')[0],
  }
}

// The directory, as an owner of `yak` reads and writes it: the MCP graph
// tier, the one door left into the meta store — apps.ts serves nothing at
// its address, to anyone (T-32585). The owner is the kernel's, unless named.
export let meta = (k: Kernel, cookie = k.owner.cookie) => {
  let agent = connector(k, cookie)
  let where = { space: 'yak', app: 'platform' }
  return {
    // The rows, and only the rows: a tool reply carries the unseen block and
    // the ceiling line after them (unseen.ts), and the meta space has breaks
    // of its own to be told about like anybody else.
    query: async (query: string) =>
      JSON.parse(
        (await agent.tool('graph_query', { ...where, query })).split('\n\n## ')[
          0
        ],
      ) as Row[],
    apply: (entities: unknown[]) =>
      agent.tool('graph_apply', { ...where, entities }),
  }
}

// The two shapes a tool's words carry, read back out of them. A tool answers
// bundles now, so what a probe used to pick off `structuredContent` is in the
// prose — and every test that wants it wants it the same way.

/** One line of what `commands` answers (tools.ts). */
export type Listed = {
  /** `<space>/<app>`, off the header the app's commands sit under */
  at: string
  name: string
  /** its arguments as the listing writes them: `who, miles, pace?` */
  args: string
  /** `writes` rather than `reads` */
  writes: boolean
  description: string
}

export let commandsIn = (said: string): Listed[] => {
  let at = ''
  let out: Listed[] = []
  for (let line of said.split('\n')) {
    let head = /^## (\S+)$/.exec(line)
    if (head) {
      at = head[1]
      continue
    }
    let one = /^(\w+)\(([^)]*)\) (reads|writes) — (.+)$/.exec(line)
    if (one) {
      out.push({
        at,
        name: one[1],
        args: one[2],
        writes: one[3] == 'writes',
        description: one[4],
      })
    }
  }
  return out
}

/**
 * The rows a query command answered, from under its sentence: `command` says
 * `<name>: N rows in <at>` and then the rows (declared.ts `ran`), with the
 * unseen block after them where the caller has a space to be told about.
 */
export let rowsIn = <T>(said: string): T[] =>
  JSON.parse(
    said.slice(said.indexOf('\n\n') + 2).split('\n\n## ')[0],
  ) as T[]

// An app's `vocab.json`, as a probe writes one: the document, without every
// test writing out `$defs` and `properties` around two properties. A property
// is its JSON Schema — {@link txt}, {@link num} and {@link when} are the three
// a probe reaches for. `tools` are the app's commands, each marked a tool here.
export let vocabFile = (
  defs: Record<string, Record<string, unknown>>,
  tools: Record<string, Record<string, unknown>> = {},
): string =>
  JSON.stringify({
    $defs: {
      ...Object.fromEntries(
        Object.entries(defs).map((
          [name, props],
        ) => [name, { properties: props }]),
      ),
      ...Object.fromEntries(
        Object.entries(tools).map(([name, t]) => [name, { tool: true, ...t }]),
      ),
    },
  })
export let txt = { type: 'string' }
export let num = { type: 'number' }
export let when = { type: 'string', format: 'date-time' }

// A person with spaces and apps, made through their own agent's doors: they
// sign in, then space_new and app_new. The first app in a space answers its
// bare hostname. Returns who they are, and the eids by slug.
export let seed = async (
  k: Kernel,
  spaces: { slug: string; apps: string[] }[],
) => {
  let them = await signIn(k)
  let agent = connector(k, them.cookie)
  // Each of those tools names what it made as `slug (eid)`.
  let idOf = (said: string) => {
    let hit = /\(([0-9a-f-]{36})\)/.exec(said)
    if (!hit) throw new Error(`no eid in: ${said}`)
    return hit[1]
  }
  let eids: Record<string, string> = {}
  for (let s of spaces) {
    eids[s.slug] = idOf(
      await agent.tool('space_new', { slug: s.slug, title: s.slug }),
    )
    for (let a of s.apps) {
      eids[`${s.slug}/${a}`] = idOf(
        await agent.tool('app_new', { space: s.slug, slug: a, title: a }),
      )
    }
  }
  return { ...them, eids }
}

// ---- Cloudflare's account API, stood in for (mail.ts, domains.ts) ---------
//
// The two conversations a kernel has with Cloudflare, over the API's
// `{success, errors, result}` envelope. A letter sent through Email Sending,
// by its API or its binding, is written to `log` as one `yak-mail` line, which
// is where a test reads its letters back (`letters`). And the three calls a domain makes — list by name,
// create, delete — go to custom hostnames kept in memory. A hostname is
// answered active, which is the state a domain reaches once the person's
// record resolves; the words each step is read by are held against recorded
// bytes in domains_test.ts, so what this is for is the other half: that the
// tools attach, report and detach a domain end to end.
export let cloudflare = (log: string) => {
  let held = new Map<string, Custom>()
  let wrote = (to: string | string[], subject: string, body = '') =>
    Deno.writeTextFileSync(
      log,
      `yak-mail ${JSON.stringify({ to, subject, body })}\n`,
      { append: true },
    )
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    let url = new URL(req.url)
    let ok = (result: unknown) => Response.json({ success: true, result })
    if (url.pathname.endsWith('/email/sending/send')) {
      let { to, subject, text } = await req.json()
      wrote(to, subject, text)
      return ok({})
    }
    if (req.method == 'POST') {
      let made = async () => {
        let { hostname } = await req.json() as { hostname: string }
        let custom: Custom = {
          id: crypto.randomUUID(),
          hostname,
          status: 'active',
          ssl: { status: 'active' },
        }
        held.set(hostname, custom)
        return ok(custom)
      }
      return made()
    }
    if (req.method == 'DELETE') {
      let id = url.pathname.split('/').pop()
      for (let [name, c] of held) if (c.id == id) held.delete(name)
      return ok({ id })
    }
    let want = url.searchParams.get('hostname') ?? ''
    let found = held.get(want)
    return ok(found ? [found] : [])
  })
  return {
    url: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    // The same product as a Worker binding (post.ts `Binding`), which is how
    // an app's own letters leave.
    binding: {
      send: (l: { to: string; subject: string; text?: string }) => {
        wrote(l.to, l.subject, l.text)
        return Promise.resolve({ messageId: crypto.randomUUID() })
      },
    },
    stop: () => server.shutdown(),
  }
}

/** Attaches `hostname` at the kernel's stand-in for Cloudflare, as a Plus
 * space's domain_attach would have. */
export let attach = async (k: Pick<Kernel, 'cloudflare'>, hostname: string) => {
  let made = await fetch(k.cloudflare, {
    method: 'POST',
    body: JSON.stringify({ hostname }),
  })
  await made.body?.cancel()
}

/** Whether the kernel's stand-in for Cloudflare holds `hostname` attached. */
export let attached = async (
  k: Pick<Kernel, 'cloudflare'>,
  hostname: string,
) => {
  let at = `${k.cloudflare}/?hostname=${hostname}`
  return ((await (await fetch(at)).json()).result as unknown[]).length > 0
}

/**
 * A space on Plus, the one way a space gets there: Stripe holds an active
 * subscription for it and the webhook moves the plan (billing.ts). `plan` is
 * stamped, so no door a test can reach writes it — the kernel is leased with
 * this `STRIPE_WEBHOOK_SECRET` and the event is signed with it. The
 * subscription comes back, for a test that goes on to cancel it; the kernel
 * cancels it on stop otherwise.
 */
export let plus = async (k: Pick<Kernel, 'at' | 'bought'>, space: string) => {
  let sub = await subscribed(k, stripeKey(), { space })
  await delivered(
    k,
    '/stripe/webhook',
    WEBHOOK_SECRET,
    'customer.subscription.updated',
    sub,
  )
  return sub
}

/**
 * A `Stripe-Signature` header over exactly these bytes: HMAC-SHA256 of
 * `<timestamp>.<raw body>`, keyed by the endpoint's signing secret. The scheme
 * is Stripe's own and identical for the platform endpoint and the Connect one —
 * only the secret differs — so both doors are driven through this.
 */
export let signed = async (secret: string, raw: string, at: number) => {
  let key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${at}.${raw}`),
  )
  let hex = [...new Uint8Array(mac)]
    .map((n) => n.toString(16).padStart(2, '0')).join('')
  return `t=${at},v1=${hex}`
}

// ---- a zip, as a person would drop one (unzip.ts, drop.ts, T-34230) --------
//
// The reader is the thing under test, so the fixtures are written here rather
// than checked in as bytes: a zip whose folder is stripped, one carrying a path
// that escapes, one written as a stream — each is an argument, not a file
// somebody has to open a hex editor to read.
//
// The CRC is left zero. Nothing on this path checks one — the runtime's inflate
// does not, and neither does unzip.ts — because a zip is a container here and
// not an archive anybody keeps.
export type Packed = {
  path: string
  content?: string | Uint8Array<ArrayBuffer>
  // Deflate the bytes rather than storing them.
  deflate?: boolean
  // What the header says, for a zip the door must refuse: a method it does not
  // read, or the encrypted bit.
  method?: number
  flags?: number
}

let deflated = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(
        new CompressionStream('deflate-raw'),
      ),
    ).arrayBuffer(),
  )

export let zipped = async (entries: Packed[]) => {
  let enc = new TextEncoder()
  let body: Uint8Array[] = []
  let index: Uint8Array[] = []
  let at = 0
  for (let one of entries) {
    let raw = typeof one.content == 'string'
      ? enc.encode(one.content)
      : one.content ?? new Uint8Array()
    let packed = one.deflate ? await deflated(raw) : raw
    let method = one.method ?? (one.deflate ? 8 : 0)
    let flags = one.flags ?? 0
    // Bit 3: the sizes were not known when the header went out, so they are
    // zero there and true in the index at the end.
    let streamed = !!(flags & 8)
    let name = enc.encode(one.path)
    let head = new Uint8Array(30 + name.length)
    let h = new DataView(head.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, flags, true)
    h.setUint16(8, method, true)
    h.setUint32(18, streamed ? 0 : packed.length, true)
    h.setUint32(22, streamed ? 0 : raw.length, true)
    h.setUint16(26, name.length, true)
    head.set(name, 30)
    body.push(head, packed)
    let size = head.length + packed.length
    if (streamed) {
      let tail = new Uint8Array(16)
      let t = new DataView(tail.buffer)
      t.setUint32(0, 0x08074b50, true)
      t.setUint32(8, packed.length, true)
      t.setUint32(12, raw.length, true)
      body.push(tail)
      size += tail.length
    }
    let row = new Uint8Array(46 + name.length)
    let c = new DataView(row.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, flags, true)
    c.setUint16(10, method, true)
    c.setUint32(20, packed.length, true)
    c.setUint32(24, raw.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, at, true)
    row.set(name, 46)
    index.push(row)
    at += size
  }
  let end = new Uint8Array(22)
  let e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, index.length, true)
  e.setUint16(10, index.length, true)
  e.setUint32(12, index.reduce((n, r) => n + r.length, 0), true)
  e.setUint32(16, at, true)
  let all = [...body, ...index, end]
  let out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (let p of all) {
    out.set(p, i)
    i += p.length
  }
  return out
}

// ---- a kernel that is already running (roster_test.ts) ------------
//
// yaks.app answers the same doors workerd does, so a suite that drives one can
// drive the other: this is `kernel` for a host already deployed — where it is,
// one request at a hostname, and a stop with nothing to stop. What it cannot
// give is the two things only a local runtime has: its log, so no letter can
// be read back, and its session secret, so no cookie can be minted. A run
// against a deployed kernel carries a bearer instead.
export let deployed = (url: string) => {
  let base = url.replace(/\/+$/, '')
  let host = new URL(base).host
  return owning({
    base,
    host,
    secret: '',
    log: '',
    cloudflare: '',
    at: (where: string, path: string, init: RequestInit = {}) =>
      fetch(`https://${where}${path}`, init),
  })
}

/**
 * A bearer, the way a host gets one: dynamic registration as a public client,
 * the authorization code with PKCE, and the exchange. mcp_auth_test.ts walks
 * the same steps and asserts on each of them; this walks them to come back
 * with a token, for a suite that wants to reach the connector the way a client
 * does rather than with a cookie no client has.
 */
/**
 * The Allow button, clicked the way a browser clicks it: the consent page is
 * drawn for this cookie and this authorize request, and its form is posted
 * back with the token only that page holds (identity.ts `consenting`). The
 * redirect is the answer, unfollowed.
 */
export let allowed = async (
  k: Pick<Kernel, 'at' | 'host'>,
  q: string,
  cookie: string,
) => {
  let page = await (await k.at(k.host, `/oauth/authorize?${q}`, {
    headers: { cookie },
  })).text()
  let consent = /name="consent" value="([^"]+)"/.exec(page)?.[1]
  if (!consent) throw new Error(`no consent form in: ${page}`)
  return k.at(k.host, '/oauth/allow', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body: new URLSearchParams({ q, consent }).toString(),
  })
}

export let bearerFor = async (
  k: Pick<Kernel, 'at' | 'host'>,
  cookie: string,
) => {
  let back = 'https://probe.invalid/cb'
  let form = (
    path: string,
    fields: Record<string, string>,
    sent: Record<string, string> = {},
  ) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...sent,
      },
      body: new URLSearchParams(fields).toString(),
    })
  let reg = await k.at(k.host, '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'a roster probe',
      redirect_uris: [back],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  if (reg.status != 201) throw new Error(`register: ${await reg.text()}`)
  let { client_id } = await reg.json() as { client_id: string }
  let verifier = crypto.randomUUID() + crypto.randomUUID()
  let q = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: back,
    state: 'roster',
    scope: 'graph',
    code_challenge: b64u(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
    code_challenge_method: 'S256',
  }).toString()
  let allow = await allowed(k, q, cookie)
  if (allow.status != 302) throw new Error(`allow: ${await allow.text()}`)
  await allow.body?.cancel()
  let code = new URL(allow.headers.get('location')!).searchParams.get('code')!
  let got = await (await form('/oauth/token', {
    grant_type: 'authorization_code',
    code,
    client_id,
    redirect_uri: back,
    code_verifier: verifier,
  })).json() as { access_token?: string }
  if (!got.access_token) throw new Error(`token: ${JSON.stringify(got)}`)
  return got.access_token
}

// ---- Stripe, in its sandbox (billing.ts, sell.ts) ------------------------
//
// Every test that reaches Stripe reaches Stripe itself, in test mode: what
// proves a purchase works is Stripe taking it, not the right fields having been
// assembled. The key is the owner's sandbox secret key, passed in the
// environment and never committed; a run without one fails naming what to set
// rather than passing over the money paths in silence.

let SANDBOX = 'op://Yak Shaving LLC/yaks.app stripe/sandbox/secret key'

/** The key a test run hands its tests: STRIPE_KEY, or else the owner's from
 * 1Password when `op` can read it here. */
export let sandboxKey = async () => {
  let key = Deno.env.get('STRIPE_KEY')
  if (key) return key
  let read = await new Deno.Command('op', {
    args: ['read', SANDBOX],
    stdout: 'piped',
    stderr: 'null',
  }).output().catch(() => undefined)
  return read?.success ? new TextDecoder().decode(read.stdout).trim() : ''
}

/** The sandbox secret key, or the sentence saying how to supply one. It must
 * be a test-mode key: a live key here would charge somebody. */
export let stripeKey = () => {
  let key = Deno.env.get('STRIPE_KEY') ?? ''
  if (!key) {
    throw new Error(
      'no Stripe sandbox key: set STRIPE_KEY to a test-mode secret key and ' +
        'the money paths run against Stripe for real. The owner keeps one at ' +
        `op read '${SANDBOX}'`,
    )
  }
  if (!key.startsWith('sk_test_')) {
    throw new Error('STRIPE_KEY is not a test-mode key (sk_test_…)')
  }
  return key
}

/** One call to Stripe, in Stripe's own dialect: form-encoded in, JSON out,
 * with the bracketed keys its nested fields are written with. A refusal is
 * thrown carrying Stripe's own message, which is the whole of the failure.
 * An answer that says `Stripe-Should-Retry: true` (an object another request
 * held, say) is asked again, as Stripe's own libraries do, under one
 * idempotency key so a write retried is the same write. */
export let charged = async (
  key: string,
  path: string,
  fields?: Record<string, unknown>,
  on?: string,
  method = fields ? 'POST' : 'GET',
) => {
  let body = new URLSearchParams()
  let write = (prefix: string, value: unknown) => {
    if (value == null) return
    if (typeof value == 'object') {
      for (let [k, v] of Object.entries(value)) {
        write(prefix ? `${prefix}[${k}]` : k, v)
      }
    } else body.set(prefix, String(value))
  }
  write('', fields ?? {})
  let once = crypto.randomUUID()
  let r = await until(async (): Promise<Response | null> => {
    let r = await fetch(`https://api.stripe.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(method == 'POST' ? { 'idempotency-key': once } : {}),
        ...(on ? { 'stripe-account': on } : {}),
      },
      ...(fields ? { body: body.toString() } : {}),
    })
    if (r.headers.get('stripe-should-retry') != 'true') return r
    await r.body?.cancel()
    return null
  }, {
    timeout: 15_000,
    poll: 500,
    label: `stripe ${path} to stop asking for a retry`,
  })
  let said = await r.json() as { error?: { message: string } }
  if (said.error) throw new Error(`stripe ${path}: ${said.error.message}`)
  return said as Record<string, unknown>
}

/**
 * The recurring price a Plus checkout charges, found or made in the sandbox.
 * A price carries no name of its own, so the product holds the name and the
 * price hangs off it: a second run reuses both rather than filling the sandbox
 * with a product per run. STRIPE_PRICE names one outright where the owner has
 * a price they would rather charge.
 */
export let plusPrice = async (key: string, named = 'yaks.app probe Plus') => {
  let asked = Deno.env.get('STRIPE_PRICE')
  if (asked) return asked
  // Stripe is the seller under Managed Payments, which the platform asks for
  // (billing.ts), and a seller owes tax — so a product with no tax code is
  // one Stripe refuses to sell. This is the code for software as a service.
  let sold = { name: named, tax_code: 'txcd_10103000' }
  let products = await charged(key, '/v1/products?limit=100') as unknown as {
    data: { id: string; name: string; tax_code?: string }[]
  }
  let found = products.data.find((p) => p.name == named)
  if (found && !found.tax_code) {
    await charged(key, `/v1/products/${found.id}`, {
      tax_code: sold.tax_code,
    })
  }
  let product = found ??
    await charged(key, '/v1/products', sold) as unknown as { id: string }
  let prices = await charged(
    key,
    `/v1/prices?product=${product.id}&active=true&limit=100`,
  ) as unknown as { data: { id: string; recurring?: unknown }[] }
  let price = prices.data.find((p) => p.recurring) ??
    await charged(key, '/v1/prices', {
      product: product.id,
      currency: 'usd',
      unit_amount: 900,
      recurring: { interval: 'month' },
    }) as unknown as { id: string }
  return price.id
}

/**
 * A connected account that can take money, found or made in the sandbox. The
 * account `space_sell` makes waits on a person's identity form, which no test
 * can fill in, so this one is onboarded by the platform with Stripe's test
 * identity (`address_full_match`, `000000000`, `btok_us_verified`). Stripe
 * takes about a minute to enable a new one, so it is kept and found again by
 * name rather than made per run.
 */
export let merchant = async (
  key: string,
  named = 'yaks.app probe merchant',
) => {
  let found = ''
  for (let after = ''; !found;) {
    let page = await charged(
      key,
      `/v1/accounts?limit=100${after && `&starting_after=${after}`}`,
    ) as unknown as {
      data: { id: string; metadata?: Record<string, string> }[]
      has_more: boolean
    }
    found = page.data.find((a) => a.metadata?.probe == named)?.id ?? ''
    if (!page.has_more) break
    after = page.data.at(-1)!.id
  }
  let id = found || String(
    (await charged(key, '/v1/accounts', {
      country: 'US',
      business_type: 'individual',
      controller: {
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'application',
        stripe_dashboard: { type: 'none' },
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: { mcc: '5734', url: 'https://yaks.app' },
      individual: {
        first_name: 'Probe',
        last_name: 'Merchant',
        email: 'merchant@example.com',
        phone: '0000000000',
        dob: { day: 1, month: 1, year: 1901 },
        address: {
          line1: 'address_full_match',
          city: 'Brooklyn',
          state: 'NY',
          postal_code: '11201',
          country: 'US',
        },
        id_number: '000000000',
      },
      external_account: 'btok_us_verified',
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
      metadata: { probe: named },
    })).id,
  )
  await until(
    async () => (await charged(key, `/v1/accounts/${id}`)).charges_enabled,
    { timeout: 180_000, poll: 2000, label: `${id} to take charges` },
  )
  return id
}

/**
 * A Plus subscription Stripe holds, carrying `metadata`, paid with
 * `pm_card_visa` (Stripe's name for 4242 4242 4242 4242) on `customer`, or on a
 * fresh customer when none is named. It is what a completed checkout leaves:
 * Stripe's checkout page draws its card fields in cross-origin frames behind a
 * captcha, which no test can drive, so the card goes in the way the API puts it.
 * It is bought for kernel `k`, whose stop cancels it if the test did not.
 */
export let subscribed = async (
  k: Pick<Kernel, 'bought'>,
  key: string,
  metadata: Record<string, string>,
  customer?: string,
) => {
  // Stamped the way checkout stamps it (billing.ts `metaOf`), with the apex a
  // probe kernel runs under, so staging, which hears this sandbox's events
  // too, lets the purchase go as another deployment's.
  metadata = { ...metadata, apex: apex() }
  customer ??= String((await charged(key, '/v1/customers', { metadata })).id)
  let card = await charged(key, '/v1/payment_methods/pm_card_visa/attach', {
    customer,
  })
  let sub = await charged(key, '/v1/subscriptions', {
    customer,
    items: { 0: { price: await plusPrice(key) } },
    default_payment_method: String(card.id),
    metadata,
  })
  k.bought.add(String(sub.id))
  return sub
}

/**
 * An event as Stripe would deliver it, carrying an object Stripe actually
 * holds. Stripe cannot reach a workerd bound to loopback, so the half of
 * delivery a probe supplies is the hop itself: the object is fetched from the
 * sandbox, wrapped in the envelope the handler reads, and signed with the
 * secret the kernel was booted with.
 */
export let delivered = async (
  k: Pick<Kernel, 'at'>,
  path: '/stripe/webhook' | '/stripe/connect',
  secret: string,
  type: string,
  object: unknown,
  // The connected account an event is about. Stripe puts it on the envelope
  // rather than in the object, and it is what the Connect door attributes by,
  // so an event without one is not about a seller at all (sell.ts `apply`).
  on?: string,
  // When Stripe made the event. A redelivery is the same event again, so a
  // test that replays one passes the same moment twice.
  at = Math.floor(Date.now() / 1000),
) => {
  let raw = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type,
    created: at,
    ...(on ? { account: on } : {}),
    data: { object },
  })
  let r = await k.at('yaks.app', path, {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': await signed(secret, raw, at),
    },
  })
  let said = await r.text()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${said}`)
  return said
}
