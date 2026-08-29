// The whole backend in one Deno.serve: static files out of src/, TS/TSX
// translated to JS per-request (sucrase strips types + compiles JSX — no
// bundling, no type-checking; `deno task check` is the type gate), bare
// imports resolved by the import map in index.html to the vendored ESM in
// src/vendor/, the sync websocket, and a src/ watcher that hot-swaps
// clients: component edits re-import under a fresh ?v generation (state
// survives — it lives in live.ts, above the swap), css edits re-fetch the
// stylesheet, and only shell/server edits still cost a real reload.
import { transform } from 'sucrase'
import { dirname } from 'node:path'
import retiredDataDoorList from './retired_data_doors.json' with {
  type: 'json',
}
import { guard, type Serving } from './bind.ts'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { providers } from './adapters.ts'
import { capabilities, type Change, type Dep, idOf } from './types.ts'
import { type Mutation, mutationResult } from './mutation.ts'
import {
  apply,
  appPlane,
  buried,
  correct,
  cursorOf,
  depsOf,
  eager,
  epochOf,
  file as graph,
  human,
  journalBy,
  journalOf,
  locate,
  mutate,
  recast,
  redact as redactValue,
  refsOf,
  rowsOf,
  scanAnomalies,
  settingEid,
  settingValue,
  sweepSelect,
  textMatches,
  touch,
  writerUrl,
} from './db.ts'
import { db } from './live_db.ts'
import { catchup } from './catchup.ts'
import { published, withBackupLock } from './redaction.ts'
import { dbKids, type Subserve, subserve } from './subserve.ts'
import {
  configureEffects,
  dispatch,
  fed,
  relay,
  trace,
  type Where,
} from './effects.ts'
import {
  bootDoing,
  type Doing,
  splitEffects,
  tick,
  wireDoing,
} from './doing.ts'
import { registerSessionSource } from './source_session.ts'
import { registerCodexSource } from './source_codex.ts'
import { registerManagedSource } from './source_managed.ts'
import { freeze, serveFrozen, store } from './freeze.ts'
import { landBlob, serveBlob } from './blob.ts'
import { filed } from './page.ts'
import { fleetRaw, mailIdOf } from './inbound.ts'
import { FLOOR, setEmbedConfig, setModel, similarTo, textOf } from './embed.ts'
import { dbReads, type IO, mcpServer } from './mcp.ts'
import { drain as drainTurns } from './turn.ts'
import {
  maintainStandingFor,
  prepareWorktree,
  recoverWorktree,
} from './sessions.ts'
import { codexIssuer, codexStore } from './codex_auth.ts'
import { accountHttp, accountService } from './accounts.ts'
import { credentialHttp, credentialService } from './credentials.ts'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { managedCodex } from './managed_codex.ts'
import { sessionRow as storedSession } from './session_store.ts'
import { responses } from './responses.ts'
import { codexReadiness } from './codex_ready.ts'
import { type OllamaConfig, ollamaProbe, ollamaTransport } from './ollama.ts'
import { resolve, settingRows } from './config.ts'
import { codexGeneration } from './runner.ts'
import { type Observation, safeObservation } from './observations.ts'
import { outcome, recent, record, stats, toolCall } from './telemetry.ts'
import { stamp } from './hot.ts'
import { serverFile } from './reload.ts'
import { jsonOf, type Row } from './client.ts'
import {
  listed,
  matchQuery,
  nearOf,
  orderOf,
  parseQuery,
  resolveRefs,
  TEXT,
} from './query.ts'
import {
  evalAgg,
  evalBuildWork,
  evalGraph,
  rowed,
  workBlockers,
} from './graph_query.ts'
import { withResults } from './result_component.ts'
import { nativeSoon } from './tmux.ts'
import { loadPlugins, pluginSpecifiers } from './plugins.ts'
import { stop as stopTimers } from './timers.ts'

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
//
// Serving is per-connection (D-22388 step 4): each socket is served by ONE
// subserve instance — in its own Worker for a file-backed graph (own thread,
// own read-only connection, own query eval, so one client's expensive query
// never stalls another's), inline in this process for :memory: (a worker's
// separate connection would open a DIFFERENT empty graph) or when workers are
// unavailable. This process stays the one WRITER either way: a worker posts
// its client's batches back here, and every commit reaches the workers as a
// {cast} forward off the journal feed.
type Served = { sock: WebSocket; inline?: Subserve; worker?: Worker }
let served = new Set<Served>()

// Heartbeat: a half-open socket (network drop with no FIN, a suspended tab)
// stays OPEN on both ends, so neither onclose fires. A periodic app-level ping
// gives every client's watchdog guaranteed traffic to distinguish a QUIET graph
// from a DEAD socket — no ping for a while and the client force-reconnects
// (T-21511). The browser can't send native pings, so it's a plain data frame the
// client resets its watchdog on and never lands.
let PING = JSON.stringify({ ping: 1 })
let PING_MS = 25_000

// How long the delegator waits for a worker's {closed} ack before it force-
// terminates anyway (T-22658). The graceful close acks in microseconds; this
// deadline only bites a worker wedged mid-query, and matches the worker's own
// busy_timeout so a close queued behind one legitimate long read still lands.
let WORKER_CLOSE_MS = 5_000

// Observations belong only to connected readers of this Session partition.
// No cursor means no journal position, and this path never reaches apply(),
// cast(), snapshot(), or the browser's persistent landing branch. A worker
// socket is counted on the forward — the worker's own map decides delivery.
export let broadcastObservation = (value: Observation) => {
  let observation = safeObservation(value)
  if (!observation) return 0
  let frame = JSON.stringify({ observe: observation })
  let sent = 0
  for (let s of served) {
    if (s.sock.readyState != WebSocket.OPEN) continue
    try {
      if (s.inline) {
        if (s.inline.observe(frame, observation.session)) sent++
      } else {
        s.worker!.postMessage({ observe: frame, session: observation.session })
        sent++
      }
    } catch { /* a closing watcher loses an optional hint */ }
  }
  return sent
}

// The subscription machinery itself — Sub, control, maintain, aged, the live
// stream, the join handshake — lives in subserve.ts, one instance per socket,
// shared verbatim by the inline path and the per-connection workers. What
// remains here is the fan-out: iterate the served set, hand each connection
// the committed batch (inline directly, worker by message).

// Fold a committed batch into every INLINE connection's subscriptions —
// worker sockets hear the same batch through cast()'s forward. Exported for
// the subscription tests, which drive maintain() directly on :memory:.
export let maintain = (batch: Change[]) => {
  let cur = cursorOf(db)
  for (let s of served) {
    if (s.sock.readyState != WebSocket.OPEN) continue
    s.inline?.maintain(batch, cur)
  }
}

// The moving-time sweep (subserve.aged): every connection re-tests its own
// moving-window members against the clock — inline directly, workers by
// message. Exported for the subscription tests.
// App-plane compatibility mode (TASKS_PLANE=app, D-22804 §8 strangler) exists
// only for disposable parity databases; live_db.ts refuses owner data. Its
// handle is read-only, it never migrates, runs no boot write-reconcilers, and
// fires no effects. Read once here before cast/wantHere consult it at module
// load; the parity data plane is the bridge's /apply + /ws.
let appOnly = appPlane()

export let aged = (now = Date.now()) => {
  for (let s of served) {
    if (s.sock.readyState != WebSocket.OPEN) continue
    if (s.inline) s.inline.aged(now)
    else s.worker!.postMessage({ aged: now })
  }
}

let runnerSoon = () => {}

// Broadcast a committed batch to every connection — inline sockets serve it
// here (live stream + subscription fold, subserve.cast), worker sockets get
// it as a message and serve it on their own thread. The one door every write
// path (MCP, /apply, effects, touch, freeze) reaches subscribers through. A
// journal-fed cast stamps the ROW's rowid, so a client that disconnects
// mid-drain reconnects from exactly what it heard; a non-journaled cast
// (touch) keeps the current top.
let cast = (changes: Change[], except?: WebSocket, at?: number) => {
  let cursor = at ?? cursorOf(db)
  for (let s of served) {
    if (s.sock == except || s.sock.readyState != WebSocket.OPEN) continue
    if (s.inline) s.inline.cast(changes, cursor)
    else s.worker!.postMessage({ cast: changes, cursor })
  }
  // Native tmux delivery belongs to the doing owner: inline that's us; in
  // split mode the effects daemon's native tick sweeps, and two processes
  // driving send-keys would double-submit.
  if (!splitEffects() && !appOnly) nativeSoon(cast)
  // Maintain the native-session `standing` facet at the write edge (T-17855),
  // so SessionDot reads it O(1) instead of scanning the whole entry log per
  // render (157ms/dot). cast is the one door BOTH writers of turn-edge entries
  // funnel through — the runner (managed_codex, which never dispatches effects)
  // and the wire (/apply, MCP). A turn-edge batch re-derives standingOf over
  // the session's log once and stamps it; everything else is a cheap name
  // check. The stamp casts back as a `session` change (not a turn-edge comp),
  // so this cannot recurse.
  // The standing facet is a WRITE at the cast edge; the writer maintains it. An
  // app-plane reader only rebroadcasts the bridge's committed rows to its
  // sockets — it must not stamp (its handle is read-only anyway).
  if (!appOnly) maintainStandingFor(changes, cast)
}

// The effect half of a write, run AFTER the casts: a slow or failing
// handler can never hold the wire, and a failure is telemetry, not a
// broken batch (effects.ts owns the doctrine). In split mode
// (TASKS_EFFECTS=daemon) this process fires only the `where:'serve'` rows
// welded to its in-memory runner; the effects daemon owns the rest, off the
// same journal rows through its own cursor.
// An app-plane reader fires NO effects: the worldly half (`where:'do'`) is the
// effects daemon's, and the serve-side runner (`where:'serve'`) drives model
// turns that WRITE, which belongs to the writer side — so this process just
// broadcasts committed rows to its sockets and dispatches nothing.
let wantHere: (w: Where) => boolean = appOnly
  ? () => false
  : splitEffects()
  ? (w) => w == 'serve'
  : () => true
let effect = (out: Change[], t: ReturnType<typeof trace>) => {
  dispatch(out, t, (comp, e) =>
    record(db, {
      source: 'http',
      name: `effect:${comp}`,
      ok: false,
      error: String(e),
    }), wantHere)
}

// The journal feed (D-22388 step 1): the one path every JOURNALED commit takes
// to the sockets and the effect registry — the server's own writes (their
// doors call feed.settle() right after apply(), keeping today's synchronous
// ordering) and a foreign process's (data_version polling wakes the same drain),
// uniformly. Effects fire only for rows journaled with a fed() trace — the
// configured driver DEFERRED here — so effect-free runner applies and ordinary
// record() stamps broadcast without dispatching. Dispatch reads the journal's
// canonical batch, not recast()'s extra cache-convergence echoes, so one commit
// remains one effect ask even when a stamped component is re-read for sockets.
// Handler-internal casts (sessions.ts, managed_codex.ts, …) still cast
// directly; their journaled rows re-broadcast once when the feed passes them —
// idempotent by the wire's contract ("applying the same patch twice is
// harmless") — and migrate onto the feed with the effects-daemon extraction
// (D-22388 step 3).
let feed = catchup(db, (r) => {
  let changes = recast(db, r)
  cast(changes, undefined, r.rowid)
  if (r.trace) effect(r.batch, r.trace)
})
feed.watch(graph)
configureEffects({
  split: splitEffects(),
  want: wantHere,
  settle: feed.settle,
  oops: (comp, e) =>
    record(db, {
      source: 'http',
      name: `effect:${comp}`,
      ok: false,
      error: String(e),
    }),
})

// A write batch from one socket, applied HERE — the writer process — whichever
// side served the socket. {apply, id} is a batch wearing a delivery id
// (T-21413): the ack is what lets a client HOLD each write in its outbox until
// commit instead of firing and forgetting; a bare array (an older tab) still
// applies, it just gets no ack. A refusal answers with a SCOPED re-sync of
// just the eids it touched — the authoritative pre-batch state (M-21143),
// never a whole-graph snapshot. The commit reaches every socket — the sender
// included, which hears the canonical patch — through the journal feed, same
// as a foreign writer's would.
let applyFrom = (
  socket: WebSocket,
  writer: string | null,
  sent: Change[],
  id?: string,
) => {
  // App-plane-only: this reader can't commit, so the /ws write is forwarded to
  // the bridge writer (T-22927). The forward is async (a network hop) and sends
  // its own ack/reject on the socket, so fire it and return — the same shape as
  // the local path, whose broadcast is likewise async (the feed watcher casts
  // the bridge's committed rows to EVERY socket, this one included, so on
  // success we only ack). This keeps the kept web UI writing on a demoted Deno.
  if (appOnly) {
    proxyApplyFrom(socket, writer, sent, id)
    return
  }
  try {
    apply(db, sent, fed(), writer)
  } catch (e) {
    console.error('sync: bad batch dropped —', e)
    socket.send(JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
      changes: correct(db, sent),
      id,
    }))
    return
  }
  if (id) socket.send(JSON.stringify({ ack: id }))
  feed.settle()
}

// Forward a /ws write batch to the bridge /apply and relay the outcome to the
// originating socket. Mirror of applyFrom's success/reject shape: the bridge
// answers 200 with `{ok, changes}` (committed — the feed delivers those rows to
// the sockets, so we just ack), or a 4xx/5xx whose body is the reason, which we
// hand back beside this reader's own `correct()` of the sent rows.
let proxyApplyFrom = async (
  socket: WebSocket,
  writer: string | null,
  sent: Change[],
  id?: string,
) => {
  let r = await postToWriter('/apply', writer, JSON.stringify(sent))
  if (r.status >= 200 && r.status < 300) {
    if (id) socket.send(JSON.stringify({ ack: id }))
    // Nudge the feed to drain the bridge's just-committed rows promptly rather
    // than waiting on the next poll; the cast to every socket follows.
    feed.settle()
    return
  }
  console.error('sync: bridge rejected batch —', r.text)
  socket.send(JSON.stringify({ error: r.text, changes: correct(db, sent), id }))
}

let workerN = 0
// Per-WS workers are ON by default (T-22658): they open read-only
// (readOnly:true) and cannot write a page. The fd leak that made re-enabling wait is fixed above
// (graceful {close} teardown). TASKS_WS_WORKERS=0 is the escape hatch back to
// inline serving if one is ever needed.
let workersWanted = Deno.env.get('TASKS_WS_WORKERS') != '0'
let ws = (req: Request) => {
  let { socket, response } = Deno.upgradeWebSocket(req)
  // The tab names itself once, at connect: ?client=<eid> is the writer for
  // every batch on this socket, so a browser write journals a resolved
  // actor instead of nothing (T-6669). A tab that names none resolves to
  // the box owner like any anonymous write.
  let writer = new URL(req.url).searchParams.get('client')
  // No implicit join: a fresh socket is in NO broadcast set until it declares
  // itself — {since} opens the live stream, {sub} the subscriptions (both in
  // subserve). A socket that declares neither hears nothing.
  let beat = setInterval(() => {
    if (socket.readyState == WebSocket.OPEN) socket.send(PING)
    else clearInterval(beat)
  }, PING_MS)
  // The delegator split: a file-backed graph hands the connection to its own
  // worker — its own thread, its own read-only connection — and this process
  // only pumps frames and applies writes. ON by default; the 2026-08-26 live
  // corruption briefly forced this inline while workers were the suspect, but
  // their connections are read-only and the teardown fd leak is fixed
  // (graceful {close} below). :memory: always serves
  // inline (a worker's separate connection would open a DIFFERENT empty graph),
  // as does any environment where the Worker fails to construct, and — loudly —
  // any socket whose worker reports its connection dead: the delegator closes
  // that socket so the client reconnects onto an inline serve, and no join can
  // die silently again.
  let s: Served = { sock: socket }
  // Graceful worker teardown (T-22658): Worker.terminate() leaks the worker's
  // sqlite fds, so ask the worker to close its own connection ({close}) and
  // terminate only on its {closed} ack — or after a deadline, so a wedged worker
  // still cannot outlive its socket. Idempotent: the dead-worker path and the
  // socket's onclose can both reach shut().
  let closedAck = () => {}
  let shutting = false
  let shut = () => {
    let w = s.worker
    if (!w || shutting) return
    shutting = true
    let torn = false
    let kill = () => {
      if (torn) return
      torn = true
      w.terminate()
    }
    let timer = setTimeout(kill, WORKER_CLOSE_MS)
    closedAck = () => {
      clearTimeout(timer)
      kill()
    }
    w.postMessage({ close: true })
  }
  if (workersWanted && graph != ':memory:') {
    try {
      let w = new Worker(new URL('./wsworker.ts', import.meta.url), {
        type: 'module',
        name: `ws#${++workerN}`,
      })
      w.postMessage({ init: graph })
      w.onmessage = (m) => {
        let d = m.data
        if (typeof d?.frame == 'string') {
          if (socket.readyState == WebSocket.OPEN) socket.send(d.frame)
        } else if (Array.isArray(d?.apply)) {
          applyFrom(socket, writer, d.apply as Change[], d.id)
        } else if (d?.closed) {
          closedAck()
        } else if (typeof d?.dead == 'string') {
          // The worker's connection failed (its init, or a read mid-serve).
          // Serving would be silence; kill the pair and let the client's
          // reconnect land on an inline serve — workersWanted flips off for
          // the process, one failure is enough.
          console.error(
            `wsworker dead — serving inline from here on: ${d.dead}`,
          )
          workersWanted = false
          shut()
          socket.close(1012, 'resubscribe')
        }
      }
      w.onerror = (e) => console.warn('wsworker error —', e.message)
      s.worker = w
    } catch (e) {
      console.warn('ws: worker unavailable, serving inline —', e)
    }
  }
  if (!s.worker) {
    s.inline = subserve(db, (json) => {
      if (socket.readyState == WebSocket.OPEN) socket.send(json)
    })
  }
  served.add(s)
  socket.onclose = () => {
    clearInterval(beat)
    served.delete(s)
    shut()
  }
  socket.onmessage = (m) => {
    let raw = String(m.data)
    // Worker mode: the whole frame goes to the worker; it parses, serves
    // reads itself, and posts write batches back to applyFrom above.
    if (s.worker) return s.worker.postMessage({ raw })
    let frame = JSON.parse(raw)
    // Object frames are control, structurally disjoint from the array
    // batches: {since}/{sub}/{unsub} go to subserve, writes apply here. The
    // inline join drains the feed first, so a foreign commit the watcher
    // hasn't settled yet can't arrive twice.
    if (Array.isArray(frame)) {
      return applyFrom(socket, writer, frame as Change[])
    }
    if (Array.isArray(frame.apply)) {
      return applyFrom(
        socket,
        writer,
        frame.apply as Change[],
        frame.id != null ? String(frame.id) : undefined,
      )
    }
    s.inline!.frame(frame, () => feed.settle())
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
let graphIO: IO = {
  // Local and stdio MCP share these exact SQLite readers. The remaining
  // capabilities below are service-owned mutations or external operations.
  ...dbReads(db),
  // deno-lint-ignore require-await
  write: async (mutation, via) => {
    if (appOnly) refuseWrite()
    let out = mutationResult(mutate(db, mutation, fed(), via))
    feed.settle()
    return out
  },
  upload: async (eid, html) => {
    if (appOnly) refuseWrite()
    // store() journals its stamp (record); the feed carries it to the sockets.
    let res = await store(eid, html, () => feed.settle())
    if (!res.ok) throw new Error(await res.text())
  },
  // The one writer of recall stats: stamp, then cast, so every cache hears
  // the new warmth (the apply wire refuses these rows).
  // deno-lint-ignore require-await
  touch: async (eids, confirm) => {
    // Recall warmth is a WRITE (unjournaled, but still a row edit), so the
    // read-only app-plane reader skips it silently — a read must never fail
    // because it tried to bump recall stats. The writer owns warmth.
    if (appOnly) return
    // Recall touches are deliberately NOT journaled (reading is not editing),
    // so they cannot ride the feed: the direct cast is their only delivery,
    // live-only by design.
    let out = touch(db, eids, confirm)
    if (out.length) cast(out)
  },
  providers: () => readyProviders(),
}

let codexAccount = accountService(codexStore(), codexIssuer())

// Ollama's base URL, resolved at each request boundary: graph override (read
// live from the setting table) > environment > catalog default. The transport
// and the readiness probe share this one resolver, so a saved base reaches the
// next request and the next test alike, with no tasksd restart (T-18303).
let ollamaBase = () =>
  resolve('OLLAMA_BASE_URL', (key) => settingValue(db, key)).value!

// The server-only credential store (T-18302): the secret plane of the config
// catalog. Its bytes never enter the graph, the wire, or a child environment;
// the HTTP surface below returns only state, never a value. Its `test` action
// runs the provider-safe Ollama probe, which reaches the same resolved base.
let credentials = credentialService(
  undefined,
  undefined,
  ollamaProbe(ollamaBase),
)

// The transport's config view: base from the shared resolver, key from the
// server-only store — read fresh per request, never cached across generations.
let ollamaConfig: OllamaConfig = {
  base: ollamaBase,
  key: () => credentials.secret('OLLAMA_API_KEY'),
}

// The embed transport shares that config view, and its model resolves through
// the graph plane too (OLLAMA_EMBED_MODEL override>env>default). Injected once
// at boot: the embed sweep and similarity-ranked /query run in this process, so a saved
// override reaches them, and MODEL is fixed for the process (a change is a
// deliberate corpus re-embed, T-22784 / D-22781).
setEmbedConfig(ollamaConfig)
setModel(resolve('OLLAMA_EMBED_MODEL', (key) => settingValue(db, key)).value!)

// How long a provider exchange may make no progress — no headers, no first
// frame, no next frame — before the transport aborts it as stalled. A hung
// Responses bus otherwise renews its lease forever and strands the generation
// `running` with no error (T-24135); five silent minutes is a strong stall
// signal even for a high-effort turn whose reasoning streams nothing.
let stallMs = Number(Deno.env.get('CODEX_STALL_MS') ?? 300_000)
let codexTransport = responses({
  credentials: codexAccount.credentials,
  headers: { originator: 'tasks', version: '0' },
  retries: 1,
  stallMs,
})
// The adapter table stamped with live readiness: the graph-native Codex
// transport is ready only when its account is signed in AND its Responses bus
// answers, so every server-side spawn default (obey, MCP, CLI) routes
// graph-native → CLI fallback off this one probe instead of reading the account
// again at each door. Creds alone left a wedged bus in the rotation (T-24135).
let codexReady = codexReadiness(
  () => codexAccount.status(),
  () => codexTransport.reach(),
)
let readyProviders = async () => {
  let ok = await codexReady()
  return providers((name) => name != 'codex' || ok)
}
let managed = managedCodex({
  db,
  cast,
  transport: codexTransport,
  generators: {
    ollama: codexGeneration(
      ollamaTransport({ retries: 1, stallMs }, ollamaConfig),
    ),
  },
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

// A CLI grammar refusal is caller feedback, not a broken Session. Keep the
// invocation durably in telemetry so the grammar and manual can improve,
// without stamping `exception` and summoning self-healing for a mistype.
let cliUsage = async (req: Request) => {
  try {
    let b = JSON.parse(await bounded(req, 16 * 1024))
    let args = Array.isArray(b.args) ? b.args.map(String) : []
    let session = b.session == null ? null : String(b.session)
    let error = String(b.error ?? 'invalid CLI usage')
    record(db, {
      source: 'cli',
      name: 'usage',
      session_id: session,
      ok: false,
      error,
      detail: JSON.stringify(args),
    })
  } catch (e) {
    console.warn('CLI usage report dropped —', e)
  }
  return new Response(null, { status: 204 })
}

// Requests become eligible only after boot reconciliation. The supervisor
// starts no replacement until this process has drained and exited.
let booted: () => void = () => {}
let boot = new Promise<void>((resolve) => booted = resolve)
let port = Number(Deno.env.get('PORT') ?? 5173)
// Whose graph holds this address (src/bind.ts). Any occupied port is refused:
// one address has exactly one serving process.
let serving: Serving = { db: graph, epoch: epochOf(db), pid: Deno.pid }
let refuseWrite = (): never => {
  throw new Error(
    'app-plane-only mode (TASKS_PLANE=app): writes go to the data-plane ' +
      'writer (the Rust bridge /apply), not this Deno server',
  )
}
// The graph-mutating HTTP doors, named once. /error and /usage are excluded on
// purpose: they only record() telemetry, which swallows a read-only failure and
// never touches the graph. /ws and /mcp are mixed read/write doors and refuse
// writes at their own seams (applyFrom, graphIO.write/upload).
let writeDoor = (method: string, path: string): boolean =>
  (method == 'GET' && path == '/freeze') ||
  (method == 'POST' &&
    (path == '/apply' || path == '/redact' ||
      path == '/page' || path == '/upload' || path == '/blob'))

let methodNotAllowed = (allow: string) =>
  Response.json({ error: { code: 'method_not_allowed' } }, {
    status: 405,
    headers: { allow },
  })

// The strangler write-proxy (T-22927): in TASKS_PLANE=app this reader forwards a
// write to the data-plane writer (the Rust bridge) and hands its answer back
// untouched — the Deno→bridge mirror of the bridge's own proxy_apply (main.rs).
// It is a NETWORK HOP, never a local write: the db handle stays read-only.
// Production refuses this mode on the owner graph; disposable parity copies
// may exercise it. `fetch` does not throw on a 4xx/5xx (unlike the bridge's ureq,
// which needs http_status_as_error(false) to match), so a rejected batch's body
// — the guard-stale reason, the claim bounce — relays like any other answer.
let noWriter = () =>
  'app-plane-only mode (TASKS_PLANE=app) has no data-plane writer to forward ' +
  'to — set TASKS_WRITER_URL to the Rust bridge (never this reader itself)'
// POST a body to one of the writer's doors, returning its raw reply as (status,
// content-type, text) — the same three surfaces the bridge relays. x-via (the
// honesty header apply resolves to an actor) and the content-type ride along.
let postToWriter = async (
  path: string,
  via: string | null,
  body: BodyInit,
  contentType = 'application/json',
): Promise<{ status: number; type: string; text: string }> => {
  let base = writerUrl()
  if (!base) return { status: 503, type: 'text/plain', text: noWriter() }
  let url = base + path
  let headers: Record<string, string> = { 'content-type': contentType }
  if (via) headers['x-via'] = via
  try {
    let r = await fetch(url, { method: 'POST', headers, body })
    return {
      status: r.status,
      type: r.headers.get('content-type') ?? 'application/json',
      text: await r.text(),
    }
  } catch (e) {
    let why = e instanceof Error ? e.message : String(e)
    return {
      status: 502,
      type: 'text/plain',
      text: `app-plane proxy to ${url} failed: ${why}`,
    }
  }
}
// The HTTP-door proxy: forward this request's raw body to the matching bridge
// door and relay status + content-type + body verbatim. Only /apply has a bridge
// door today; the other mutating doors have none yet (their follow-on), so the
// caller keeps refusing them.
let proxyWriteDoor = async (req: Request, path: string): Promise<Response> => {
  let body = await req.arrayBuffer()
  let r = await postToWriter(
    path,
    req.headers.get('x-via'),
    body,
    req.headers.get('content-type') ?? 'application/json',
  )
  return new Response(r.text, {
    status: r.status,
    headers: { 'content-type': r.type },
  })
}
let portOwnership: Deno.FsFile
try {
  portOwnership = await guard(port, graph)
} catch (e) {
  console.error(`tasks: ${(e as Error).message}`)
  Deno.exit(1)
}

// Dial the supervisor's private --ready port and write one byte. The port
// arrives on ARGV, never the environment: an env var is inherited by every
// descendant, so a shell under `deno task dev` would hand the address to every
// probe server an agent spawns hours later — long after that supervisor is
// gone, and after the port may belong to a stranger. Argv is scoped to the one
// process meant to answer. Best effort: nobody listening (a hand-run server) is
// normal, not a reason to die. The server sends one beat after it is ready.
let signalReady = async () => {
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

// Load configured plugins into THIS process before serving, so a plugin's
// server-side registrars (effects via on(), a comps fragment) are in place when
// the first request lands (D-18663 seam 1). Inert by default: no TASKS_PLUGINS
// means an empty list and no imports.
let specs = pluginSpecifiers()
await loadPlugins(specs)
// The BROWSER can't read the environment, so the server hands it the list. Only
// plugins served from this repo's `plugins/` dir are browser-reachable (the
// on-the-fly src server transforms them like any TS — no bundler); npm:/jsr:/
// remote specifiers stay server-only. specs are resolved file:// URLs, so the
// browser path is what sits under the repo root. Empty by default, so the shell
// below is served byte-for-byte as today.
let repo = new URL('..', import.meta.url).pathname
let repoUrl = new URL('..', import.meta.url).href
let browserPlugins = specs
  .filter((s) => s.startsWith(`${repoUrl}plugins/`))
  .map((s) => `/${s.slice(repoUrl.length)}`)

// Retired graph-data doors must answer as API misses instead of falling through
// to the SPA's convincing 200. Their capabilities live at the generic graph
// boundaries now. The shared manifest is also compiled into yak-bridge, so an
// older app-plane process behind its fallback cannot revive one of them.
export let retiredDataDoors = new Set(retiredDataDoorList)

// The request handler, DEFINED here but not yet listening. The bind happens at
// the bottom of boot (just before booted()), after migration and reconciliation,
// so the first accepted request can be answered immediately.
let handle = async (req: Request) => {
  let url = new URL(req.url)
  let path = url.pathname
  // Answered BEFORE boot: a peer deciding whether it may join this address
  // must hear whose graph is here without waiting out our migrations.
  if (path == '/graph') return Response.json(serving)
  await boot
  // App-plane-only: the graph-mutating HTTP doors don't write HERE — this
  // process is a reader beside the bridge writer (D-22804 §8). /apply forwards
  // to the bridge and relays its answer (T-22927), so the kept surfaces keep
  // writing; the other mutating doors have no bridge route yet and still 503
  // (their follow-on). (/ws writes proxy at applyFrom; MCP writes refuse at their
  // own seam; the telemetry doors /error+/usage stay open — record() swallows on
  // read-only.)
  if (appOnly && writeDoor(req.method, path)) {
    if (path == '/apply') return proxyWriteDoor(req, path)
    return new Response(
      'app-plane-only mode (TASKS_PLANE=app): this write door has no data-plane ' +
        'route yet — writes go to the Rust bridge, not this Deno server',
      { status: 503 },
    )
  }
  if (path.startsWith('/accounts/codex')) {
    return accountHttp(codexAccount, req, path)
  }
  if (path.startsWith('/config/credentials')) {
    return credentialHttp(credentials, req, path)
  }
  // The non-secret plane's source report (T-18590): each catalog setting's
  // effective value + which plane answered + the existing setting eid a client
  // save targets. GET-only, no-store; secrets never appear (settingRows is
  // plainKeys only) — their state lives at /config/credentials.
  if (path == '/config/settings') {
    if (req.method != 'GET') {
      return Response.json({ error: { code: 'method_not_allowed' } }, {
        status: 405,
        headers: { 'cache-control': 'no-store' },
      })
    }
    return Response.json(
      settingRows(
        (key) => settingValue(db, key),
        (key) => settingEid(db, key),
      ),
      { headers: { 'cache-control': 'no-store' } },
    )
  }
  if (path == '/ws') return ws(req)
  // The advertised capability tokens, cheaply — a headless spawn door
  // (client.ts serverCaps) reads this to decide whether to speak canonical
  // `spawn` without paying for a whole snapshot — and the reachability
  // HEAD the browser's reload gate pings.
  if (path == '/capabilities') return Response.json(capabilities)
  // The graph's storage-integrity anomalies (D-18866): orphaned component rows
  // and dangling {eid} references — both wire-invisible, so the doctor cannot
  // see them through /query and reads this raw db scan instead. Read-only.
  if (path == '/integrity') return Response.json(scanAnomalies(db))
  if (path == '/work-blockers') {
    if (req.method != 'GET') return methodNotAllowed('GET')
    let parents = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
    let limit = Number(url.searchParams.get('limit')) || 20
    return Response.json(
      workBlockers(db, parents, limit).map((set) => ({
        parent: set.parent,
        items: set.items.map((row) => jsonOf(row)),
        truncated: set.truncated,
      })),
    )
  }
  if (path == '/query') {
    if (req.method != 'GET') return methodNotAllowed('GET')
    // The graph over plain GET: the query string IS the filter line —
    // the same grammar boards and task_list speak — and hits come back
    // Structured like every entity JSON door. Kind is a filter now, not a
    // parameter: `.kind=project` screens by derived kind through the grammar.
    // `backlinks=1` adds who points at each hit (eid columns + edges),
    // `deps=1` the hit's own edges both ways; `id=` names entities outright.
    // A malformed filter is the typist's news, not a server error.
    try {
      let segs = url.search.slice(1).split('&').filter(Boolean)
        .map(decodeURIComponent)
      let backs = segs.includes('backlinks=1')
      let edged = segs.includes('deps=1')
      let reveal = segs.includes('quarantined=1')
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
      let work = segs.find((s) => s.startsWith('work='))?.slice(5)
      let recursive = segs.includes('recursive=1')
      // `id=` FETCHES rather than filters: each value is an ADDRESS — T-3, a
      // bare num, an alias slug, a uuid — and locate() is the index's own
      // reading of "what names an entity", the same four rules find() spells
      // over a materialized graph. It is a parameter beside backlinks=
      // rather than a predicate because addressing is not filtering:
      // `.entity.eid~=abc` would be a substring search over uuids, legal and
      // meaningless.
      //
      // An id naming nothing is simply absent, the way a filter matching
      // nothing returns no rows — a caller asking for five and getting three
      // learns which two are gone by their absence.
      let named = segs.filter((s) => s.startsWith('id='))
        .flatMap((s) => s.slice(3).split(',')).filter(Boolean)
      let only = named.length
        ? new Set(
          (named.map((i) => locate(db, i)).filter(Boolean) as string[])
            .filter((eid) => !buried(db, eid)),
        )
        : null
      segs = segs.filter((s) =>
        s != 'backlinks=1' && s != 'deps=1' && s != 'quarantined=1' &&
        !s.startsWith('after=') &&
        !s.startsWith('limit=') &&
        !s.startsWith('work=') &&
        s != 'recursive=1' &&
        !s.startsWith('id=')
      )
      let q = segs.join('&')
      let asked = q.trim()
        ? resolveRefs(parseQuery(q), (id) => locate(db, id))
        : []
      // An aggregate projection (`.count!` / `.distinct=col` / `.tally=col`)
      // answers with the reduction, not a row set — the census asks for values,
      // so rows, layers and id= addressing don't apply. Keys come back sorted
      // the way the census always has; `.count!` is one number under `count`.
      let agg = evalAgg(db, q)
      if (agg) {
        if (agg.op == 'count') {
          return Response.json({ count: agg.values.get('') ?? 0 })
        }
        let keys = [...agg.values.keys()].sort()
        return Response.json(
          agg.op == 'distinct' ? { distinct: keys } : {
            tally: Object.fromEntries(
              keys.map((k) => [k, agg.values.get(k)]),
            ),
          },
        )
      }
      // Any remaining filter line still screens, so `id=` composes with the
      // grammar rather than replacing it.
      let screen = (hits: Row[]) =>
        only ? hits.filter((r) => only.has(r.eid)) : hits

      // Semantic retrieval is a ranking of ordinary entities, so it shares
      // /query and projects the same transient rank facet as FTS. `.near=`
      // lets an entity supply its current doc and reusable stored vector; bare
      // text remains available for an arbitrary query. The embedding provider
      // is external I/O, so this is deliberately the one query evaluator the
      // Deno app plane owns while both runtimes keep ordinary reads local.
      let semantic = orderOf(asked) == 'similar'
      let semanticHits: Row[] | undefined = semantic
        ? await (async () => {
          let near = nearOf(asked)
          let eid = near ? locate(db, near) : undefined
          let comps = eid ? eager(db, eid) : undefined
          let text = eid
            ? textOf(comps?.doc?.title, comps?.doc?.body)
            : asked.filter((p) => p.op == TEXT).map((p) => p.value).join(' ')
          if (!text) return []
          let found = await similarTo(db, text, limit ?? 8, FLOOR, eid)
          return (found ?? []).map((h) => {
            let row = rowed({ eid: h.eid, comps: eager(db, h.eid) })
            row.comps.rank = {
              score: h.score,
              open: h.eid,
              title: String(row.comps.doc?.title ?? ''),
            }
            return row
          })
        })()
        : undefined
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
        let eids = hits.map((r) => r.eid)
        if (!backs && !edged) {
          return hits.map((r) => jsonOf(r))
        }
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
      // A dead entity is gone before this: `only` was built above with the
      // tombstone excluded (buried), so it holds live eids only and eager()
      // always finds a spine with components. Since the D-18866 flip retains a
      // tombstoned spine row, that exclusion is explicit rather than a side
      // effect of delete removing the row.
      if (only) {
        // `id=` already SELECTED; a remaining filter only screens. No
        // remaining filter means no screen — an empty QUERY would select
        // nothing, so this door states its meaning before parsing.
        let preds = asked
        let hits = withResults(
          db,
          preds,
          [...only].map((eid) => rowed({ eid, comps: eager(db, eid) })),
        )
          .filter((r) => reveal || listed(r.comps, preds))
          .filter((r) =>
            matchQuery(
              r.comps,
              preds,
              (e) => eager(db, e),
              undefined,
              dbKids(db, (e: string) => eager(db, e)),
              undefined,
              (eid, p) => textMatches(db, eid, p),
            )
          )
        return Response.json(
          layers(screen(hits).sort((a, b) => a.num - b.num)),
        )
      }
      if (work) {
        if (work != 'build') throw new Error(`unknown work lane: ${work}`)
        return Response.json(layers(evalBuildWork(db, q, {
          limit,
          recursive,
        })))
      }
      // The authoritative pipeline (evalGraph): the index answers when it can
      // (a one-row question cost a 27 MB snapshot and 0.29s before sql.ts,
      // 100x), else the JS matcher over the full universe — which now carries
      // the lazy entry partition whenever the query names it. Kind is a filter
      // in q now (`.kind=`), hot ranking and entry ordering/paging all settle
      // inside evalGraph, so this door and the in-process graph_query tool
      // read one answer.
      let hits = semanticHits ?? evalGraph(db, q, { after, limit }).hits
      return Response.json(layers(hits))
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 400 })
    }
  }
  if (path == '/mcp' && req.method == 'POST') return mcp(req)
  if (path == '/error' && req.method == 'POST') return clientError(req)
  if (path == '/usage' && req.method == 'POST') return cliUsage(req)
  if (path == '/telemetry') {
    let since = url.searchParams.get('since') ?? undefined
    let only = url.searchParams.get('only') ?? undefined
    // ?stats=1 asks for the latency distribution (p50/p95/p99 per door+tool,
    // computed in SQL) instead of the raw rows.
    if (url.searchParams.get('stats')) {
      return Response.json(stats(db, { since, only }))
    }
    return Response.json(recent(db, {
      since,
      limit: Number(url.searchParams.get('limit')) || undefined,
      only,
    }))
  }
  // HTTP writes (the CLI and MCP server): same apply, same allowlist,
  // same broadcast — an HTTP client is just a client without a socket.
  if (path == '/apply') {
    if (req.method != 'POST') return methodNotAllowed('POST')
    let t0 = performance.now()
    let name = 'apply'
    let note = (ok: boolean, error?: string) =>
      record(db, {
        source: 'http',
        name,
        ok,
        ms: performance.now() - t0,
        error,
      })
    return req.json().then((mutation: Mutation) => {
      if (!Array.isArray(mutation) && 'mutation' in mutation) {
        name = mutation?.mutation == 'undo' ? 'undo' : 'mutation'
      }
      // Attribution is an honesty header, not auth: the CLI names its
      // session in x-via (the instrument), apply resolves it to the actor
      // it acts for, and an anonymous post falls back to the box owner.
      let out = mutationResult(mutate(
        db,
        mutation,
        fed(),
        req.headers.get('x-via'),
      ))
      feed.settle()
      note(true)
      return Response.json(
        !Array.isArray(mutation) && 'entities' in mutation
          ? { ok: true, ...out }
          : { ok: true, changes: out.changes },
      )
    }).catch((e) => {
      // The MESSAGE, not String(e) — a rejection is read by a person or
      // an agent, and `String(new Error(x))` prefixes a stray "Error:"
      // that the CLI then wraps again ("apply failed: Error: …").
      let why = e instanceof Error ? e.message : String(e)
      note(false, why)
      return new Response(why, { status: 400 })
    })
  }
  // Value redaction is the one write that reaches backward into the journal.
  // Hold backup's process lock from the atomic database scrub through the
  // upstream-history report, so no pre-scrub snapshot can publish after the
  // answer. The removed value rides only the POST body and db transaction —
  // never a URL, diagnostic, telemetry row, git argv, or response.
  if (path == '/redact' && req.method == 'POST') {
    let t0 = performance.now()
    try {
      let body = await req.json() as { id?: string; selector?: string }
      if (!body.id || body.selector == null) {
        throw new Error('redact needs an id and selector')
      }
      let done = await withBackupLock(dirname(graph), async () => {
        let result = redactValue(
          db,
          body.id!,
          body.selector!,
          req.headers.get('x-via'),
        )
        // The redaction journaled its own row (with an empty trace, so the
        // feed reproduces the old changed-handler-only dispatch).
        feed.settle()
        let backup
        try {
          backup = await published(dirname(graph), result.firstSeen)
        } catch (e) {
          backup = { ref: null, error: String(e) }
        }
        return {
          ...result,
          audit: human(db, result.audit),
          target: human(db, result.target),
          backup,
        }
      })
      record(db, {
        source: 'http',
        name: 'redact',
        ok: true,
        ms: performance.now() - t0,
      })
      return Response.json(done)
    } catch (e) {
      let why = e instanceof Error ? e.message : String(e)
      record(db, {
        source: 'http',
        name: 'redact',
        ok: false,
        ms: performance.now() - t0,
        error: why,
      })
      return new Response(why, { status: 400 })
    }
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
  // The wire's record, per entity (?eid=) or instrument (?via= — a
  // session's whole day). Raw eids only — id resolution is a client concern.
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
  // Attach a file: the raw body IS the bytes, its content-type the mime,
  // ?name= the filename, ?eid= the entity to attach to (a fresh uuid mints
  // a bare file entity). landBlob stores the bytes content-addressed; the
  // `blob` metadata rides apply() like any write (blob.ts owns the store).
  if (path == '/blob' && req.method == 'POST') {
    try {
      let eid = url.searchParams.get('eid') ?? ''
      if (!eid) return new Response('eid required', { status: 400 })
      let name = url.searchParams.get('name') ?? 'file'
      let mime = req.headers.get('content-type') || 'application/octet-stream'
      let bytes = new Uint8Array(await req.arrayBuffer())
      let out = apply(
        db,
        await landBlob(eid, name, mime, bytes),
        fed(),
        req.headers.get('x-via'),
      )
      feed.settle()
      return Response.json({ ok: true, changes: out })
    } catch (e) {
      let why = e instanceof Error ? e.message : String(e)
      return new Response(why, { status: 400 })
    }
  }
  if (path.startsWith('/blob/')) return serveBlob(path.slice(6))
  // The user's theme: a stylesheet in their vault, not this repo, so
  // re-skinning is a file beside your data — never a fork of styles.css
  // (T-12778). Loaded after styles.css, it overrides the :root theme
  // contract. Absent is the normal case: an empty stylesheet, not a 404
  // the log would cry about. themeWatch (below) hot-swaps it on save.
  if (path == '/theme.css') {
    let theme = `${Deno.env.get('HOME')}/.tasks/theme.css`
    let css = await Deno.readTextFile(theme).catch(() => '')
    return new Response(css, {
      headers: { 'content-type': mime.css, 'cache-control': 'no-cache' },
    })
  }
  // Plugin bytes: served from this repo's `plugins/` dir the same on-the-fly
  // way src is (TS → JS, mtime-cached), so the browser imports the same
  // modules the server did — a path prefix, not a bundler (D-18663 seam 1).
  // Reachable only when a plugin is configured; otherwise nothing links here.
  if (path.startsWith('/plugins/')) return file(repo.slice(0, -1), path)
  // Retired data doors never masquerade as browser routes. Their capability
  // lives in /query, /ws, or a local library now; serving index.html here
  // would turn a caller bug into a convincing 200 response.
  if (retiredDataDoors.has(path)) {
    return new Response('retired: use /query, /ws, or the local library', {
      status: 404,
    })
  }
  // Static files and SPA navigation are reads. Any unhandled mutating method
  // is an API miss, never a request for index.html; returning the shell made a
  // misspelled write look successful and hid wrong-method calls to known doors.
  if (req.method != 'GET' && req.method != 'HEAD') {
    return methodNotAllowed('GET, HEAD')
  }
  // An extensionless path is a ROUTE (/T-123): the app boots and reads
  // the URL — same shell, different root card.
  let shell = path.includes('.') ? path : '/index.html'
  // When plugins are configured, inject their browser URLs into the shell so
  // main.tsx can import them before first render. With none configured (the
  // default), the shell is served byte-for-byte unchanged — the loader stays
  // inert.
  if (shell == '/index.html' && browserPlugins.length) {
    let html = await Deno.readTextFile(`${src}index.html`)
    let tag = `<script type="application/json" id="tasks-plugins">${
      JSON.stringify(browserPlugins)
    }</script>`
    return new Response(html.replace('</head>', `  ${tag}\n  </head>`), {
      headers: { 'content-type': mime.html, 'cache-control': 'no-cache' },
    })
  }
  return file(src.slice(0, -1), shell)
}

// Pass-through legacy sessions materialize on read from their transcript files
// (D-17790 / T-17795) — registered here, server-only, so the read doors resolve
// a purged session and stream its tail without a row ever landing. Three stores,
// one machinery (source_file.ts): claude projects, codex rollouts, managed logs.
registerSessionSource()
registerCodexSource()
registerManagedSource()

// The curated effects moved whole to doing.ts (D-22388 step 3): one list,
// wired in every process — this server passes its in-memory runner hooks for
// the few `where:'serve'` rows, and in split mode (TASKS_EFFECTS=daemon) the
// effects daemon owns everything else. wireDoing returns the persona-sync
// debounce boot still needs below.
let doingDeps: Doing = {
  cast,
  native: {
    soon: () => runnerSoon(),
    start: managed.start,
    remove: (eid) => managed.remove(eid),
    stop: (eid, target) => managed.stop(eid, target),
    comment: (target, eid) => managed.comment(target, eid),
  },
  codexReady,
  readyProviders,
}
let { syncSoon } = wireDoing(doingDeps)

// live_db.ts completed the transactional, idempotent migration before this
// process reached any boot reconciler. The supervisor never starts this server
// until the old process has exited.

// A restart may occur after a hook queued its boundary but before the file
// watcher observed it. Boot consumes that durable remainder.
turnSweep()

// The subscription time windows advance with no write behind them, so the
// sockets standing in one need a clock of their own — serving-side state, so
// this tick stays here in every mode. No boot pass: at boot there is nobody
// subscribed for it to serve.
tick('subs', () => aged(), 30_000, false)

// The doing half: boot reconcile + recurring sweeps + the outbox relay
// (doing.ts). Inline (default) this process owns all of it, exactly as
// before the extraction. Split (TASKS_EFFECTS=daemon) the effects daemon
// runs bootDoing after this process's READY beat, and this server relays
// only the `where:'serve'` sweeps its in-memory runner owns — the runner
// re-boot row and the graph-native pending re-drives.
if (appOnly) {
  // App-plane-only owns NO doing: the boot reconcilers (reapLeases,
  // standingBackfill, the outbox relay) all WRITE, and the serve-side runner
  // drives model turns that WRITE — both belong to the writer side (the bridge)
  // and the effects daemon (its own -effects.lock). This reader just serves.
} else if (splitEffects()) {
  relay(
    (comp, pending) =>
      db.prepare(sweepSelect(comp, pending)).all() as Record<
        string,
        unknown
      >[],
    undefined,
    (w) => w == 'serve',
  )
} else {
  bootDoing(doingDeps, syncSoon)
}

// Watch src/ and tell every client what a save means (debounced — editors
// fire several events per save):
//   {hmr: gen}  component/logic edit — re-import the graph under ?v=gen
//               and re-render; signals in live.ts keep all state
//   {css: gen}  css-only edit — re-fetch the stylesheet, nothing else
//   'reload'    a SHELL file (main.tsx, live.ts, index.html, vendor/) —
//               the swap boundary itself moved; only a real reload applies
// The supervisor (dev.ts) owns server-graph restarts. We must not close client
// sockets merely because this watcher saw a serverFile edit: the supervisor
// first asks this process to settle and exit, then starts the replacement.
// Returning here leaves the existing process serving until that ordered stop;
// clients retry through the deliberate restart gap.
let shellish = (p: string) =>
  p.endsWith('/main.tsx') || p.endsWith('/live.ts') ||
  p.endsWith('/index.html') || p.includes('/vendor/')
let watch = async () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let batch = new Set<string>()
  for await (let e of Deno.watchFs(src)) {
    if (e.paths.some(serverFile)) return
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
      for (let { sock } of served) {
        if (sock.readyState == WebSocket.OPEN) sock.send(JSON.stringify(msg))
      }
    }, 50)
  }
}
watch()

// Turn hooks append to a durable local spool and return without waiting for a
// loaded event loop. The server resolves the provider id through its unique
// index and sends the ordinary graph change once it gets a turn.
function turnSweep() {
  // Draining the turn spool WRITES session.turn; the writer owns it. An
  // app-plane reader leaves the spool for the writer side to drain.
  if (appOnly) return
  if (Deno.env.get('DB_PATH')) return
  try {
    drainTurns(({ sid, turn }) => {
      let row = db.prepare(
        `select e.eid as eid from session s
         join entity e on e.id = s.entity where s.id = ?`,
      ).get(sid) as { eid: string } | undefined
      if (!row) return
      apply(
        db,
        [{
          eid: row.eid,
          name: 'session',
          comp: { turn },
        }],
        fed(),
        sid,
      )
      feed.settle()
    })
  } catch (e) {
    console.warn('turn spool retained —', e)
  }
}

// The user's theme (~/.tasks/theme.css, T-12778) lives outside src/, so it
// gets its own watch: a save broadcasts {css} like any other stylesheet edit,
// re-fetching the sheet with no reload. Non-recursive keeps this off the
// vault's worktrees/ and logs/ churn; a top-level db write wakes the loop but
// goes nowhere, since we act only on theme.css — which also catches a theme
// created (or removed) while the server runs, where watching the file itself
// could not. No vault dir (a bare probe) means nothing to watch.
let themeWatch = async () => {
  let dir = `${Deno.env.get('HOME')}/.tasks`
  let w
  try {
    w = Deno.watchFs(dir, { recursive: false })
  } catch {
    return
  }
  for await (let e of w) {
    // Only a WRITE arms the spool drain. Drain's own read emits an `access`
    // event on turns.jsonl, and acting on it re-armed the drain in a tight
    // loop (~8.7k opens/s of steady CPU) — the second half of the feedback the
    // empty-spool truncate guard (turn.ts) closed. A hook's append is
    // `modify`, so filtering access keeps every real report and kills the echo.
    if (
      e.kind != 'access' && e.paths.some((p) => p.endsWith('/turns.jsonl'))
    ) turnSweep()
    if (!e.paths.some((p) => p.endsWith('/theme.css'))) continue
    let msg = JSON.stringify({ css: ++gen })
    for (let { sock } of served) {
      if (sock.readyState == WebSocket.OPEN) sock.send(msg)
    }
  }
}
themeWatch()

let draining = false
let drain = async () => {
  if (draining) return
  draining = true
  // Silence the recurring reconcilers FIRST — before any await below. We have
  // decided to cede the port, so no sweep may fire another write while drain
  // settles in-flight work: past this synchronous line the event loop hands no
  // interval another turn, so a hung drain can no longer leak stale-code writes
  // at the live db (T-19494).
  stopTimers()
  // Let in-flight graph-native generations/calls finish and settle BEFORE the
  // listener closes: this drain keeps a source-edit restart from killing a live
  // codex turn, and it can run for minutes (settle caps at 300s). Through this
  // settle we remain the port's one listener. The supervisor waits for our exit
  // before it starts the replacement.
  await managed.settle()
  for (let { sock } of served) sock.close(1012, 'server restart')
  // shutdown() waits for EVERY in-flight response, and the streaming doors
  // (a /logs tail) hold theirs open indefinitely. Bound it: past the bound,
  // Deno.exit ends the straggler streams so the supervisor can start the
  // replacement.
  await Promise.race([
    http.shutdown(),
    new Promise((r) => setTimeout(r, 15_000)),
  ])
  await codexAccount.close()
  // PRAGMA optimize on the long-lived connection at graceful shutdown — the
  // point SQLite recommends for a persistent connection (T-16325). Since 3.46
  // it auto-analyzes tables whose sqlite_stat1 drifted or is missing as the
  // graph grew, so the next boot's planner starts on fresh stats instead of
  // plans that rot with size. Best-effort: a stats refresh must never hold up
  // a clean shutdown, and it only ever rewrites sqlite_stat1.
  try {
    db.exec('pragma optimize')
  } catch (e) {
    console.warn('pragma optimize skipped —', e)
  }
  // Close the main owner-storage handle before exit. The process may still
  // have a socket worker winding down, so the kernel releases both lifetime
  // locks only when Deno.exit closes every process descriptor together.
  db.close()
  void portOwnership
  Deno.exit(0)
}

// Bind last, after migrations and boot reconciliation. The supervisor has
// already stopped and reaped the old process, so the public port has one
// serving process and needs no listener overlap.
let http = Deno.serve({ port }, handle)
Deno.addSignalListener('SIGINT', drain)
Deno.addSignalListener('SIGTERM', drain)
booted()
// One readiness beat: fully migrated and serving.
await signalReady()
