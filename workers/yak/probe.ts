// The kernel under test: `wrangler dev` boots workers/yak on a probe port
// with a throwaway persistence directory and a test secret, and a test
// drives it over HTTP the way a browser or a headless client would — a
// hostname rides `x-yak-host`, since fetch refuses a Host header and the
// kernel honors ours on a dev host (route.ts). Slow tier only: a real
// runtime boots. The pinned wrangler runs through npx (WRANGLER overrides the
// command); the process is its own session so `stop` takes workerd down with
// it, and proves the port closed before it returns.
//
// TWO ports, both free ones: the server's, and the devtools inspector's.
// Wrangler binds the inspector on a FIXED 9229 unless told otherwise, so a
// second `wrangler dev` anywhere on the box dies with "Address already in
// use" — and the test suite runs its files in parallel (bin/test.ts), so
// every kernel here would be a second one for somebody.
import { until } from '../../src/testing.ts'
import { COOKIE, sign } from '../../src/token.ts'

let root = new URL('./', import.meta.url).pathname
let wrangler = (Deno.env.get('WRANGLER') ?? 'npx --yes wrangler@4.42.2')
  .split(' ')

let freePort = () => {
  let l = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let { port } = l.addr as Deno.NetAddr
  l.close()
  return port
}

let listening = async (port: number) => {
  try {
    ;(await Deno.connect({ hostname: '127.0.0.1', port })).close()
    return true
  } catch {
    return false
  }
}

export type Kernel = Awaited<ReturnType<typeof kernel>>

export let kernel = async () => {
  let port = freePort()
  let inspector = freePort()
  let secret = crypto.randomUUID()
  let state = Deno.makeTempDirSync({ prefix: 'tasks-yak-' })
  let log = Deno.makeTempFileSync({ prefix: 'tasks-yak-', suffix: '.log' })
  // One handle per stream: a WritableStream locks to a single piper.
  let out = Deno.openSync(log, { write: true, append: true })
  let err = Deno.openSync(log, { write: true, append: true })
  let child = new Deno.Command('setsid', {
    args: [
      ...wrangler,
      'dev',
      '--config',
      'wrangler.toml',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      state,
      '--var',
      `SESSION_SECRET:${secret}`,
      // Letters land in the meta store, where a test reads its own code.
      '--var',
      'MAIL_DEV:1',
      '--show-interactive-dev-session=false',
    ],
    cwd: root,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let logged = Promise.all([
    child.stdout.pipeTo(out.writable, { preventClose: true }),
    child.stderr.pipeTo(err.writable, { preventClose: true }),
  ])
  let base = `http://127.0.0.1:${port}`
  // One request, at one hostname.
  let at = (host: string, path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        'x-yak-host': host,
      },
    })
  let stop = async () => {
    try {
      await new Deno.Command('kill', { args: ['-TERM', `-${child.pid}`] })
        .output()
    } catch { /* already gone */ }
    await until(async () => !(await listening(port)), {
      timeout: 15_000,
      poll: 100,
      label: 'the probe port to close',
    })
    await child.status
    await logged
    out.close()
    err.close()
    Deno.removeSync(state, { recursive: true })
    Deno.removeSync(log)
  }
  try {
    await until(async () => {
      try {
        return (await at('yaks.app', '/')).ok
      } catch {
        return false
      }
    }, { timeout: 60_000, poll: 250, label: () => Deno.readTextFileSync(log) })
  } catch (e) {
    await stop()
    throw e
  }
  return { base, secret, at, stop, log }
}

// An origin that stands for `<space>.yaks.app` on a socket. `new WebSocket`
// sends the URL's own Host and takes no headers, so `x-yak-host` — the header
// a fetch-driven probe spells (route.ts) — has to go on the wire itself: this
// relay inserts it (and a cookie) into the handshake it forwards, then copies
// bytes both ways, so the socket a test holds is the kernel's own, framing
// and all. HTTP through it works too, for one request per connection.
export let relay = (k: Kernel, host: string, cookie?: string) => {
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
      (cookie ? `cookie: ${cookie}\r\n` : '')
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

type Row = { entity: { eid: string; num: number }; [k: string]: unknown }

// A client on one app's graph API, as one person (or nobody).
export let client = (
  k: Kernel,
  host: string,
  app: string,
  cookie?: string,
) => {
  let headers: Record<string, string> = cookie ? { cookie } : {}
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
      changes: { eid: string; name: string; comp: unknown }[]
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

// The directory's first rows, written by `person` through the meta space's
// bootstrap (index.ts): the person, their ownership of `yak`, and each space
// with its apps and the person as its owner. Returns the eids by slug.
export let seed = async (
  k: Kernel,
  person: string,
  spaces: { slug: string; apps: string[]; home?: string }[],
) => {
  let eids: Record<string, string> = {}
  let batch: unknown[] = [{ eid: person, name: 'person', comp: {} }]
  let meta = crypto.randomUUID()
  // Signed in, because the directory has no public face (apps.ts): its API
  // answers an owner of `yak` and nobody else, and a memberless meta space
  // makes the first signed-in person one — which is exactly this bootstrap.
  let cookie = await signedIn(k, person)
  // The meta space already exists (seeded on first touch); read its eid.
  let [yak] = await client(k, 'yak.yaks.app', 'platform', cookie)
    .get('.space.slug=yak')
  batch.push({
    eid: meta,
    name: 'member',
    comp: { space: yak.entity.eid, person, role: 'owner' },
  })
  for (let s of spaces) {
    let space = eids[s.slug] = crypto.randomUUID()
    batch.push({ eid: space, name: 'doc', comp: { title: s.slug } })
    batch.push({ eid: space, name: 'space', comp: { slug: s.slug } })
    batch.push({
      eid: crypto.randomUUID(),
      name: 'member',
      comp: { space, person, role: 'owner' },
    })
    for (let a of s.apps) {
      let app = eids[`${s.slug}/${a}`] = crypto.randomUUID()
      batch.push({ eid: app, name: 'doc', comp: { title: a } })
      batch.push({ eid: app, name: 'app', comp: { slug: a, space } })
    }
    if (s.home) {
      batch.push({
        eid: space,
        name: 'space',
        comp: { home: eids[`${s.slug}/${s.home}`] },
      })
    }
  }
  await client(k, 'yak.yaks.app', 'platform', cookie).applied(batch)
  return eids
}

// An agent on the connector: JSON-RPC over POST /mcp at the apex, as one
// signed-in person. `tool` answers the reply's text, throwing when the tool
// says it erred, so a test reads the words and not the envelope.
export let connector = (k: Kernel, cookie?: string) => {
  let n = 0
  let call = async (method: string, params: unknown = {}) => {
    let r = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: {
        ...(cookie ? { cookie } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
    })
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
