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
// `script` below boots workerd the same way for a THROWAWAY Worker that is
// not the kernel at all — the modules an app's own script is made of, run in
// the runtime that would run them.
//
// TWO ports, both free ones: the server's, and the devtools inspector's.
// Wrangler binds the inspector on a FIXED 9229 unless told otherwise, so a
// second `wrangler dev` anywhere on the box dies with "Address already in
// use" — and the test suite runs its files in parallel (bin/test.ts), so
// every kernel here would be a second one for somebody.
import { until } from '../../src/testing.ts'
import { COOKIE, sign, verify } from '../../src/token.ts'
import { ready, WRANGLER } from './wrangler.ts'

let root = new URL('./', import.meta.url).pathname
let wrangler = (Deno.env.get('WRANGLER') ?? WRANGLER.join(' ')).split(' ')

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
  await ready()
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

/**
 * A THROWAWAY Worker under workerd — not the kernel: a directory of files, a
 * wrangler.toml naming the entry, `wrangler dev` on two free ports of its
 * own, and one `at(path)`.
 *
 * It is how a test runs code the platform would UPLOAD rather than serve. A
 * dispatch namespace has no local implementation (dispatch.ts), so an app's
 * own script can otherwise only be asserted as a multipart body; this runs
 * the same module set in the same runtime, which is where a module that is
 * mislabelled or missing shows itself (T-34263).
 */
export let script = async (
  files: Record<string, string | Uint8Array>,
  main = 'entry.js',
) => {
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
  let port = freePort()
  let inspector = freePort()
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
      String(port),
      '--inspector-port',
      String(inspector),
      '--ip',
      '127.0.0.1',
      '--show-interactive-dev-session=false',
    ],
    cwd: dir,
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let at = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${path}`, init)
  let stop = async () => {
    try {
      await new Deno.Command('kill', { args: ['-TERM', `-${child.pid}`] })
        .output()
    } catch { /* already gone */ }
    await until(async () => !(await listening(port)), {
      timeout: 15_000,
      poll: 100,
      label: 'the script port to close',
    })
    await child.status
    Deno.removeSync(dir, { recursive: true })
    Deno.removeSync(log)
  }
  try {
    // Any answer at all means workerd linked the modules and is running them;
    // a script that does not link never listens, and the log says why.
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
  // The transport's session id: minted at `initialize` and sent back on every
  // later request, the way a client does — it names this client's stream and
  // the tool list it cached (mcp.ts).
  let session = ''
  let call = async (method: string, params: unknown = {}) => {
    let r = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: {
        ...(cookie ? { cookie } : {}),
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

// A letter INTO the kernel, at the door workerd keeps for exactly this: the
// runtime's local email endpoint hands the body to `email()` as a message
// (index.ts, inbox.ts). The envelope rides the query string — `from` and `to`
// as the SMTP session gave them, which is why a message may be addressed at an
// app whose name is nowhere in its own headers — and the body is raw RFC 5322,
// which must carry a `Message-ID` or the runtime refuses to parse it.
//
// The answer is the handler's: 200 where the letter landed, 400 carrying the
// reason where it was rejected. A rejection only reaches the status because
// index.ts AWAITS `setReject` — the message is an RPC stub, and a rejection
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
// space. The FIRST sign-in on a fresh kernel owns the meta space, which is
// how any directory row comes to be written at all (identity.ts).
// A person, signed in: the code card asks what to call them the first time
// (T-32654), so `name` is what a probe answers it — left out, the front of
// their address is what the platform ends up calling them.
export let signIn = async (
  k: Kernel,
  email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`,
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
  // What the header SAYS, for a zip the door must refuse: a method it does not
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
