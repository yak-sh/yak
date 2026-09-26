// The platform in memory: the kernel's own bindings, stood up under Deno so a
// test can drive the code that runs in production with nothing stubbed between
// a request and the rows.
//
// It is a file rather than a helper inside one test because two suites need
// it — serving_test.ts, which serves an app off it, and builder_test.ts, which
// builds one on it — and a second copy of a Store namespace is a second answer
// to what a Store namespace is.
//
// What is here is only what the runtime gives a Worker and Deno does not: the
// streaming HTML rewriter, a Durable Object's state (the stand-in
// @yaks/durable-object ships), an R2 bucket, a scripted Workers AI binding,
// and the namespace that hands out a Store per name. Everything above them —
// the directory, the tools, the serving door — is the kernel's own code,
// called directly.
import { driver, type DurableStorage, type Wire } from '@yaks/durable-object'
import {
  among,
  by,
  col,
  type Expr,
  type Insert,
  lit,
  type Param,
  scan,
  type Select,
  select,
  table,
  type Update,
  val,
} from '@yaks/sql'
import { objects } from '@yaks/sqlite'
import { contentType } from '@std/media-types'
import { durable } from '../../packages/durable-object/testing.ts'
import { Builder } from './build.ts'
import type { Env, Inbound } from './env.ts'
import { Store } from './graph.ts'
import { Wire as Wired } from './stream.ts'
import type { Limiter } from './rate.ts'

// The streaming HTML rewriter, in the one shape apps.ts asks for it
// (`reported` weaves the reporter into every page): a tag prepended inside the
// first `head` or `body`, else appended to the document. Deno has none, and
// what a page carries out of that door is part of what the door does.
type El = { prepend(s: string, o: { html: boolean }): void }

class Rewriter {
  #on: [string, (el: El) => void][] = []
  #end: ((e: { append(s: string, o: { html: boolean }): void }) => void)[] = []
  on(selector: string, h: { element(el: El): void }) {
    this.#on.push([selector, h.element])
    return this
  }
  onDocument(h: { end(e: { append(s: string, o: unknown): void }): void }) {
    this.#end.push(h.end)
    return this
  }
  transform(res: Response) {
    let done = res.text().then((html) => {
      for (let [selector, element] of this.#on) {
        let at = new RegExp(`<${selector}[^>]*>`, 'i').exec(html)
        if (!at) continue
        element({
          prepend: (s) => {
            let cut = at.index + at[0].length
            html = html.slice(0, cut) + s + html.slice(cut)
          },
        })
      }
      for (let end of this.#end) end({ append: (s) => void (html += s) })
      return new TextEncoder().encode(html)
    })
    return new Response(
      new ReadableStream({
        async start(c) {
          c.enqueue(await done)
          c.close()
        },
      }),
      res,
    )
  }
}

;(globalThis as { HTMLRewriter?: unknown }).HTMLRewriter ??= Rewriter

/**
 * Point-in-time recovery, faked (recover.ts, T-34507).
 *
 * There is nowhere at all to drive a restore against a runtime: local workerd
 * answers `getCurrentBookmark` and refuses the other two — "This Durable
 * Object's storage back-end does not implement point-in-time recovery" —
 * so the probe kernel (probe.ts) cannot hold this gesture either. What is
 * imitated here is the contract and not the recovery: a bookmark that moves
 * with every read, a bookmark for a moment inside the window and a throw
 * outside it, and the restore remembered rather than performed.
 *
 * That is enough for the half that is ours — the order the record is written
 * in, the sentence that comes back, the restart being asked for — and it
 * proves nothing whatever about SQLite going backwards, which is Cloudflare's
 * half and is not ours to test.
 */
export type Pitr = {
  /** The bookmark the object was last told to wake at, if it was told one. */
  restore: string
  /** How many times a restart was asked for. */
  aborts: number
  /** Every bookmark handed out, in order. */
  marks: string[]
}

/** One Durable Object's state, as the Store constructor takes it. */
export let state = () => {
  let live: Wire[] = []
  let pitr: Pitr = { restore: '', aborts: 0, marks: [] }
  let bookmark = (name: string) => {
    pitr.marks.push(name)
    return Promise.resolve(name)
  }
  return {
    storage: Object.assign(durable(), {
      getCurrentBookmark: () => bookmark(`at-${pitr.marks.length}`),
      getBookmarkForTime: (at: number | Date) => {
        let t = at instanceof Date ? at.getTime() : at
        if (Date.now() - t > 30 * 24 * 60 * 60_000) {
          return Promise.reject(
            new Error('the bookmark is outside the 30-day window'),
          )
        }
        return bookmark(`at-${new Date(t).toISOString()}`)
      },
      onNextSessionRestoreBookmark: (b: string) => {
        pitr.restore = b
        return Promise.resolve(`undo-${b}`)
      },
    }),
    live,
    pitr,
    abort: () => void pitr.aborts++,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// ---- an object's own rows, as older code left them ----

type Fields = Record<string, Param | Expr>
let expr = (v: Param | Expr): Expr =>
  v && typeof v == 'object' && 't' in v ? v : val(v)

/** Every row of a table, set. */
export let every = (name: string, set: Fields): Update => ({
  t: 'update',
  table: name,
  set: Object.fromEntries(Object.entries(set).map(([k, v]) => [k, expr(v)])),
})

/** A slot of the object's key-value memory (graph.ts `#get` and `#put`),
 * read, and set. */
let slotOf = (k: string): Select =>
  select({ cols: [col('v')], from: table('yak_kv'), where: by({ k }) })
let slotted = (k: string, v: string): Insert => ({
  t: 'insert',
  into: 'yak_kv',
  cols: ['k', 'v'],
  rows: [[val(k), val(v)]],
  upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
})

/** Anything holding an object's storage: its state, as a test keeps it. */
type Held = { storage: DurableStorage }

/** The object's SQLite, the way the store reaches it. */
export let db = ({ storage }: Held) => driver(storage)

/** The names of what the object's schema holds: tables, indexes, triggers. */
export let named = (held: Held, fields: Record<string, Param>) =>
  objects(db(held), fields).map((r) => String(r.name))

export let slot = (held: Held, k: string): string | null =>
  (db(held).query(slotOf(k))[0]?.v as string | undefined) ?? null
export let keep = (held: Held, k: string, v: string) =>
  db(held).query(slotted(k, v))

/**
 * A store as it stood before archetypes: its rows unclassified, no descriptor
 * and none of their tables, and a schema stamp the next wake moves, so that
 * wake backfills.
 */
export let unclassified = (held: Held, stamp: string) => {
  let d = db(held)
  d.query({ t: 'update', table: 'entity', set: { archetype: lit(null) } })
  let descriptors = scan(d, 'archetype', undefined, ['entity'])
    .map((r) => val(Number(r.entity)))
  for (let name of ['retired', 'archetype']) {
    d.query({ t: 'drop', kind: 'table', name })
  }
  d.query({ t: 'delete', from: 'entity', where: among(col('id'), descriptors) })
  keep(held, 'schema', stamp)
}

/** One turn, as a scripted model answers it. */
export type Turn = {
  text?: string
  calls?: { name: string; arguments: unknown }[]
}

/**
 * Workers AI, scripted: the `AI` binding answering the turns it was given, in
 * the binding's own shape (`{response, tool_calls, usage}`), so a test drives
 * the whole provider (@yaks/workers-ai, as builder.ts hands it the loop) — the
 * messages it writes, the tool calls it reads back — and not just the loop.
 * Past the end of the script it says nothing, which ends the loop.
 */
export let ai = (script: Turn[]) => {
  let asked: { model: string; input: Record<string, unknown> }[] = []
  let at = 0
  return {
    asked,
    run: (model: string, input: unknown) => {
      asked.push({ model, input: input as Record<string, unknown> })
      let turn = script[at++] ?? {}
      return Promise.resolve({
        response: turn.text ?? '',
        tool_calls: turn.calls ?? [],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      })
    },
    // The gateway a Workers AI binding can name is nobody's here: nothing on
    // this platform reaches OpenAI (builder.ts, T-34238).
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
  }
}

/**
 * The bucket, as the slice `r2Objects` asks for.
 *
 * `at` is when each object landed, which the retention sweep reads
 * (versions.ts `pruned`); a test that wants an object to look old sets it,
 * and everything else lands now.
 */
export let bucket = () => {
  let held = new Map<string, Uint8Array>()
  let at = new Map<string, number>()
  return {
    held,
    at,
    r2: {
      head: (k: string) => Promise.resolve(held.get(k) ?? null),
      get: (k: string) =>
        Promise.resolve(
          held.has(k)
            ? { arrayBuffer: () => Promise.resolve(held.get(k)!.buffer) }
            : null,
        ),
      put: (k: string, v: ArrayBuffer | Uint8Array) => {
        held.set(k, v instanceof Uint8Array ? v : new Uint8Array(v))
        if (!at.has(k)) at.set(k, Date.now())
        return Promise.resolve()
      },
      delete: (k: string) => {
        held.delete(k)
        at.delete(k)
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

/** One command, as the stand-in sandbox was told to answer it. */
export type Ran = {
  stdout?: string
  stderr?: string
  exitCode?: number
  /** a process that keeps running until it is killed */
  running?: boolean
}

/**
 * The builder's workbench, in memory (sandbox.ts): a scripted answer per
 * command and a Map for a filesystem. It is here beside the Store and the
 * bucket for the same reason they are — a second copy of what a sandbox
 * answers is a second answer to what a sandbox is — and it keeps the tools
 * that reach for one testable with no container anywhere.
 *
 * `answer` is asked for every command; what it returns is what `exec` says,
 * and what a process `startProcess` began has printed and exited with.
 * Undefined is a command that did nothing and exited 0.
 */
export let sandboxes = (answer: (cmd: string) => Ran | void = () => {}) => {
  let ran: string[] = []
  // The environment each command was handed (sandbox.ts `signed`), in order.
  let env: Record<string, string>[] = []
  let files = new Map<string, string>()
  let alive = new Set<string>()
  // Every process a `startProcess` began, by its id, kept after it exits.
  let processes = new Map<
    string,
    {
      pid: number
      status: string
      exitCode?: number
      stdout: string
      stderr: string
    }
  >()
  type Opts = { cwd?: string; timeout?: number; env?: Record<string, string> }
  let heard = (name: string, cmd: string, opts?: Opts) => {
    alive.add(name)
    ran.push(cmd)
    env.push(opts?.env ?? {})
    return answer(cmd) ?? {}
  }
  let box = (name: string) => ({
    exec: (cmd: string, opts?: Opts) => {
      let said = heard(name, cmd, opts)
      return Promise.resolve({
        stdout: said.stdout ?? '',
        stderr: said.stderr ?? '',
        exitCode: said.exitCode ?? 0,
        cwd: opts?.cwd,
      })
    },
    startProcess: (cmd: string, opts?: Opts) => {
      let said = heard(name, cmd, opts)
      let id = `proc-${processes.size + 1}`
      let pid = processes.size + 100
      processes.set(id, {
        pid,
        status: said.running ? 'running' : 'completed',
        exitCode: said.running ? undefined : said.exitCode ?? 0,
        stdout: said.stdout ?? '',
        stderr: said.stderr ?? '',
      })
      return Promise.resolve({ id, pid })
    },
    getProcess: (id: string) => {
      let p = processes.get(id)
      return Promise.resolve(p ? { id, ...p } : null)
    },
    killProcess: (id: string) => {
      let p = processes.get(id)
      if (p?.status == 'running') p.status = 'killed'
      return Promise.resolve()
    },
    getProcessLogs: (id: string) => {
      let p = processes.get(id)
      return Promise.resolve({
        stdout: p?.stdout ?? '',
        stderr: p?.stderr ?? '',
      })
    },
    mkdir: () => Promise.resolve({ success: true }),
    writeFile: (path: string, content: string) => {
      alive.add(name)
      files.set(path, content)
      return Promise.resolve({ success: true })
    },
    readFile: (path: string, opts?: { encoding?: string }) => {
      alive.add(name)
      let held = files.get(path)
      if (held == null) return Promise.reject(new Error(`no file ${path}`))
      return Promise.resolve({
        content: opts?.encoding == 'base64'
          ? btoa(String.fromCharCode(...new TextEncoder().encode(held)))
          : held,
      })
    },
    destroy: () => Promise.resolve(void alive.delete(name)),
  })
  return {
    ran,
    env,
    files,
    alive,
    // `getSandbox` addresses one by name off the namespace; nothing here
    // needs an id object, so the name is the id.
    SANDBOX: {
      idFromName: (n: string) => n,
      getByName: (n: string) => box(n),
      get: (n: unknown) => box(String(n)),
    },
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
  let file = (path: string, bytes: Uint8Array<ArrayBuffer>) =>
    new Response(bytes, {
      headers: {
        'content-type': contentType(path.slice(path.lastIndexOf('.'))) ??
          'application/octet-stream',
      },
    })
  return {
    fetch: async (req: Request) => {
      let url = new URL(req.url)
      let path = decodeURIComponent(url.pathname)
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
      let bytes = await read(path)
      if (bytes) return file(path, bytes)
      let html = await read(`${path}.html`)
      if (html) return file('.html', html)
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
 * A rate limiting binding (rate.ts `Limiter`), counting the way Miniflare's
 * does: `limit` calls per key in each `period` seconds, the windows fixed and
 * counted from the epoch.
 */
export let limiter = (limit: number, period: number): Limiter => {
  let seen = new Map<string, number>()
  return {
    limit: ({ key }) => {
      let at = `${Math.floor(Date.now() / 1000 / period)} ${key}`
      seen.set(at, (seen.get(at) ?? 0) + 1)
      return Promise.resolve({ success: seen.get(at)! <= limit })
    },
  }
}

/**
 * One platform: a Store per name the kernel builds, the bucket its files are
 * in, and the platform's own assets off disk (the client an app imports, the
 * guide the builder reads).
 */
export let platform = (secret: string, vars: Partial<Env> = {}) => {
  let stores: ReturnType<typeof state>[] = []
  let ownedState = () => {
    let ctx = state()
    stores.push(ctx)
    return ctx
  }
  let objects = new Map<string, Store>()
  let sockets = new Map<string, Wire[]>()
  // What the runtime did to each object, beside what the object did: the
  // restore it was told to wake at and the restart it was asked for, which
  // are the runtime's half of a recovery and not the Store's (recover.ts).
  let recovery = new Map<string, Pitr>()
  // Each object's own state, by name: its sockets, its recovery, and the one
  // alarm it arms for the wakes it holds (graph.ts, D-37562). A test reads the
  // instant back off it, which is what the runtime would deliver.
  let states = new Map<string, ReturnType<typeof state>>()
  let object = (name: string) => {
    let held = objects.get(name)
    if (!held) {
      let ctx = ownedState()
      sockets.set(name, ctx.live)
      recovery.set(name, ctx.pitr)
      states.set(name, ctx)
      objects.set(name, held = new Store(ctx, env))
    }
    return held
  }
  // The builder's object, one per space (build.ts). Made on demand like a
  // store, and kept, so a second connection reaches the conversation the first
  // one started.
  let builders = new Map<string, Builder>()
  let builder = (name: string): Builder => {
    let held = builders.get(name)
    if (!held) builders.set(name, held = new Builder(ownedState(), env))
    return held
  }
  // A person's stream (stream.ts), one object per person, made on demand and
  // kept like a store: what a session was told, and the roster it holds.
  let wires = new Map<string, Wired>()
  let wire = (name: string): Wired => {
    let held = wires.get(name)
    if (!held) wires.set(name, held = new Wired({ storage: kvStorage() }, env))
    return held
  }
  let files = bucket()
  let env = {
    SESSION_SECRET: secret,
    BLOBS: files.r2,
    // The grants ledger (grants.ts): what a CLI token and the build sandbox's
    // own sign-in are written down in.
    OAUTH_KV: kv(),
    ASSETS: assets(new URL('./public/', import.meta.url)),
    STORE: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: (r: Request) => Promise.resolve(object(String(n)).fetch(r)),
      }),
    },
    WIRE: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: (r: Request) => Promise.resolve(wire(String(n)).fetch(r)),
      }),
    },
    BUILDER: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: (r: Request) => Promise.resolve(builder(String(n)).fetch(r)),
      }),
    },
    ...vars,
  } as unknown as Env
  // Every alarm that is due, delivered the way the runtime delivers one: the
  // instant cleared, then the object's `alarm()`, which may arm the next. A
  // test drives this by hand; a kernel (probe.ts) on a timer.
  let ringing = false
  let ring = async () => {
    if (ringing) return
    ringing = true
    try {
      for (let [name, ctx] of states) {
        let at = await ctx.storage.getAlarm()
        if (at == null || at > Date.now()) continue
        await ctx.storage.deleteAlarm()
        await object(name).alarm()
      }
    } finally {
      ringing = false
    }
  }
  return {
    env,
    files,
    object,
    states,
    sockets,
    builder,
    recovery,
    ring,
    [Symbol.dispose]: () => {
      for (let ctx of stores) ctx.storage[Symbol.dispose]()
      stores.length = 0
    },
  }
}
