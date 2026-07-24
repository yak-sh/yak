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
  cursorOf,
  db,
  delta,
  eager,
  epoch,
  journalBy,
  journalOf,
  search,
  snapshot,
  touch,
  vocabHash,
  vocabularyDoc,
} from './db.ts'
import { spread, type Step, step } from './subs.ts'
import { dispatch, docs, on, relay, trace } from './effects.ts'
import { vocabularyMd } from './schema.ts'
import { freeze, serveFrozen, store } from './freeze.ts'
import { fanout, FANOUT_PENDING, mailed } from './mail.ts'
import { native } from './mailer.ts'
import { knocked } from './knock.ts'
import { waking } from './wake.ts'
import {
  fleetApi,
  fleetRaw,
  inboundSweep,
  mailIdOf,
  mayStamp,
} from './inbound.ts'
import { scribeSweep } from './scribe.ts'
import { embedSweep, similarTo } from './embed.ts'
import { mcpServer } from './mcp.ts'
import { filesFor, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import {
  commented,
  deleted,
  logs,
  recover,
  spawned,
  stopped,
  tidy,
  watched,
} from './sessions.ts'
import { outcome, recent, record, toolCall } from './telemetry.ts'
import { stamp } from './hot.ts'
import { find, type Row, rows } from './client.ts'
import {
  matchQuery,
  orderOf,
  parseQuery,
  type Pred,
  resolveRefs,
  warm,
} from './query.ts'

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

// Query subscriptions (T-3683), the whole registry. A Sub is a socket's saved
// query + the eids currently in its set; `subs` maps each socket to its named
// subscriptions, `filtered` holds every socket that ever subscribed. The
// migration switch is one boolean: a socket stays in the legacy full
// rebroadcast until its first control frame flips it into `filtered`, after
// which it hears ONLY its subscription frames (design §1/§6). onclose drops
// both — GC-free, per-socket.
type Sub = { preds: Pred[]; members: Set<string> }
let subs = new Map<WebSocket, Map<string, Sub>>()
let filtered = new Set<WebSocket>()

// The query pipeline shared by /query and a subscription's initial set: the
// current graph parsed, ref-resolved, matched. `hits` are every row matching
// the preds; `preds`/`all`/`byEid`/`snap` ride out for whoever ranks or
// backlinks on top (design §10.2).
let evalQuery = (q: string) => {
  let snap = snapshot(db)
  let all = rows(snap)
  let preds = resolveRefs(parseQuery(q), (id) => find(all, id)?.eid)
  let byEid = new Map(all.map((r) => [r.eid, r.comps]))
  let hits = all.filter((r) => matchQuery(r.comps, preds, (e) => byEid.get(e)))
  return { snap, all, preds, byEid, hits }
}

// Fold a committed batch into every subscription (design §2), synchronously —
// no await between apply and these frames, so snapshot-then-updates stays
// gapless. Per touched eid × sub: one eager keyed read (batch-cached), then
// the §2 transition — ADD queues full comps, UPDATE queues the batch's own
// patches, REMOVE pushes a drop, a death forwards entity-null. Stage 1 tests
// own-comp equality preds; path/time preds still evaluate (matchQuery derefs
// through the same eager read) but their far-side changes aren't indexed yet,
// so a path-pred sub only re-checks members a batch actually touched — the
// staged gap (design §2), not a silent wrong answer.
let maintain = (batch: Change[]) => {
  if (!subs.size) return
  let cur = cursorOf(db)
  let gone = new Set(
    batch.filter((c) => c.name == 'entity' && c.comp == null).map((c) => c.eid),
  )
  let touched = [...new Set(batch.map((c) => c.eid))]
  let reads = new Map<string, Record<string, Record<string, unknown>>>()
  let comps = (eid: string) => {
    let hit = reads.get(eid)
    if (!hit) reads.set(eid, hit = eager(db, eid))
    return hit
  }
  let patch = new Map<string, Change[]>()
  for (let c of batch) patch.set(c.eid, [...(patch.get(c.eid) ?? []), c])
  for (let [sock, map] of subs) {
    if (sock.readyState != WebSocket.OPEN) continue
    for (let [id, sub] of map) {
      let changes: Change[] = []
      let drop: string[] = []
      for (let eid of touched) {
        let c = gone.has(eid) ? {} : comps(eid)
        let alive = !gone.has(eid) && !!c.entity
        let hit = alive && matchQuery(c, sub.preds, comps)
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'add') changes.push(...spread(eid, c))
        else if (s == 'update') changes.push(...(patch.get(eid) ?? []))
        else if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      if (changes.length || drop.length) {
        sock.send(JSON.stringify({ sub: id, changes, drop, cursor: cur }))
      }
    }
  }
}

// A socket's control frame (design §1): `{sub, q}` subscribes or replaces (the
// initial frame is the query's current matches as one batch, and seeds the
// member set); `{unsub}` forgets one. Any control frame flips the socket into
// `filtered` — the migration switch — so it leaves the legacy rebroadcast even
// if the query is malformed (it then simply hears nothing, its own news).
let control = (
  sock: WebSocket,
  f: { sub?: string; q?: string; unsub?: string },
) => {
  filtered.add(sock)
  let map = subs.get(sock) ?? new Map<string, Sub>()
  subs.set(sock, map)
  if (typeof f.unsub == 'string') return void map.delete(f.unsub)
  if (typeof f.sub != 'string') return
  try {
    let { preds, hits } = evalQuery(f.q ?? '')
    map.set(f.sub, { preds, members: new Set(hits.map((r) => r.eid)) })
    let changes = hits.flatMap((r) => spread(r.eid, r.comps))
    sock.send(
      JSON.stringify({ sub: f.sub, changes, drop: [], cursor: cursorOf(db) }),
    )
  } catch (e) {
    console.warn('sub: bad query —', e)
  }
}

// Broadcast a committed batch to every LEGACY client (subscription sockets
// hear only their own frames, via maintain), then fold it into subscriptions.
// The one door every non-/ws write path (MCP, /apply, effects, touch, freeze)
// reaches subscribers through.
let cast = (changes: Change[], except?: WebSocket) => {
  let msg = JSON.stringify(changes)
  for (let c of clients) {
    if (c == except || c.readyState != WebSocket.OPEN || filtered.has(c)) {
      continue
    }
    c.send(msg)
  }
  maintain(changes)
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

// A booting socket's catch-up handshake (T-6829): the client declares the
// cursor+epoch+vocab it holds; the server replays the journal since it — or a
// full reset if the cursor is void (first visit) or its epoch/vocab moved (a
// db restore's fresh rowids, a vocabulary change) — and only THEN adds the
// socket to the live broadcast, so every later commit reaches it AFTER its
// catch-up, in journal order. Synchronous end to end: no await between the
// delta read and the add, so no commit interleaves (the gapless property,
// same as maintain()). This ONE ordered channel replaces the old two-channel
// boot (live over /ws, catch-up over HTTP /delta) whose reorder the client
// used to buffer around — the wire preserves order at the source now. HTTP
// /delta and /snapshot stay for one-shot clients (CLI, headless) with no
// live stream. A commit ≤ H is already in the delta; one after the add
// broadcasts live — no gap, no non-idempotent dup.
let join = (
  sock: WebSocket,
  f: { since?: number; epoch?: string; vocab?: string },
) => {
  if (f.since == null || f.epoch != epoch || f.vocab != vocabHash) {
    sock.send(JSON.stringify({ reset: true, snapshot: snapshot(db) }))
  } else {
    let d = delta(db, f.since)
    sock.send(JSON.stringify({ catchup: d.changes, cursor: d.cursor }))
  }
  clients.add(sock)
}

let ws = (req: Request) => {
  let { socket, response } = Deno.upgradeWebSocket(req)
  // The tab names itself once, at connect: ?client=<eid> is the writer for
  // every batch on this socket, so a browser write journals a resolved
  // actor instead of nothing (T-6669). A tab that names none resolves to
  // the box owner like any anonymous write.
  let writer = new URL(req.url).searchParams.get('client')
  // No implicit join: a fresh socket is in NO broadcast set until it declares
  // itself — {since} joins the live `clients` (via join()), {sub} sets
  // `filtered` (via control()). A socket that declares neither hears nothing.
  socket.onclose = () => {
    clients.delete(socket)
    subs.delete(socket)
    filtered.delete(socket)
  }
  socket.onmessage = (m) => {
    let frame = JSON.parse(String(m.data))
    // Object frames are control (design §1), structurally disjoint from the
    // array batches: {since} is the catch-up handshake, everything else
    // ({sub}/{unsub}) is subscriptions — nothing existing changes.
    if (!Array.isArray(frame)) {
      if ('since' in frame) return join(socket, frame)
      return control(socket, frame)
    }
    let sent = frame as Change[]
    let out: Change[]
    let t = trace()
    try {
      out = apply(db, sent, t, writer)
    } catch (e) {
      console.error('sync: bad batch dropped —', e)
      return
    }
    let extra = out.slice(sent.length)
    // Peers get the batch as sent; cascade extras go to EVERYONE — the
    // sender's optimistic cache only removed what it asked to remove.
    // Subscription sockets are skipped here and served by maintain() instead.
    for (let c of clients) {
      if (c.readyState != WebSocket.OPEN || filtered.has(c)) continue
      if (c != socket) c.send(m.data)
      if (extra.length) c.send(JSON.stringify(extra))
    }
    maintain(out)
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
  async (req) => {
    let url = new URL(req.url)
    let path = url.pathname
    if (path == '/ws') return ws(req)
    if (path == '/snapshot') return Response.json(snapshot(db))
    if (path == '/delta') {
      // The returning client's catch-up: changes since its cursor. A cursor
      // is only valid against the epoch and vocabulary that issued it — a
      // mismatch means the journal was reset (restore) or the shape moved,
      // so 409 tells the client to full-resnapshot rather than serve a
      // misleading delta.
      let p = url.searchParams
      if (p.get('epoch') != epoch || p.get('vocab') != vocabHash) {
        return new Response('stale', { status: 409 })
      }
      return Response.json(delta(db, Number(p.get('since') ?? 0)))
    }
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
    if (path == '/similar') {
      // Semantic neighbors of arbitrary text — the dupe hint's door.
      // 503 = this box has no embedder; callers show nothing, not errors.
      let q = url.searchParams.get('q') ?? ''
      if (!q.trim()) return new Response('q required', { status: 400 })
      let hits = await similarTo(
        db,
        q,
        Number(url.searchParams.get('limit') ?? 8),
        Number(url.searchParams.get('floor') ?? 0),
      )
      if (!hits) return new Response('no embedder here', { status: 503 })
      let byEid = new Map(rows(snapshot(db)).map((r) => [r.eid, r]))
      return Response.json(hits.map((h) => {
        let r = byEid.get(h.eid)
        return {
          ...h,
          id: r ? idOf(r) : h.eid,
          kind: r?.kind ?? 'entity',
          title: String(r?.comps.doc?.title ?? ''),
        }
      }))
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
        // One pipeline with the subscription initial-set (evalQuery); kind,
        // hot-ranking and backlinks layer on top of its matches.
        let { snap, all, preds, byEid, hits } = evalQuery(segs.join('&'))
        let now = Date.now()
        hits = kind ? hits.filter((r) => r.kind == kind) : hits
        if (orderOf(preds) == 'hot') {
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
        // session in x-via (the instrument — a principal writing directly
        // is its own instrument), apply resolves it to the actor it acts
        // for, and an anonymous post falls back to the box owner. x-actor
        // is the header's old name — older installed CLIs still send it
        // (T-7114); drop the fallback once they've rotated.
        let out = apply(
          db,
          changes,
          t,
          req.headers.get('x-via') ?? req.headers.get('x-actor'),
        )
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
    // Mail attachments, proxied read-only: the fleet-mail worker holds
    // them in R2 behind a token that stays in THIS process — clients
    // name the mail ENTITY; the spool's message_id is server business.
    // /mail/:id/files lists ({message_id, files}); …/files/:name streams
    // the bytes. Each miss says which link broke, so the CLI teaches at
    // failure time instead of shrugging.
    let files = path.match(/^\/mail\/([^/]+)\/files(?:\/(.+))?$/)
    if (files) {
      let ref = decodeURIComponent(files[1])
      let row = mailIdOf(ref)
      if (!row) return new Response(`not a mail: ${ref}`, { status: 404 })
      if (!row.message_id) {
        return new Response(
          `${ref} has no spool row (outbound/relay mail carries no attachments)`,
          { status: 404 },
        )
      }
      let name = files[2] ? decodeURIComponent(files[2]) : undefined
      let up = fleetRaw(
        `/messages/${encodeURIComponent(row.message_id)}/attachments` +
          (name ? `/${encodeURIComponent(name)}` : ''),
      )
      if (!up) {
        return new Response(
          'fleet-mail API not configured on this server (FLEET_MAIL_API_URL / FLEET_MAIL_API_TOKEN)',
          { status: 503 },
        )
      }
      let res = await up
      if (!res.ok) return new Response(await res.text(), { status: res.status })
      if (name) {
        return new Response(res.body, {
          headers: {
            'content-type': res.headers.get('content-type') ??
              'application/octet-stream',
          },
        })
      }
      return Response.json({
        message_id: row.message_id,
        files: await res.json(),
      })
    }
    // Managed sessions are DRIVEN through the graph (create a session
    // with a provider, create a stop_request, comment at a settled one —
    // the effects below); the log file is the one thing still read here,
    // because logs are log data, not graph.
    let session = path.match(/^\/sessions\/([0-9a-f-]{36})\/logs$/)
    if (session) return Response.json(logs(session[1], url.searchParams))
    // The wire's record, per entity (?eid=) or per actor (?actor= — a
    // session's whole day, for the wrap ledger). Newest first. Raw eids
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
        store(
          url.searchParams.get('eid') ?? '',
          body,
          cast,
          url.searchParams.has('scrub'),
        )
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
// Entity.tsx's renderer list. A session created with a provider is a spawn
// request; a stop_request is the brake; a comment at a settled managed
// session resumes it; a deleted session's process dies with its row.
// A future plugin contributes rows here the same way it would renderers.
on('session', {
  created: spawned(cast),
  removed: deleted,
  doc: 'a session created with a provider is a spawn request — validate, ' +
    'launch the agent; a deleted session kills its process',
})
on('session', {
  created: watched(cast),
  changed: { pid: watched(cast) },
  doc: 'a session that announced a claude process gets watched: say when ' +
    'the door shuts, counting its transcript if it wrote one (we never ' +
    'forked it, so there is no exit code to report)',
})
on('stop_request', {
  created: stopped(cast),
  sweep: { pending: 'acted_at is null' },
  doc: 'the brake: signal the targeted session to stop, stamp acted_at',
})
on('comment', {
  created: commented(cast),
  doc: 'a comment at a settled session resumes that agent with its ' +
    'unheard backlog',
})
on('knock', {
  created: knocked(cast),
  sweep: { pending: 'acted_at is null' },
  doc: 'attention, resolved: cast to whoever is awake for the recipient, ' +
    'spawn a project operator onto the target, or mail an addressed ' +
    'person — stamp delivery/error either way',
})
on('wake', {
  created: waking(cast),
  changed: { at: waking(cast) }, // a moved hour re-arms the timer
  // Not an outbox retry but the RECONCILE: boot hands back every wake
  // still owed, so an hour that passed while the server was down fires
  // now instead of vanishing.
  sweep: { pending: 'acted_at is null' },
  doc: 'the timed knock: hold until `at`, then mint the knock and let ' +
    'the ladder deliver — one timer, re-armed at the earliest pending ' +
    'wake and reconciled at boot',
})
on('mail', {
  created: mailed(cast),
  // message_id marks INBOUND — a record of arrival the sweep must never
  // hand to delivery (mailed() guards the live path the same way).
  sweep: { pending: 'acted_at is null and message_id is null' },
  doc: 'deliver the mail — $TASKS_MAIL_CMD when set, else the native ' +
    'Cloudflare sender — resolve the address book reference, stamp ' +
    'acted_at/error/to_addr (the envelope copy) and sent_id (native)',
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
// once) and commits what it wrote, so a persona edit doesn't leave every
// venture repo dirty. A failed write or commit is a warning, never a
// broken batch.
//
// This lands in the PRIMARY checkout, which an operator may be using
// right now — so what's safe here and what isn't: the pathspec commit
// leaves the index alone, so staged work survives (git.ts), and only
// tracked files are committed, so nothing new appears in their tree.
// What it does do is advance the branch under them: a worktree's pending
// `push origin HEAD:main` stops being fast-forward and needs a rebase.
// That's the trade we take knowingly — one small commit per persona
// edit, so the rebase is always trivial.
let syncing: ReturnType<typeof setTimeout> | undefined
let syncSoon = () => {
  clearTimeout(syncing)
  syncing = setTimeout(async () => {
    try {
      let snap = snapshot(db)
      let files = filesFor(rows(snap), snap.deps, Date.now())
      for (let f of syncFiles(files).failed) console.warn('persona sync —', f)
      // Every projection path, not just this tick's writes: a file some
      // earlier tick left dirty (untracked then, adopted since) is dirt
      // this tick can clear. commit() ignores whatever matches HEAD.
      let done = await commit(files.map((f) => f.path), 'personas: materialize')
      for (let f of done.failed) console.warn('persona commit —', f)
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
  doc: 'a tier edge (or common flip) at a persona re-renders its files',
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

// Inbound rides the pull (inbound.ts): the fleet-mail sweep, on an
// interval like the log tailer — it graduates to a `system` entity under
// T-3906. Boot sweeps too (idempotency makes it free); unconfigured is
// dormancy, said once, never an error — and a non-live db is REFUSAL
// (mayStamp), or a probe inheriting live creds steals delivery.
if (fleetApi()) {
  inboundSweep(cast)
  setInterval(() => inboundSweep(cast), 10_000)
} else {
  console.log(
    mayStamp()
      ? 'inbound sweep dormant — set FLEET_MAIL_API_URL and FLEET_MAIL_API_TOKEN'
      : 'inbound sweep dormant — non-live db (DB_PATH set); ' +
        'FLEET_MAIL_SWEEP=1 opts in',
  )
}

// Which outbound door is armed — said once at boot, so an env flip is
// verifiable from the journal (per-mail outcomes stamp on the row).
console.log(
  Deno.env.get('TASKS_MAIL_CMD')
    ? 'mailer: $TASKS_MAIL_CMD'
    : native()
    ? 'mailer: native (Cloudflare Email Sending)'
    : 'mailer dormant — set TASKS_MAIL_CMD, or CLOUDFLARE_EMAIL_TOKEN + ' +
      'HOLDCO_CF_ACCOUNT_ID',
)

// The scribe (scribe.ts): when wrap stubs wait, spawn the desk — a
// session wearing the scribe persona writes the briefs and memories.
// Ten-minute tick; the sweep's own throttle keeps it to one desk an
// hour. Graduates to a `system` entity under T-3906 with the others.
scribeSweep(cast)
setInterval(() => scribeSweep(cast), 10 * 60_000)

// Embeddings (embed.ts): every non-comment doc keeps a semantic vector,
// refreshed a few seconds after its text moves — that's what lets a
// create reply say "this already exists" while the ink is still wet.
// Boot sweeps the backfill; the interval catches anything the debounce
// dropped. A box without the model sweeps zero rows, forever, silently.
embedSweep(db)
setInterval(() => embedSweep(db), 10 * 60_000)
let embedSoon = (() => {
  let t: ReturnType<typeof setTimeout> | undefined
  return () => {
    clearTimeout(t)
    t = setTimeout(() => embedSweep(db), 3_000)
  }
})()
on('doc', {
  created: embedSoon,
  changed: { title: embedSoon, body: embedSoon },
  doc: 'docs keep a semantic vector — the embed sweep refreshes what moved',
})

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
  'subs.ts',
  'freeze.ts',
  'hot.ts',
  'mcp.ts',
  'client.ts',
  'sessions.ts',
  'door.ts',
  'served.ts',
  'proc.ts',
  'adapters.ts',
  'telemetry.ts',
  'mail.ts',
  'mailer.ts',
  'persona.ts',
  'git.ts',
  'inbound.ts',
  'scribe.ts',
  'knock.ts',
  'wake.ts',
  'embed.ts',
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
