import { decodedPath } from './request-path.ts'
import { HTMLRewriter as LolHtml } from 'html-rewriter-wasm'
import { createHash } from 'node:crypto'
import { memoryMultipart } from '@yaks/blob'
import { contentType } from 'mime-types'
import { ram } from '@yaks/ram'
import { group } from '@yaks/tracker'
import {
  options as trackerOptions,
  store as trackerStore,
  vocab as trackerVocab,
} from '../tracker/core.ts'
import { door as trackerDoor } from '../tracker/door.ts'
import { batch as trackerBatch } from '../tracker/queue.ts'
import { scopeOf } from '../tracker/worker.ts'
import type { Env, Inbound, Vars } from './env.ts'
import { Wire as Wired } from './stream.ts'
import type { Limiter } from './rate.ts'
import { sha256 } from './versions.ts'
import { workspaces } from './workspace-probe.ts'

// The HTMLRewriter binding: the runtime's own lol-html, compiled to
// WebAssembly (html-rewriter-wasm, as Miniflare runs it), behind the
// Response-in, Response-out shape the runtime gives it. The bytes a handler
// does not touch pass through as they came, so a page's doctype, case and
// whitespace survive the way they do in production.
type Handlers = Parameters<LolHtml['on']>[1]
type DocumentHandlers = Parameters<LolHtml['onDocument']>[0]

class Rewriter {
  #on: [string, Handlers][] = []
  #documents: DocumentHandlers[] = []
  on(selector: string, handlers: Handlers) {
    this.#on.push([selector, handlers])
    return this
  }
  onDocument(handlers: DocumentHandlers) {
    this.#documents.push(handlers)
    return this
  }
  transform(res: Response) {
    let on = this.#on, documents = this.#documents
    let body = new ReadableStream<Uint8Array>({
      async start(c) {
        let html = new LolHtml((chunk) => {
          if (chunk.length) c.enqueue(chunk.slice())
        })
        for (let [selector, handlers] of on) html.on(selector, handlers)
        for (let handlers of documents) html.onDocument(handlers)
        try {
          for await (let bytes of res.body ?? []) await html.write(bytes)
          await html.end()
        } finally {
          html.free()
        }
        c.close()
      },
    })
    return new Response(body, res)
  }
}

;(globalThis as { HTMLRewriter?: unknown }).HTMLRewriter ??= Rewriter

let sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false
  return true
}

/**
 * The bucket, as the slice `r2Objects` asks for.
 *
 * `at` is when each object landed, which the retention sweep reads
 * (written.ts `pruned`); a test that wants an object to look old sets it,
 * and everything else lands now.
 */
export let bucket = () => {
  let held = new Map<string, Uint8Array>()
  let at = new Map<string, number>()
  let gets: { key: string; range?: { offset: number; length: number } }[] = []
  let etags = new WeakMap<Uint8Array, {
    bytes: Uint8Array<ArrayBuffer>
    etag: string
  }>()
  // `held` is public and its bytes can change. Each read keeps one snapshot
  // for its body and tag, sharing the digest until those bytes change.
  let tagged = (bytes: Uint8Array) => {
    let was = etags.get(bytes)
    if (was && sameBytes(bytes, was.bytes)) return was
    let snapshot = new Uint8Array(bytes)
    // Hash in this process: WebCrypto queues a worker even for a two-byte
    // fixture, making a read wait on unrelated crypto work in the suite.
    let next = {
      bytes: snapshot,
      etag: createHash('sha256').update(snapshot).digest('hex'),
    }
    etags.set(bytes, next)
    return next
  }
  let put = (k: string, v: ArrayBuffer | ArrayBufferView | string) => {
    let bytes = typeof v == 'string'
      ? new TextEncoder().encode(v)
      : v instanceof ArrayBuffer
      ? new Uint8Array(v)
      : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    held.set(k, new Uint8Array(bytes))
    if (!at.has(k)) at.set(k, Date.now())
    return Promise.resolve()
  }
  return {
    held,
    at,
    gets,
    r2: {
      head: (k: string) => {
        let bytes = held.get(k)
        if (!bytes) return Promise.resolve(null)
        let read = tagged(bytes)
        return Promise.resolve({ size: read.bytes.byteLength, etag: read.etag })
      },
      get: (
        k: string,
        options?: { range: { offset: number; length: number } },
      ) => {
        gets.push({ key: k, range: options?.range })
        let bytes = held.get(k)
        if (!bytes) return Promise.resolve(null)
        let read = tagged(bytes)
        let at = options?.range.offset ?? 0
        let end = at + (options?.range.length ?? read.bytes.length)
        let part = read.bytes.slice(at, end)
        return Promise.resolve({
          etag: read.etag,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(part)
              controller.close()
            },
          }),
          arrayBuffer: () => Promise.resolve(part.buffer as ArrayBuffer),
        })
      },
      put,
      // An upload in parts, held here until it is whole and then put.
      ...memoryMultipart(put),
      delete: (keys: string | string[]) => {
        for (let k of [keys].flat()) {
          held.delete(k)
          at.delete(k)
        }
        return Promise.resolve()
      },
      list: ({ prefix }: { prefix: string }) =>
        Promise.resolve({
          objects: [...held.keys()].filter((k) => k.startsWith(prefix))
            .map((key) => ({
              key,
              size: held.get(key)!.byteLength,
              uploaded: new Date(at.get(key) ?? Date.now()),
            })),
          truncated: false,
        }),
    },
  }
}

/**
 * The Analytics Engine dataset, as a list (views.ts). Cloudflare's own binding
 * takes a point and says nothing back, so what a test can assert on is what
 * was written — which is exactly what the privacy rule is about.
 */
export let dataset = () => {
  let points: {
    indexes?: string[]
    blobs?: string[]
    doubles?: number[]
  }[] = []
  return {
    points,
    writeDataPoint: (p: (typeof points)[number]) => void points.push(p),
  }
}

/**
 * The Analytics Engine SQL API, scripted (views.ts). There is no binding to
 * swap — reading a dataset is an HTTP call with a token — so this stands in
 * for `globalThis.fetch` and answers only that endpoint, passing everything
 * else through. `rows` is handed the SQL and says what came back, so a test
 * states rows rather than JSON.
 */
export let analytics = (rows: (sql: string) => Record<string, unknown>[]) => {
  let asked: string[] = []
  let real = globalThis.fetch
  globalThis.fetch = ((to: string | Request, init?: RequestInit) => {
    let at = typeof to == 'string' ? to : to.url
    if (!at.includes('/analytics_engine/sql')) return real(to as Request, init)
    let sql = String(init?.body ?? '')
    asked.push(sql)
    return Promise.resolve(Response.json({ data: rows(sql) }))
  }) as typeof fetch
  return { asked, done: () => void (globalThis.fetch = real) }
}

/** How many gallery cards a page draws (gallery.ts `card`), whatever other
 * classes a card wears beside its own. */
export let cards = (html: string) =>
  html.match(/class="[^"]*\bMake_Card\b[^"]*"/g)?.length ?? 0

/**
 * A Durable Object's key-value storage in a Map, the slice the Wire object
 * reads (stream.ts): a value is kept as a structured clone, as the runtime
 * keeps it.
 */
export let kvStorage = () => {
  let map = new Map<string, unknown>()
  return {
    map,
    get: <T>(key: string) => Promise.resolve(map.get(key) as T | undefined),
    put: (key: string, value: unknown) =>
      Promise.resolve(void map.set(key, structuredClone(value))),
  }
}

/**
 * A KV namespace in a Map, in the shape the kernel and its OAuth provider ask
 * of `OAUTH_KV` (grants.ts, handoff.ts, identity.ts): a value read back as
 * text or as JSON, a key that lapses at its `expirationTtl`, and a listing
 * by prefix that comes back in one page.
 */
export let kv = () => {
  let held = new Map<string, string>()
  let until = new Map<string, number>()
  let live = (k: string) => {
    if ((until.get(k) ?? Infinity) > Date.now()) return held.get(k) ?? null
    held.delete(k)
    until.delete(k)
    return null
  }
  type As = 'text' | 'json' | { type?: 'text' | 'json' }
  return {
    held,
    get: (k: string, as?: As) => {
      let v = live(k)
      let json = as == 'json' || typeof as == 'object' && as.type == 'json'
      return Promise.resolve(json && v != null ? JSON.parse(v) : v)
    },
    put: (k: string, v: string, o: { expirationTtl?: number } = {}) => {
      held.set(k, v)
      if (o.expirationTtl) until.set(k, Date.now() + o.expirationTtl * 1000)
      else until.delete(k)
      return Promise.resolve()
    },
    delete: (k: string) => (held.delete(k), Promise.resolve()),
    list: ({ prefix = '' }: { prefix?: string }) =>
      Promise.resolve({
        keys: [...held.keys()].filter((k) => k.startsWith(prefix) && live(k))
          .map((name) => ({ name })),
        list_complete: true,
      }),
  }
}

/**
 * Workers static assets over a directory (wrangler.toml `[assets]`), with the
 * binding's default html handling: `/x` answers x.html and `/x/` answers
 * x/index.html, a page asked for by its file name moves to its address with a
 * 307, and anything else not on disk is a 404.
 */
export let assets = (root: URL) => {
  let read = (path: string) =>
    Deno.readFile(new URL(`.${path}`, root)).catch(() => null)
  // As the runtime's binding answers: an ETag of the bytes, and a 304 to a
  // request already holding them.
  let file = async (
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    asked?: string | null,
  ) => {
    let etag = `"${(await sha256(bytes)).slice(0, 32)}"`
    let headers = {
      'content-type': contentType(path.slice(path.lastIndexOf('.'))) ||
        'application/octet-stream',
      'cache-control': 'public, max-age=0, must-revalidate',
      etag,
    }
    return asked == etag
      ? new Response(null, { status: 304, headers })
      : new Response(bytes, { headers })
  }
  return {
    fetch: async (req: Request) => {
      let url = new URL(req.url)
      let path = decodedPath(url.pathname)
      if (path == null) return new Response(null, { status: 404 })
      let moved = (to: string) =>
        new Response(null, {
          status: 307,
          headers: { location: to + url.search },
        })
      let page = /(\/index)?\.html$/.exec(path)
      if (page && await read(path)) {
        return moved(page[1] ? path.slice(0, -10) : path.slice(0, -5))
      }
      if (path.endsWith('/')) {
        let index = await read(`${path}index.html`)
        return index
          ? file('.html', index)
          : new Response(null, { status: 404 })
      }
      let asked = req.headers.get('if-none-match')
      let bytes = await read(path)
      if (bytes) return file(path, bytes, asked)
      let html = await read(`${path}.html`)
      if (html) return file('.html', html, asked)
      if (await read(`${path}/index.html`)) return moved(`${path}/`)
      return new Response(null, { status: 404 })
    },
  }
}

/**
 * The runtime's local email door (`/cdn-cgi/handler/email`), as `wrangler dev`
 * answers it: the envelope off the query string and the letter as the body,
 * handed to the Worker's `email()` as a message. 200 when it was taken, 400
 * carrying the reason when it was refused (`setReject`).
 */
export let emailed = async (
  req: Request,
  email: (m: Inbound, env: Env) => Promise<void>,
  env: Env,
) => {
  let url = new URL(req.url)
  let raw = await req.text()
  let head = new Map<string, string>()
  let lines = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ')
  for (let line of lines.split(/\r?\n/)) {
    let at = line.indexOf(':')
    if (at > 0) {
      head.set(
        line.slice(0, at).trim().toLowerCase(),
        line.slice(at + 1).trim(),
      )
    }
  }
  let refused = ''
  await email({
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    headers: { get: (name) => head.get(name.toLowerCase()) ?? null },
    raw: new Response(raw).body!,
    setReject: (why) => void (refused = why),
  }, env)
  return refused
    ? new Response(refused, { status: 400 })
    : new Response('Worker successfully processed email')
}

/**
 * A rate limiting binding (rate.ts `Limiter`): `limit` calls per key in each
 * `period` seconds, each key's windows fixed and counted from its first call.
 * Miniflare counts them from the epoch; counted from a key's first call, a
 * burst sent from a key of its own lands in one window whenever it is sent,
 * so a test never waits on the clock for a window with time left in it.
 */
export let limiter = (limit: number, period: number): Limiter => {
  let first = new Map<string, number>()
  let seen = new Map<string, number>()
  return {
    limit: ({ key }) => {
      let now = Date.now()
      if (!first.has(key)) first.set(key, now)
      let at = `${Math.floor((now - first.get(key)!) / 1000 / period)} ${key}`
      seen.set(at, (seen.get(at) ?? 0) + 1)
      return Promise.resolve({ success: seen.get(at)! <= limit })
    },
  }
}

/** Worker bindings independent of Store and Builder hosts. Namespaces are
 * supplied by the scenario that owns their behavior. */
export let bindings = (secret: string, vars: Vars = {}) => {
  // A person's stream (stream.ts), one object per person, made on demand and
  // kept like a store: what a session was told, and the roster it holds.
  let wires = new Map<string, Wired>()
  let wire = (name: string): Wired => {
    let held = wires.get(name)
    if (!held) wires.set(name, held = new Wired({ storage: kvStorage() }, env))
    return held
  }
  let trackers = new Map<string, ReturnType<typeof trackerStore>>()
  let tracker = (scope: string) => {
    let held = trackers.get(scope)
    if (!held) {
      trackers.set(
        scope,
        held = trackerStore(ram(trackerVocab, trackerOptions), {
          sink: () => {},
        }),
      )
    }
    return held
  }
  let files = bucket()
  let env = {
    SESSION_SECRET: secret,
    TRACKER_SECRET: secret,
    TRACKER: {
      fetch: (request: Request) => {
        let scope = scopeOf(new URL(request.url))
        if (!scope) {
          return Promise.resolve(
            Response.json({ error: 'tracker scope required' }, {
              status: 400,
            }),
          )
        }
        return trackerDoor(tracker(scope), scope, secret)(request)
      },
    },
    ERRORS: {
      send: async (rows: import('@yaks/graph').Bundle[]) => {
        let { scope } = trackerBatch(rows)
        let target = tracker(scope)
        await target.ingest(rows)
        for (let row of rows.filter((row) => row.error)) {
          await group(
            target.graph,
            row.entity.eid,
          )
        }
      },
    },
    BLOBS: files.r2,
    // The grants ledger (grants.ts): what a CLI token and the build sandbox's
    // own sign-in are written down in.
    OAUTH_KV: kv(),
    ASSETS: assets(new URL('./public/', import.meta.url)),
    WIRE: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: (r: Request) => Promise.resolve(wire(String(n)).fetch(r)),
      }),
    },
    ...vars,
    WORKSPACES: vars.WORKSPACES ??
      (vars.SANDBOX ? workspaces(vars.SANDBOX) : undefined),
  } as unknown as Env
  // These bindings finish their work inside each request; no background
  // work remains for their holder to drain. Store hosts add their own drain.
  let settled = () => Promise.resolve()
  return { env, files, settled, [Symbol.asyncDispose]: settled }
}
