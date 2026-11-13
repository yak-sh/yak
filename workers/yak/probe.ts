// The kernel and its network boundaries, driven in process. Each fixture
// owns a synthetic origin; requests to it dispatch directly to its handler.
import * as io from '@yaks/file/io'
import { apex } from '@yaks/platform/host'
import { challenge } from '@yaks/oauth'
import { clock, until } from '@yaks/testing'
import { COOKIE, sign, verify } from './lib/token.ts'
import type { Custom } from './domains.ts'
import type { Command } from './declared.ts'
import type { Bundle } from '@yaks/graph'
import type { Load } from '@yaks/host'
import type { Env, Vars } from './env.ts'
import type { Purgers } from './purge.ts'
import type { Builder } from './build.ts'
import { bounded, type Ceiling } from '@yaks/durable-object/ceiling'
import { type Directory, directoryOf, spaceHandle } from './directory.ts'
import { valueIn } from '@yaks/tools/value'
import { parse } from 'smol-toml'
import { endpoints } from './endpoints.ts'
import { delivered, fakeSub } from '@yaks/stripe/testing'
import { Ajv } from 'ajv'
import { run as jq } from '@gabrielbryk/jq-ts'

let logs = new Map<string, string>()

// Compiling tools' output schemas took a sixth of mcp_graph_test.ts's profile;
// every client of every kernel lists the same schemas.
let ajv = new Ajv({ strict: false })
let compiled = new Map<string, ReturnType<typeof ajv.compile>>()
let fitting = (schema: unknown) => {
  let text = JSON.stringify(schema)
  if (!compiled.has(text)) compiled.set(text, ajv.compile(schema as object))
  return compiled.get(text)!
}
let transport = endpoints(globalThis)
export let endpoint = transport.open

/** What the in-process kernel checks a Stripe event against. */
export let WEBHOOK_SECRET = 'probe-webhook-secret'

/** The OpenAI apps challenge token the run's kernel serves. */
export let CHALLENGE = 'probe-openai-apps-challenge'

// Every probe request arrives from a place of its own, since the kernel holds
// strangers to a rate per source (@yaks/workerd/rate) and a suite's dozen sign-ins are
// not one loop. A test about a rate names its source in the headers, which
// win, and an anonymous `client` keeps one for its life.
let byte = () => crypto.getRandomValues(new Uint8Array(1))[0]
let somewhere = () => ({ 'cf-connecting-ip': `198.18.${byte()}.${byte()}` })

/** One kernel request at its addressed hostname, without a network hop. */
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
  at: (at: string, path: string, init: RequestInit = {}) => {
    let req = new Request(`https://${at}${path}`, {
      ...init,
      headers: { ...somewhere(), ...(init.headers as Record<string, string>) },
    })
    return transport.at(base, req)
  },
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

/** A kernel's door, its meta-space owner, and its cleanup. */
export type Kernel = Door & {
  owner: Person
  dir: Directory
  // Every data point the Visits dataset was handed: page views and funnel
  // steps.
  views: { points: { indexes?: string[]; blobs?: string[] }[] }
  stop: () => Promise<void>
  // In-process HTTP probes can inspect what crossed the tracker queue door.
  reported: Bundle[]
  flushReports: () => Promise<void>
  // And wait for what a request left running after it answered: the
  // effects a write owed, run by the store's pool.
  settled: () => Promise<void>
  deliveries: () => Promise<void>
  // A space's Builder object, by the space's eid: a socket's frames are
  // delivered to it the way the runtime delivers them (`webSocketMessage`).
  builder: (space: string) => Builder
  // A store's ceiling, by the object's name (`app.store`): what its rows have
  // spent, and whether it is stopped (@yaks/durable-object `bounded`).
  ceiling: (store: string) => Ceiling
}

/** What reading a letter needs: the log, and what to wait on when there is one. */
type Mailbox = Pick<Kernel, 'log'> & Partial<Pick<Kernel, 'deliveries'>>

let owning = <K extends Door>(k: K, close = () => Promise.resolve()) => ({
  ...k,
  stop: close,
})

/**
 * The test kernel's settings, its own and never the deploy's `[vars]`: a test
 * sees what is written here and what it asks for, so changing production's
 * wrangler.toml can't reach one. Each service is a stand-in in this file, and
 * each name is one no deploy holds.
 */
export let vars = (secret: string, cloudflare: string) => ({
  LOCAL_DEV: '1',
  ENVIRONMENT: 'test',
  SESSION_SECRET: secret,
  CF_ACCOUNT: 'account',
  WORKER_NAME: 'yak',
  DISPATCH_NAMESPACE: 'yak-apps',
  VIEWS_DATASET: 'yak_views',
  MAIL_TOKEN: 'a-token',
  MAIL_API: cloudflare,
  CF_ZONE: 'zone',
  CF_HOSTNAMES_TOKEN: 'a-token',
  HOSTNAMES_API: cloudflare,
  DNS_API: `${cloudflare}/dns-query`,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_CONNECT_WEBHOOK_SECRET: WEBHOOK_SECRET,
  OPENAI_APPS_CHALLENGE: CHALLENGE,
  REALTIME_APP: 'app',
  REALTIME_TOKEN: 'a-token',
  REALTIME_API: cloudflare,
  CF_WORKERS_TOKEN: 'a-token',
  WORKERS_API: cloudflare,
  META_DATASET: 'dataset',
  META_CONVERSIONS_TOKEN: 'a-token',
  META_API: `${cloudflare}/meta`,
})

// The rate limits are bindings rather than settings: the kernel holds every
// one wrangler.toml declares, each at its declared rate.
let ratelimits = () =>
  (parse(
    io.readTextFileSync(new URL('./wrangler.toml', import.meta.url)),
  ) as {
    ratelimits: { name: string; simple: { limit: number; period: number } }[]
  }).ratelimits

// The kernel's handler and graph bindings share the caller's process.
let boot = async (
  bindings: Vars = {},
  prepare?: (env: Env) => void,
  load?: Load,
) => {
  let [
    { handler, email },
    { ai, dataset, emailed, limiter, lasting, modelPage },
    { within },
  ] = await Promise
    .all([
      import('./kernel.ts'),
      import('./testing.ts'),
      import('./defects.ts'),
    ])
  let secret = crypto.randomUUID()
  let log = crypto.randomUUID()
  logs.set(log, '')
  let cf = cloudflare(log)
  let views = dataset()
  let p = lasting(secret, {
    ...vars(secret, cf.url),
    // What the runtime binds beside the config: this deploy's id, and the
    // `send_email` binding an app's letters leave through.
    CF_VERSION_METADATA: { id: crypto.randomUUID() },
    MAIL: cf.binding,
    // The Visits dataset, kept in memory: what the kernel counts (views.ts,
    // funnel.ts) is read off `views`.
    VIEWS: views,
    // A model that says nothing, priced from a page of our own: an app's
    // break starts its space's Operator (unseen.ts `fix`), and no test
    // reaches Workers AI or its catalogue.
    AI: ai([]) as Env['AI'],
    MODEL_FETCH: () => Promise.resolve(modelPage(0.15, 0.5)),
    ...Object.fromEntries(
      ratelimits().map((r) => [
        r.name,
        limiter(r.simple.limit, r.simple.period),
      ]),
    ),
    ...bindings,
  }, load)
  prepare?.(p.env)
  let reported: Bundle[] = []
  let reportClock = clock()
  let send = p.env.ERRORS?.send.bind(p.env.ERRORS)
  if (send) {
    p.env.ERRORS = {
      send: (rows) => {
        reported.push(...rows)
        return send(rows)
      },
    }
  }
  // What a request left running past its answer (defects.ts `background`),
  // held the way the runtime's waitUntil holds it, so `settled` waits for it.
  let held = new Set<Promise<void>>()
  let retain = (work: Promise<void>) => {
    held.add(work)
    void work.finally(() => held.delete(work))
  }
  let settled = async () => {
    await p.settled()
    while (held.size) {
      await Promise.allSettled(held)
      await p.settled()
    }
  }
  let service = endpoint((req) =>
    within(
      p.env,
      {},
      () =>
        new URL(req.url).pathname == '/cdn-cgi/handler/email'
          ? emailed(req, email, p.env)
          : handler.fetch(req, p.env),
      reportClock,
      { retain },
    )
  )
  let ticking = setInterval(p.ring, 10)
  let close = async () => {
    clearInterval(ticking)
    await service.stop()
    await p[Symbol.asyncDispose]()
    await cf.stop()
    logs.delete(log)
  }
  let door = driven(service.url, secret, log, apex(), cf.url)
  let deliveries = async () => {
    while (held.size) await Promise.allSettled([...held])
  }
  try {
    return {
      ...door,
      owner: await signIn({ ...door, deliveries }, `owner@${apex()}`),
      dir: directoryOf(p.env.STORE),
      views,
      reported,
      flushReports: () => reportClock.advance(10_000),
      settled,
      builder: p.builder,
      ceiling: (store: string) => bounded(p.states.get(store)!.storage),
      deliveries,
      close,
    }
  } catch (e) {
    await close()
    throw e
  }
}

/** A Purger that writes down each tag it is asked to purge (`purged`), and
 * purges nothing: the edge is Cloudflare's. A purge asked to spread to every
 * colo waits on `spreading` while one is set. */
export let recording = () => {
  let purged: string[] = []
  let held: { spreading?: Promise<void> } = {}
  let PURGER: Purgers = {
    idFromName: () => 'purger',
    get: () => ({
      purge: async (tags, spread) => {
        purged.push(...tags)
        if (spread) await held.spreading
      },
    }),
  }
  return { purged, PURGER, held }
}

// This process's kernel, started by the first test that asks for one.
let shared: ReturnType<typeof boot> | undefined

/** The in-memory kernel shared by this test process. */
export let kernel = async (): Promise<Kernel> => {
  let { close: _, ...k } = await (shared ??= boot())
  return owning(k)
}

/**
 * A kernel in memory of one test's own, started for it and ended by its
 * `stop`: for a test that needs the kernel whole, such as one that times a
 * store's first wake.
 */
export let fresh = async (
  bindings: Vars = {},
  prepare?: (env: Env) => void,
  load?: Load,
): Promise<Kernel> => {
  let { close, ...k } = await boot(bindings, prepare, load)
  return owning(k, close)
}

// A page client's origin, routed to the kernel with its hostname and cookie.
export let browser = (k: Kernel, host: string, cookie?: string) => {
  let service = endpoint(async (req) => {
    let url = new URL(req.url)
    let sent: Record<string, string> = {}
    for (
      let h of [
        'content-type',
        'content-length',
        'x-yak-name',
        'x-yak-state',
        'x-yak-version',
      ]
    ) {
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
  return { origin: service.url, stop: service.stop }
}

// A signed-in person's Cookie header, an hour long. It names a person whose
// row the caller wrote: a cookie for nobody is an erased account's, refused
// (directory.ts `own`); `signIn` makes the person too.
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
  type Envelope = {
    ok: boolean
    aliases: Record<string, string>
    bundles: Bundle[]
  }
  let applied = async <T extends unknown[] | { entities: unknown[] }>(
    body: T,
  ): Promise<T extends unknown[] ? Bundle[] : Envelope> => {
    let r = await post(body)
    if (r.status != 200) throw new Error(`apply ${r.status}: ${await r.text()}`)
    return await r.json()
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
  path = '/mcp',
) => {
  let n = 0
  // The transport's session id: minted at `initialize` and sent back on every
  // later request, the way a client does — it names this client's stream and
  // the tool list it cached (mcp.ts).
  let session = ''
  let schemas = new Map<string, ReturnType<typeof ajv.compile>>()
  let ask = async (method: string, params: unknown = {}) => {
    let r = await k.at(k.host, path, {
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
  let call = async (method: string, params: unknown = {}) => {
    let out = await ask(method, params)
    if (method == 'tools/call' && out.structuredContent !== undefined) {
      let { name } = params as { name: string }
      if (!schemas.has(name)) {
        let { tools } = await ask('tools/list')
        for (let t of tools) {
          if (t.outputSchema) schemas.set(t.name, fitting(t.outputSchema))
        }
      }
      let fits = schemas.get(name)
      if (!fits) throw new Error(`${name}: no listed output schema`)
      if (!fits(out.structuredContent)) {
        throw new Error(`${name}: ${ajv.errorsText(fits.errors)}`)
      }
    }
    return out
  }
  // A reply's readers: the words a person reads, and the same answer as data,
  // which is what a program reads: its bundles (`structuredContent.result`)
  // and the value they answered (@yaks/tools `valueIn`). The words carry more
  // than the answer, and a long text only by a tag beside it.
  let answer = async (name: string, args: unknown = {}) => {
    let out = await call('tools/call', { name, arguments: args })
    let text = String(out.content[0].text)
    if (out.isError) throw new Error(text)
    let rows: Bundle[] = out.structuredContent?.result ?? []
    return { text, rows, value: valueIn(rows) }
  }
  let tool = async (name: string, args: unknown = {}) =>
    (await answer(name, args)).text
  // A jq filter over an answer's structured content, whole wherever it is:
  // one too large for the reply was kept (result-tools.ts) and the filter
  // runs on it there, through result_query; one that fit runs here.
  let narrow = async (name: string, args: unknown, query: string) => {
    let out = await call('tools/call', { name, arguments: args })
    if (out.isError) throw new Error(String(out.content[0].text))
    let held = out.structuredContent as Record<string, unknown> | undefined
    if (
      typeof held?.id != 'string' || typeof held.bytes != 'number' ||
      !('shape' in held)
    ) return jq(query, (held ?? null) as Parameters<typeof jq>[1])[0]
    let { id, space, app, scope } = held
    let kept = await call('tools/call', {
      name: 'result_query',
      arguments: {
        id,
        // A tool declaring its own answer keeps it beside its words.
        query: '(if type == "object" and has("structuredContent") ' +
          `then .structuredContent else . end) | (${query})`,
        ...space ? { space } : {},
        ...app ? { app } : {},
        ...scope ? { scope } : {},
      },
    })
    if (kept.isError) throw new Error(String(kept.content[0].text))
    let values = kept.structuredContent?.values
    if (!Array.isArray(values)) throw new Error(`${query}: too large again`)
    return values[0]
  }
  return { call, tool, answer, narrow }
}

// Every letter the kernel has sent to an address, oldest first, read off its
// log: the stand-in for Email Sending writes one line per letter
// (`cloudflare`), so no store anywhere holds a code a read could spend.
// A letter may be addressed to several readers at once (mail.ts `Letter`), so
// "to this address" is membership, not equality.
export type Letter = {
  from?: string
  name?: string
  to: string | string[]
  subject: string
  body: string
  replyTo?: string
}

export let letters = (k: Pick<Kernel, 'log'>, to: string): Letter[] =>
  [...(logs.get(k.log) ?? '').matchAll(/yak-mail (\{.*\})/g)]
    .map((m) => JSON.parse(m[1]) as Letter)
    .filter((l) => [l.to].flat().includes(to))

/** Every event Meta's Conversions API was sent (meta-ads.ts), with the token
 * it came with. */
export let toldMeta = (k: Pick<Kernel, 'log'>) =>
  [...(logs.get(k.log) ?? '').matchAll(/yak-meta (\{.*\})/g)]
    .flatMap((m) => {
      let { data, access_token } = JSON.parse(m[1])
      return (data as Record<string, unknown>[]).map((event) => ({
        token: access_token as string,
        event,
      }))
    })

// Wait for this delivery, not for every unrelated alarm in the shared kernel.
// A mover or an in-flight request elsewhere can remain active after this
// letter was delivered; its lifetime cannot gate reading the receipt.
let posted = async <T>(
  k: Partial<Pick<Kernel, 'deliveries'>>,
  find: () => T,
  label: string,
) => {
  await k.deliveries?.()
  return until(find, { timeout: 20_000, poll: 10, label })
}

// The latest letter to an address that says a thing, waited for: the one the
// latest request sent.
export let letter = (
  k: Mailbox,
  to: string,
  saying: string,
  after = 0,
) =>
  posted(
    k,
    () =>
      letters(k, to).slice(after).findLast((l) =>
        `${l.subject}\n${l.body}`.includes(saying)
      ),
    `a letter for ${to} saying ${saying}`,
  )

// The code in the latest letter to an address, past the letters already
// received before requesting another sign-in.
export let mailed = (
  k: Mailbox,
  to: string,
  after = 0,
) =>
  posted(
    k,
    () =>
      /\b(\d{6})\b/.exec(letters(k, to).slice(after).at(-1)?.subject ?? '')
        ?.[1] ?? '',
    `a letter for ${to}`,
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

// Deliver an RFC 5322 letter directly through the kernel's email adapter.
export let arrives = (
  k: Kernel,
  m: { from: string; to: string; raw: string },
) =>
  k.at(
    k.host,
    `/cdn-cgi/handler/email?from=${encodeURIComponent(m.from)}` +
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

// A fixture name stays separate across invocations on the shared kernel.
export let unique = (name: string) =>
  `${name}-${crypto.randomUUID().slice(0, 8)}`

// A person signs in the way a browser does — an address, the code off the
// log, the cookie back — and the kernel mints their person row and their own
// space. The first sign-in on a fresh kernel owns the meta space, which is
// how any directory row comes to be written at all (identity.ts).
// A person, signed in through the address and the code, as anyone signs in.
export let signIn = async (
  k: Pick<Kernel, 'at' | 'host' | 'secret'> & Mailbox,
  email = `${unique('probe')}@${k.host}`,
): Promise<Person> => {
  let form = (path: string, fields: Record<string, string>) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  let received = letters(k, email).length
  let asked = await form('/login', { address: email })
  if (asked.status != 200) throw new Error(`login: ${await asked.text()}`)
  await asked.body?.cancel()
  let code = await mailed(k, email, received)
  let inn = await form('/login/code', { address: email, code })
  if (inn.status != 303) throw new Error(`code: ${await inn.text()}`)
  await inn.body?.cancel()
  // Signed in a moment ago: their space, settled behind the answer
  // (identity.ts `landed`), stands.
  await k.deliveries?.()
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
    // The rows, read off the answer's data: its words carry the unseen block,
    // the ceiling line and a long text only by a tag beside it.
    query: async (query: string) =>
      (await agent.answer('graph_query', { ...where, query })).rows as Row[],
    apply: (entities: unknown[]) =>
      agent.tool('graph_apply', { ...where, entities }),
  }
}

// What `commands` and `command` answer as data (tools.ts, declared.ts `ran`),
// read off the answer: its words are for a model, and carry more.

type Agent = ReturnType<typeof connector>

/** Every command the agent can reach, or the ones of the app `args` names. */
export let commandsOf = async (
  agent: Agent,
  args: Record<string, unknown> = {},
): Promise<Command[]> =>
  (await agent.answer('commands', args)).value?.commands as Command[]

/** A command's arguments: every one it takes, and the ones it needs. */
export let argsIn = (c: Command) => {
  let s = c.input as { properties?: object; required?: string[] }
  return { all: Object.keys(s.properties ?? {}), need: s.required ?? [] }
}

/** The rows a query command answered. */
export let rowsOf = <T>(said: { value?: Record<string, unknown> }): T[] =>
  said.value?.rows as T[]

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

// A free space this person owns, written into the directory by the platform
// the way directory.ts `mint` writes one: what a space made before one person
// was held to one free space (meter.ts `SPACES`) is. Answers its eid.
export let owned = async (
  k: Kernel,
  person: string,
  slug: string,
  title = slug,
) => (await ownedAll(k, person, [{ slug, title }]))[0]

// Several such spaces, written in one apply: their eids, in order.
let ownedAll = async (
  k: Kernel,
  person: string,
  each: { slug: string; title?: string }[],
) => {
  let eids = each.map(() => crypto.randomUUID())
  await meta(k).apply(each.flatMap(({ slug, title = slug }, i) => [
    {
      entity: { eid: eids[i] },
      doc: { title },
      space: { slug, store: spaceHandle(slug, eids[i]) },
    },
    {
      entity: { eid: `$seat${i}` },
      member: { space: eids[i], person, role: 'owner' },
    },
  ]))
  return eids
}

// A person with spaces and apps: they sign in, own each space (`owned`), and
// make its apps through their own agent's app_new. The first app in a space
// answers its bare hostname. Returns who they are, and the eids by slug.
export let seed = async (
  k: Kernel,
  spaces: { slug: string; apps: string[] }[],
) => {
  let them = await signIn(k)
  let agent = connector(k, them.cookie)
  // Each of those tools answers the eid of what it made.
  let made = async (tool: string, args: Record<string, unknown>) =>
    String((await agent.answer(tool, args)).value?.eid)
  let eids: Record<string, string> = {}
  let owns = await ownedAll(k, them.person, spaces)
  for (let [i, s] of spaces.entries()) {
    eids[s.slug] = owns[i]
    for (let a of s.apps) {
      eids[`${s.slug}/${a}`] = await made('app_new', {
        space: s.slug,
        slug: a,
        title: a,
      })
    }
  }
  return { ...them, eids }
}

// ---- Cloudflare's account API, stood in for (mail, domains, rtc, workers) --
//
// The conversations a kernel has with Cloudflare, over the API's
// `{success, errors, result}` envelope. A letter sent through Email Sending,
// by its API or its binding, is written to `log` as one `yak-mail` line, which
// is where a test reads its letters back (`letters`). And the three calls a domain makes — list by name,
// create, delete — go to custom hostnames kept in memory. A hostname is
// answered active, which is the state a domain reaches once the person's
// record resolves; the words each step is read by are held against recorded
// bytes in domains_test.ts, so what this is for is the other half: that the
// tools attach, report and detach a domain end to end.
//
// Realtime's SFU (`/apps/…`) is its own API, not the envelope: sessions and
// the tracks each holds, answered with a mid and an empty description, since
// nothing here carries media. `GET` a session reads its tracks back, which is
// how a test sees what the door opened and closed.
// A worker upload keeps its script and secret names for later API calls.
// Email Sending refuses every letter to an address at `refused.invalid`, for
// a test of a letter that never leaves.
let REFUSED = 'the destination address is not allowed'
let refused = (to: string | string[]) =>
  [to].flat().some((t) => t.endsWith('@refused.invalid'))

export let cloudflare = (log = crypto.randomUUID()) => {
  let held = new Map<string, Custom>()
  let dns = new Map<string, string[]>()
  let calls = new Map<string, Track[]>()
  let workers = new Map<string, { version: string; secrets: Set<string> }>()
  let sfu = async (req: Request, path: string) => {
    let [, id = '', rest = ''] =
      /^\/apps\/[^/]+\/sessions\/([^/]+)\/?(.*)$/.exec(path) ?? []
    if (id == 'new') {
      let made = crypto.randomUUID()
      calls.set(made, [])
      return Response.json({ sessionId: made }, { status: 201 })
    }
    let tracks = calls.get(id)
    if (!tracks) {
      return Response.json({ errorCode: 'no session' }, { status: 404 })
    }
    if (req.method == 'GET') return Response.json({ tracks })
    let asked = (await req.json()).tracks as Track[] ?? []
    if (rest == 'tracks/new') {
      let made = asked.map((t, i) => ({
        ...t,
        mid: String(tracks.length + i),
        status: 'active',
      }))
      tracks.push(...made)
      return Response.json({
        tracks: made.map(({ mid, trackName }) => ({ mid, trackName })),
        sessionDescription: { type: 'answer', sdp: '' },
      })
    }
    if (rest == 'tracks/close') {
      for (let t of tracks) {
        if (asked.some((c) => c.mid == t.mid)) t.status = 'inactive'
      }
    }
    return Response.json({})
  }
  let wrote = (
    to: string | string[],
    subject: string,
    body = '',
    replyTo?: string,
    from?: { address: string; name: string },
  ) =>
    logs.set(
      log,
      (logs.get(log) ?? '') +
        `yak-mail ${
          JSON.stringify({
            to,
            subject,
            body,
            replyTo,
            from: from?.address,
            name: from?.name,
          })
        }\n`,
    )
  let service = endpoint(async (req) => {
    let url = new URL(req.url)
    let ok = (result: unknown) => Response.json({ success: true, result })
    if (url.pathname.startsWith('/meta/')) {
      logs.set(
        log,
        (logs.get(log) ?? '') +
          `yak-meta ${JSON.stringify(await req.json())}\n`,
      )
      return Response.json({ events_received: 1 })
    }
    if (url.pathname == '/probe/txt') {
      let { name, values } = await req.json()
      dns.set(name, values)
      return ok(null)
    }
    if (url.pathname == '/probe/hostname') {
      let { hostname, over } = await req.json()
      let custom = held.get(hostname)
      if (custom) Object.assign(custom, over)
      return ok(custom ?? null)
    }
    if (url.pathname == '/dns-query') {
      let name = url.searchParams.get('name') ?? ''
      return Response.json({
        Status: 0,
        Answer: (dns.get(name) ?? []).map((value) => ({
          name,
          type: 16,
          data: JSON.stringify(value),
        })),
      })
    }
    if (url.pathname == '/tracker-probe' && req.method == 'POST') {
      logs.set(log, (logs.get(log) ?? '') + `yak-tracker ${await req.text()}\n`)
      return new Response(null, { status: 200 })
    }
    if (url.pathname.startsWith('/apps/')) return await sfu(req, url.pathname)
    let script =
      /^\/accounts\/[^/]+\/workers\/dispatch\/namespaces\/[^/]+\/scripts\/([^/]+)(?:\/(.*))?$/
        .exec(url.pathname)
    if (script) {
      let [, name, tail] = script
      let held = workers.get(name)
      if (!tail && req.method == 'PUT') {
        let version = crypto.randomUUID()
        workers.set(name, { version, secrets: held?.secrets ?? new Set() })
        return ok({ version_id: version })
      }
      if (!held) return new Response(null, { status: 404 })
      if (tail == 'secrets' && req.method == 'PUT') {
        held.secrets.add((await req.json()).name)
        return ok({})
      }
      if (tail == 'secrets' && req.method == 'GET') {
        return ok([...held.secrets].map((name) => ({ name })))
      }
      if (tail?.startsWith('secrets/') && req.method == 'DELETE') {
        held.secrets.delete(decodeURIComponent(tail.slice('secrets/'.length)))
        return ok({})
      }
      if (!tail && req.method == 'DELETE') workers.delete(name)
      else if (tail || !['GET', 'DELETE'].includes(req.method)) {
        return new Response(null, { status: 404 })
      }
      return ok({ script: { id: name }, version_id: held.version })
    }
    if (url.pathname.endsWith('/email/sending/send')) {
      let { to, subject, text, reply_to, from } = await req.json()
      if (refused(to)) {
        return Response.json({
          success: false,
          errors: [{ code: 10001, message: REFUSED }],
        }, { status: 400 })
      }
      wrote(to, subject, text, reply_to, from)
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
          ownership_verification: {
            type: 'txt',
            name: `_cf-custom-hostname.${hostname}`,
            value: crypto.randomUUID(),
          },
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
    // Cloudflare can omit the ownership challenge once active. The platform
    // must retain the POST's challenge rather than trust that omission.
    let { ownership_verification: _record, ...active } = found ?? {}
    return ok(found ? [found.status == 'active' ? active : found] : [])
  })
  return {
    url: service.url,
    // The same product as a Worker binding (post.ts `Binding`), which is how
    // an app's own letters leave.
    binding: {
      send: (l: { to: string | string[]; subject: string; text?: string }) => {
        if (refused(l.to)) return Promise.reject(new Error(REFUSED))
        wrote(l.to, l.subject, l.text)
        return Promise.resolve({ messageId: crypto.randomUUID() })
      },
    },
    stop: service.stop,
  }
}

/** A track at the stand-in for Realtime's SFU (`cloudflare`). */
export type Track = {
  mid: string
  trackName?: string
  location?: string
  sessionId?: string
  status?: string
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

/** The TXT records served by the kernel's DNS stand-in. */
export let dnsTxt = async (
  k: Pick<Kernel, 'cloudflare'>,
  name: string,
  ...values: string[]
) => {
  let response = await fetch(`${k.cloudflare}/probe/txt`, {
    method: 'POST',
    body: JSON.stringify({ name, values }),
  })
  await response.body?.cancel()
}

/** Read or change one hostname at the kernel's Cloudflare stand-in. */
export let domainState = async (
  k: Pick<Kernel, 'cloudflare'>,
  hostname: string,
  over: Partial<Custom> = {},
): Promise<Custom> => {
  let response = await fetch(`${k.cloudflare}/probe/hostname`, {
    method: 'POST',
    body: JSON.stringify({ hostname, over }),
  })
  return (await response.json()).result
}

/** Whether the kernel's stand-in for Cloudflare holds `hostname` attached. */
export let attached = async (
  k: Pick<Kernel, 'cloudflare'>,
  hostname: string,
) => {
  let at = `${k.cloudflare}/?hostname=${hostname}`
  return ((await (await fetch(at)).json()).result as unknown[]).length > 0
}

/** What the kernel's apex answers a request posted to `path`, the way a
 * provider posts its events (@yaks/stripe/testing `delivered`). */
export let apexPost =
  (k: Pick<Kernel, 'at'>) => (path: string, init: RequestInit) =>
    k.at('yaks.app', path, init)

/** What a subscription bought for `space` here is tagged with. */
export let tagged = (space: string) => ({ space, apex: apex() })

/**
 * A space on Plus for a test whose subject is what the plan allows, not how it
 * is bought: a signed `subscription.updated` carrying an active subscription
 * (@yaks/stripe/testing `fakeSub`) Stripe never held. Nothing is asked of the
 * sandbox, so nothing is left in it.
 */
export let onPlus = (k: Pick<Kernel, 'at'>, space: string) =>
  delivered(
    apexPost(k),
    '/stripe/webhook',
    WEBHOOK_SECRET,
    'customer.subscription.updated',
    fakeSub(tagged(space)),
  )

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
  // read, the encrypted bit, or a size the bytes do not keep to.
  method?: number
  flags?: number
  size?: number
  // A data descriptor (flags bit 3) without its signature, as the format
  // allows.
  bare?: boolean
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
    let size = one.size ?? raw.length
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
    h.setUint32(22, streamed ? 0 : size, true)
    h.setUint16(26, name.length, true)
    head.set(name, 30)
    body.push(head, packed)
    let took = head.length + packed.length
    if (streamed) {
      let tail = new Uint8Array(16)
      let t = new DataView(tail.buffer)
      t.setUint32(0, 0x08074b50, true)
      t.setUint32(8, packed.length, true)
      t.setUint32(12, size, true)
      let sent = one.bare ? tail.subarray(4) : tail
      body.push(sent)
      took += sent.length
    }
    let row = new Uint8Array(46 + name.length)
    let c = new DataView(row.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, flags, true)
    c.setUint16(10, method, true)
    c.setUint32(20, packed.length, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, at, true)
    row.set(name, 46)
    index.push(row)
    at += took
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
    code_challenge: await challenge(verifier),
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
