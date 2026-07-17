// The whole backend in one Deno.serve: static files out of src/, TS/TSX
// translated to JS per-request (sucrase strips types + compiles JSX — no
// bundling, no type-checking; `deno task check` is the type gate), bare
// imports resolved by the import map in index.html to the vendored ESM in
// src/vendor/, the sync websocket, and a src/ watcher that tells clients to
// reload. State lives in the db, so a reload IS hot: camera, cards, and
// views all come back where they were.
import { transform } from 'sucrase'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { providers } from './adapters.ts'
import { type Change } from './types.ts'
import { apply, db, search, snapshot } from './db.ts'
import { freeze, serveFrozen } from './freeze.ts'
import { mcpServer } from './mcp.ts'
import { logs, recover, start, stop } from './sessions.ts'
import { outcome, recent, record, toolCall } from './telemetry.ts'

let src = new URL('.', import.meta.url).pathname

let mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  png: 'image/png',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json',
}

// Serve a file from under a root, refusing path escapes. TS/TSX comes back
// as JS, translated on the fly and cached by mtime.
let ts = new Map<string, { mtime: number; js: string }>()
let file = async (root: string, path: string) => {
  let full = root + path
  if (full.includes('..')) return new Response('no', { status: 400 })
  let ext = path.split('.').pop() ?? ''
  try {
    if (ext == 'ts' || ext == 'tsx') {
      let mtime = (await Deno.stat(full)).mtime?.getTime() ?? 0
      let hit = ts.get(full)
      if (!hit || hit.mtime != mtime) {
        hit = {
          mtime,
          js: transform(await Deno.readTextFile(full), {
            transforms: ['typescript', 'jsx'],
            jsxRuntime: 'automatic',
            jsxImportSource: 'preact',
            production: true,
            filePath: path,
          }).code,
        }
        ts.set(full, hit)
      }
      return new Response(hit.js, {
        headers: { 'content-type': mime.js, 'cache-control': 'no-cache' },
      })
    }
    return new Response(await Deno.readFile(full), {
      headers: {
        'content-type': mime[ext] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      },
    })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

// The sync channel: clients send flat change batches ([{eid, name, comp}]),
// the server applies them and rebroadcasts to every other client. Non-array
// frames are control messages ('reload', from the watcher).
let clients = new Set<WebSocket>()
let cast = (changes: Change[], except?: WebSocket) => {
  let msg = JSON.stringify(changes)
  for (let c of clients) {
    if (c != except && c.readyState == WebSocket.OPEN) c.send(msg)
  }
}
let ws = (req: Request) => {
  let { socket, response } = Deno.upgradeWebSocket(req)
  socket.onopen = () => clients.add(socket)
  socket.onclose = () => clients.delete(socket)
  socket.onmessage = (m) => {
    let sent = JSON.parse(String(m.data)) as Change[]
    let extra: Change[]
    try {
      extra = apply(db, sent).slice(sent.length)
    } catch (e) {
      console.error('sync: bad batch dropped —', e)
      return
    }
    // Peers get the batch as sent; cascade extras go to EVERYONE — the
    // sender's optimistic cache only removed what it asked to remove.
    for (let c of clients) {
      if (c.readyState != WebSocket.OPEN) continue
      if (c != socket) c.send(m.data)
      if (extra.length) c.send(JSON.stringify(extra))
    }
  }
  return response
}

// MCP mounted on THIS server — one port, one process, no extra auth
// surface. Stateless: every POST is one JSON-RPC message answered by a
// fresh in-memory server (cheap), so dev-server restarts can never
// strand an agent session — and no node-shim layers to wedge. Tools
// reach the graph in-process: same apply(), same allowlist, and writes
// broadcast to every live client.
//
// Every tools/call is timed and recorded on the way through (telemetry.ts
// classifies the body — this route is the only place that sees both the
// request and its reply).
let mcp = async (req: Request) => {
  let call: ReturnType<typeof toolCall> = null
  let t0 = performance.now()
  try {
    let body = await req.json()
    if (Array.isArray(body)) return new Response('no batches', { status: 400 })
    if (body.id == null) return new Response(null, { status: 202 }) // notification
    call = toolCall(body)
    let [mine, theirs] = InMemoryTransport.createLinkedPair()
    let server = mcpServer({
      // deno-lint-ignore require-await
      read: async () => snapshot(db),
      // deno-lint-ignore require-await
      write: async (changes) => {
        cast(apply(db, changes))
      },
      // deno-lint-ignore require-await
      find: async (q, limit) => search(db, q, limit),
    })
    await server.connect(theirs)
    let reply = new Promise((resolve) => mine.onmessage = resolve)
    await mine.start()
    await mine.send(body)
    let out = await Promise.race([
      reply,
      new Promise((_, no) =>
        setTimeout(() => no(new Error('mcp timeout')), 60_000)
      ),
    ])
    await server.close()
    if (call) {
      record(db, {
        source: 'mcp',
        ...call,
        ...outcome(out),
        ms: performance.now() - t0,
      })
    }
    return Response.json(out)
  } catch (e) {
    console.warn('mcp request failed —', e)
    // A timeout or a crash never reached the tool's own error path —
    // record it anyway, or the worst calls are the invisible ones.
    if (call) {
      record(db, {
        source: 'mcp',
        ...call,
        ok: false,
        ms: performance.now() - t0,
        error: String(e),
      })
    }
    return new Response('mcp error', { status: 500 })
  }
}

// Read at most n bytes of a body: a report from a broken page is
// untrusted in SIZE, if in nothing else. Breaking the loop cancels the
// stream; a truncated body just fails to parse.
let bounded = async (req: Request, n: number) => {
  let out = ''
  let dec = new TextDecoder()
  if (!req.body) return out
  for await (let chunk of req.body) {
    out += dec.decode(chunk, { stream: true })
    if (out.length > n) break
  }
  return out.slice(0, n)
}

// The browser's crash channel (main.tsx posts here). Always 204: a
// reporter that can fail loudly is a second bug on top of the first.
let clientError = async (req: Request) => {
  try {
    let b = JSON.parse(await bounded(req, 16 * 1024))
    record(db, {
      source: 'web',
      name: 'error',
      session_id: b.client_eid ?? null,
      ok: false,
      error: String(b.message ?? 'error'),
      detail: [b.stack, b.url].filter(Boolean).join('\n\n'),
    })
  } catch (e) {
    console.warn('error report dropped —', e)
  }
  return new Response(null, { status: 204 })
}

// Explicit Deno.serve, not a `deno serve` default export: --watch restarts
// only complete gracefully once the old isolate drains, which a live
// listener + websockets never guarantee — reusePort lets the new isolate
// bind alongside the dying one, and only the options object can carry it.
Deno.serve(
  { port: Number(Deno.env.get('PORT') ?? 5173), reusePort: true },
  (req) => {
    let url = new URL(req.url)
    let path = url.pathname
    if (path == '/ws') return ws(req)
    if (path == '/snapshot') return Response.json(snapshot(db))
    if (path == '/search') {
      // a malformed filter is the typist's news, not a server error
      try {
        return Response.json(search(
          db,
          url.searchParams.get('q') ?? '',
          Number(url.searchParams.get('limit') ?? 20),
        ))
      } catch (e) {
        return new Response(String((e as Error).message ?? e), { status: 400 })
      }
    }
    if (path == '/mcp' && req.method == 'POST') return mcp(req)
    if (path == '/error' && req.method == 'POST') return clientError(req)
    if (path == '/telemetry') {
      return Response.json(recent(db, {
        since: url.searchParams.get('since') ?? undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
        only: url.searchParams.get('only') ?? undefined,
      }))
    }
    // HTTP writes (the CLI and MCP server): same apply, same allowlist,
    // same broadcast — an HTTP client is just a client without a socket.
    if (path == '/apply' && req.method == 'POST') {
      let t0 = performance.now()
      let note = (ok: boolean, error?: string) =>
        record(db, {
          source: 'http',
          name: 'apply',
          ok,
          ms: performance.now() - t0,
          error,
        })
      return req.json().then((changes: Change[]) => {
        cast(apply(db, changes))
        note(true)
        return Response.json({ ok: true })
      }).catch((e) => {
        note(false, String(e))
        return new Response(String(e), { status: 400 })
      })
    }
    // The adapter table, for a browser that must offer what a start
    // request will be checked against (adapters.ts is server-only).
    if (path == '/providers') return Response.json(providers())
    // Managed sessions: spawn one on a task, ask it to stop, read its log.
    // The handlers stay thin — the lifecycle lives in sessions.ts.
    if (path == '/sessions/start' && req.method == 'POST') {
      return req.json()
        .then((body) => start(body, cast))
        .then((r) =>
          'error' in r
            ? new Response(r.error, { status: r.status })
            : Response.json({ eid: r.eid })
        )
        .catch((e) => new Response(String(e), { status: 400 }))
    }
    let session = path.match(/^\/sessions\/([0-9a-f-]{36})\/(stop|logs)$/)
    if (session) {
      let [, eid, verb] = session
      if (verb == 'logs') return Response.json(logs(eid, url.searchParams))
      if (req.method != 'POST') return new Response('no', { status: 405 })
      return stop(eid, cast).then((r) =>
        'error' in r
          ? new Response(r.error, { status: r.status })
          : Response.json(r)
      )
    }
    if (path == '/freeze') {
      return freeze(url.searchParams.get('eid') ?? '', cast)
    }
    if (path.startsWith('/frozen/')) {
      return serveFrozen(path.slice(8).replace(/\.html$/, ''))
    }
    // An extensionless path is a ROUTE (/T-123): the app boots and reads
    // the URL — same shell, different root card.
    return file(src.slice(0, -1), path.includes('.') ? path : '/index.html')
  },
)

// Managed children are detached (setsid) and this process restarts on every
// server-file edit — so booting means picking them back up: adopt the ones
// still alive, finalize the ones that died while we were away. Nothing here
// reaps a child; the watcher below must never learn how.
recover(cast)

// Watch src/ and tell every client to reload (debounced — editors fire
// several events per save). The server itself restarts via --watch, whose
// scope is its own module graph — but a graceful restart only completes
// once THIS isolate's event loop drains, and open websockets hold it
// forever (the new isolate then dies on AddrInUse). So when a server-graph
// file changes, close every socket and stop watching: the isolate settles,
// the port frees, the restart binds. Clients reload-poll their way back.
// Everything the SERVER imports (transitively) — a change to these needs
// a process restart, not a client reload. Keep in sync with the imports
// above (mcp.ts pulls client.ts in).
let graph = [
  'server.ts',
  'db.ts',
  'types.ts',
  'freeze.ts',
  'mcp.ts',
  'client.ts',
  'sessions.ts',
  'adapters.ts',
  'telemetry.ts',
]
let watch = async () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  for await (let e of Deno.watchFs(src)) {
    if (e.paths.some((p) => graph.some((g) => p.endsWith(`/${g}`)))) {
      for (let c of clients) c.close()
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      for (let c of clients) {
        if (c.readyState == WebSocket.OPEN) c.send(JSON.stringify('reload'))
      }
    }, 50)
  }
}
watch()
