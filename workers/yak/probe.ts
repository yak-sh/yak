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
import { COOKIE, sign, verify } from '../../src/token.ts'

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

export let kernel = async (vars: Record<string, string> = {}) => {
  let port = freePort()
  let inspector = freePort()
  let secret = crypto.randomUUID()
  let state = Deno.makeTempDirSync({ prefix: 'tasks-yak-' })
  let log = Deno.makeTempFileSync({ prefix: 'tasks-yak-', suffix: '.log' })
  // The child writes the log ITSELF, both streams into the one file: the
  // shell's own redirect, `$0` the file and `"$@"` the command, so nothing
  // depends on this process pumping a pipe. Piping them here read empty —
  // which left the boot-failure label blank and every letter unreadable.
  let child = new Deno.Command('setsid', {
    args: [
      'sh',
      '-c',
      'exec "$@" >>"$0" 2>&1',
      log,
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
      // Letters are printed on the Worker's log, which lands in `log` below,
      // where a test reads its own code (`mailed`). Nothing ever files a
      // code in a store.
      '--var',
      'MAIL_DEV:1',
      // Any extra vars a test asks for: a domain-verification token
      // (index.ts), or a kernel wearing CIMD=off (identity.ts).
      ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
      '--show-interactive-dev-session=false',
    ],
    cwd: root,
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
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

// An origin that stands in for `<space>.yaks.app` over HTTP: every request
// goes to the kernel wearing that hostname, and the person's cookie if they
// have one. What a browser gives a page and a test cannot is exactly this —
// the hostname a probe can only spell in `x-yak-host` (route.ts), and the
// cookie that says who is asking — so a client module running under Deno
// reaches an app's doors through here exactly as a page's would. The request
// passes through whole, BYTES included: an upload is a body that is not text
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
// a fetch-driven probe spells (route.ts) — has to go on the wire itself: this
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

// Every letter the kernel has sent to an address, oldest first, read off its
// own log: MAIL_DEV prints one line per letter (mail.ts `printed`), so no
// store anywhere holds a code a read could spend.
export type Letter = { to: string; subject: string; body: string }

export let letters = (k: Kernel, to: string): Letter[] =>
  [...Deno.readTextFileSync(k.log).matchAll(/yak-mail (\{.*\})/g)]
    .map((m) => JSON.parse(m[1]) as Letter)
    .filter((l) => l.to == to)

// The latest letter to an address that says a thing, waited for — an
// invitation is sent while the tool is answering (T-32629).
export let letter = async (k: Kernel, to: string, saying: string) =>
  (await until(
    () =>
      letters(k, to).findLast((l) =>
        `${l.subject}\n${l.body}`.includes(saying)
      ),
    {
      timeout: 20_000,
      poll: 100,
      label: `a letter for ${to} saying ${saying}`,
    },
  ))!

// The sign-in code out of the newest one.
export let mailed = (k: Kernel, to: string) =>
  until(
    () => /\b(\d{6})\b/.exec(letters(k, to).at(-1)?.subject ?? '')?.[1] ?? '',
    { timeout: 20_000, poll: 100, label: `a letter for ${to}` },
  )

// A person signs in the way a browser does — an address, the code off the
// log, the cookie back — and the kernel mints their person row and their own
// space. The FIRST sign-in on a fresh kernel owns the meta space, which is
// how any directory row comes to be written at all (identity.ts).
// A person, signed in: the code card asks what to call them the first time
// (T-32654), so `name` is what a probe answers it — left out, the front of
// their address is what the platform ends up calling them.
export let signIn = async (
  k: Kernel,
  email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`,
  name = 'Probe',
) => {
  let form = (path: string, fields: Record<string, string>) =>
    k.at('yaks.app', path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  let asked = await form('/login', { email })
  if (asked.status != 200) throw new Error(`login: ${await asked.text()}`)
  await asked.body?.cancel()
  let code = await mailed(k, email)
  let inn = await form('/login/code', { email, code, name })
  if (inn.status != 303) throw new Error(`code: ${await inn.text()}`)
  await inn.body?.cancel()
  let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
  let claims = await verify(cookie.slice(COOKIE.length + 1), k.secret)
  if (!claims) throw new Error('the sign-in set no session')
  return { person: claims.person, cookie, email, code, name }
}

// The directory, as an owner of `yak` reads and writes it: the MCP graph
// tier, the one door left into the meta store — apps.ts serves nothing at
// its address, to anyone (T-32585).
export let meta = (k: Kernel, cookie: string) => {
  let agent = connector(k, cookie)
  let where = { space: 'yak', app: 'platform' }
  return {
    query: async (query: string) =>
      JSON.parse(await agent.tool('graph_query', { ...where, query })) as Row[],
    apply: (entities: unknown[]) =>
      agent.tool('graph_apply', { ...where, entities }),
  }
}

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
