// The other way in: pulling what arrived from an edge that cannot reach the
// graph.
//
// ./routes.ts is for an edge that can post a letter to the graph. A graph
// behind a perimeter cannot be posted to, so its edge keeps what arrived and
// the graph asks for it. The edge holds two trays: the letters that came to
// your domain, and the requests posted to its hook paths
// ({@link https://jsr.io/@yaks/hook | @yaks/hook}). A pull takes what nobody
// has taken, records each, and tells the edge which ids are done, so its trays
// drain.
//
//   GET  /messages?unnotified=1&.dir=in&limit=100   letters nobody has taken
//   POST /messages/notified  {ids}                   these are taken
//   GET  /requests?unprocessed=1&limit=100           requests (404: no tray)
//   POST /requests/processed {ids}                   these are taken
//
// Taking is first come, first served at the edge: whichever graph acknowledges
// a letter has it, and no other graph ever sees it. So naming a pull in a
// config is the whole opt-in, and two graphs must never name the same edge — a
// copy of a config that pulls takes the mail from the graph it was copied
// from.
//
// Recording comes before acknowledging, and every record is idempotent — a
// letter by its Message-ID (./arrive.ts), a request by the id derived from it
// (@yaks/hook `hookEid`) — so a crash between the two is harmless: the next
// pull gets the same items back, records nothing new, and acknowledges them.
// An item that cannot be recorded is left unacknowledged and said, so it is
// tried again rather than lost.
//
// An edge that does not answer is tried again on the next pass, which takes
// everything a blip left behind. Transient failures are logged while retrying;
// a delayed letter reports the outage that held it up when the edge recovers.

import type { Eid, Graph } from '@yaks/graph'
import { hooked, type Request } from '@yaks/hook'
import { type Arrivals, arrived, routed } from './arrive.ts'
import type { Arrival, Received } from './inbound.ts'
import type { Fetch } from './cloudflare.ts'
import type { Pull } from './options.ts'

/** Where a failure is told: the host's telemetry, else the console. */
export type Report = (
  error: unknown,
  context?: { tags?: Record<string, string> },
) => unknown

/** How long a letter may wait at the edge before taking it is itself a
 * failure: a pull runs every few seconds, so a letter this old means the pull
 * did not take it in time, however it came to be late. */
export let LATE = 60_000

/** A letter as the edge holds it: the envelope and what it parsed out. */
export type EdgeMessage = {
  /** the edge's key for it: `msg:<ms>:<Message-ID>` */
  id: string
  /** when it arrived, in milliseconds */
  ts?: number | null
  /** when it arrived, as ISO */
  received_at?: string | null
  /** `in` for an arrival */
  dir?: string | null
  /** the envelope sender */
  from?: string | null
  /** the `From:` header — the author */
  from_header?: string | null
  /** the address it was delivered to */
  to?: string | null
  subject?: string | null
  /** the body as text */
  text?: string | null
  /** whether the sending domain signed for it (DKIM) */
  verified?: boolean | null
  /** the `In-Reply-To:` header */
  in_reply_to?: string | null
  /** the `Reply-To:` header, as written */
  reply_to?: string | null
  /** the headers the edge kept: a JSON object, as text */
  headers?: string | null
}

/** A request as the edge holds it, captured as it was received. */
export type EdgeRequest = {
  id: string
  ts?: number | null
  /** who sent it, as the edge named them */
  source?: string | null
  method?: string | null
  path?: string | null
  /** the headers: a JSON object, as text */
  headers?: string | null
  body?: string | null
  /** 1 where the sender's signature verified, 0 where it did not */
  sig_ok?: number | null
}

/** The edge as a pull uses it — a test hands in fixtures instead. `requests`
 * answers null where the edge has no request tray. */
export type Edge = {
  messages: () => Promise<EdgeMessage[]>
  notified: (ids: string[]) => Promise<void>
  requests: () => Promise<EdgeRequest[] | null>
  processed: (ids: string[]) => Promise<void>
}

/** How long one request to the edge may make no answer. */
export let WAIT = 10_000

/** A transport failure another pass can recover from. Parsing, authentication
 * and recording failures are unexpected and still report immediately. */
export class Unavailable extends Error {}

/** The edge's HTTP API, with the bearer token it asks for. */
export let edge = (
  { url, token }: Pull,
  go: Fetch = fetch,
  stop?: AbortSignal,
  wait = WAIT,
): Edge => {
  let root = url.replace(/\/+$/, '')
  let address = new URL(root)
  if (!['http:', 'https:'].includes(address.protocol)) {
    throw new Error('mail edge URL must use HTTP or HTTPS')
  }
  // The answer's body, parsed, or null where the edge has no such tray.
  let call = async (method: string, path: string, body?: unknown) => {
    let late = AbortSignal.timeout(wait)
    let signal = stop ? AbortSignal.any([stop, late]) : late
    try {
      let res = await go(`${root}${path}`, {
        method,
        signal,
        headers: new Headers({
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        }),
        ...(body ? { body: JSON.stringify(body) } : {}),
      }).catch((cause) => {
        throw new Unavailable(`${method} ${path}: connection failed`, { cause })
      })
      if (res.status == 404 && path.startsWith('/requests?')) {
        await res.body?.cancel()
        return undefined
      }
      let raw = await res.text().catch((cause) => {
        throw new Unavailable(`${method} ${path}: response interrupted`, {
          cause,
        })
      })
      if (!res.ok) {
        let ErrorType =
          res.status == 408 || res.status == 429 || res.status >= 500
            ? Unavailable
            : Error
        throw new ErrorType(`${method} ${path}: ${res.status} ${raw}`)
      }
      return raw ? JSON.parse(raw) : null
    } catch (error) {
      // A host stopping is not a failed pull, including while the body is
      // arriving. A timeout still throws, so the tray reports it and the
      // service tries again on its next pass.
      if (stop?.aborted) return null
      throw error
    }
  }
  // The edge binds one SQL variable per id, and its store caps a statement at
  // a hundred, so an acknowledgement goes in bites.
  let ack = async (path: string, ids: string[]) => {
    for (let i = 0; i < ids.length; i += 50) {
      await call('POST', path, { ids: ids.slice(i, i + 50) })
    }
  }
  let list = async (path: string, optional = false) => {
    let items = await call('GET', path)
    if (stop?.aborted || (items === undefined && optional)) return null
    if (
      !Array.isArray(items) ||
      items.some((item) => !item || typeof item.id != 'string')
    ) {
      throw new Error(`GET ${path}: expected items with ids`)
    }
    return items
  }
  return {
    messages: async () =>
      (await list('/messages?unnotified=1&.dir=in&limit=100&sort=ts')) ??
        [],
    notified: (ids) => ack('/messages/notified', ids),
    requests: () => list('/requests?unprocessed=1&limit=100', true),
    processed: (ids) => ack('/requests/processed', ids),
  }
}

/**
 * The Message-ID inside the edge's key for a letter.
 *
 * ```ts
 * import { messageIdOf } from '@yaks/mail'
 * messageIdOf('msg:1789861530206:<a1@x.example>') // 'a1@x.example'
 * messageIdOf('a1@x.example')                     // 'a1@x.example'
 * ```
 */
export let messageIdOf = (key: string): string =>
  (/^(?:msg|out):\d+:(.+)$/.exec(key)?.[1] ?? key).replace(/[<>]/g, '').trim()

let parsed = (raw: string | null | undefined): Record<string, unknown> => {
  try {
    let v = JSON.parse(raw ?? '{}')
    return v && typeof v == 'object' ? v : {}
  } catch {
    return {}
  }
}

/** A letter the edge holds, as the message and arrival ./arrive.ts records:
 * the headers it kept, with the ones it parsed out written back over them. */
export let received = (m: EdgeMessage): [Received, Arrival] => {
  let heads = new Map(
    Object.entries(parsed(m.headers)).map(([k, v]) => [
      k.toLowerCase(),
      String(v),
    ]),
  )
  let said: [string, string | null | undefined][] = [
    ['from', m.from_header],
    ['subject', m.subject],
    ['message-id', messageIdOf(m.id)],
    ['in-reply-to', m.in_reply_to],
    ['reply-to', m.reply_to],
  ]
  for (let [k, v] of said) if (v) heads.set(k, v)
  let at = m.received_at ?? new Date(m.ts ?? Date.now()).toISOString()
  return [
    {
      from: m.from ?? '',
      to: m.to ?? '',
      headers: { get: (name) => heads.get(name.toLowerCase()) ?? null },
    },
    {
      at,
      ...(m.text == null ? {} : { text: m.text }),
      ...(m.verified == null ? {} : { verified: m.verified }),
    },
  ]
}

/** Whom a request is for: the mailbox its first path segment names at your
 * domain — `/hook/books/…` is whoever has `books@<domain>` — else triage. */
export let hookTo = async (
  { graph, domain, triage }: Arrivals,
  path: string | null | undefined,
): Promise<Eid | undefined> => {
  let name = /^\/hook\/([^/?#]+)/.exec(path ?? '')?.[1]
  let found = name && domain
    ? await routed(graph, `${name}@${domain}`, domain)
    : null
  return found ?? triage
}

// A request the edge holds, as @yaks/hook records one.
let request = (r: EdgeRequest): Request => ({
  id: r.id,
  source: r.source || 'unknown',
  ...(r.method == null ? {} : { method: r.method }),
  ...(r.path == null ? {} : { path: r.path }),
  ...(r.headers == null ? {} : { headers: r.headers }),
  ...(r.body == null ? {} : { body: r.body }),
  ...(r.sig_ok == null ? {} : { verified: !!r.sig_ok }),
})

/** An outage kept until the tray answers, including the cause a delayed letter
 * reports. A caller that retries shares this map across passes. */
export type Down = Map<string, { since: number; error: unknown }>

// What every tray of one pass shares.
type Pass = {
  report: Report
  log: Report
  now: () => number
  down?: Down | undefined
}

// One tray: list it, record each item, acknowledge the ones recorded. Nothing
// here throws — nobody is waiting on a pull to answer — so a failure is said
// instead, and an item that failed stays at the edge for the next pull.
let tray = async <T extends { id: string }>(
  { report, log, now, down }: Pass,
  name: string,
  list: () => Promise<T[] | null>,
  record: (item: T) => Promise<unknown>,
  ack: (ids: string[]) => Promise<void>,
): Promise<number> => {
  let fail = (what: string, err: unknown, tags: Record<string, string> = {}) =>
    report(new Error(`@yaks/mail — pull could not ${what}`, { cause: err }), {
      tags: { step: 'mail pull', tray: name, ...tags },
    })
  let began = now()
  let done: string[] = []
  try {
    for (let item of await list() ?? []) {
      try {
        await record(item)
        done.push(item.id)
      } catch (err) {
        fail(`record ${name} ${item.id}`, err)
      }
    }
    if (done.length) await ack(done)
    if (down?.delete(name)) {
      log(`@yaks/mail — ${name} tray recovered`, { tags: { tray: name } })
    }
    return done.length
  } catch (err) {
    if (!down || !(err instanceof Unavailable)) fail(`take ${name}s`, err)
    else {
      let previous = down.get(name)
      down.set(name, { since: previous?.since ?? began, error: err })
      if (!previous) {
        log(
          new Error(
            `@yaks/mail — ${name} tray unavailable; retrying next pass`,
            {
              cause: err,
            },
          ),
          { tags: { step: 'mail pull', tray: name } },
        )
      }
    }
  }
  return 0
}

/** What one pull took: how many letters and requests it recorded and
 * acknowledged. */
export type Pulled = { messages: number; requests: number }

/**
 * One pull: take the letters and the requests the edge holds, record them, and
 * acknowledge them. Each tray fails alone, so an edge that cannot list its
 * letters still hands over its requests.
 *
 * Requests are recorded only where the graph declares `hook`, and aimed at
 * whom they are for only where it declares `about`; a graph without `hook`
 * leaves the request tray for one that has it.
 *
 * A caller that pulls again hands in the same `down` each pass. Transient
 * failures are logged and retained as the cause of a delayed letter's report;
 * without another pass, every failure reports at once.
 */
export let pull = async (
  at: Arrivals & {
    graph: Graph
    report?: Report
    log?: Report
    now?: () => number
    down?: Down
  },
  from: Edge,
): Promise<Pulled> => {
  let {
    graph,
    report = console.error,
    log = console.warn,
    now = Date.now,
    down,
  } = at
  let pass: Pass = { report, log, now, down }
  let receive = arrived(at)
  // Where a late letter's time went, per step, so the report says which.
  let took: Record<string, string> = {}
  let timed = async <T>(
    step: string,
    run: () => T | Promise<T>,
  ): Promise<T> => {
    let began = now()
    try {
      return await run()
    } finally {
      took[step] = `${now() - began} ms`
    }
  }
  let messages = await tray(
    pass,
    'message',
    () => timed('list', from.messages),
    async (m) => {
      // An outbound copy has nothing to record; taking it clears the tray.
      if (m.dir && m.dir != 'in') return
      let bundles = await timed('read', () => receive(...received(m)))
      if (bundles.length) await timed('write', () => graph.apply(bundles))
      let waited = now() - (m.ts ?? (Date.parse(m.received_at ?? '') || now()))
      if (bundles.length && waited > LATE) {
        let outage = down?.get('message')
        report(
          new Error('@yaks/mail — a letter waited too long at the edge', {
            cause: outage?.error,
          }),
          {
            tags: {
              step: 'mail stall',
              letter: messageIdOf(m.id),
              waited: `${waited} ms`,
              ...(outage ? { down: `${now() - outage.since} ms` } : {}),
              ...took,
            },
          },
        )
      }
    },
    from.notified,
  )
  let requests = graph.vocab.comp('hook')
    ? await tray(
      pass,
      'request',
      from.requests,
      async (r) => {
        let about = graph.vocab.comp('about')
          ? await hookTo(at, r.path)
          : undefined
        await graph.apply(hooked(request(r), about), { trusted: true })
      },
      from.processed,
    )
    : 0
  return { messages, requests }
}
