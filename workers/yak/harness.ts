// The platform in memory: the kernel's own bindings, stood up under Deno so a
// test can drive the code that runs in production with nothing stubbed between
// a request and the rows.
//
// It is a FILE rather than a helper inside one test because two suites need
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
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { Builder } from './build.ts'
import type { Env } from './env.ts'
import { Store } from './graph.ts'

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

/** One Durable Object's state, as the Store constructor takes it. */
export let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

/** One turn, as a scripted model answers it. */
export type Turn = {
  text?: string
  calls?: { name: string; arguments: unknown }[]
}

/**
 * Workers AI, scripted: the `AI` binding answering the turns it was given, in
 * the binding's OWN shape (`{response, tool_calls, usage}`), so a test drives
 * builder.ts's whole provider — the messages it writes, the tool calls it
 * reads back — and not just its loop. Past the end of the script it says
 * nothing, which ends the loop.
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

/** The bucket, as the slice `r2Blobs` asks for. */
export let bucket = () => {
  let held = new Map<string, Uint8Array>()
  return {
    held,
    r2: {
      head: (k: string) => Promise.resolve(held.get(k) ?? null),
      get: (k: string) =>
        Promise.resolve(
          held.has(k)
            ? { arrayBuffer: () => Promise.resolve(held.get(k)!.buffer) }
            : null,
        ),
      put: (k: string, v: ArrayBuffer | Uint8Array) =>
        Promise.resolve(
          void held.set(k, v instanceof Uint8Array ? v : new Uint8Array(v)),
        ),
      delete: (k: string) => Promise.resolve(void held.delete(k)),
      list: ({ prefix }: { prefix: string }) =>
        Promise.resolve({
          objects: [...held.keys()].filter((k) => k.startsWith(prefix))
            .map((key) => ({ key })),
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
 * A KV namespace in a Map, in the one shape the kernel asks of `OAUTH_KV`
 * (grants.ts, handoff.ts). TTL is not simulated: what expires here expires by
 * the value's own `exp`, which a test moves by handing a clock in.
 */
export let kv = () => {
  let held = new Map<string, string>()
  return {
    held,
    get: (k: string) => Promise.resolve(held.get(k) ?? null),
    put: (k: string, v: string) => (held.set(k, v), Promise.resolve()),
    delete: (k: string) => (held.delete(k), Promise.resolve()),
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve({
        keys: [...held.keys()].filter((k) => k.startsWith(prefix))
          .map((name) => ({ name })),
      }),
  }
}

/** One command, as the stand-in sandbox was told to answer it. */
export type Ran = { stdout?: string; stderr?: string; exitCode?: number }

/**
 * The builder's workbench, in memory (sandbox.ts): a scripted answer per
 * command and a Map for a filesystem. It is here beside the Store and the
 * bucket for the same reason they are — a second copy of what a sandbox
 * answers is a second answer to what a sandbox is — and it keeps the tools
 * that reach for one testable with no container anywhere.
 *
 * `answer` is asked for every command; what it returns is what `exec` says.
 * Undefined is a command that did nothing and exited 0.
 */
export let sandboxes = (answer: (cmd: string) => Ran | void = () => {}) => {
  let ran: string[] = []
  // The environment each command was handed (sandbox.ts `signed`), in order.
  let env: Record<string, string>[] = []
  let files = new Map<string, string>()
  let alive = new Set<string>()
  let box = (name: string) => ({
    exec: (
      cmd: string,
      opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
    ) => {
      alive.add(name)
      ran.push(cmd)
      env.push(opts?.env ?? {})
      let said = answer(cmd) ?? {}
      return Promise.resolve({
        stdout: said.stdout ?? '',
        stderr: said.stderr ?? '',
        exitCode: said.exitCode ?? 0,
        cwd: opts?.cwd,
      })
    },
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
    // needs an id object, so the name IS the id.
    SANDBOX: {
      idFromName: (n: string) => n,
      getByName: (n: string) => box(n),
      get: (n: unknown) => box(String(n)),
    },
  }
}

/**
 * One platform: a Store per name the kernel spells, the bucket its files are
 * in, and the platform's own assets off disk (the client an app imports, the
 * guide the builder reads).
 */
export let platform = (secret: string, vars: Partial<Env> = {}) => {
  let objects = new Map<string, Store>()
  let sockets = new Map<string, Wire[]>()
  let object = (name: string) => {
    let held = objects.get(name)
    if (!held) {
      let ctx = state()
      sockets.set(name, ctx.live)
      objects.set(name, held = new Store(ctx))
    }
    return held
  }
  // The builder's object, one per space (build.ts). Made on demand like a
  // store, and kept, so a second connection reaches the conversation the first
  // one started.
  let builders = new Map<string, Builder>()
  let builder = (name: string): Builder => {
    let held = builders.get(name)
    if (!held) builders.set(name, held = new Builder(state(), env))
    return held
  }
  let files = bucket()
  let env = {
    SESSION_SECRET: secret,
    BLOBS: files.r2,
    // The grants ledger (grants.ts): what a CLI token and the build sandbox's
    // own sign-in are written down in.
    OAUTH_KV: kv(),
    ASSETS: {
      fetch: async (req: Request) =>
        new Response(
          await Deno.readFile(
            new URL(`./public${new URL(req.url).pathname}`, import.meta.url),
          ),
          { headers: { 'content-type': 'text/javascript' } },
        ),
    },
    STORE: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: (r: Request) => Promise.resolve(object(String(n)).fetch(r)),
      }),
    },
    // Nobody is listening: a break is still written, and telling its members
    // about it is the half that may fail without taking the write with it.
    WIRE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: () => Promise.resolve(new Response(null, { status: 204 })),
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
  return { env, files, object, sockets, builder }
}
