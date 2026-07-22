// The whole backend in one Deno.serve: static files out of src/, TS/TSX
// translated to JS per-request (sucrase strips types + compiles JSX — no
// bundling, no type-checking; `deno task check` is the type gate), bare
// imports resolved by the import map in index.html to the vendored ESM in
// src/vendor/, the sync websocket, and a src/ watcher that hot-swaps
// clients: component edits re-import under a fresh ?v generation (state
// survives — it lives in live.ts, above the swap), css edits re-fetch the
// stylesheet, and only shell/server edits still cost a real reload.
import { transform } from 'sucrase'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { providers } from './adapters.ts'
import { type Change, idOf } from './types.ts'
import {
  apply,
  db,
  journalBy,
  journalOf,
  search,
  snapshot,
  touch,
  vocabularyDoc,
} from './db.ts'
import { dispatch, docs, on, relay, trace } from './effects.ts'
import { vocabularyMd } from './schema.ts'
import { freeze, serveFrozen, store } from './freeze.ts'
import { fanout, FANOUT_PENDING, mailed } from './mail.ts'
import { mcpServer } from './mcp.ts'
import { filesFor, syncFiles } from './persona.ts'
import {
  commented,
  deleted,
  logs,
  recover,
  spawned,
  stopped,
  tidy,
} from './sessions.ts'
import { outcome, recent, record, toolCall } from './telemetry.ts'
import { stamp } from './hot.ts'
import { find, type Row, rows } from './client.ts'
import { matchQuery, orderOf, parseQuery, resolveRefs, warm } from './query.ts'

// The hot-swap generation: bumped by the watcher on every client-code or
// css change, stamped into every served module's relative imports so a
// swap re-fetches the whole component graph (see hot.ts).
let gen = 1

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
      return new Response(stamp(hit.js, gen), {
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

// The effect half of a write, run AFTER the casts: a slow or failing
// handler can never hold the wire, and a failure is telemetry, not a
// broken batch (effects.ts owns the doctrine).
let effect = (out: Change[], t: ReturnType<typeof trace>) => {
  dispatch(out, t, (comp, e) =>
    record(db, {
      source: 'http',
      name: `effect:${comp}`,
      ok: false,
      error: String(e),
    }))
}

let ws = (req: Request) => {
  let { socket, response } = Deno.upgradeWebSocket(req)
  socket.onopen = () => clients.add(socket)
  socket.onclose = () => clients.delete(socket)
  socket.onmessage = (m) => {
    let sent = JSON.parse(String(m.data)) as Change[]
    let out: Change[]
    let t = trace()
    try {
      out = apply(db, sent, t)
    } catch (e) {
      console.error('sync: bad batch dropped —', e)
      return
    }
    let extra = out.slice(sent.length)
    // Peers get the batch as sent; cascade extras go to EVERYONE — the
    // sender's optimistic cache only removed what it asked to remove.
    for (let c of clients) {
      if (c.readyState != WebSocket.OPEN) continue
      if (c != socket) c.send(m.data)
      if (extra.length) c.send(JSON.stringify(extra))
    }
    effect(out, t)
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
      write: async (changes, actor) => {
        let t = trace()
        let out = apply(db, changes, t, actor)
        cast(out)
        effect(out, t)
      },
      // deno-lint-ignore require-await
      find: async (q, limit) => search(db, q, limit),
      upload: async (eid, html) => {
        let res = await store(eid, html, cast)
        if (!res.ok) throw new Error(await res.text())
      },
      // The one writer of recall stats: stamp, then cast, so every
      // cache hears the new warmth (the apply wire refuses these rows).
      // deno-lint-ignore require-await
      touch: async (eids, confirm) => {
        let out = touch(db, eids, confirm)
        if (out.length) cast(out)
      },
      // deno-lint-ignore require-await
      logs: async (eid, q) => logs(eid, q),
      // deno-lint-ignore require-await
      history: async (eid, limit) => journalOf(db, eid, limit),
      // deno-lint-ignore require-await
      providers: async () => providers(),
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
    if (path == '/query') {
      // The graph over plain GET: the query string IS the filter line —
      // the same grammar boards and task_list speak — and hits come back
      // graph_query-shaped. `kind=` screens by derived kind; `backlinks=1`
      // adds who points at each hit (eid columns + edges). A malformed
      // filter is the typist's news, not a server error.
      try {
        let segs = url.search.slice(1).split('&').filter(Boolean)
          .map(decodeURIComponent)
        let backs = segs.includes('backlinks=1')
        let kind = segs.find((s) => s.startsWith('kind='))?.slice(5)
        segs = segs.filter((s) => s != 'backlinks=1' && !s.startsWith('kind='))
        let snap = snapshot(db)
        let all = rows(snap)
        let ps = resolveRefs(
          parseQuery(segs.join('&')),
          (id) => find(all, id)?.eid,
        )
        let byEid = new Map(all.map((r) => [r.eid, r.comps]))
        let now = Date.now()
        let hits = all
          .filter((r) => !kind || r.kind == kind)
          .filter((r) => matchQuery(r.comps, ps, (e) => byEid.get(e)))
        if (orderOf(ps) == 'hot') {
          hits.sort((a, b) =>
            warm(b.comps, now, (e) => byEid.get(e)) -
            warm(a.comps, now, (e) => byEid.get(e))
          )
        }
        let back = new Map<string, { from: string; via: string }[]>()
        if (backs) {
          let wanted = new Set(hits.map((r) => r.eid))
          let add = (to: unknown, from: Row, via: string) => {
            if (typeof to != 'string' || !wanted.has(to)) return
            let list = back.get(to) ?? []
            list.push({ from: idOf(from), via })
            back.set(to, list)
          }
          for (let r of all) {
            for (let [c, comp] of Object.entries(r.comps)) {
              for (let [p, v] of Object.entries(comp)) {
                if (p.endsWith('_eid')) add(v, r, `${c}.${p}`)
              }
            }
          }
          let rowOf = new Map(all.map((r) => [r.eid, r]))
          for (let d of snap.deps) {
            let from = rowOf.get(d.parent)
            if (from) add(d.child, from, d.type)
          }
        }
        return Response.json(hits.map((r) => ({
          id: idOf(r),
          kind: r.kind,
          eid: r.eid,
          comps: r.comps,
          ...(backs ? { backlinks: back.get(r.eid) ?? [] } : {}),
        })))
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
        let t = trace()
        // Attribution is an honesty header, not auth: the CLI names its
        // session, anonymous posts journal as null.
        let out = apply(db, changes, t, req.headers.get('x-actor'))
        cast(out)
        effect(out, t)
        note(true)
        return Response.json({ ok: true })
      }).catch((e) => {
        note(false, String(e))
        return new Response(String(e), { status: 400 })
      })
    }
    // The adapter table, for a browser that must offer what a spawn
    // request will be checked against (adapters.ts is server-only).
    if (path == '/providers') return Response.json(providers())
    // Managed sessions are DRIVEN through the graph (create a session
    // with a provider, create a stop_request, comment at a settled one —
    // the effects below); the log file is the one thing still read here,
    // because logs are log data, not graph.
    let session = path.match(/^\/sessions\/([0-9a-f-]{36})\/logs$/)
    if (session) return Response.json(logs(session[1], url.searchParams))
    // The wire's record, per entity (?eid=) or per actor (?actor= — a
    // session's whole day, for the lapse ledger). Newest first. Raw eids
    // only — id resolution is a client concern.
    if (path == '/journal') {
      let actor = url.searchParams.get('actor')
      let limit = Number(url.searchParams.get('limit') ?? 50) || 50
      return Response.json(
        actor
          ? journalBy(db, actor, limit)
          : journalOf(db, url.searchParams.get('eid') ?? '', limit),
      )
    }
    if (path == '/freeze') {
      return freeze(url.searchParams.get('eid') ?? '', cast)
    }
    if (path == '/upload' && req.method == 'POST') {
      return req.text().then((body) =>
        store(url.searchParams.get('eid') ?? '', body, cast)
      )
    }
    if (path.startsWith('/frozen/')) {
      return serveFrozen(path.slice(8).replace(/\.html$/, ''))
    }
    // An extensionless path is a ROUTE (/T-123): the app boots and reads
    // the URL — same shell, different root card.
    return file(src.slice(0, -1), path.includes('.') ? path : '/index.html')
  },
)

// The curated effects — the graph's post-commit levers, one list, like
// View.tsx's renderer list. A session created with a provider is a spawn
// request; a stop_request is the brake; a comment at a settled managed
// session resumes it; a deleted session's process dies with its row.
// A future plugin contributes rows here the same way it would renderers.
on('session', {
  created: spawned(cast),
  removed: deleted,
  doc: 'a session created with a provider is a spawn request — validate, ' +
    'launch the agent; a deleted session kills its process',
})
on('stop_request', {
  created: stopped(cast),
  sweep: { pending: 'acted_at is null' },
  doc: 'the brake: signal the targeted session to stop, stamp acted_at',
})
on('comment', {
  created: commented(cast),
  doc: 'a comment at a settled managed session resumes that agent',
})
on('mail', {
  created: mailed(cast),
  sweep: { pending: 'acted_at is null' },
  doc: 'deliver the mail through $TASKS_MAIL_CMD — resolve the address ' +
    'book reference, stamp acted_at/error/to_addr (the envelope copy)',
})
on('comment', {
  created: fanout(cast),
  sweep: { pending: FANOUT_PENDING },
  doc: "a comment on an addressed project's task fans out as a " +
    'mail to that project (the about edge is the receipt)',
})

// Personas follow the graph into each repo's .tasks/ files: any change
// that could reshape one — a persona born or rehomed, a tier edge
// spoken or unsaid, a doc edit on a persona or a tiered member —
// re-renders the fleet (write-if-changed, debounced so a batch lands
// once). Never commits: `task sync --commit` is the deliberate move,
// and a failed write is a warning, never a broken batch.
let syncing: ReturnType<typeof setTimeout> | undefined
let syncSoon = () => {
  clearTimeout(syncing)
  syncing = setTimeout(() => {
    try {
      let snap = snapshot(db)
      let { failed } = syncFiles(filesFor(rows(snap), snap.deps, Date.now()))
      for (let f of failed) console.warn('persona sync —', f)
    } catch (e) {
      console.warn('persona sync —', e)
    }
  }, 250)
}
// Is this eid a persona, or on some persona's tier? The gate that keeps
// ordinary doc edits and edges from re-rendering the fleet.
let personaish = (...eids: (string | undefined)[]) =>
  eids.some((e) =>
    e && db.prepare(
      `select 1 from persona where eid = :e
       union select 1 from dependency d
         join persona p on p.eid = d.parent_eid where d.child_eid = :e`,
    ).get({ e })
  )
on('persona', {
  created: syncSoon,
  changed: { project_eid: syncSoon },
  removed: syncSoon,
  doc: "materialize personas into their projects' .tasks/ files " +
    '(write-if-changed; task sync --commit is the deliberate commit)',
})
on('dependency', {
  created: (eid, comp) =>
    personaish(eid, comp.child_eid as string) && syncSoon(),
  doc: 'a tier edge (or baseline flip) at a persona re-renders its files',
})
on('doc', {
  changed: {
    title: (eid) => personaish(eid) && syncSoon(),
    body: (eid) => personaish(eid) && syncSoon(),
  },
  doc: 'a doc edit on a persona or a tiered memory re-renders its files',
})

// Managed children are detached (setsid) and this process restarts on every
// server-file edit — so booting means picking them back up: adopt the ones
// still alive, finalize the ones that died while we were away. Nothing here
// reaps a child; the watcher below must never learn how.
recover(cast)

// Then the outbox relay: intents that committed but never fired their
// effect (a crash in the post-commit gap) re-fire now — strictly AFTER
// recover(), so a re-driven stop finds the adopted pid to signal.
relay((comp, pending) =>
  db.prepare(`select * from ${comp} where ${pending}`).all() as Record<
    string,
    unknown
  >[]
)

// Last, the worktree sweep: completed sessions whose merged, clean trees
// outlived their usefulness let go — at boot, never at settle, so a live
// server's resume window stays open (sessions.ts tidy says why).
tidy(cast)

// The Vocabulary doc: the schema written into the graph, regenerated
// from the live structures now that the effects registry is full. After
// the registrations above, or the doc would ship an empty Effects list.
vocabularyDoc(db, vocabularyMd(docs()))

// Watch src/ and tell every client what a save means (debounced — editors
// fire several events per save):
//   {hmr: gen}  component/logic edit — re-import the graph under ?v=gen
//               and re-render; signals in live.ts keep all state
//   {css: gen}  css-only edit — re-fetch the stylesheet, nothing else
//   'reload'    a SHELL file (main.tsx, live.ts, index.html, vendor/) —
//               the swap boundary itself moved; only a real reload applies
// The server itself restarts via --watch, whose scope is its own module
// graph — but a graceful restart only completes once THIS isolate's event
// loop drains, and open websockets hold it forever (the new isolate then
// dies on AddrInUse). So when a server-graph file changes, close every
// socket and stop watching: the isolate settles, the port frees, the
// restart binds. Clients reload-poll their way back.
// `graph` is everything the SERVER imports (transitively) — a change to
// these needs a process restart, not a client swap. Keep in sync with the
// imports above (mcp.ts pulls client.ts in; db.ts pulls query.ts).
let graph = [
  'server.ts',
  'db.ts',
  'effects.ts',
  'schema.ts',
  'types.ts',
  'query.ts',
  'freeze.ts',
  'hot.ts',
  'mcp.ts',
  'client.ts',
  'sessions.ts',
  'adapters.ts',
  'telemetry.ts',
]
let shellish = (p: string) =>
  p.endsWith('/main.tsx') || p.endsWith('/live.ts') ||
  p.endsWith('/index.html') || p.includes('/vendor/')
let watch = async () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let batch = new Set<string>()
  for await (let e of Deno.watchFs(src)) {
    if (e.paths.some((p) => graph.some((g) => p.endsWith(`/${g}`)))) {
      for (let c of clients) c.close()
      return
    }
    for (let p of e.paths) batch.add(p)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      let paths = [...batch]
      batch.clear()
      let msg = paths.some(shellish)
        ? 'reload' as const
        : paths.every((p) => p.endsWith('.css'))
        ? { css: ++gen }
        : { hmr: ++gen }
      for (let c of clients) {
        if (c.readyState == WebSocket.OPEN) c.send(JSON.stringify(msg))
      }
    }, 50)
  }
}
watch()
