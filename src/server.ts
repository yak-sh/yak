// The whole backend in one Deno.serve: static files out of src/, TS/TSX
// translated to JS per-request (sucrase strips types + compiles JSX — no
// bundling, no type-checking; `deno task check` is the type gate), bare
// imports resolved by the import map in index.html to the vendored ESM in
// src/vendor/, the sync websocket, and a src/ watcher that hot-swaps
// clients: component edits re-import under a fresh ?v generation (state
// survives — it lives in live.ts, above the swap), css edits re-fetch the
// stylesheet, and only shell/server edits still cost a real reload.
import { transform } from 'sucrase'
import { bound, guard, type Serving } from './bind.ts'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { providers } from './adapters.ts'
import { type Change, type Dep, idOf, kindOf } from './types.ts'
import {
  apply,
  bodies,
  cursorOf,
  db,
  delta,
  depsOf,
  eager,
  epoch,
  file as graph,
  journalBy,
  journalOf,
  locate,
  refsOf,
  rootChanges,
  rowsOf,
  search,
  snapshot,
  touch,
  vocabHash,
  vocabularyDoc,
} from './db.ts'
import { bodied, bodyless, gaps, spread, type Step, step } from './subs.ts'
import { dispatch, docs, on, relay, trace } from './effects.ts'
import { vocabularyMd } from './schema.ts'
import { freeze, serveFrozen, store } from './freeze.ts'
import { filed } from './page.ts'
import { PENDING } from './deliver.ts'
import { fileBug, HEAL_PENDING } from './heal.ts'
import { fanout, FANOUT_PENDING, mailed } from './mail.ts'
import { native } from './mailer.ts'
import { closingTask } from './closing.ts'
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
import { type IO, mcpServer } from './mcp.ts'
import { projection, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import {
  codexPending,
  commented,
  deleted,
  logs,
  prepareWorktree,
  recover,
  recoverWorktree,
  spawned,
  stopped,
  tidy,
  watched,
} from './sessions.ts'
import { codexIssuer, codexStore } from './codex_auth.ts'
import { accountHttp, accountService } from './accounts.ts'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { graphSession, managedCodex } from './managed_codex.ts'
import { sessionRow as storedSession } from './session_store.ts'
import { responses } from './responses.ts'
import { readEntries } from './entries.ts'
import { graphLog, graphLogPage } from './entry_log.ts'
import { type Observation, safeObservation } from './observations.ts'
import { outcome, recent, record, toolCall } from './telemetry.ts'
import { stamp } from './hot.ts'
import { obeyed } from './obey.ts'
import { serverFile } from './reload.ts'
import { jsonOf, type Row, rows } from './client.ts'
import {
  listed,
  matchQuery,
  parseQuery,
  type Pred,
  resolveRefs,
} from './query.ts'
import { evalFast, evalGraph, evalQuery, rowed } from './graph_query.ts'
import { liveFrame } from './wire.ts'
import { nativeSoon, nativeSweep, noticeAccepted } from './tmux.ts'
import { roleRemoved, rolesSoon, rolesSweep } from './roles.ts'
import { prune as pruneTree, reap as reapProbes, sweep } from './probes.ts'

// The last line of defence. A rejection nobody handled ends a Deno process,
// and this process dying costs every operator (T-11139) — so an escaped one
// degrades to a logged error. This never replaces guarding a sweep at its
// call site (`tick` below); it is what catches the one nobody guarded, and
// the warning is how you find it.
globalThis.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  console.error('unhandled rejection —', e.reason)
})

// The hot-swap generation: bumped by the watcher on every client-code or css
// change, stamped into every served module's relative imports so a swap
// re-fetches the whole component graph (see hot.ts).
//
// Seeded from the clock because the browser's ESM cache OUTLIVES this
// process and is keyed by exact specifier. Counting from 1 each boot re-mints
// `?v=2` after every restart — and a tab that already holds `App.tsx?v=2`
// answers the re-import from cache, so the swap reports `code v2 live` while
// running the previous process's modules. Nothing throws, so main.tsx's
// `Good` fallback cannot see it either. Monotonic across processes is the
// property that matters; within one, only that it climbs.
let gen = Date.now()

let src = new URL('.', import.meta.url).pathname

let mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
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
let envelopes = new Set<WebSocket>()

// Query subscriptions (T-3683), the whole registry. A Sub is a socket's saved
// query + the eids currently in its set; `subs` maps each socket to its named
// subscriptions, `filtered` holds every socket that opened a non-shadow sub.
// Shadow subs hear both streams for prove-before-flip; the later migration
// switch is still one boolean. onclose drops both — GC-free, per-socket.
type Sub = {
  preds: Pred[]
  members: Set<string>
  shadow: boolean
  moving: boolean
  bodies: boolean
  details: boolean
}
let subs = new Map<WebSocket, Map<string, Sub>>()
let filtered = new Set<WebSocket>()

// Observations belong only to connected readers of this Session partition.
// No cursor means no journal position, and this path never reaches apply(),
// cast(), snapshot(), or the browser's persistent landing branch.
export let broadcastObservation = (value: Observation) => {
  let observation = safeObservation(value)
  if (!observation) return 0
  let frame = JSON.stringify({ observe: observation })
  let sent = 0
  for (let [sock, map] of subs) {
    if (
      sock.readyState != WebSocket.OPEN ||
      !map.has(`entries:${observation.session}`)
    ) continue
    try {
      sock.send(frame)
      sent++
    } catch { /* a closing watcher loses an optional hint */ }
  }
  return sent
}

// The filter-query pipeline lives in graph_query.ts, parameterized by db so a
// test drives it without booting the server; here every call closes over the
// one live db. evalFast/evalQuery back the /ws initial set; evalGraph is the
// whole answer the /query door and the in-process graph_query tool share.

// Fold a committed batch into every subscription (design §2), synchronously —
// no await between apply and these frames, so snapshot-then-updates stays
// gapless. Per touched eid × sub: one eager keyed read (batch-cached), then
// the §2 transition — ADD queues full comps, UPDATE queues the batch's own
// patches, REMOVE pushes a drop, a death forwards entity-null. Stage 1 tests
// own-comp equality preds; path/time preds still evaluate (matchQuery derefs
// through the same eager read) but their far-side changes aren't indexed yet,
// so a path-pred sub only re-checks members a batch actually touched — the
// staged gap (design §2), not a silent wrong answer.
// What a subscription frame has to CARRY. A live subscription owns its
// client's view of these rows, so it ships the components. A SHADOW one does
// not: it never flips the socket into `filtered`, so the same client is still
// hearing the complete broadcast, and landSub() reads a shadow frame's changes
// for one thing only — the eids, to keep the member set. Everything else in
// that frame is a second copy of what the client already has.
//
// It is not a small second copy. Over the eighteen live boards the shadow
// frames came to 62.6 MB, and the spine says the same thing about membership
// in 3.9 MB — 6.2% of the bytes, with the whole-graph board going from 21.7 MB
// and 765ms to 1.4 MB and 383ms. Membership is identical on every one.
//
// The ordering under cast() is what makes the spine safe: sendLive() reaches
// the complete-broadcast clients BEFORE maintain() runs, so a client always
// holds an entity's components before a shadow frame mentions its eid. Reverse
// that and a spine-only add would land a component-less row in a cache whose
// whole contract is that it is complete.
//
// The other half of the same question is BODIES: a live subscription owns the
// rows, but a board or shape never paints a body, and doc bodies are 44% of
// what a whole-graph subscription ships. Only `card:`/`route:` subs — the
// ones that exist to show one entity whole — carry them (subs.ts `bodied`).
let carry = (sub: Sub, changes: Change[]) =>
  sub.bodies ? changes : bodyless(changes)

let payload = (
  sub: Sub,
  eid: string,
  comps: Record<string, Record<string, unknown>>,
): Change[] =>
  sub.shadow && !sub.details
    ? [{ eid, name: 'entity', comp: comps.entity as Change['comp'] }]
    : carry(sub, spread(eid, comps))

export let maintain = (batch: Change[]) => {
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
        let hit = alive && listed(c, sub.preds) &&
          matchQuery(c, sub.preds, comps)
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'add') changes.push(...payload(sub, eid, c))
        // A standing match tells a shadow sub nothing: membership did not
        // move, and the client heard the patch on the complete stream.
        else if (s == 'update' && (!sub.shadow || sub.details)) {
          changes.push(...carry(sub, patch.get(eid) ?? []))
        } else if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      if (changes.length || drop.length) {
        sock.send(JSON.stringify({
          sub: id,
          changes,
          drop,
          cursor: cur,
          shadow: sub.shadow,
        }))
      }
    }
  }
}

// A moving time phrase ('today', '1 week ago') names a window the CLOCK moves,
// not the data — so a member ages out of it with nobody writing anything, and
// maintain() only ever re-tests what a batch touched. The sweep is that missing
// trigger: on each tick, every moving-time subscription re-tests its OWN members
// against the clock and drops the ones that have fallen out.
//
// Members only, and that is exact rather than partial. A past-facing window
// ('today', 'since a week ago') sheds as its near edge advances and can never
// GAIN a member without a write, because a row's timestamp does not move. Only
// a FUTURE-facing phrase over a future column ('.wake.at<=in 60m') can gain,
// and finding those entrants means asking the whole graph — evalQuery takes
// ~1s over a 22 MB snapshot of the live board, so a tick that did it would cost
// more than everything it serves. gaps() still reports 'moving-time' for both,
// so that half stays classified rather than silently assumed handled.
//
// `now` is a parameter because a window a client waits a minute to cross is a
// test nobody writes; handing the matcher a later moment states the same thing
// in a millisecond.
export let aged = (now = Date.now()) => {
  if (!subs.size) return
  let cur = cursorOf(db)
  let reads = new Map<string, Record<string, Record<string, unknown>>>()
  let comps = (eid: string) => {
    let hit = reads.get(eid)
    if (!hit) reads.set(eid, hit = eager(db, eid))
    return hit
  }
  for (let [sock, map] of subs) {
    if (sock.readyState != WebSocket.OPEN) continue
    for (let [id, sub] of map) {
      if (!sub.moving) continue
      let changes: Change[] = []
      let drop: string[] = []
      for (let eid of [...sub.members]) {
        let c = comps(eid)
        let alive = !!c.entity
        let hit = alive && listed(c, sub.preds) &&
          matchQuery(c, sub.preds, comps, now)
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      if (changes.length || drop.length) {
        sock.send(JSON.stringify({
          sub: id,
          changes,
          drop,
          cursor: cur,
          shadow: sub.shadow,
        }))
      }
    }
  }
}
// A socket's control frame (design §1): `{sub, q}` subscribes or replaces (the
// initial frame is the query's current matches as one batch, and seeds the
// member set, marked `replace` for the client); `{unsub}` forgets one. A
// non-shadow subscribe flips the socket into `filtered`; a shadow subscribe
// keeps the legacy stream beside its result frames.
let control = (
  sock: WebSocket,
  f: { sub?: string; q?: string; unsub?: string; shadow?: boolean },
) => {
  // A shadow subscription proves its set beside the complete stream. It must
  // not flip the socket into partial-cache delivery before stage 2c.
  if (typeof f.sub == 'string' && !f.shadow) filtered.add(sock)
  let map = subs.get(sock) ?? new Map<string, Sub>()
  subs.set(sock, map)
  if (typeof f.unsub == 'string') return void map.delete(f.unsub)
  if (typeof f.sub != 'string') return
  try {
    let details = f.sub.startsWith('entries:')
    let { preds, hits } = evalFast(db, f.q ?? '', undefined, details) ??
      evalQuery(db, f.q ?? '')
    map.set(f.sub, {
      preds,
      members: new Set(hits.map((r) => r.eid)),
      shadow: !!f.shadow,
      moving: gaps(preds).includes('moving-time'),
      bodies: bodied(f.sub),
      // Entry partitions are absent from both the root snapshot and root live
      // stream, so their shadow owns bodies and standing-match updates too.
      details,
    })
    let sub = map.get(f.sub)!
    let changes = hits.flatMap((r) => payload(sub, r.eid, r.comps))
    sock.send(
      JSON.stringify({
        sub: f.sub,
        changes,
        drop: [],
        replace: true,
        cursor: cursorOf(db),
        shadow: !!f.shadow,
      }),
    )
  } catch (e) {
    console.warn('sub: bad query —', e)
  }
}

// Send one committed batch in the shape each socket negotiated: long-lived
// old clients keep their bare arrays while new browser leaders get the cursor
// needed for an atomic IDB checkpoint.
let sendLive = (changes: Change[], except?: WebSocket) => {
  changes = rootChanges(db, changes)
  if (!changes.length) return
  let cursor = cursorOf(db)
  let bare = JSON.stringify(liveFrame(changes, cursor, false))
  let framed = JSON.stringify(liveFrame(changes, cursor, true))
  for (let c of clients) {
    if (c == except || c.readyState != WebSocket.OPEN || filtered.has(c)) {
      continue
    }
    c.send(envelopes.has(c) ? framed : bare)
  }
}

let runnerSoon = () => {}

// Broadcast a committed batch to every full-graph client (subscription
// sockets hear only their own frames, via maintain), then fold it into subs.
// The one door every non-/ws write path (MCP, /apply, effects, touch, freeze)
// reaches subscribers through.
let cast = (changes: Change[], except?: WebSocket) => {
  sendLive(changes, except)
  maintain(changes)
  nativeSoon(cast)
  rolesSoon(cast)
  runnerSoon()
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
  f: { since?: number; epoch?: string; vocab?: string; live?: number },
) => {
  if (f.live == 1) envelopes.add(sock)
  else envelopes.delete(sock)
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
    envelopes.delete(socket)
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
      socket.send(JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        snapshot: snapshot(db),
      }))
      return
    }
    // The sender hears the canonical patch too: its optimistic spelling may
    // differ from storage (`P02`, `today`, a human reference). Applying the
    // same patch twice is harmless; omitting it leaves the sender divergent.
    sendLive(out)
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
let partition = (eid: string) => readEntries(db, eid)

let sessionLog = (eid: string, q: URLSearchParams) =>
  graphSession(db, eid) ? graphLogPage(partition(eid), q) : logs(eid, q)

let graphIO: IO = {
  // deno-lint-ignore require-await
  read: async () => snapshot(db),
  // The authoritative filter-query, in-process: the same evalGraph the /query
  // door runs, so graph_query reaches the lazy entry partition instead of the
  // snapshot()-only truth it read before.
  // deno-lint-ignore require-await
  query: async (q, kind, opts) => evalGraph(db, q, kind, opts).hits,
  // deno-lint-ignore require-await
  write: async (changes, via) => {
    let t = trace()
    let out = apply(db, changes, t, via)
    cast(out)
    effect(out, t)
    return out
  },
  // deno-lint-ignore require-await
  find: async (q, limit) => search(db, q, limit),
  upload: async (eid, html) => {
    let res = await store(eid, html, cast)
    if (!res.ok) throw new Error(await res.text())
  },
  // The one writer of recall stats: stamp, then cast, so every cache hears
  // the new warmth (the apply wire refuses these rows).
  // deno-lint-ignore require-await
  touch: async (eids, confirm) => {
    let out = touch(db, eids, confirm)
    if (out.length) cast(out)
  },
  // deno-lint-ignore require-await
  logs: async (eid, q) => sessionLog(eid, q),
  // deno-lint-ignore require-await
  history: async (eid, limit) => journalOf(db, eid, limit),
  providers: () => readyProviders(),
}

let codexAccount = accountService(codexStore(), codexIssuer())

// The adapter table stamped with live readiness: the graph-native Codex
// transport is ready only when its account is signed in, so every server-side
// spawn default (obey, MCP, CLI) routes graph-native → CLI fallback off this
// one probe instead of reading the account again at each door.
let readyProviders = async () => {
  let ok = await codexAccount.status().then((s) => s.ready).catch(() => false)
  return providers((name) => name != 'codex' || ok)
}
let managed = managedCodex({
  db,
  cast,
  transport: responses({
    credentials: codexAccount.credentials,
    headers: { originator: 'tasks', version: '0' },
    retries: 1,
  }),
  tools: async (tree, session) => {
    let tasks = await tasksTools(graphIO, session)
    if (!tree) return tasks
    try {
      // A reaped checkout regrows before any tool runs in it (T-16761): the
      // provider thread outlives its worktree, so a later turn recreates the
      // recorded path from the base rather than dying at localTools' realPath.
      await recoverWorktree(session, cast)
      let identity = String(storedSession(db, session)?.id ?? session)
      return combineTools(await localTools({ tree, session: identity }), tasks)
    } catch (error) {
      await tasks.close?.()
      throw error
    }
  },
  prepare: prepareWorktree,
  observe: broadcastObservation,
})
runnerSoon = () =>
  managed.sweep().catch((e) => console.warn('Codex runner sweep —', e))

let mcp = async (req: Request) => {
  let call: ReturnType<typeof toolCall> = null
  let t0 = performance.now()
  try {
    let body = await req.json()
    if (Array.isArray(body)) return new Response('no batches', { status: 400 })
    if (body.id == null) return new Response(null, { status: 202 }) // notification
    call = toolCall(body)
    let [mine, theirs] = InMemoryTransport.createLinkedPair()
    let server = mcpServer(graphIO)
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
      session_id: b.client ?? null,
      ok: false,
      error: String(b.message ?? 'error'),
      detail: [b.stack, b.url].filter(Boolean).join('\n\n'),
    })
  } catch (e) {
    console.warn('error report dropped —', e)
  }
  return new Response(null, { status: 204 })
}

// The handoff supervisor starts the successor before asking this process to
// drain. reusePort makes those listeners overlap; shutdown() keeps every
// request on the process that accepted it until its response is complete.
let booted: () => void = () => {}
let boot = new Promise<void>((resolve) => booted = resolve)
let port = Number(Deno.env.get('PORT') ?? 5173)
// Whose graph holds this address (src/bind.ts). An occupied port is refused
// — a stranger's graph makes every reader a coin flip, and even our own file
// twice over is a probe writing to the owner's board — unless `--join` says
// a supervisor meant this process to succeed the one already there.
let serving: Serving = { db: graph, epoch, pid: Deno.pid }
let ownership: Deno.FsFile
try {
  ownership = await guard(port, graph, Deno.args.includes('--join'))
} catch (e) {
  console.error(`tasks: ${(e as Error).message}`)
  Deno.exit(1)
}
let http = Deno.serve(
  { port, reusePort: true },
  async (req) => {
    let url = new URL(req.url)
    let path = url.pathname
    // Answered BEFORE boot: a peer deciding whether it may join this address
    // must hear whose graph is here without waiting out our migrations.
    if (path == '/graph') return Response.json(serving)
    await boot
    if (path.startsWith('/accounts/codex')) {
      return accountHttp(codexAccount, req, path)
    }
    if (path == '/ws') return ws(req)
    if (path == '/snapshot') return Response.json(snapshot(db))
    if (path == '/body') {
      // The bodies a bodyless payload deferred, for the eids a view is about
      // to paint or edit (live.ts `want`). A Change batch, so it lands
      // through applyLocal like any patch — no second intake path.
      let eids = (url.searchParams.get('eids') ?? '').split(',').filter(Boolean)
      return Response.json({ changes: bodies(db, eids) })
    }
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
        url.searchParams.get('eid') ?? undefined,
      )
      if (!hits) return new Response('no embedder here', { status: 503 })
      return Response.json(hits.map((h) => {
        let comps = eager(db, h.eid)
        let entity = comps.entity
        let kind = kindOf(comps)
        return {
          ...h,
          id: entity
            ? idOf({ eid: h.eid, kind, num: Number(entity.num) })
            : h.eid,
          kind,
          title: String(comps.doc?.title ?? ''),
        }
      }))
    }
    if (path == '/query') {
      // The graph over plain GET: the query string IS the filter line —
      // the same grammar boards and task_list speak — and hits come back
      // Structured like every entity JSON door. `kind=` screens by derived
      // kind; `backlinks=1` adds who points at each hit (eid columns + edges),
      // `deps=1` the hit's own edges both ways; `id=` names entities outright.
      // A malformed filter is the typist's news, not a server error.
      try {
        let segs = url.search.slice(1).split('&').filter(Boolean)
          .map(decodeURIComponent)
        let backs = segs.includes('backlinks=1')
        let edged = segs.includes('deps=1')
        let reveal = segs.includes('quarantined=1')
        let kind = segs.find((s) => s.startsWith('kind='))?.slice(5)
        // Paging for the lazy entry partition: `after=` is an entry.seq cursor,
        // `limit=` the page size. Ignored by an eager query, which the snapshot
        // path already answers whole in num order.
        let after = Number(
          segs.find((s) => s.startsWith('after='))?.slice(6),
        ) ||
          0
        let limit = Number(
          segs.find((s) => s.startsWith('limit='))?.slice(6),
        ) || undefined
        // `id=` FETCHES rather than filters: each value is an ADDRESS — T-3, a
        // bare num, an alias slug, a uuid — and locate() is the index's own
        // reading of "what names an entity", the same four rules find() spells
        // over a materialized graph. It is a parameter beside kind= and
        // backlinks= rather than a predicate because addressing is not
        // filtering: `.entity.eid~=abc` would be a substring search over
        // uuids, legal and meaningless.
        //
        // An id naming nothing is simply absent, the way a filter matching
        // nothing returns no rows — a caller asking for five and getting three
        // learns which two are gone by their absence.
        let named = segs.filter((s) => s.startsWith('id='))
          .flatMap((s) => s.slice(3).split(',')).filter(Boolean)
        let only = named.length
          ? new Set(
            named.map((i) => locate(db, i)).filter(Boolean) as string[],
          )
          : null
        segs = segs.filter((s) =>
          s != 'backlinks=1' && s != 'deps=1' && s != 'quarantined=1' &&
          !s.startsWith('kind=') && !s.startsWith('after=') &&
          !s.startsWith('limit=') &&
          !s.startsWith('id=')
        )
        let q = segs.join('&')
        // Any remaining filter line still screens, so `id=` composes with the
        // grammar rather than replacing it.
        let screen = (hits: Row[]) => {
          let out = kind ? hits.filter((r) => r.kind == kind) : hits
          return only ? out.filter((r) => only.has(r.eid)) : out
        }
        // What a hit carries BESIDE its components: its own edges (deps=1)
        // and who points at it (backlinks=1). Both are keyed off the hits —
        // depsOf and refsOf read the edge table and each typed eid column by
        // eid — so a one-entity question costs one entity. Backlinks used to
        // walk every row of the graph for this, which is what held the whole
        // door on the snapshot path; now every path serves both layers the
        // same way, and `deps` is the first door outside /snapshot to carry an
        // entity's OUTGOING edges at all (`task show` prints them).
        //
        // `deps` are the snap.deps triples touching the hit, eids and all: an
        // endpoint's id and status come from fetching it, and a caller
        // rendering edges is fetching those rows anyway.
        let layers = (hits: Row[]) => {
          if (!backs && !edged) return hits.map((r) => jsonOf(r))
          let eids = hits.map((r) => r.eid)
          let deps = depsOf(db, eids).filter((d) =>
            reveal ||
            (!eager(db, d.parent).quarantined &&
              !eager(db, d.child).quarantined)
          )
          let mine = new Map<string, Dep[]>()
          for (let d of deps) {
            for (let e of [d.parent, d.child]) {
              if (mine.has(e)) mine.get(e)!.push(d)
              else mine.set(e, [d])
            }
          }
          let back = new Map<
            string,
            { from: string; via: string; title: string }[]
          >()
          if (backs) {
            let wanted = new Set(eids)
            // An edge is a reference like any other; its verb IS the `via`.
            let refs = [
              ...refsOf(db, eids).filter((r) =>
                reveal || !eager(db, r.from).quarantined
              ),
              ...deps.filter((d) => wanted.has(d.child))
                .map((d) => ({ from: d.parent, via: d.type, to: d.child })),
            ]
            // The title rides along because a backlink is READ, not chased:
            // the extension's "what references this page" panel is one query
            // or it is two, and the id alone would force the second.
            let named = new Map(
              rowsOf(db, [...new Set(refs.map((r) => r.from))])
                .map(rowed).map((r) => [r.eid, r]),
            )
            for (let { from, via, to } of refs) {
              let r = named.get(from)
              if (!r) continue // a comp row whose spine is gone names nobody
              let list = back.get(to) ?? []
              list.push({
                from: idOf(r),
                via,
                title: String(r.comps.doc?.title ?? ''),
              })
              back.set(to, list)
            }
          }
          return hits.map((r) => ({
            ...jsonOf(r),
            ...(edged ? { deps: mine.get(r.eid) ?? [] } : {}),
            ...(backs ? { backlinks: back.get(r.eid) ?? [] } : {}),
          }))
        }
        // Named entities are read one eager() each — a handful of keyed reads,
        // against a filter that would otherwise select everything and drag the
        // whole graph in behind it.
        // A dead entity is gone before this: every arm of locate() reads a
        // table whose row dies with it — the spine by num or by eid, and an
        // alias, which is a component of the entity it names — so `only`
        // holds live eids only and eager() always finds a spine.
        if (only) {
          let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
          let hits = [...only].map((eid) =>
            rowed({ eid, comps: eager(db, eid) })
          )
            .filter((r) => reveal || listed(r.comps, preds))
            .filter((r) => matchQuery(r.comps, preds, (e) => eager(db, e)))
          return Response.json(
            layers(screen(hits).sort((a, b) => a.num - b.num)),
          )
        }
        // The authoritative pipeline (evalGraph): the index answers when it can
        // (a one-row question cost a 27 MB snapshot and 0.29s before sql.ts,
        // 100x), else the JS matcher over the full universe — which now carries
        // the lazy entry partition whenever the query names it. kind screening,
        // hot ranking, and entry ordering/paging all settle inside evalGraph, so
        // this door and the in-process graph_query tool read one answer.
        let { hits } = evalGraph(db, q, kind, { after, limit })
        return Response.json(layers(hits))
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
        // session in x-via (the instrument), apply resolves it to the actor
        // it acts for, and an anonymous post falls back to the box owner.
        let out = apply(
          db,
          changes,
          t,
          req.headers.get('x-via'),
        )
        cast(out)
        effect(out, t)
        note(true)
        return Response.json({ ok: true, changes: out })
      }).catch((e) => {
        // The MESSAGE, not String(e) — a rejection is read by a person or
        // an agent, and `String(new Error(x))` prefixes a stray "Error:"
        // that the CLI then wraps again ("apply failed: Error: …").
        let why = e instanceof Error ? e.message : String(e)
        note(false, why)
        return new Response(why, { status: 400 })
      })
    }
    // The adapter table, for a browser that must offer what a spawn
    // request will be checked against (adapters.ts is server-only).
    if (path == '/providers') return Response.json(await readyProviders())
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
    // Both session substrates speak the same normalized log door: process
    // runs project their JSONL, graph runs project their ordered entries.
    let session = path.match(/^\/sessions\/([0-9a-f-]{36})\/logs$/)
    if (session) return Response.json(sessionLog(session[1], url.searchParams))
    // The wire's record, per entity (?eid=) or instrument (?via= — a
    // session's whole day, for the wrap ledger). Newest first. Raw eids
    // only — id resolution is a client concern.
    if (path == '/journal') {
      let via = url.searchParams.get('via')
      let limit = Number(url.searchParams.get('limit') ?? 50) || 50
      return Response.json(
        via
          ? journalBy(db, via, limit)
          : journalOf(db, url.searchParams.get('eid') ?? '', limit),
      )
    }
    if (path == '/freeze') {
      return freeze(url.searchParams.get('eid') ?? '', cast)
    }
    // A page as witnessed by a browser — the extension's write door
    // (page.ts owns what one filing IS).
    if (path == '/page' && req.method == 'POST') {
      return req.json().then((body) => filed(body, cast)).catch((e) =>
        new Response(e instanceof Error ? e.message : String(e), {
          status: 400,
        })
      )
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
bound(ownership)

// The curated effects — the graph's post-commit levers, one list, like
// Entity.tsx's renderer list. A session created with a spawn spec is a launch
// request; a stop_request is the brake; a comment at a settled managed
// session resumes it; a deleted session's process dies with its row.
// A future plugin contributes rows here the same way it would renderers.
on('session', {
  created: spawned(cast, managed.start),
  removed: (eid) => {
    managed.remove(eid)
    deleted(eid)
  },
  sweep: { pending: codexPending },
  doc: 'a session created with a spawn spec is a launch request — validate, ' +
    'launch the agent; a deleted session stops its runner or process',
})
on('session', {
  created: watched(cast),
  changed: { pid: watched(cast) },
  doc: 'a session that announced a provider process gets watched: say when ' +
    'the process leaves, counting its transcript if it wrote one (we never ' +
    'forked it, so there is no exit code to report)',
})
on('session', {
  changed: { turn: noticeAccepted(cast) },
  doc: 'a busy native-TUI turn after a submitted wake-up records acceptance; ' +
    'graph message content remains pending until task_context surfaces it',
})
on('stop_request', {
  created: stopped(cast),
  sweep: { pending: PENDING('stop_request') },
  doc: 'the brake: signal the targeted session to stop, settle delivered',
})
on('stop_request', {
  created: (eid, comp) => managed.stop(eid, String(comp.target)),
  sweep: { pending: PENDING('stop_request') },
  doc: 'a graph-native Codex stop appends cancellation, aborts its leased ' +
    'operation, and settles the stop request without a process signal',
})
on('role', {
  removed: roleRemoved(cast),
  doc: 'a removed persistent role closes its deterministic native tmux door; ' +
    'desired state reconciliation owns starts, stops, and configuration drift',
})
on('comment', {
  created: commented(cast),
  doc: 'a comment at a settled session resumes that agent with its ' +
    'unheard backlog',
})
on('comment', {
  created: (eid, comp) => managed.comment(String(comp.target), eid),
  doc: 'a comment at a graph-native Codex session appends content-free ' +
    'attention; task_context owns retrieval and acknowledgement',
})
on('comment', {
  created: obeyed(cast, () => codexAccount.status().then((s) => s.ready)),
  doc: 'a comment whose first line opens with `:` is a command line — ' +
    'run against its target, as its author, answered by an event comment',
})
on('task', {
  changed: { status: closingTask(cast) },
  doc: 'closing a task archives the correspondence about it — the ' +
    'letters and comments that were waiting at the moment it closed, ' +
    'never anything that arrives after',
})
on('knock', {
  created: knocked(cast),
  sweep: { pending: PENDING('knock') },
  doc: 'attention, resolved: cast to whoever is awake for the recipient, ' +
    'spawn a project operator onto the target, or mail an addressed ' +
    'person — settle delivered/error either way',
})
on('wake', {
  created: waking(cast),
  changed: { at: waking(cast) }, // a moved hour re-arms the timer
  // Not an outbox retry but the RECONCILE: boot hands back every wake
  // still owed, so an hour that passed while the server was down fires
  // now instead of vanishing.
  sweep: { pending: PENDING('wake') },
  doc: 'the timed knock: hold until `at`, then mint the knock and let ' +
    'the ladder deliver — one timer, re-armed at the earliest pending ' +
    'wake and reconciled at boot',
})
on('mail', {
  created: mailed(cast),
  // message_id marks INBOUND — a record of arrival the sweep must never
  // hand to delivery (mailed() guards the live path the same way).
  sweep: { pending: `message_id is null and ${PENDING('mail')}` },
  doc: 'deliver the mail — $TASKS_MAIL_CMD when set, else the native ' +
    'Cloudflare sender — resolve the address book reference, settle ' +
    'delivered/error and denormalize to_addr/sent_id (the envelope copy)',
})
on('comment', {
  created: fanout(cast),
  sweep: { pending: FANOUT_PENDING },
  doc: "a comment on an addressed project's task fans out as a " +
    'mail to that project (the about edge is the receipt)',
})
on('exception', {
  created: fileBug(cast),
  // Boot reconcile: every exception no bug yet points at re-drives the filer,
  // which dedups by key regardless — at-least-once, storm-proof (D-17077).
  sweep: { pending: HEAL_PENDING },
  doc: 'self-healing phase 1: an exception (break) facet files ONE deduped ' +
    'bug ticket per distinct fault (kind + normalized message + stack head); ' +
    'recurrences annotate the open ticket instead of multiplying it — no ' +
    'spawn yet (D-17077)',
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
// `task land` stops being a fast-forward and needs a rebase.
// That's the trade we take knowingly — one small commit per persona
// edit, so the rebase is always trivial.
let syncing: ReturnType<typeof setTimeout> | undefined
// Nobody reads this process's stdout. A sync that can't land — a tree
// behind its upstream, a push origin refused — is exactly the failure
// that decays into a hand repair months later, so every one of them is
// also a telemetry row: `task telemetry --errors` is where an operator
// meets it, and the graph's own writes stay unbothered either way.
let stuck = (e: unknown) => {
  console.warn('persona sync —', e)
  record(db, {
    source: 'srv',
    name: 'persona sync',
    ok: false,
    error: String(e),
  })
}
let syncSoon = () => {
  clearTimeout(syncing)
  syncing = setTimeout(async () => {
    try {
      let snap = snapshot(db)
      let files = projection(rows(snap), snap.deps, Date.now())
      for (let f of syncFiles(files).failed) stuck(f)
      // Every projection path, not just this tick's writes: a file some
      // earlier tick left dirty (untracked then, adopted since) is dirt
      // this tick can clear. commit() ignores whatever matches HEAD.
      for (let f of (await commit(files, 'personas: materialize')).failed) {
        stuck(f)
      }
    } catch (e) {
      stuck(e)
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
         join persona p on p.eid = d.parent where d.child = :e`,
    ).get({ e })
  )
on('persona', {
  created: syncSoon,
  // home is the persona's home project — re-homing it moves which
  // repo the file lands in, so it must re-render. NOT project: the
  // persona component has no such column (types.ts), and a changed
  // handler naming a column that isn't there never fires.
  changed: { home: syncSoon },
  removed: syncSoon,
  doc: "materialize personas into their projects' .tasks/ files " +
    '(write-if-changed; task sync --commit is the deliberate commit)',
})
on('dependency', {
  created: (eid, comp) => personaish(eid, comp.child as string) && syncSoon(),
  doc: 'a tier edge (or common flip) at a persona re-renders its files',
})
on('doc', {
  changed: {
    title: (eid) => personaish(eid) && syncSoon(),
    body: (eid) => personaish(eid) && syncSoon(),
  },
  doc: 'a doc edit on a persona or a tiered memory re-renders its files',
})
// Boot migrations may reshape those graph-owned teachings without an apply
// trace. Reconcile once here too, or the source migrates while its generated
// persona files keep teaching the retired vocabulary.
syncSoon()

// Managed children are detached (setsid) and this process restarts on every
// server-file edit — so booting means picking them back up: adopt the ones
// still alive, finalize the ones that died while we were away. Nothing here
// reaps a child; the watcher below must never learn how.
recover(cast)

// Every reconciler runs on a timer, which means nothing is holding its
// promise — and in Deno a rejection nobody handled ENDS THE PROCESS. A sweep
// that throws would take the server, and the server dying costs every
// operator (T-11139). So the guard is the SHAPE here, not a `.catch` each
// caller has to remember: four of the five sweeps below had forgotten it.
// `boot` runs the first pass now, as the boot-time reconcile most of them
// want; the returned runner is the debounce door for graph casts.
let tick = (name: string, sweep: () => unknown, ms: number, boot = true) => {
  let run = async () => {
    try {
      await sweep()
    } catch (e) {
      console.warn(`${name} sweep —`, e)
    }
  }
  if (boot) run()
  setInterval(run, ms)
  return run
}

// Native Codex panes have no content channel. Reconcile pending inboxes at
// boot and on a short tick; graph writes also debounce nativeSoon() through
// cast. Per-session submission/acceptance clocks bound swallowed-send retries.
// Moving time windows advance with no write behind them, so the subscriptions
// standing in one need a clock of their own. No boot pass: at boot there is
// nobody subscribed for it to serve.
tick('subs', () => aged(), 30_000, false)

tick('native', () => nativeSweep(cast), 2_000)

// Persistent roles are desired state: boot and the short tick heal a daemon
// restart or dead native TUI, while every graph cast debounces a faster pass.
tick('roles', () => rolesSweep(cast), 2_000)

tick('codex-runner', () => managed.sweep(), 300)

// What sessions leave running (probes.ts): a headless browser squatting on a
// CDP port, a probe server on a scratch db, a worktree with nothing left in
// it. SessionEnd cannot be this door — a killed session never fires one — so
// the sweep is a reconciler on a slow tick, reading /proc as it stands. Only
// the LIVE server sweeps: a probe server reaping its siblings would be the
// leak wearing a uniform. No boot pass — a restart is not new evidence.
//
// Unattended killing is OPT-IN (TASKS_SWEEP=1). The predicate is proven
// against one afternoon's /proc, and the operator door — `task probes`, which
// lists and only reaps when told — costs nothing to read for a week first. A
// false positive here is not a bug report, it is somebody's work gone with no
// one watching; the flag is what makes turning it on a decision.
if (mayStamp() && Deno.env.get('TASKS_SWEEP') == '1') {
  let repo = Deno.cwd()
  setInterval(async () => {
    try {
      let sessions = db.prepare('select eid, id, cwd, pid from session')
        .all() as {
          eid: string
          id: string
          cwd: string | null
          pid: number | null
        }[]
      // A graph-native session stays resumable until its log is terminal (a
      // final answer, nothing pending). The server holds the entry log, so it
      // spares a busy or waiting checkout and lets a settled one be collected —
      // regrown on the next turn if it comes back (T-16761).
      let resumable = (eid: string) => {
        let rows = readEntries(db, eid)
        return rows.length > 0 && !graphLog(rows).terminal
      }
      let seen = sweep(
        sessions.map((s) => ({ ...s, active: resumable(s.eid) })),
        repo,
      )
      let killed = await reapProbes(seen.verdicts)
      let gone = seen.trees.filter((t) => t.prune && pruneTree(repo, t.tree))
      for (let v of seen.verdicts.filter((v) => v.reap)) {
        console.log(`swept ${v.proc.pid} — ${v.why}`)
      }
      for (let t of gone) console.log(`swept ${t.tree.path} — ${t.why}`)
      if (killed.length || gone.length) {
        record(db, {
          source: 'http',
          name: 'probes',
          ok: true,
          detail: `${killed.length} process(es), ${gone.length} worktree(s)`,
        })
      }
    } catch (e) {
      console.warn('probe sweep —', e)
    }
  }, 10 * 60_000)
}

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
  tick('inbound', () => inboundSweep(cast), 10_000)
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
tick('scribe', () => scribeSweep(cast), 10 * 60_000)

// Embeddings (embed.ts): every non-comment doc keeps a semantic vector,
// refreshed a few seconds after its text moves — that's what lets a
// create reply say "this already exists" while the ink is still wet.
// Boot sweeps the backfill; the interval catches anything the debounce
// dropped. A box without the model sweeps zero rows, forever, silently.
let embedding = tick('embed', () => embedSweep(db), 10 * 60_000)
let embedSoon = (() => {
  let t: ReturnType<typeof setTimeout> | undefined
  return () => {
    clearTimeout(t)
    t = setTimeout(embedding, 3_000)
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
// The supervisor owns server-graph restarts. This watcher closes websockets
// promptly so browser clients poll toward the successor; HTTP keeps draining.
let shellish = (p: string) =>
  p.endsWith('/main.tsx') || p.endsWith('/live.ts') ||
  p.endsWith('/index.html') || p.includes('/vendor/')
let watch = async () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let batch = new Set<string>()
  for await (let e of Deno.watchFs(src)) {
    if (e.paths.some(serverFile)) {
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

// The supervisor's private rendezvous port arrives on ARGV, never the
// environment: an env var is inherited by every descendant, so a shell started
// under `deno task dev` hands the address to every probe server an agent spawns
// hours later — long after that supervisor is gone, and after the port may
// belong to a stranger. Argv is scoped to the one process meant to answer.
// And the signal is best effort: nobody listening is a normal condition, not
// something to serve requests and then die of.
let ready = async () => {
  let arg = Deno.args.find((a) => a.startsWith('--ready='))
  if (!arg) return
  try {
    let port = Number(arg.split('=')[1])
    using conn = await Deno.connect({ hostname: '127.0.0.1', port })
    await conn.write(new Uint8Array([1]))
  } catch (e) {
    console.warn('ready signal not delivered —', e)
  }
}

let draining = false
let drain = async () => {
  if (draining) return
  draining = true
  for (let c of clients) c.close(1012, 'server restart')
  await http.shutdown()
  // Let in-flight graph-native generations/calls finish and settle before we
  // go: the supervisor already has a successor serving the port, so this drain
  // is what keeps a source-edit handoff from killing a live codex turn.
  await managed.settle()
  await codexAccount.close()
  ownership.close()
  Deno.exit(0)
}

Deno.addSignalListener('SIGINT', drain)
Deno.addSignalListener('SIGTERM', drain)
booted()
await ready()
