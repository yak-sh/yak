// The kernel under test: `wrangler dev` boots workers/yak on a probe port
// with a throwaway persistence directory and a test secret, and a test
// drives it over HTTP the way a browser or a headless client would — a
// hostname rides `x-yak-host`, since fetch refuses a Host header and the
// kernel honors ours on a dev host (route.ts). Slow tier only: a real
// runtime boots. The pinned wrangler runs through npx (wrangler.ts owns the
// pin, WRANGLER overrides the command) and boots with node_modules current,
// since esbuild bundles the npm deps out of it and a fresh worktree has none;
// the process is its own session so `stop` takes workerd down with it, and
// proves the port closed before it returns.
//
// `script` below boots workerd the same way for a throwaway Worker that is
// not the kernel at all — the modules an app's own script is made of, run in
// the runtime that would run them.
//
// Two ports, both allocated by the runtime: the server's and the inspector's.
// Wrangler binds the inspector on a fixed 9229 unless told otherwise, so both
// ask for port zero. Parallel probes neither share that default nor race over
// a port selected and released before their child can bind it.
import { fileURLToPath } from 'node:url'
import { apex } from './host.ts'
import { b64u } from './mcp-probe.ts'
import { until } from '../../src/testing.ts'
import { COOKIE, sign, verify } from '../../src/token.ts'
import { ready, WRANGLER } from './wrangler.ts'
import type { Custom } from './domains.ts'

let root = fileURLToPath(new URL('./', import.meta.url))
let wrangler = (Deno.env.get('WRANGLER') ?? WRANGLER.join(' ')).split(' ')

// Let workerd bind its own ephemeral port. Selecting a free port and closing
// it before spawning leaves a race with every other parallel probe. A TCP/HTTP
// answer alone also accepts Wrangler's startup proxy before its worker is ready.
export let readyAddress = (log: string) =>
  /Ready on (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1] ?? ''

let started = (log: string) =>
  until(() => readyAddress(Deno.readTextFileSync(log)), {
    timeout: 60_000,
    poll: 250,
    label: () => Deno.readTextFileSync(log),
  })

let listening = async (port: number) => {
  try {
    ;(await Deno.connect({ hostname: '127.0.0.1', port })).close()
    return true
  } catch {
    return false
  }
}

// The suite owns one kernel runtime. A lease gets private binding names,
// variables and logs, not a process. Direct deno test remains supported by
// the standalone Wrangler path below.
let leased = async (body: unknown) => {
  let host = Deno.env.get('YAK_PROBE_HOST')!
  let response = await fetch(host, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await response.text())
  let { id, ...lease } = await response.json() as {
    id: string
    base: string
    secret: string
    log: string
    socket?: { port: number; headers: Record<string, string> }
  }
  let stop = async () => {
    let response = await fetch(`${host}/${id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(await response.text())
    await response.body?.cancel()
  }
  return { ...lease, stop }
}

export type Kernel = Awaited<ReturnType<typeof kernel>>

export let kernel = async (vars: Record<string, string> = {}) => {
  if (Deno.env.get('YAK_PROBE_HOST')) {
    let lease = await leased({ vars })
    let at = (host: string, path: string, init: RequestInit = {}) =>
      fetch(`${lease.base}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          'x-yak-host': host,
        },
      })
    return { ...lease, at, host: apex(vars) }
  }
  await ready()
  let host = apex(vars)
  let secret = crypto.randomUUID()
  let state = Deno.makeTempDirSync({ prefix: 'tasks-yak-' })
  let log = Deno.makeTempFileSync({ prefix: 'tasks-yak-', suffix: '.log' })
  // The child writes the log itself, both streams into the one file: the
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
      // AI (and any future remote binding) must not open a Cloudflare proxy:
      // these probes exercise local workerd/SQLite, never account resources.
      // Merely omitting --remote still enables remote bindings by default.
      '--local',
      '--config',
      'wrangler.toml',
      '--port',
      '0',
      '--inspector-port',
      '0',
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
      // The builder's workbench is a container (wrangler.toml
      // `[[containers]]`, sandbox.ts), and `wrangler dev` builds its image
      // from the Dockerfile before it serves anything — which needs a
      // container engine. No probe here calls a sandbox tool, and a test
      // suite may not require a daemon to be running on the box, so the
      // kernel boots with containers off and `env.SANDBOX` unbound, which is
      // the case the tools already answer in a sentence (`NO_BOX`).
      '--enable-containers=false',
      '--show-interactive-dev-session=false',
    ],
    cwd: root,
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let base = ''
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
    await until(
      async () => !base || !(await listening(Number(new URL(base).port))),
      {
        timeout: 15_000,
        poll: 100,
        label: 'the probe port to close',
      },
    )
    await child.status
    Deno.removeSync(state, { recursive: true })
    Deno.removeSync(log)
  }
  try {
    base = await started(log)
    await until(async () => {
      try {
        return (await at(host, '/')).ok
      } catch {
        return false
      }
    }, { timeout: 60_000, poll: 250, label: () => Deno.readTextFileSync(log) })
  } catch (e) {
    await stop()
    throw e
  }
  return { base, secret, at, stop, log, host, socket: undefined }
}

/**
 * A throwaway Worker under workerd — not the kernel: a directory of files, a
 * wrangler.toml naming the entry, `wrangler dev` on two runtime-allocated ports of its
 * own, and one `at(path)`.
 *
 * It is how a test runs code the platform would upload rather than serve. A
 * dispatch namespace has no local implementation (dispatch.ts), so an app's
 * own script can otherwise only be asserted as a multipart body; this runs
 * the same module set in the same runtime, which is where a module that is
 * mislabelled or missing shows itself (T-34263).
 */
export let script = async (
  files: Record<string, string | Uint8Array>,
  main = 'entry.js',
) => {
  if (Deno.env.get('YAK_PROBE_HOST')) {
    let lease = await leased({
      main,
      files: Object.fromEntries(
        Object.entries(files).map((
          [name, body],
        ) => [name, typeof body == 'string' ? body : [...body]]),
      ),
    })
    return {
      ...lease,
      at: (path: string, init?: RequestInit) =>
        fetch(`${lease.base}${path}`, init),
    }
  }
  let dir = Deno.makeTempDirSync({ prefix: 'yak-script-' })
  for (let [name, body] of Object.entries(files)) {
    let at = `${dir}/${name}`
    Deno.mkdirSync(at.slice(0, at.lastIndexOf('/')), { recursive: true })
    if (typeof body == 'string') Deno.writeTextFileSync(at, body)
    else Deno.writeFileSync(at, body)
  }
  Deno.writeTextFileSync(
    `${dir}/wrangler.toml`,
    `name = "probe"\nmain = "${main}"\ncompatibility_date = "2025-05-08"\n`,
  )
  let log = Deno.makeTempFileSync({ prefix: 'yak-script-', suffix: '.log' })
  let child = new Deno.Command('setsid', {
    args: [
      'sh',
      '-c',
      'exec "$@" >>"$0" 2>&1',
      log,
      ...wrangler,
      'dev',
      '--port',
      '0',
      '--inspector-port',
      '0',
      '--ip',
      '127.0.0.1',
      '--show-interactive-dev-session=false',
    ],
    cwd: dir,
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let base = ''
  let at = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init)
  let stop = async () => {
    try {
      await new Deno.Command('kill', { args: ['-TERM', `-${child.pid}`] })
        .output()
    } catch { /* already gone */ }
    await until(
      async () => !base || !(await listening(Number(new URL(base).port))),
      {
        timeout: 15_000,
        poll: 100,
        label: 'the script port to close',
      },
    )
    await child.status
    Deno.removeSync(dir, { recursive: true })
    Deno.removeSync(log)
  }
  try {
    // Its own ready announcement names the port and confirms module startup.
    base = await started(log)
    await until(async () => {
      try {
        await (await at('/')).body?.cancel()
        return true
      } catch {
        return false
      }
    }, { timeout: 60_000, poll: 250, label: () => Deno.readTextFileSync(log) })
  } catch (e) {
    await stop()
    throw e
  }
  return { at, stop, log }
}

// An origin that stands in for `<space>.yaks.app` over HTTP: every request
// goes to the kernel wearing that hostname, and the person's cookie if they
// have one. What a browser gives a page and a test cannot is exactly this —
// the hostname a probe can only spell in `x-yak-host` (route.ts), and the
// cookie that says who is asking — so a client module running under Deno
// reaches an app's doors through here exactly as a page's would. The request
// passes through whole, bytes included: an upload is a body that is not text
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
  let socket = k.socket
  let up = socket?.port ?? Number(new URL(k.base).port)
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
    let extra =
      Object.entries(socket?.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`)
        .join('') +
      `x-yak-host: ${host}\r\n` +
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
//
// `bearer` is the other credential the door takes — a CLI grant (grants.ts),
// which is how the terminal talks to this same door and carries no cookie at
// all.
export let connector = (k: Kernel, cookie?: string, bearer?: string) => {
  let n = 0
  // The transport's session id: minted at `initialize` and sent back on every
  // later request, the way a client does — it names this client's stream and
  // the tool list it cached (mcp.ts).
  let session = ''
  let call = async (method: string, params: unknown = {}) => {
    let r = await k.at(k.host, '/mcp', {
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
// A letter may be addressed to several readers at once (mail.ts `Letter`), so
// "to this address" is membership, not equality.
export type Letter = { to: string | string[]; subject: string; body: string }

export let letters = (k: Pick<Kernel, 'log'>, to: string): Letter[] =>
  [...Deno.readTextFileSync(k.log).matchAll(/yak-mail (\{.*\})/g)]
    .map((m) => JSON.parse(m[1]) as Letter)
    .filter((l) => [l.to].flat().includes(to))

// The latest letter to an address that says a thing, waited for — an
// invitation is sent while the tool is answering (T-32629).
export let letter = async (
  k: Pick<Kernel, 'log'>,
  to: string,
  saying: string,
  after = 0,
) =>
  (await until(
    () =>
      letters(k, to).slice(after).findLast((l) =>
        `${l.subject}\n${l.body}`.includes(saying)
      ),
    {
      timeout: 20_000,
      poll: 100,
      label: `a letter for ${to} saying ${saying}`,
    },
  ))!

// Wait past the letters already received before requesting another sign-in.
// The HTTP response can precede workerd flushing the new letter to its log.
export let mailed = (k: Pick<Kernel, 'log'>, to: string, after = 0) =>
  until(
    () =>
      /\b(\d{6})\b/.exec(letters(k, to).slice(after).at(-1)?.subject ?? '')
        ?.[1] ?? '',
    { timeout: 20_000, poll: 100, label: `a letter for ${to}` },
  )

// A letter into the kernel, at the door workerd keeps for exactly this: the
// runtime's local email endpoint hands the body to `email()` as a message
// (index.ts, inbox.ts). The envelope rides the query string — `from` and `to`
// as the SMTP session gave them, which is why a message may be addressed at an
// app whose name is nowhere in its own headers — and the body is raw RFC 5322,
// which must carry a `Message-ID` or the runtime refuses to parse it.
//
// The answer is the handler's: 200 where the letter landed, 400 carrying the
// reason where it was rejected. A rejection only reaches the status because
// index.ts awaits `setReject` — the message is an RPC stub, and a rejection
// that is not awaited lands after the answer is built.
export let arrives = (
  k: Kernel,
  m: { from: string; to: string; raw: string },
) =>
  fetch(
    `${k.base}/cdn-cgi/handler/email?from=${encodeURIComponent(m.from)}` +
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

// A person signs in the way a browser does — an address, the code off the
// log, the cookie back — and the kernel mints their person row and their own
// space. The first sign-in on a fresh kernel owns the meta space, which is
// how any directory row comes to be written at all (identity.ts).
// A person, signed in: the code card asks what to call them the first time
// (T-32654), so `name` is what a probe answers it — left out, the front of
// their address is what the platform ends up calling them.
export let signIn = async (
  k: Kernel,
  email = `probe-${crypto.randomUUID().slice(0, 8)}@${k.host}`,
) => {
  let form = (path: string, fields: Record<string, string>) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  let received = letters(k, email).length
  let asked = await form('/login', { email })
  if (asked.status != 200) throw new Error(`login: ${await asked.text()}`)
  await asked.body?.cancel()
  let code = await mailed(k, email, received)
  let inn = await form('/login/code', { email, code })
  if (inn.status != 303) throw new Error(`code: ${await inn.text()}`)
  await inn.body?.cancel()
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
// its address, to anyone (T-32585).
export let meta = (k: Kernel, cookie: string) => {
  let agent = connector(k, cookie)
  let where = { space: 'yak', app: 'platform' }
  return {
    // The rows, and only the rows: a tool reply carries the unseen block and
    // the ceiling line after them (unseen.ts), and the meta space has breaks
    // of its own to be told about like anybody else.
    query: async (query: string) =>
      JSON.parse(
        (await agent.tool('graph_query', { ...where, query })).split('\n\n## ')[
          0
        ],
      ) as Row[],
    apply: (entities: unknown[]) =>
      agent.tool('graph_apply', { ...where, entities }),
  }
}

// The two shapes a tool's words carry, read back out of them. A tool answers
// bundles now, so what a probe used to pick off `structuredContent` is in the
// prose — and every test that wants it wants it the same way.

/** One line of what `commands` answers (tools.ts). */
export type Listed = {
  /** `<space>/<app>`, off the header the app's commands sit under */
  at: string
  name: string
  /** its arguments as the listing spells them: `who, miles, pace?` */
  args: string
  /** `writes` rather than `reads` */
  writes: boolean
  description: string
}

export let commandsIn = (said: string): Listed[] => {
  let at = ''
  let out: Listed[] = []
  for (let line of said.split('\n')) {
    let head = /^## (\S+)$/.exec(line)
    if (head) {
      at = head[1]
      continue
    }
    let one = /^(\w+)\(([^)]*)\) (reads|writes) — (.+)$/.exec(line)
    if (one) {
      out.push({
        at,
        name: one[1],
        args: one[2],
        writes: one[3] == 'writes',
        description: one[4],
      })
    }
  }
  return out
}

/**
 * The rows a query command answered, from under its sentence: `command` says
 * `<name>: N rows in <at>` and then the rows (declared.ts `ran`), with the
 * unseen block after them where the caller has a space to be told about.
 */
export let rowsIn = <T>(said: string): T[] =>
  JSON.parse(
    said.slice(said.indexOf('\n\n') + 2).split('\n\n## ')[0],
  ) as T[]

// An app's `vocab.json`, as a probe writes one: the document, without every
// test spelling `$defs` and `properties` around two columns. A column is its
// JSON Schema — {@link txt}, {@link num} and {@link when} are the three a probe
// reaches for.
export let vocabFile = (
  defs: Record<string, Record<string, unknown>>,
): string =>
  JSON.stringify({
    $defs: Object.fromEntries(
      Object.entries(defs).map((
        [name, props],
      ) => [name, { properties: props }]),
    ),
  })
export let txt = { type: 'string' }
export let num = { type: 'number' }
export let when = { type: 'string', format: 'date-time' }

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

// ---- Stripe, stood in for (billing.ts, sell.ts) ----------------------------
//
// Stripe's v1 API is form-encoded POSTs to one base URL, and `STRIPE_API`
// aims that base anywhere — so a probe can be Stripe for the length of a test.
// What it is for is the two things only a runtime can answer: that the fields
// the code builds actually go out on the wire in the shape Stripe's docs spell,
// and that the whole route — tool to door to Stripe and back into the graph —
// joins up. The seams are pinned in sell_test.ts and billing_test.ts, where
// they cost microseconds.

export type Call = { path: string; on: string; sent: URLSearchParams }

/**
 * A stand-in Stripe on a free port. `answer` is handed the path, the fields
 * as they arrived and the `Stripe-Account` header (empty on a platform call),
 * and returns the JSON object Stripe would — or null for "Stripe would refuse
 * that", which comes back in the error shape billing.ts `said` reads.
 *
 * Every call is recorded in `calls`, in order, because the assertion that
 * matters is usually what was sent: an `application_fee_amount` under the right
 * key, a `Stripe-Account` on the right request.
 */
export let stripe = (
  answer: (call: Call) => unknown,
) => {
  let calls: Call[] = []
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    let call: Call = {
      path: new URL(req.url).pathname,
      on: req.headers.get('stripe-account') ?? '',
      sent: new URLSearchParams(await req.text()),
    }
    calls.push(call)
    let out = answer(call)
    return out == null
      ? Response.json({
        error: { message: `nothing stands in for ${call.path}` },
      }, { status: 400 })
      : Response.json(out)
  })
  return {
    url: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    calls,
    // The last call at a path, which is what an assertion nearly always wants.
    at: (path: string) => calls.filter((c) => c.path == path).at(-1),
    stop: () => server.shutdown(),
  }
}

// ---- Cloudflare's custom hostnames, stood in for (domains.ts) -------------
//
// The three calls a domain makes — list by name, create, delete — over the
// account API's `{success, errors, result}` envelope, kept in memory. A
// hostname is answered active, which is the state a domain reaches once the
// person's record resolves; the words each step is read by are held against
// recorded bytes in domains_test.ts, so what this is for is the other half:
// that the tools attach, report and detach a domain end to end.
export let hostnames = () => {
  let held = new Map<string, Custom>()
  let server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    let url = new URL(req.url)
    let ok = (result: unknown) => Response.json({ success: true, result })
    if (req.method == 'POST') {
      let made = async () => {
        let { hostname } = await req.json() as { hostname: string }
        let custom: Custom = {
          id: crypto.randomUUID(),
          hostname,
          status: 'active',
          ssl: { status: 'active' },
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
    return ok(found ? [found] : [])
  })
  return {
    url: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    held,
    stop: () => server.shutdown(),
  }
}

/**
 * A space on Plus, the one way a space gets there: Stripe says its
 * subscription is active and the webhook moves the plan (billing.ts). `plan`
 * is stamped, so no door a test can reach writes it — the kernel is leased
 * with this `STRIPE_WEBHOOK_SECRET` and the event is signed with it.
 */
export let plus = async (k: Kernel, secret: string, space: string) => {
  let at = Math.floor(Date.now() / 1000)
  let raw = JSON.stringify({
    id: `evt_plus_${space}`,
    type: 'customer.subscription.updated',
    created: at,
    data: {
      object: {
        id: `sub_plus_${space}`,
        customer: `cus_plus_${space}`,
        status: 'active',
        metadata: { space },
      },
    },
  })
  let paid = await k.at('yaks.app', '/stripe/webhook', {
    method: 'POST',
    body: raw,
    headers: { 'stripe-signature': await signed(secret, raw, at) },
  })
  let said = await paid.text()
  if (!paid.ok) throw new Error(`plus: ${paid.status} ${said}`)
}

/**
 * A `Stripe-Signature` header over exactly these bytes: HMAC-SHA256 of
 * `<timestamp>.<raw body>`, keyed by the endpoint's signing secret. The scheme
 * is Stripe's own and identical for the platform endpoint and the Connect one —
 * only the secret differs — so both doors are driven through this.
 */
export let signed = async (secret: string, raw: string, at: number) => {
  let key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${at}.${raw}`),
  )
  let hex = [...new Uint8Array(mac)]
    .map((n) => n.toString(16).padStart(2, '0')).join('')
  return `t=${at},v1=${hex}`
}

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
  // read, or the encrypted bit.
  method?: number
  flags?: number
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
    h.setUint32(22, streamed ? 0 : raw.length, true)
    h.setUint16(26, name.length, true)
    head.set(name, 30)
    body.push(head, packed)
    let size = head.length + packed.length
    if (streamed) {
      let tail = new Uint8Array(16)
      let t = new DataView(tail.buffer)
      t.setUint32(0, 0x08074b50, true)
      t.setUint32(8, packed.length, true)
      t.setUint32(12, raw.length, true)
      body.push(tail)
      size += tail.length
    }
    let row = new Uint8Array(46 + name.length)
    let c = new DataView(row.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, flags, true)
    c.setUint16(10, method, true)
    c.setUint32(20, packed.length, true)
    c.setUint32(24, raw.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, at, true)
    row.set(name, 46)
    index.push(row)
    at += size
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

// ---- a kernel that is already running (roster_workerd_test.ts) ------------
//
// yaks.app answers the same doors workerd does, so a suite that drives one can
// drive the other: this is `kernel` for a host already deployed — where it is,
// one request at a hostname, and a stop with nothing to stop. What it cannot
// give is the two things only a local runtime has: its log, so no letter can
// be read back, and its session secret, so no cookie can be minted. A run
// against a deployed kernel carries a bearer instead.
export let deployed = (url: string) => {
  let base = url.replace(/\/+$/, '')
  let host = new URL(base).host
  return {
    base,
    host,
    secret: '',
    log: '',
    socket: undefined,
    at: (where: string, path: string, init: RequestInit = {}) =>
      fetch(`https://${where}${path}`, init),
    stop: () => Promise.resolve(),
  }
}

/**
 * A bearer, the way a host gets one: dynamic registration as a public client,
 * the authorization code with PKCE, and the exchange. mcp_auth_test.ts walks
 * the same steps and asserts on each of them; this walks them to come back
 * with a token, for a suite that wants to reach the connector the way a client
 * does rather than with a cookie no client has.
 */
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
    code_challenge: b64u(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
    code_challenge_method: 'S256',
  }).toString()
  let allowed = await form('/oauth/allow', { q }, { cookie })
  if (allowed.status != 302) throw new Error(`allow: ${await allowed.text()}`)
  await allowed.body?.cancel()
  let code = new URL(allowed.headers.get('location')!).searchParams.get('code')!
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

// ---- Stripe's own sandbox, not stood in for -------------------------------
//
// `stripe` above is the stand-in every seam test uses. These are the other
// thing: Stripe itself in test mode, which is what proves a purchase works
// rather than proving the right fields were assembled. The key is the owner's
// sandbox secret key, passed in the environment and never committed; a run
// without one fails naming what to set rather than passing over the money
// paths in silence.

/** The sandbox secret key, or the sentence saying how to supply one. It must
 * be a test-mode key: a live key here would charge somebody. */
export let stripeKey = () => {
  let key = Deno.env.get('STRIPE_KEY') ?? ''
  if (!key) {
    throw new Error(
      'no Stripe sandbox key: set STRIPE_KEY to a test-mode secret key and ' +
        'the money paths run against Stripe for real. The owner keeps one at ' +
        "op read 'op://Yak Shaving LLC/yaks.app stripe/sandbox/secret key'",
    )
  }
  if (!key.startsWith('sk_test_')) {
    throw new Error('STRIPE_KEY is not a test-mode key (sk_test_…)')
  }
  return key
}

/** One call to Stripe, in Stripe's own dialect: form-encoded in, JSON out,
 * with the bracketed keys its nested fields are spelled with. A refusal is
 * thrown carrying Stripe's own message, which is the whole of the failure. */
export let charged = async (
  key: string,
  path: string,
  fields?: Record<string, unknown>,
  on?: string,
) => {
  let body = new URLSearchParams()
  let write = (prefix: string, value: unknown) => {
    if (value == null) return
    if (typeof value == 'object') {
      for (let [k, v] of Object.entries(value)) {
        write(prefix ? `${prefix}[${k}]` : k, v)
      }
    } else body.set(prefix, String(value))
  }
  write('', fields ?? {})
  let r = await fetch(`https://api.stripe.com${path}`, {
    method: fields ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
      ...(on ? { 'stripe-account': on } : {}),
    },
    ...(fields ? { body: body.toString() } : {}),
  })
  let said = await r.json() as { error?: { message: string } }
  if (said.error) throw new Error(`stripe ${path}: ${said.error.message}`)
  return said as Record<string, unknown>
}

/**
 * The recurring price a Plus checkout charges, found or made in the sandbox.
 * A price carries no name of its own, so the product holds the name and the
 * price hangs off it: a second run reuses both rather than filling the sandbox
 * with a product per run. STRIPE_PRICE names one outright where the owner has
 * a price they would rather charge.
 */
export let plusPrice = async (key: string, named = 'yaks.app probe Plus') => {
  let asked = Deno.env.get('STRIPE_PRICE')
  if (asked) return asked
  // Stripe is the seller under Managed Payments, which the platform asks for
  // (billing.ts), and a seller owes tax — so a product with no tax code is
  // one Stripe refuses to sell. This is the code for software as a service.
  let sold = { name: named, tax_code: 'txcd_10103000' }
  let products = await charged(key, '/v1/products?limit=100') as unknown as {
    data: { id: string; name: string; tax_code?: string }[]
  }
  let found = products.data.find((p) => p.name == named)
  if (found && !found.tax_code) {
    await charged(key, `/v1/products/${found.id}`, {
      tax_code: sold.tax_code,
    })
  }
  let product = found ??
    await charged(key, '/v1/products', sold) as unknown as { id: string }
  let prices = await charged(
    key,
    `/v1/prices?product=${product.id}&active=true&limit=100`,
  ) as unknown as { data: { id: string; recurring?: unknown }[] }
  let price = prices.data.find((p) => p.recurring) ??
    await charged(key, '/v1/prices', {
      product: product.id,
      currency: 'usd',
      unit_amount: 900,
      recurring: { interval: 'month' },
    }) as unknown as { id: string }
  return price.id
}

/**
 * An event as Stripe would deliver it, carrying an object Stripe actually
 * holds. Stripe cannot reach a workerd bound to loopback, so the half of
 * delivery a probe supplies is the hop itself: the object is fetched from the
 * sandbox, wrapped in the envelope the handler reads, and signed with the
 * secret the kernel was booted with.
 */
export let delivered = async (
  k: Pick<Kernel, 'at'>,
  path: '/stripe/webhook' | '/stripe/connect',
  secret: string,
  type: string,
  object: unknown,
  // The connected account an event is about. Stripe puts it on the envelope
  // rather than in the object, and it is what the Connect door attributes by,
  // so an event without one is not about a seller at all (sell.ts `apply`).
  on?: string,
) => {
  let at = Math.floor(Date.now() / 1000)
  let raw = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type,
    created: at,
    ...(on ? { account: on } : {}),
    data: { object },
  })
  let r = await k.at('yaks.app', path, {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': await signed(secret, raw, at),
    },
  })
  let said = await r.text()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${said}`)
  return said
}
