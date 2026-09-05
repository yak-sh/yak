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
// @yaks/durable-object ships), an R2 bucket, and the namespace that hands out
// a Store per name. Everything above them — the directory, the tools, the
// serving door — is the kernel's own code, called directly.
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
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
  let files = bucket()
  let env = {
    SESSION_SECRET: secret,
    BLOBS: files.r2,
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
    ...vars,
  } as unknown as Env
  return { env, files, object, sockets }
}
