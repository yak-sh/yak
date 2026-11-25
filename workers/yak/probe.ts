// The kernel and its network boundaries, driven in process. Each fixture
// owns a synthetic origin; requests to it dispatch directly to its handler.
import './runtime-resolve.ts'
import { settingsEid as spaceEid } from '@yaks/platform/space-pages'
import { apex } from '@yaks/platform/host'
import { challenge } from '@yaks/oauth'
import { cleanup, clock, kept, until } from '@yaks/testing'
import { COOKIE, sign, verify } from './lib/token.ts'
import { unsealed } from './invite.ts'
import type { Custom } from './domains.ts'
import type { Command } from './declared.ts'
import type { Bundle } from '@yaks/graph'
import {
  ACCOUNT,
  accountEid,
  type AccountWrite,
} from '@yaks/platform/account-rows'
import { REACH, TAB_PERSON } from '@yaks/platform/page-graph'
import { AGENTS, agentsOf } from '@yaks/platform/agents'
import type { PeopleAct } from '@yaks/platform/people-rows'
import type { Load } from '@yaks/host'
import type { Env, Vars } from './env.ts'
import type { Purgers } from '@yaks/workerd/purge'
import type { Builder } from './build.ts'
import { bounded, type Ceiling } from '@yaks/durable-object/ceiling'
import { type Directory, directoryOf, spaceHandle } from './directory.ts'
import { valueIn } from '@yaks/tools/value'
import { endpoints } from './endpoints.ts'
import { delivered, fakeSub } from '@yaks/stripe/testing'
import { domainsApi } from '../../packages/resend/testing.ts'
import { Ajv } from 'ajv'
import { run as jq } from '@gabrielbryk/jq-ts'

let logs = new Map<string, string>()

// Compile each schema when a reply uses it. Most tests call only a few of the
// listed tools, and connectors for other callers can share these validators.
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

/** `p`'s tab asking its page graph's door (@yaks/platform/page-graph). */
export let reach = (
  k: Pick<Kernel, 'at' | 'host'>,
  p: Pick<Person, 'person' | 'cookie'>,
  path: string,
  init: RequestInit = {},
) =>
  k.at(k.host, `${REACH}${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      cookie: p.cookie,
      [TAB_PERSON]: p.person,
      'content-type': 'application/json',
    },
  })

/** `p` writing `bundles` through their tab's page graph. */
export let wrote = (
  k: Pick<Kernel, 'at' | 'host'>,
  p: Pick<Person, 'person' | 'cookie'>,
  bundles: Bundle[],
) => reach(k, p, '/apply', { method: 'POST', body: JSON.stringify(bundles) })

/** The agents `p` connected, as their tab's page graph reads them
 * (@yaks/platform/agents), or undefined when the door refuses. */
export let agentsAt = async (
  k: Pick<Kernel, 'at' | 'host'>,
  p: Pick<Person, 'person' | 'cookie'>,
) => {
  let res = await reach(k, p, `/query?q=${encodeURIComponent(AGENTS)}`)
  if (!res.ok) return void await res.body?.cancel()
  return agentsOf(await res.json())
}

/** `p` pressing Disconnect on their agent `agent`, through their page graph:
 * the press with what it came to, and their agents read again. */
export let disconnectAgent = (
  k: Pick<Kernel, 'at' | 'host'>,
  p: Pick<Person, 'person' | 'cookie'>,
  agent: string,
) =>
  wrote(k, p, [{
    entity: { eid: crypto.randomUUID() },
    disconnectAgent: { agent },
  }])

/** `p` pressing a button of the People page of their space `slug`: the act
 * `act` (@yaks/platform/people-rows) with `args`, written through their page
 * graph. The answer is the act with what it came to in `said`, or a refusal. */
export let pressPeople = async (
  k: Pick<Kernel, 'at' | 'host' | 'dir'>,
  p: Pick<Person, 'person' | 'cookie'>,
  slug: string,
  act: PeopleAct,
  args: Record<string, string> = {},
) => {
  let space = (await k.dir.space(slug))!
  let res = await wrote(k, p, [{
    entity: { eid: crypto.randomUUID() },
    [act]: { space: space.eid, ...args },
  }])
  let body = await res.json()
  return {
    status: res.status,
    said: (body[0]?.[act]?.said ?? body.message) as string,
  }
}

/** `p` changing their account as their Profile's Save bar does: the account
 * row they hold, with `change`, written through their page graph. */
export let saveAccount = async (
  k: Pick<Kernel, 'at' | 'host'>,
  p: Pick<Person, 'person' | 'cookie'>,
  change: AccountWrite,
) => {
  let [row] = await (await reach(k, p, `/query?q=${ACCOUNT}`)).json()
  return await wrote(k, p, [{
    entity: { eid: accountEid(p.person) },
    account: { ...row.account, ...change },
  }])
}

/** `p` doing `act` to the space `space` through their page graph, as its
 * Settings, Domains or Trash page does (@yaks/platform/space-pages): its
 * `spaceSettings`, as Settings' Save bar writes them, or one of its acts. */
export let spaceAct = (
  k: Pick<Kernel, 'at' | 'host'>,
  p: Pick<Person, 'person' | 'cookie'>,
  space: string,
  act: Record<string, Record<string, unknown>>,
) => {
  let [[word, value]] = Object.entries(act)
  return wrote(k, p, [{
    entity: {
      eid: word == 'spaceSettings' ? spaceEid(space) : crypto.randomUUID(),
    },
    [word]: { space, ...value },
  }])
}

/** A kernel's door (`driven`). */
export type Door = ReturnType<typeof driven>

/** A kernel's door, its meta-space owner, and its cleanup. */
export type Kernel = Door & {
  owner: Person
  dir: Directory
  // The stand-in for Resend's Domains API a space's mail domains are set up
  // at (mail-domains.ts): what it holds, and `arrive` to mark a domain's
  // records found in DNS.
  mailDomains: ReturnType<typeof domainsApi>
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
  CF_DNS_TOKEN: 'a-token',
  HOSTNAMES_API: cloudflare,
  RESEND_DOMAINS_TOKEN: 'a-token',
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

// The kernel's handler and graph bindings share the caller's process.
let boot = async (
  bindings: Vars = {},
  prepare?: (env: Env) => void,
  load?: Load,
) => {
  let [
    { handler, email },
    { ai, dataset, emailed, lasting, modelPage },
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
  let cf = cloudflare(log, bindings.REGISTRAR_EXPIRY as string | undefined)
  let domains = domainsApi('a-token')
  let views = dataset()
  let p = lasting(secret, {
    ...vars(secret, cf.url),
    // What the runtime binds beside the config: this deploy's id, and the
    // `send_email` binding an app's letters leave through.
    CF_VERSION_METADATA: { id: crypto.randomUUID() },
    MAIL: cf.binding,
    // Resend's Domains API, stood in for; every other call a mail provider
    // makes goes where it always went.
    MAIL_FETCH: (url: string, init: RequestInit) =>
      new URL(url).pathname.startsWith('/domains')
        ? domains.fetch(url, init)
        : fetch(url, init),
    // The Visits dataset, kept in memory: what the kernel counts (views.ts,
    // funnel.ts) is read off `views`.
    VIEWS: views,
    // A model that says nothing, priced from a page of our own: an app's
    // break starts its space's Operator (unseen.ts `fix`), and no test
    // reaches Workers AI or its catalogue.
    AI: ai([]) as Env['AI'],
    MODEL_FETCH: () => Promise.resolve(modelPage(0.15, 0.5)),
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
  // Once, however many ask: a test's `stop`, and its scope after it.
  let closed: Promise<void> | undefined
  let close = () =>
    closed ??= (async () => {
      await service.stop()
      await p[Symbol.asyncDispose]()
      await cf.stop()
      logs.delete(log)
    })()
  let door = driven(service.url, secret, log, apex(), cf.url)
  let deliveries = async () => {
    while (held.size) await Promise.allSettled([...held])
  }
  try {
    return {
      ...door,
      owner: await signIn({ ...door, deliveries }, `owner@${apex()}`),
      dir: directoryOf(p.env.STORE),
      mailDomains: domains,
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

// The kernel the runner's files share, started by the first of their tests
// that asks for one. Booting it (its platform store, the owner's sign-in) is
// most of what a small file costs, so it serves every file after, and ends
// once the runtime needs its memory back (@yaks/testing `kept`): it holds
// every store any file made. Files keep apart on it through their own people,
// spaces and hostnames.
let shared: ReturnType<typeof boot> | undefined

/** The in-memory kernel shared by the runner's files. */
export let kernel = async (): Promise<Kernel> => {
  if (!shared) {
    let mine = shared = boot()
    kept(async () => {
      if (shared == mine) shared = undefined
      await (await mine).close()
    })
  }
  let { close: _, ...k } = await shared
  return owning(k)
}

/**
 * A kernel in memory of one test's own, started for it and ended by its
 * `stop`, or else as the test ends (or, made outside a test, its file): for
 * a test that needs the kernel whole, such as one that times a store's first
 * wake.
 */
export let fresh = async (
  bindings: Vars = {},
  prepare?: (env: Env) => void,
  load?: Load,
): Promise<Kernel> => {
  let { close, ...k } = await boot(bindings, prepare, load)
  cleanup(close)
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

/**
 * A page as this checkout draws it, written to `file` as one still document
 * (@yaks/platform/still) for `yak admin browse <path> --html <file>` to show
 * at its live address in Cloudflare's browser: a UI change seen before it
 * lands. The site's built files (the kit's `_ui.css` among them) are built
 * first, as the deploy builds them (assets.ts).
 *
 * ```ts ignore
 * let k = await kernel()
 * let me = await signIn(k)
 * let own = (await k.dir.own(me.person))!
 * await stillPage(k, `/${own.slug}/updates`, me.cookie, '.scratch/updates.html')
 * ```
 */
export let stillPage = async (
  k: Door,
  path: string,
  cookie: string,
  file: string,
) => {
  await (building ??= import('./assets.ts').then((a) => a.build()))
  let get = (url: string) => {
    let { pathname, search } = new URL(url, 'https://yaks.app')
    return k.at('yaks.app', pathname + search, {
      headers: { cookie, accept: 'text/html' },
    })
  }
  // An address that moved draws the page it moved to.
  let at = new URL(path, 'https://yaks.app')
  let r = await get(at.href)
  for (let hops = 0; r.status >= 300 && r.status < 400 && hops < 5; hops++) {
    at = new URL(r.headers.get('location')!, at)
    r = await get(at.href)
  }
  if (!r.ok) throw new Error(`${at.pathname} answered ${r.status}`)
  let { still } = await import('@yaks/platform/still')
  await Deno.writeTextFile(file, await still(await r.text(), at.href, get))
}
let building: Promise<void> | undefined

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

// The output schemas each caller of a kernel was listed, by tool: a caller
// lists its tools once, however many clients it opens (`meta` opens one a
// call), and lists them again only for a tool it was not listed yet.
type Schemas = Map<
  string,
  { schema: object; check?: ReturnType<typeof fitting> }
>
let listings = new WeakMap<object, Map<string, Schemas>>()
let listedFor = (k: Pick<Kernel, 'at'>, caller: string): Schemas => {
  let held = listings.get(k.at) ?? new Map<string, Schemas>()
  listings.set(k.at, held)
  if (!held.has(caller)) held.set(caller, new Map())
  return held.get(caller)!
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
  let schemas = listedFor(k, `${k.host}${path} ${cookie ?? ''} ${bearer ?? ''}`)
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
          if (t.outputSchema) schemas.set(t.name, { schema: t.outputSchema })
        }
      }
      let schema = schemas.get(name)
      if (!schema) throw new Error(`${name}: no listed output schema`)
      let fits = schema.check ??= fitting(schema.schema)
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
// (`cloudflare`). An app's letter may be addressed to several readers at
// once, so "to this address" is membership, not equality.
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

// The latest letter to an address that says a thing, past the letters it had
// already received, waited for. The pool sends a letter after the write that
// asked for it commits, so a request that answered may not have sent its letter
// yet: when an earlier letter says the same thing, `after` (the count of
// `letters` taken before the request) is what makes this the request's own.
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

let DIGITS = /\b(\d{6})\b/

// The code in the latest letter to an address that carries one, past the
// letters already received before requesting another sign-in. Another letter
// to the address (an invitation the pool sends after its write commits) can
// land after the code's, so the newest letter is not always the code's.
export let mailed = (
  k: Mailbox,
  to: string,
  after = 0,
) =>
  posted(
    k,
    () =>
      letters(k, to).slice(after).map((l) => DIGITS.exec(l.subject)?.[1])
        .findLast(Boolean) ?? '',
    `a code letter for ${to}`,
  )

// An invitation's one click, the way its person makes it (invite.ts): the link
// out of the latest invitation letter to that address, past `after` letters
// (see `letter`), opened with `cookie` (or none). Answers the door's response,
// unread.
export let clickInvite = async (
  k: Kernel,
  email: string,
  cookie?: string,
  after = 0,
) => {
  let l = await letter(k, email, '/invite?t=', after)
  let link = new URL(/https:\/\/\S+\/invite\?t=\S+/.exec(l.body)![0])
  return k.at(link.host, link.pathname + link.search, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
}

// Accepted: the click, signed in as its person, landing where it points.
// Anything else says which door answered: its page's title (or its first
// words), the link clicked, and what that link's seal opens to under the
// kernel's own secret (invite.ts `unsealed`).
export let accepted = async (
  k: Kernel,
  email: string,
  cookie: string,
  after = 0,
) => {
  let r = await clickInvite(k, email, cookie, after)
  if (r.status == 303) {
    await r.body?.cancel()
    return r.headers.get('location')!
  }
  let text = await r.text()
  let said = /<title>([^<]*)<\/title>/.exec(text)?.[1] ?? text.slice(0, 200)
  let l = await letter(k, email, '/invite?t=', after)
  let link = /https:\/\/\S+\/invite\?t=\S+/.exec(l.body)![0]
  let t = new URL(link).searchParams.get('t') ?? ''
  let sealed = await unsealed(t, k.secret)
  throw new Error(
    `accept: ${r.status} ${said} at ${link}, ` +
      `sealed ${JSON.stringify(sealed)}`,
  )
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
  let browser = ''
  let form = (path: string, fields: Record<string, string>) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...browser ? { cookie: browser } : {},
      },
      body: new URLSearchParams(fields).toString(),
    })
  let received = letters(k, email).length
  let asked = await form('/login', { address: email })
  if (asked.status != 200) throw new Error(`login: ${await asked.text()}`)
  browser =
    asked.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`))?.split(
      ';',
    )[0] ?? ''
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

// The release published as `name` marked as passing yaks.app's code review
// (gallery.ts `reviewed`), so a copy of it in a stranger's space runs
// unsandboxed (@yaks/platform/installs `vetted`, T-1857).
export let reviewed = async (k: Kernel, name: string) => {
  let { app } = (await k.dir.offered(name))!
  let release = (await k.dir.deployAt(app, app.published!.version))!
  await k.dir.stamp({
    entities: [{
      entity: { eid: release.eid },
      code_review: { verdict: 'approve', findings: 'probe' },
    }],
  })
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
// was held to one free space (@yaks/platform/plans `SPACES`) is. Answers its
// eid.
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

export let cloudflare = (
  log = crypto.randomUUID(),
  registrarExpiry = new Date(Date.now() + 365 * 86_400_000).toISOString(),
) => {
  let held = new Map<string, Custom>()
  let dns = new Map<string, string[]>()
  // The records written in the platform's own zone (zone.ts), by their id.
  let zone = new Map<string, Record<string, unknown> & { id: string }>()
  let records = async (req: Request, url: URL, id?: string) => {
    if (req.method == 'POST') {
      let made = { ...await req.json(), id: crypto.randomUUID() }
      zone.set(made.id, made)
      return ok(made)
    }
    if (req.method == 'DELETE' && id) {
      zone.delete(id)
      return ok({ id })
    }
    let { type, name } = Object.fromEntries(url.searchParams)
    return ok(
      [...zone.values()].filter((r) => r.type == type && r.name == name),
    )
  }
  let ok = (result: unknown) => Response.json({ success: true, result })
  // Cloudflare Registrar and the account's zones (@yaks/cloudflare/registrar):
  // a name beginning `taken` is someone else's, every other one costs $10.44
  // a year and registers at once; and each zone made is kept by its name.
  let names = new Map<string, { auto_renew: boolean }>()
  let zones = new Map<string, string>()
  let priced = (name: string) =>
    name.startsWith('taken')
      ? { name, registrable: false, reason: 'domain_unavailable' }
      : {
        name,
        registrable: true,
        tier: 'standard',
        pricing: {
          currency: 'USD',
          registration_cost: '10.44',
          renewal_cost: name.endsWith('.store')
            ? '42.20'
            : name.endsWith('.dev')
            ? '12.20'
            : '10.44',
        },
      }
  let workflow = (name: string) => ({
    domain_name: name,
    state: 'succeeded',
    completed: true,
    context: {
      registration: {
        expires_at: registrarExpiry,
        auto_renew: names.get(name)?.auto_renew,
      },
    },
  })
  let missing = () =>
    Response.json({ success: false, errors: [{ message: 'not found' }] }, {
      status: 404,
    })
  let registrar = async (req: Request, url: URL) => {
    let path = url.pathname
    if (path == '/zones' && req.method == 'GET') {
      let name = url.searchParams.get('name') ?? ''
      let id = zones.get(name)
      return ok(id ? [{ id, name }] : [])
    }
    if (path == '/zones' && req.method == 'POST') {
      let { name } = await req.json()
      let id = zones.get(name) ?? crypto.randomUUID()
      zones.set(name, id)
      return ok({ id, name })
    }
    let at = /^\/accounts\/[^/]+\/registrar\/(.*)$/.exec(path)?.[1]
    if (at == null) return null
    if (at == 'domain-check') {
      let { domains } = await req.json()
      return ok({ domains: (domains as string[]).map(priced) })
    }
    if (at == 'domain-search') {
      let q = url.searchParams.get('q') ?? ''
      return ok({ domains: [`${q}.com`, `${q}.net`].map(priced) })
    }
    if (at == 'registrations' && req.method == 'POST') {
      let { domain_name, auto_renew } = await req.json()
      names.set(domain_name, { auto_renew: !!auto_renew })
      return Response.json({ success: true, result: workflow(domain_name) }, {
        status: 201,
      })
    }
    let [, name, rest] = /^registrations\/([^/]+)\/?(.*)$/.exec(at) ?? []
    let held = name && names.get(decodeURIComponent(name))
    if (!held) return missing()
    if (rest == 'registration-status') return ok(workflow(name))
    if (!rest && req.method == 'GET') {
      return ok({
        expires_at: registrarExpiry,
        auto_renew: held.auto_renew,
      })
    }
    if (!rest && req.method == 'PATCH') {
      held.auto_renew = !!(await req.json()).auto_renew
      return ok(workflow(name))
    }
    return missing()
  }
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
    let written = /^\/zones\/[^/]+\/dns_records(?:\/([^/]+))?$/
      .exec(url.pathname)
    if (written) return await records(req, url, written[1])
    let sold = await registrar(req, url)
    if (sold) return sold
    if (url.pathname == '/probe/zone') return ok([...zone.values()])
    if (url.pathname == '/probe/registrar') {
      return ok(Object.fromEntries(names))
    }
    if (url.pathname.startsWith('/meta/')) {
      logs.set(
        log,
        (logs.get(log) ?? '') +
          `yak-meta ${JSON.stringify(await req.json())}\n`,
      )
      return Response.json({ events_received: 1 })
    }
    if (url.pathname == '/probe/txt' || url.pathname == '/probe/mx') {
      let { name, values } = await req.json()
      let type = url.pathname == '/probe/mx' ? 'MX' : 'TXT'
      dns.set(`${type} ${name}`, values)
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
      let type = url.searchParams.get('type') ?? 'TXT'
      return Response.json({
        Status: 0,
        Answer: (dns.get(`${type} ${name}`) ?? []).map((value) => ({
          name,
          type: type == 'MX' ? 15 : 16,
          data: type == 'MX' ? value : JSON.stringify(value),
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
      send: (l: {
        to: string | string[]
        subject: string
        text?: string
        from?: string | { email: string; name: string }
      }) => {
        if (refused(l.to)) return Promise.reject(new Error(REFUSED))
        let from = typeof l.from == 'string'
          ? { address: l.from, name: '' }
          : l.from && { address: l.from.email, name: l.from.name }
        wrote(l.to, l.subject, l.text, undefined, from)
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

/** The records the platform wrote in its own zone, each `TYPE name content`,
 * sorted. */
export let zoneRecords = async (k: Pick<Kernel, 'cloudflare'>) => {
  let { result } = await (await fetch(`${k.cloudflare}/probe/zone`)).json()
  return (result as { type: string; name: string; content: string }[])
    .map((r) => `${r.type} ${r.name} ${r.content}`).sort()
}

/** The MX records served by the kernel's DNS stand-in, each written as DNS
 * answers one: `10 mx.example.com.`. */
export let dnsMx = async (
  k: Pick<Kernel, 'cloudflare'>,
  name: string,
  ...values: string[]
) => {
  let response = await fetch(`${k.cloudflare}/probe/mx`, {
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
export let onPlus = (
  k: Pick<Kernel, 'at'>,
  space: string,
  per?: 'month' | 'year',
) =>
  delivered(
    apexPost(k),
    '/stripe/webhook',
    WEBHOOK_SECRET,
    'customer.subscription.updated',
    fakeSub(
      tagged(space),
      per
        ? { items: { data: [{ price: { recurring: { interval: per } } }] } }
        : {},
    ),
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

/** An authorize request from a client registered as `name`, sent back to
 * `back`, and the verifier its code is exchanged with. */
export let authorizing = async (
  k: Pick<Kernel, 'at' | 'host'>,
  { name = 'a roster probe', back = 'https://probe.invalid/cb' } = {},
) => {
  let reg = await k.at(k.host, '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
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
    scope: 'graph',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  }).toString()
  return { q, client_id, back, verifier }
}

export let bearerFor = async (
  k: Pick<Kernel, 'at' | 'host'>,
  cookie: string,
) => {
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
  let { q, client_id, back, verifier } = await authorizing(k)
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

/** The names registered at the kernel's Registrar stand-in, each with
 * whether it renews. */
export let registered = async (k: Pick<Kernel, 'cloudflare'>) =>
  (await (await fetch(`${k.cloudflare}/probe/registrar`)).json())
    .result as Record<string, { auto_renew: boolean }>
