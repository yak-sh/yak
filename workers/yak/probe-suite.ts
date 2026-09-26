// The one workerd environment a test run has: the kernel under wrangler's own
// test harness (`createTestHarness`), started once by the runner's workerd
// pass (bin/test.ts), shared by every `*_workerd_test.ts`, and closed after
// the last of them (M-39441). Tests keep apart by their data — a person, a
// space, an address of their own — never by an environment of their own.
//
// The test config is wrangler.toml's, less what cannot run on this box: the
// sandbox's container, and the bindings that only exist on the account (AI,
// vectorize, the dispatch namespace, service bindings). The kernel is written
// to answer without them, as it does under `wrangler dev`.
//
// Its config is every kernel's (probe.ts `vars`), and what the run's tests
// share, it is handed in the environment (probe.ts `workerd`):
//
//   YAK_PROBE          the kernel's door; a hostname rides `x-yak-host`,
//                      and `/__script/` is probe-scripts.js's (probe.ts `script`)
//   YAK_PROBE_SECRET   the session secret, so a test can mint a cookie
//   YAK_PROBE_MAIL     the letters it sent, one `yak-mail` line each
//   YAK_PROBE_OWNER    the first person to sign in, who owns the meta space
//   YAK_PROBE_CLOUDFLARE  the stand-in for Cloudflare's API (probe.ts
//                      `cloudflare`)
import { createRequire } from 'node:module'
import { parse } from '@std/toml'
import { apex } from './host.ts'
import { dir, ready } from './wrangler.ts'
import { cloudflare, driven, signIn, vars } from './probe.ts'

type Config = Record<string, unknown> & {
  durable_objects?: { bindings: { name: string }[] }
  dev?: Record<string, unknown>
  vars?: Record<string, string>
}

// Absent from the harness, as each is absent under `wrangler dev` here: the
// container needs docker, the rest are the account's own.
let ACCOUNT_ONLY = [
  'env',
  'routes',
  'containers',
  'ai',
  'vectorize',
  'dispatch_namespaces',
  'services',
  'tail_consumers',
  'queues',
  'observability',
]

/** wrangler.toml as the run's kernel wears it, `vars` laid over its own. */
export let config = (toml: string, vars: Record<string, string>): Config => {
  let raw = parse(toml) as Config
  for (let key of ACCOUNT_ONLY) delete raw[key]
  raw.durable_objects = {
    bindings: (raw.durable_objects?.bindings ?? []).filter((b) =>
      b.name != 'SANDBOX'
    ),
  }
  raw.dev = { ...raw.dev, enable_containers: false }
  raw.vars = { ...raw.vars, ...vars }
  return raw
}

// The kernel's end of a socket it accepted (Miniflare's WebSocketPair).
type Far = {
  accept(): void
  send(data: string | ArrayBuffer): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'message' | 'close',
    f: (e: MessageEvent & CloseEvent) => void,
  ): void
}
type Harness = {
  listen(): Promise<{ url: URL }>
  getWorker(name?: string): {
    fetch(
      url: string,
      init: RequestInit & { duplex: 'half' },
    ): Promise<Response & { webSocket?: Far | null }>
  }
  close(): Promise<void>
}

// What the door leaves off a request: the connection's own words, which the
// next hop says for itself.
let HOP = [
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
]

// A close code both ends accept from a script: 1000, or an application's own.
let code = (c: number) => c == 1000 || (c >= 3000 && c <= 4999) ? c : 1000

// A socket the kernel accepted, joined to the test's own, both ways.
let bridge = (req: Request, far: Far, protocol?: string) => {
  let { socket, response } = Deno.upgradeWebSocket(req, { protocol })
  let open = new Promise((ok) => socket.onopen = ok)
  far.accept()
  far.addEventListener('message', async (e) => {
    await open
    socket.send(e.data)
  })
  far.addEventListener('close', async (e) => {
    await open
    socket.close(code(e.code), e.reason)
  })
  socket.onmessage = (e) => far.send(e.data)
  socket.onclose = (e) => {
    try {
      far.close(code(e.code), e.reason)
    } catch { /* the kernel closed it first */ }
  }
  return response
}

// The door the run's tests knock on. The harness's own address (`listen()`)
// is wrangler's dev proxy, which pools its connections to the runtime; on a
// loaded box a request it sends on a pooled connection the runtime is closing
// is lost, and the proxy answers "Your worker restarted mid-request". Here
// each request goes through the harness's own dispatch on a connection of its
// own, so none rides a connection that is closing. `/__script/` reaches the
// scripts `script()` loads, by the worker's name.
let door = (server: Harness) =>
  Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen() {} },
    async (req) => {
      let path = new URL(req.url).pathname
      let headers = new Headers(req.headers)
      for (let h of HOP) headers.delete(h)
      let upgrade = req.headers.get('upgrade') == 'websocket'
      if (!upgrade) headers.set('connection', 'close')
      // Undici would undo an encoding without taking its header off.
      headers.set('accept-encoding', 'identity')
      // Undici says a `sec-fetch-mode` of its own; Miniflare's entry Worker
      // puts the caller's back from this header.
      let mode = req.headers.get('sec-fetch-mode')
      if (mode) headers.set('mf-sec-fetch-mode', mode)
      let res = await server
        .getWorker(path.startsWith('/__script/') ? 'probe-scripts' : undefined)
        .fetch(req.url, {
          method: req.method,
          headers,
          body: req.body,
          redirect: 'manual',
          duplex: 'half',
        })
      return res.webSocket
        ? bridge(
          req,
          res.webSocket,
          res.headers.get('sec-websocket-protocol') ?? undefined,
        )
        : new Response(res.body, res)
    },
  )

/** The run's kernel, and how its tests reach it. */
export let probeSuite = async () => {
  await ready()
  let secret = crypto.randomUUID()
  let mail = Deno.makeTempFileSync({ prefix: 'yak-probe-mail-' })
  let cf = cloudflare(mail)
  // workers/yak's own wrangler, which Deno loads from there only when the run
  // says --node-modules-dir=manual (deno.json `test:run`): from Deno's npm
  // cache, the bundler finds none of the polyfills npm put beside it.
  let { createTestHarness } = createRequire(`${dir}/`)('wrangler')
  let server: Harness = createTestHarness({
    root: dir,
    workers: [
      {
        config: config(
          Deno.readTextFileSync(`${dir}/wrangler.toml`),
          vars(secret, cf.url),
        ),
      },
      {
        config: {
          name: 'probe-scripts',
          main: 'probe-scripts.js',
          compatibility_date: '2025-05-08',
          worker_loaders: [{ binding: 'LOADER' }],
        },
      },
    ],
  })
  // Wrangler resolves the config's tsconfig against the working directory
  // and hands it to esbuild relative to the Worker's own, so the bundle is
  // built from there.
  let was = Deno.cwd()
  Deno.chdir(dir)
  try {
    await server.listen()
  } catch (e) {
    await server.close()
    await cf.stop()
    throw e
  } finally {
    Deno.chdir(was)
  }
  let front = door(server)
  let stop = async () => {
    await front.shutdown()
    await server.close()
    await cf.stop()
    Deno.removeSync(mail)
  }
  try {
    let base = `http://127.0.0.1:${front.addr.port}`
    let k = driven(base, secret, mail, apex(), cf.url)
    let owner = await signIn(k, `owner@${apex()}`)
    return {
      env: {
        YAK_PROBE: base,
        YAK_PROBE_SECRET: secret,
        YAK_PROBE_MAIL: mail,
        YAK_PROBE_OWNER: JSON.stringify(owner),
        YAK_PROBE_CLOUDFLARE: cf.url,
      },
      stop,
    }
  } catch (e) {
    await stop()
    throw e
  }
}
