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
import { bound, guard, type Serving } from './bind.ts'
import { takeBaton } from './baton.ts'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { providers } from './adapters.ts'
import { capabilities, type Change, type Dep, idOf, kindOf } from './types.ts'
import {
  apply,
  bodies,
  buried,
  componentCounts,
  correct,
  cursorOf,
  cursorStale,
  db,
  delta,
  depsOf,
  eager,
  epochOf,
  file as graph,
  historicalWorked,
  human,
  inverseBatch,
  journalBy,
  journalOf,
  lastBatch,
  locate,
  migrate,
  redact as redactValue,
  referrersOf,
  refsOf,
  refValuesOf,
  resolveId,
  rootChanges,
  rowsOf,
  scanAnomalies,
  search,
  settingEid,
  settingValue,
  snapshot,
  sweepSelect,
  touch,
  vocabularyDoc,
} from './db.ts'
import { published, withBackupLock } from './redaction.ts'
import { bodied, bodyless, gaps, spread, type Step, step } from './subs.ts'
import { dispatch, docs, on, relay, trace } from './effects.ts'
import { registerSessionSource } from './source_session.ts'
import { registerCodexSource } from './source_codex.ts'
import { registerManagedSource } from './source_managed.ts'
import { vocabularyMd } from './schema.ts'
import { freeze, serveFrozen, store } from './freeze.ts'
import { landBlob, serveBlob } from './blob.ts'
import { filed } from './page.ts'
import { PENDING } from './deliver.ts'
import { ensureFixer, fileBug, FIXER_ROLE, HEAL_PENDING } from './heal.ts'
import { recallEntry } from './recall.ts'
import {
  historicalReferenced,
  referencedEntry,
  references,
} from './referenced.ts'
import { fanout, FANOUT_PENDING, mailed } from './mail.ts'
import { native } from './mailer.ts'
import { closingTask } from './closing.ts'
import { unblocking } from './unblock.ts'
import { knocked } from './knock.ts'
import { waking } from './wake.ts'
import { DREAM_PENDING, DREAM_ROLE, dreamComb } from './dream.ts'
import {
  fleetApi,
  fleetRaw,
  inboundSweep,
  isLive,
  mailIdOf,
  mayStamp,
} from './inbound.ts'
import { SCRIBE } from './scribe.ts'
import { dispatchSweep } from './dispatch.ts'
import { ruled } from './spawnrule.ts'
import { embedSweep, similarTo } from './embed.ts'
import { type IO, mcpServer } from './mcp.ts'
import { drain as drainTurns } from './turn.ts'
import { materialize, projection, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import {
  codexPending,
  commented,
  deleted,
  maintainStandingFor,
  prepareWorktree,
  reapLeases,
  reconfigured,
  recover,
  recoverWorktree,
  spawned,
  standingBackfill,
  stopped,
  tidy,
  watched,
} from './sessions.ts'
import { codexIssuer, codexStore } from './codex_auth.ts'
import { accountHttp, accountService } from './accounts.ts'
import { credentialHttp, credentialService } from './credentials.ts'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { managedCodex } from './managed_codex.ts'
import { sessionRow as storedSession } from './session_store.ts'
import { responses } from './responses.ts'
import {
  ollamaCloudTransport,
  type OllamaConfig,
  ollamaProbe,
} from './ollama_cloud.ts'
import { resolve, settingRows } from './config.ts'
import { resolve as resolveAnchor } from './anchor.ts'
import { codexGeneration } from './runner.ts'
import { readEntries } from './entries.ts'
import { graphLog } from './entry_log.ts'
import { type Observation, safeObservation } from './observations.ts'
import { outcome, recent, record, stats, toolCall } from './telemetry.ts'
import { stamp } from './hot.ts'
import { obeyed } from './obey.ts'
import { serverFile } from './reload.ts'
import {
  actorRows,
  addressed,
  inboxFor,
  inboxItem,
  jsonOf,
  readerAt,
  readerFor,
  readerRows,
  type Row,
} from './client.ts'
import {
  aggOf,
  type Hop,
  listed,
  matchQuery,
  parseQuery,
  type Pred,
  resolveRefs,
} from './query.ts'
import {
  dbReader,
  evalAgg,
  evalFast,
  evalGraph,
  evalQuery,
  localQuery,
  personaGraph,
  projectionGraph,
  rowed,
  workingSet,
} from './graph_query.ts'
import { liveFrame } from './wire.ts'
import { nativeSoon, nativeSweep, noticeAccepted } from './tmux.ts'
import {
  registerSystem,
  roleAttention,
  roleBoot,
  roleClaim,
  roleConfig,
  roleDoc,
  rolePersona,
  roleRemoved,
  roleSession,
  systemSweep,
} from './roles.ts'
import { prune as pruneTree, reap as reapProbes, sweep } from './probes.ts'
import { loadPlugins, pluginSpecifiers } from './plugins.ts'
import { repeat, stop as stopTimers } from './timers.ts'

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

// Heartbeat: a half-open socket (network drop with no FIN, a suspended tab)
// stays OPEN on both ends, so neither onclose fires. A periodic app-level ping
// gives every client's watchdog guaranteed traffic to distinguish a QUIET graph
// from a DEAD socket — no ping for a while and the client force-reconnects
// (T-21511). The browser can't send native pings, so it's a plain data frame the
// client resets its watchdog on and never lands.
let PING = JSON.stringify({ ping: 1 })
let PING_MS = 25_000

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
  // A ROUTE sub (`route:<eid>`) names one entity by id, not a query — the
  // fullscreen root a client reaches by direct URL, which the query grammar
  // can't express (`.eid=` is refused, query.ts) and which no defining set
  // holds. `only` short-circuits the matcher to this fixed id: membership is
  // "this eid, while it's alive", so the entity loads whole (details), updates
  // live, and dies with the row. Empty/absent for every query sub.
  only?: Set<string>
  // An AGGREGATE sub (T-21283): a query carrying `.tally=comp.prop` answers a
  // VALUE→COUNT map, not a member list — one sub serves every tile's badge, so
  // a page of per-row reverse-lookups never floods the wire. `vals` remembers
  // each member's current column value (a death can't be re-read from the db),
  // `counts` is the standing tally; maintain() pushes DELTA maps (n=0 deletes).
  agg?: { at: Hop; vals: Map<string, string>; counts: Map<string, number> }
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
// gapless. Per candidate eid × sub: one eager keyed read (batch-cached), then
// the §2 transition — ADD queues full comps, UPDATE queues the batch's own
// patches, REMOVE pushes a drop, a death forwards entity-null. Ordinary preds
// use the batch's touched eids; path preds add sources reached by walking the
// touched rows backward through their declared reference chain.
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

// A path member can move when any row along its reference chain changes, not
// only when the source itself changes. Walk each possible touched rung back to
// the source through the predicate's own columns. The reverse queries are
// component-keyed; ordinary subscriptions keep the touched-eid fast path.
let pathSources = (preds: Pred[], touched: string[]) => {
  let out = new Set(touched)
  for (let p of preds) {
    // A reverse hop: a touched CHILD moves its PARENT — read the child's ref
    // column back to the entity it points at. A touched grandchild (a child's
    // own component, e.g. its created row) shares the child's eid, so this one
    // hop reaches it too. The sub-filter's own hops are recomputed from the
    // parent by matchQuery, so they need no separate invalidation here.
    if (p.rev) {
      for (
        let eid of refValuesOf(db, touched, {
          comp: p.rev.comp,
          prop: p.rev.prop,
        })
      ) out.add(eid)
      continue
    }
    if (!p.at) continue
    let refs = [{ comp: p.comp, prop: p.prop }, ...p.at.slice(0, -1)]
    for (let depth = 1; depth <= refs.length; depth++) {
      let found = touched
      for (let at = depth - 1; at >= 0 && found.length; at--) {
        found = referrersOf(db, found, refs[at])
      }
      for (let eid of found) out.add(eid)
    }
  }
  return [...out]
}

// A reverse hop's Kids over the live db: the children referring at `eid` through
// `comp.prop` (referrersOf), each hydrated to its eager bag by `read`. Bound per
// maintain()/aged() pass to that pass's memoised `comps` fetcher.
let dbKids =
  (read: (eid: string) => Record<string, Record<string, unknown>>) =>
  (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map((k) => read(k))

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
      // An aggregate sub speaks value→count deltas: a member arriving,
      // leaving, or moving its column value adjusts the standing tally, and
      // only the touched values ride the frame (n=0 tells the client to drop
      // the key). vals is the member set — a death reads its last value from
      // there, since the row is already gone from the db.
      if (sub.agg) {
        let { at, vals, counts } = sub.agg
        let delta = new Map<string, number>()
        let bump = (v: string, by: number) => {
          if (!v) return
          let n = (counts.get(v) ?? 0) + by
          n > 0 ? counts.set(v, n) : counts.delete(v)
          delta.set(v, Math.max(n, 0))
        }
        for (let eid of touched) {
          let c = gone.has(eid) ? {} : comps(eid)
          let alive = !gone.has(eid) && !!c.entity
          let hit = alive && listed(c, sub.preds) &&
            matchQuery(c, sub.preds, comps, undefined, dbKids(comps))
          let now = hit ? String(c[at.comp]?.[at.prop] ?? '') : ''
          let was = vals.get(eid) ?? ''
          if (now == was) continue
          bump(was, -1)
          bump(now, 1)
          now ? vals.set(eid, now) : vals.delete(eid)
        }
        if (delta.size) {
          sock.send(JSON.stringify({
            sub: id,
            agg: Object.fromEntries(delta),
            cursor: cur,
            shadow: sub.shadow,
          }))
        }
        continue
      }
      let changes: Change[] = []
      let drop: string[] = []
      let candidates = sub.preds.some((p) => p.at || p.rev)
        ? pathSources(sub.preds, touched)
        : touched
      for (let eid of candidates) {
        let c = gone.has(eid) ? {} : comps(eid)
        let alive = !gone.has(eid) && !!c.entity
        // A route sub matches its fixed id; a query sub runs the matcher.
        let hit = alive &&
          (sub.only ? sub.only.has(eid) : listed(c, sub.preds) &&
            matchQuery(c, sub.preds, comps, undefined, dbKids(comps)))
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
          matchQuery(c, sub.preds, comps, now, dbKids(comps))
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
// One entity as a subscription hit — its eager comps, or nothing if the id
// names no live entity yet (a route sub opened before its target is minted, or
// on a tombstone). Shaped like an evalFast/evalQuery hit so control() ships it
// through the one payload path.
let rowsFor = (
  eid: string,
): { eid: string; comps: Record<string, Record<string, unknown>> }[] => {
  let comps = eager(db, eid)
  return comps.entity ? [{ eid, comps }] : []
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
    // A route sub names one entity by id in its own name — no query to eval; its
    // hits are that entity's current comps (empty if it isn't minted yet, so a
    // later create ADDs it). A query sub evaluates its filter as before.
    let route = f.sub.startsWith('route:') ? f.sub.slice('route:'.length) : null
    let details = route != null || f.sub.startsWith('entries:')
    let { preds, hits } = route != null
      ? { preds: [], hits: rowsFor(route) }
      : evalFast(db, f.q ?? '', details) ?? evalQuery(db, f.q ?? '')
    // An aggregate sub answers a tally, not a member list. Build the standing
    // count from the membership pass (vals doubles as the member set), send
    // the whole map once, and let maintain() speak in deltas from here.
    let agg = route == null ? aggOf(preds) : undefined
    if (agg) {
      let vals = new Map<string, string>()
      let counts = new Map<string, number>()
      for (let r of hits) {
        let v = String(r.comps[agg.at.comp]?.[agg.at.prop] ?? '')
        if (!v) continue
        vals.set(r.eid, v)
        counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      map.set(f.sub, {
        preds,
        members: new Set(vals.keys()),
        shadow: !!f.shadow,
        moving: false,
        bodies: false,
        details: false,
        agg: { at: agg.at, vals, counts },
      })
      sock.send(JSON.stringify({
        sub: f.sub,
        agg: Object.fromEntries(counts),
        replace: true,
        cursor: cursorOf(db),
        shadow: !!f.shadow,
      }))
      return
    }
    map.set(f.sub, {
      preds,
      members: new Set(hits.map((r) => r.eid)),
      shadow: !!f.shadow,
      moving: gaps(preds).includes('moving-time'),
      bodies: bodied(f.sub),
      // Entry partitions and route entities are absent from both the root
      // snapshot and root live stream, so their shadow owns bodies and
      // standing-match updates too.
      details,
      ...(route != null ? { only: new Set([route]) } : {}),
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
  // Maintain the native-session `standing` facet at the write edge (T-17855),
  // so SessionDot reads it O(1) instead of scanning the whole entry log per
  // render (157ms/dot). cast is the one door BOTH writers of turn-edge entries
  // funnel through — the runner (managed_codex, which never dispatches effects)
  // and the wire (/apply, MCP). A turn-edge batch re-derives standingOf over
  // the session's log once and stamps it; everything else is a cheap name
  // check. The stamp casts back as a `session` change (not a turn-edge comp),
  // so this cannot recurse.
  maintainStandingFor(changes, cast)
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
  f: {
    since?: number
    epoch?: string
    vocab?: string
    live?: number
  },
) => {
  if (f.live == 1) envelopes.add(sock)
  else envelopes.delete(sock)
  if (f.since == null || cursorStale(db, f.epoch, f.vocab, f.since)) {
    // A cold or stale client seeds the WORKING SET — never the whole graph
    // (M-21143); its subscriptions stream the rest on demand.
    sock.send(JSON.stringify({ reset: true, snapshot: workingSet(db) }))
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
  let beat = setInterval(() => {
    if (socket.readyState == WebSocket.OPEN) socket.send(PING)
    else clearInterval(beat)
  }, PING_MS)
  socket.onclose = () => {
    clearInterval(beat)
    clients.delete(socket)
    envelopes.delete(socket)
    subs.delete(socket)
    filtered.delete(socket)
  }
  socket.onmessage = (m) => {
    let frame = JSON.parse(String(m.data))
    // Object frames are control (design §1), structurally disjoint from the
    // array batches: {since} is the catch-up handshake, {apply} an acked
    // write, everything else ({sub}/{unsub}) is subscriptions.
    let sent: Change[]
    let id: string | undefined
    if (Array.isArray(frame)) sent = frame as Change[]
    else if ('since' in frame) return join(socket, frame)
    // {apply, id} is a batch wearing a delivery id (T-21413): the ack below is
    // what lets a client HOLD each write in its outbox until commit instead of
    // firing and forgetting. A bare array (an older tab) still applies — it
    // just gets no ack.
    else if (Array.isArray(frame.apply)) {
      sent = frame.apply as Change[]
      if (frame.id != null) id = String(frame.id)
    } else return control(socket, frame)
    let out: Change[]
    let t = trace()
    try {
      out = apply(db, sent, t, writer)
    } catch (e) {
      console.error('sync: bad batch dropped —', e)
      // Revert the sender's optimistic apply with a SCOPED re-sync of just the
      // eids it touched — the authoritative pre-batch state (M-21143), never a
      // whole-graph snapshot the rejected write does not need. The id settles
      // the delivery: a refusal is an answer, not a reason to redeliver.
      socket.send(JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        changes: correct(db, sent),
        id,
      }))
      return
    }
    if (id) socket.send(JSON.stringify({ ack: id }))
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
let graphIO: IO = {
  // The whole eager graph — code_run's sandbox contract and the command tool's
  // stdio-only fallback are the LAST callers (every other tool reads scoped,
  // T-22217). Deleting it rides the epic's snapshot() subtraction once those
  // two contracts are revisited.
  // deno-lint-ignore require-await
  read: async () => snapshot(db),
  // The authoritative filter-query, in-process: localQuery routes `id=`
  // addressing (locate: T-3, num, slug, uuid) and hands the rest to the same
  // evalGraph the /query door runs — one Querier semantics on both transports,
  // so client.ts's scoped readers (checkedRefs, contextSnapshot, bus) run here
  // with zero round trips.
  query: (q, opts) => localQuery(db)(q.split('&').filter(Boolean), opts),
  // The colon-command executor's scoped reader — keyed off the live db, so the
  // in-process `command` tool resolves ids/enumerations on demand instead of
  // materializing the graph (M-21143). `overlay` carries a command's not-yet-
  // applied rows (a spec-line task) for the spawn validation.
  reader: (overlay) => dbReader(db, overlay),
  // Entities BY ADDRESS — the same id= resolution the /query door runs, so a
  // tool's `find(await io.get([id]), id)` resolves every form find() reads.
  get: (ids, filters = []) =>
    ids.length
      ? localQuery(db)([`id=${ids.join(',')}`, ...filters])
      : Promise.resolve([]),
  // The dependency edges touching these entities, quarantine-screened the way
  // the /query deps=1 layer is; `reveal` lifts the screen like quarantined=1.
  // deno-lint-ignore require-await
  deps: async (eids, reveal = false) =>
    depsOf(db, eids).filter((d) =>
      reveal ||
      (!eager(db, d.parent).quarantined && !eager(db, d.child).quarantined)
    ),
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
  history: async (eid, limit) => journalOf(db, eid, limit),
  // Build the inverse and apply it in one synchronous stretch (no await
  // between) — the same atomicity the /undo route relies on.
  // deno-lint-ignore require-await
  undo: async ({ id, eid }, via) => {
    let batch = id ?? (eid ? lastBatch(db, eid) : 0)
    if (!batch) {
      throw new Error(
        eid ? `${eid} has no history to undo` : 'undo needs id or eid',
      )
    }
    let t = trace()
    let out = apply(db, inverseBatch(db, batch), t, via)
    cast(out)
    effect(out, t)
    return out
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
  generators: {
    ollama: codexGeneration(ollamaCloudTransport({ retries: 1 }, ollamaConfig)),
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
let serving: Serving = { db: graph, epoch: epochOf(db), pid: Deno.pid }
// A --join successor of a live deploy; everyone else (first boot, revive, test,
// probe) is a sole boot. This one flag steers both the port guard (bind.ts) and
// the single-writer handoff (becomeWriter below).
let joining = Deno.args.includes('--join')
let ownership: Deno.FsFile
try {
  ownership = await guard(port, graph, joining)
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
// normal, not a reason to die. Reused for BOTH beats of a --join handoff —
// "bound" then "fully ready" — and for the single "ready" of a sole boot; the
// supervisor (dev.ts) reads one or two by whether it launched us to join.
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

// The writer baton, held for this process's whole life (baton.ts): the kernel
// releases it when we exit, however we exit, so a successor's wait can never
// hang on a lock we forgot to drop. Parked in a module binding (never read,
// never closed by hand) purely so its fd is not GC-finalized out from under us.
let _writerBaton: Deno.FsFile | undefined
// Become the graph's sole WRITER before any migration or write runs (T-20223).
// A sole boot already migrated at import (db.ts) and only claims the baton —
// free now — to hold the writer role for its life. A --join successor connected
// the DB read-capable at import but has NOT migrated: it tells the supervisor it
// is PREPPED (imports done, db connected — so the predecessor is stopped and, on
// its exit, releases the baton), waits for the baton, then migrates as the
// now-sole writer. This process is NOT yet listening — the predecessor keeps the
// port through its settle, and the bind at the bottom of boot takes it only once
// we can actually answer — so the handoff's dark gap is the predecessor's
// shutdown plus our migrate, not the whole boot.
let becomeWriter = async () => {
  if (joining) await signalReady() // beat 1: bound — release the DB to me
  _writerBaton = await takeBaton(graph, { wait: joining })
  if (joining) migrate(db)
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

// The request handler, DEFINED here but not yet listening. The bind happens at
// the bottom of boot (just before booted()): reusePort deals connections to
// every listener on the port, so a successor that binds while it still has a
// minutes-long boot ahead of it steals ~half of all new connections from its
// perfectly healthy predecessor and parks them on `await boot` — under a busy
// landing cadence that alone reads as the graph being down. Binding late keeps
// the predecessor the ONLY listener until this process can actually answer,
// and shrinks the dark gap to drain + migrate.
let handle = async (req: Request) => {
  let url = new URL(req.url)
  let path = url.pathname
  // Answered BEFORE boot: a peer deciding whether it may join this address
  // must hear whose graph is here without waiting out our migrations.
  if (path == '/graph') return Response.json(serving)
  await boot
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
  // The admin census's graph-true counts: one COUNT per component table,
  // authoritative for eager AND entry-partition components the cache omits.
  if (path == '/census') return Response.json(componentCounts(db))
  // The graph's storage-integrity anomalies (D-18866): orphaned component rows
  // and dangling {eid} references — both wire-invisible, so the doctor cannot
  // see them through /query and reads this raw db scan instead. Read-only.
  if (path == '/integrity') return Response.json(scanAnomalies(db))
  if (path == '/resolve') {
    // The id-resolve fallback door (T-18102): a client whose working-set
    // cache can't name a token resolves it here — the same resolveId every
    // read door uses (T-3684). Naming-only: eid, num, kind — the immutable
    // facts a link or crumb needs, never content (that rides subscriptions),
    // so nothing folded from this answer can go stale. 404 = no such entity,
    // so the client shows its honest Lost instead of a spinner that never
    // settles; 400 = an ambiguous short-eid prefix, the typist's news.
    let id = url.searchParams.get('id') ?? ''
    let eid: string | undefined
    try {
      eid = id ? resolveId(db, id) : undefined
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 400 })
    }
    if (!eid) return new Response('no entity', { status: 404 })
    let comps = eager(db, eid)
    return Response.json({
      eid,
      num: Number(comps.entity?.num ?? 0) || null,
      kind: kindOf(comps),
    })
  }
  if (path == '/anchor') {
    // The anchor-resolver door (D-21211, T-21317): one endpoint grades any
    // anchor tri-state — fresh / moved (with the new range) / broken — and
    // serves the current bytes from git's object store, never from the db.
    // `?id=` resolves an entity's own anchor comp in its own repo context
    // (the entity's repo, its project's, its memory scope's — falling back
    // to this server's checkout, where the graph's own docs anchor);
    // explicit ?path/&sha/&start/&end/&hunk grade an unsaved anchor, and
    // ?repo= overrides the cwd either way. 404s speak, per M-16612.
    let p = url.searchParams
    let cwd = p.get('repo') ?? undefined
    let a: Parameters<typeof resolveAnchor>[1]
    let id = p.get('id')
    if (id) {
      let eid: string | undefined
      try {
        eid = resolveId(db, id)
      } catch (e) {
        return new Response(String((e as Error).message ?? e), {
          status: 400,
        })
      }
      if (!eid) return new Response('no entity', { status: 404 })
      let comps = eager(db, eid)
      if (!comps.anchor) {
        return new Response(`${id} has no anchor`, { status: 404 })
      }
      a = comps.anchor as typeof a
      // The repo an entity's anchor means: its own repo comp, else the one
      // its project (task.project / memory.scope) wears.
      let home = (owner?: unknown) =>
        owner
          ? eager(db, String(owner)).repo?.path as string | undefined
          : undefined
      cwd ??= (comps.repo?.path as string | undefined) ??
        home(comps.task?.project) ?? home(comps.memory?.scope)
    } else {
      if (!p.get('path')) {
        return new Response('need ?id= or ?path=', { status: 400 })
      }
      let num = (k: string) => (p.get(k) == null ? null : Number(p.get(k)))
      a = {
        paths: p.get('path'),
        sha: p.get('sha'),
        hunk: p.get('hunk'),
        start: num('start'),
        end: num('end'),
      }
    }
    return Response.json(await resolveAnchor(cwd ?? repo, a))
  }
  if (path == '/body') {
    // The bodies a bodyless payload deferred, for the eids a view is about
    // to paint or edit (live.ts `want`). A Change batch, so it lands
    // through applyLocal like any patch — no second intake path.
    let eids = (url.searchParams.get('eids') ?? '').split(',').filter(Boolean)
    return Response.json({ changes: bodies(db, eids) })
  }
  if (path == '/delta') {
    // The returning client's catch-up: changes since its cursor. A cursor is
    // only valid against the epoch and vocabulary that issued it, and only up
    // to the journal's current tip — a mismatch means a different graph
    // lineage, a shape change, or a rewind past the client's frontier, so 409
    // tells the client to full-resnapshot rather than serve a misleading
    // delta (cursorStale, db.ts).
    let p = url.searchParams
    if (
      cursorStale(
        db,
        p.get('epoch'),
        p.get('vocab'),
        Number(p.get('since') ?? 0),
      )
    ) {
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
  if (path == '/persona') {
    // A persona materialized server-side — the SAME bytes a spawned session
    // reads as its system prompt (persona.ts materialize()), so the browser
    // must NOT render them from its own cache: under a partial cache the tier
    // walk misses memories and edges and quietly corrupts the very prompt.
    // The read is the spawn path's own bounded walk (personaGraph: the tier
    // closure from this root, derived homeReads included), never the
    // whole-graph snapshot (M-21143). `id` addresses the persona (locate:
    // T-3, num, uuid, slug). `scoped` is the in-scope memories the editor
    // lists as untiered — a keyed memory.scope query, resolved here so
    // discovery no longer depends on what the client happens to hold.
    let eid = locate(db, url.searchParams.get('id') ?? '')
    if (!eid) return new Response('no such entity', { status: 404 })
    let { all, deps } = personaGraph(db, [eid])
    let p = all.find((r) => r.eid == eid && r.comps.persona && r.comps.doc)
    if (!p) return new Response('not a persona', { status: 404 })
    let home = (p.comps.persona.home as string | null) ?? null
    let scoped = evalGraph(
      db,
      home ? `.memory.scope=${home}` : '.memory.scope=',
    )
      .hits
      .filter((r) => r.comps.memory && r.comps.doc)
      .map((r) => r.eid)
    return Response.json({
      text: materialize(all, deps, p, Date.now()),
      scoped,
    })
  }
  if (path == '/query') {
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
        !s.startsWith('id=')
      )
      let q = segs.join('&')
      // An aggregate projection (`.distinct=col` / `.tally=col`) answers with
      // the reduction, not a row set — the census asks for values, so rows,
      // layers and id= addressing don't apply. Keys come back sorted the way
      // the census always has.
      let agg = evalAgg(db, q)
      if (agg) {
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
      // A dead entity is gone before this: `only` was built above with the
      // tombstone excluded (buried), so it holds live eids only and eager()
      // always finds a spine with components. Since the D-18866 flip retains a
      // tombstoned spine row, that exclusion is explicit rather than a side
      // effect of delete removing the row.
      if (only) {
        let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
        let hits = [...only].map((eid) => rowed({ eid, comps: eager(db, eid) }))
          .filter((r) => reveal || listed(r.comps, preds))
          .filter((r) =>
            matchQuery(
              r.comps,
              preds,
              (e) => eager(db, e),
              undefined,
              dbKids((e) => eager(db, e)),
            )
          )
        return Response.json(
          layers(screen(hits).sort((a, b) => a.num - b.num)),
        )
      }
      // The authoritative pipeline (evalGraph): the index answers when it can
      // (a one-row question cost a 27 MB snapshot and 0.29s before sql.ts,
      // 100x), else the JS matcher over the full universe — which now carries
      // the lazy entry partition whenever the query names it. Kind is a filter
      // in q now (`.kind=`), hot ranking and entry ordering/paging all settle
      // inside evalGraph, so this door and the in-process graph_query tool
      // read one answer.
      let { hits } = evalGraph(db, q, { after, limit })
      return Response.json(layers(hits))
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 400 })
    }
  }
  if (path == '/inbox') {
    // The inbox as the SERVER enumerates it — the SAME client.ts predicate
    // (inboxFor's union, screened by inboxItem/addressed over a readerFor|
    // readerAt reader), run in-process against THIS graph so a partial-cache
    // client reads its FINISHED inbox in one round-trip instead of scanning a
    // whole-graph cache it no longer holds (T-18105). `session`(+`cwd`) builds
    // the working reader; `actor` the browsing one. `mode=all` is the CLI's
    // --all (direct address incl. archived, no watch/mute); repeated `f=` are
    // dot-param filters, screening the union the way `task inbox <filters>`
    // does. A malformed filter is the typist's news, not a server error.
    try {
      let p = url.searchParams
      let mode: 'inbox' | 'all' = p.get('mode') == 'all' ? 'all' : 'inbox'
      let session = p.get('session') ?? undefined
      let actor = p.get('actor') ?? undefined
      if (!session && !actor) {
        return new Response('session or actor required', { status: 400 })
      }
      let local = localQuery(db)
      let who = session
        ? readerFor(
          await readerRows(session, local),
          session,
          p.get('cwd') ?? undefined,
        )
        : readerAt(await actorRows(actor, local), actor)
      let union = await inboxFor(who, p.getAll('f'), mode, local)
      let keep = mode == 'all' ? addressed(who) : inboxItem(who)
      return Response.json(union.filter(keep).map((r) => jsonOf(r)))
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 400 })
    }
  }
  if (path == '/references') {
    let eid = url.searchParams.get('eid') ?? ''
    if (!eid) return new Response('eid required', { status: 400 })
    return Response.json(references(db, eid), {
      headers: { 'cache-control': 'no-store' },
    })
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
        cast(result.changes)
        effect(result.changes, trace())
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
  // Undo reverses a journaled batch: the server builds the guarded inverse
  // (only it reads the journal) and applies it through the same door as any
  // write. Build and apply share this one synchronous tick — no await
  // between — so the world can't move after the inverse is priced and before
  // it lands. ?id= names a journal batch; ?eid= its entity's latest batch.
  if (path == '/undo' && req.method == 'POST') {
    let t0 = performance.now()
    let note = (ok: boolean, error?: string) =>
      record(db, {
        source: 'http',
        name: 'undo',
        ok,
        ms: performance.now() - t0,
        error,
      })
    try {
      let idParam = url.searchParams.get('id')
      let eid = url.searchParams.get('eid')
      let id = idParam != null ? Number(idParam) : eid ? lastBatch(db, eid) : 0
      if (!id) {
        throw new Error(
          eid ? `${eid} has no history to undo` : 'undo needs ?id= or ?eid=',
        )
      }
      let t = trace()
      let out = apply(db, inverseBatch(db, id), t, req.headers.get('x-via'))
      cast(out)
      effect(out, t)
      note(true)
      return Response.json({ ok: true, changes: out, id })
    } catch (e) {
      let why = e instanceof Error ? e.message : String(e)
      note(false, why)
      return new Response(why, { status: 400 })
    }
  }
  // Historical materializations are deliberate operator work, never a
  // boot sweep. Ordinary apply batches keep persistence, live broadcasts,
  // and effects on the same path as every new edge.
  if (path.startsWith('/backfill/') && req.method == 'POST') {
    let mine = {
      worked: historicalWorked,
      referenced: historicalReferenced,
    }[path.slice('/backfill/'.length)]
    if (!mine) return new Response('no such backfill', { status: 404 })
    let pending = mine(db)
    let landed = 0
    for (let i = 0; i < pending.length; i += 200) {
      let t = trace()
      let out = apply(
        db,
        pending.slice(i, i + 200),
        t,
        req.headers.get('x-via'),
      )
      landed += out.filter((c) => c.name == 'dependency').length
      cast(out)
      effect(out, t)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return Response.json({ found: pending.length, landed })
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
      let t = trace()
      let out = apply(
        db,
        await landBlob(eid, name, mime, bytes),
        t,
        req.headers.get('x-via'),
      )
      cast(out)
      effect(out, t)
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

// The curated effects — the graph's post-commit levers, one list, like
// Entity.tsx's renderer list. A session created with a spawn spec is a launch
// request; a stop_request is the brake; a comment at a settled managed
// session resumes it; a deleted session's process dies with its row.
// A future plugin contributes rows here the same way it would renderers.
on('runner', {
  created: runnerSoon,
  sweep: { pending: "name = 'tasksd'" },
  doc: 'boot the graph-native runner through the ordinary effect relay; ' +
    'live entry births wake it through their own hook',
})
on('entry', {
  created: runnerSoon,
  doc: 'a new Session entry wakes the graph-native runner; ' +
    'its indexed candidate query decides whether there is work',
})
on('message', {
  created: recallEntry(cast),
  doc: 'memory auto-recall (T-17306): a new message entry surfaces the ' +
    "nearest memories by title into the session's own log as a `recalled` " +
    'entry (deduped per session), which the channel delivers as kind=recall; ' +
    'new messages only, no history sweep, and a recall entry carries no ' +
    'message facet so it never recalls itself',
})
on('entry', {
  created: referencedEntry(cast),
  doc: 'referenced edges (D-21262): a new entry’s text is parsed for entity ' +
    'ids and page urls, and each resolved citation lands as an ' +
    'entry→referenced→target edge — pure mechanics, no inference',
})
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
on('spawn', {
  changed: {
    provider: reconfigured(cast, managed.start),
    model: reconfigured(cast, managed.start),
    effort: reconfigured(cast, managed.start),
    persona: reconfigured(cast, managed.start),
  },
  doc: 'correcting the launch spec retries a Session that failed before its ' +
    'provider or workspace started',
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
  created: roleBoot(cast),
  changed: {
    state: roleConfig(cast),
    surface: roleConfig(cast),
    scope: roleConfig(cast),
    checkout: roleConfig(cast),
    schedule: roleConfig(cast),
    wake_policy: roleConfig(cast),
    wake_target: roleConfig(cast),
    retry_at: roleConfig(cast),
    quiet: roleConfig(cast),
    cooldown: roleConfig(cast),
  },
  removed: roleRemoved(cast),
  sweep: { pending: '1' },
  doc: 'a desired-state change wakes its role; a removed role closes its ' +
    'deterministic native tmux door',
})
on('doc', {
  created: roleDoc(cast),
  changed: {
    title: roleDoc(cast),
    body: roleDoc(cast),
  },
  doc: 'role and project instructions changing re-drive only their roles',
})
on('repo', {
  created: roleConfig(cast),
  changed: {
    path: roleConfig(cast),
    base_branch: roleConfig(cast),
  },
  doc: 'a role scope repo change re-drives that scope’s roles',
})
on('project', {
  created: roleConfig(cast),
  changed: { color: roleConfig(cast) },
  doc: 'a role scope palette change re-drives that scope’s native roles',
})
on('spawn', {
  created: roleConfig(cast),
  changed: {
    provider: roleConfig(cast),
    model: roleConfig(cast),
    effort: roleConfig(cast),
    persona: rolePersona(cast),
  },
  doc: 'role launch configuration changes wake only the role that owns it',
})
on('session', {
  created: roleSession(cast),
  changed: {
    status: roleSession(cast),
    origin: roleSession(cast),
    finished_at: roleSession(cast),
    notice_at: roleSession(cast),
  },
  doc: 'a persistent role run changing re-drives only its owning role',
})
on('session', {
  created: roleClaim(cast),
  doc:
    'an operator claims its role on boot (T-19453): whoever holds the live ' +
    'claim IS the operator, so the reconciler defers to it and never spawns a ' +
    'duplicate — managed spawns and interactive operators alike, no hook needed',
})
on('comment', {
  created: commented(cast),
  doc: 'a comment on claimed work resumes or steers its process-backed run; ' +
    'a direct session target remains deprecated compatibility',
})
on('comment', {
  created: (_eid, comp) => roleAttention(cast)(String(comp.target)),
  doc: 'a comment wakes only the role that owns or scopes its target',
})
on('knock', {
  created: (_eid, comp) => roleAttention(cast)(String(comp.target)),
  doc: 'a knock wakes only the role that owns or scopes its target',
})
on('comment', {
  created: (eid, comp) => managed.comment(String(comp.target), eid),
  doc: 'a comment on claimed work appends content-free attention to its ' +
    'graph-native run; direct session targets remain compatibility',
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
on('task', {
  changed: { status: unblocking(cast) },
  doc: 'an ended task knocks the claimant session of every task that ' +
    'requires it and is now fully unblocked — the dep-completion wake ' +
    'that resumes a parked run to finish its own task (D-21448)',
})
on('knock', {
  created: knocked(cast),
  sweep: { pending: PENDING('knock') },
  doc: 'attention, resolved: cast to whoever is awake for the recipient, ' +
    'spawn a project operator onto the target, or mail an addressed ' +
    'person — settle delivered/error either way',
})
on('knock', {
  created: dreamComb(cast),
  // Boot reconcile: a dream knock whose comb never ran (a crash in the gap)
  // re-drives — the same outbox pattern as the ladder above (D-17362).
  sweep: { pending: DREAM_PENDING },
  doc: 'the dream: a cadence knock to a venture dream combs its sessions ' +
    'finished since the floor cursor, flagging drift as consider tasks and ' +
    'capturing owner decisions as memories — FLAG-only, never a fix (T-12800)',
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
// A persona's watch is a spawn rule (D-21239, spawnrule.ts): an event about
// the watched target marks it wanted (a `wants` edge) for the dispatch sweep
// to spawn under the slot cap; a human's watch stays a delivery subscription.
// The four event doors below are the inbox item classes (client.ts aboutOf).
on('comment', {
  created: ruled(cast),
  doc: 'a comment about a persona-watched target marks it wanted — the ' +
    'dispatch sweep instantiates the persona (D-21239)',
})
on('notice', {
  created: ruled(cast),
  doc: 'a notice about a persona-watched target marks it wanted (D-21239)',
})
on('knock', {
  created: ruled(cast),
  doc: 'a knock about a persona-watched target marks it wanted (D-21239)',
})
on('mail', {
  // Only an ARRIVAL is an event — message_id is the inbound mark; an
  // outbound letter about the target is the fleet's own doing.
  created: (eid, comp) => comp.message_id ? ruled(cast)(eid, comp) : undefined,
  doc: 'arrived mail about a persona-watched target marks it wanted (D-21239)',
})
on('exception', {
  created: fileBug(cast),
  // Boot reconcile: every exception no bug yet points at re-drives the filer,
  // which dedups by key regardless — at-least-once, storm-proof (D-17077).
  sweep: { pending: HEAL_PENDING },
  doc: 'self-healing phase 1: an exception (break) facet files ONE deduped ' +
    'bug ticket per distinct fault (kind + normalized message + stack head); ' +
    'recurrences annotate the open ticket instead of multiplying it (D-17077)',
})
on('bug', {
  created: ensureFixer(cast),
  // No boot sweep here any more: the fixer system role's reconcile (T-18729,
  // registered below) re-drives open, un-spawned bugs on the system tick —
  // continuously, not just at boot — behind the same gates.
  doc: 'self-healing phase 2: a newly filed bug ticket summons ONE managed ' +
    'fixer session (requested_task = the bug), behind a mute lever, a hard ' +
    'concurrency cap, and a per-fault cooldown — the fixer system role ' +
    're-drives an open, un-spawned ticket once a gate clears (D-17077, ' +
    'T-18729)',
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
  // A probe on a scratch copy must never scribble persona files into the
  // LIVE venture repos it happens to point at: projection() computes each
  // file's path from the project's real repo, not from DB_PATH, so an
  // ungated probe write lands in someone's working tree (T-14612). Only
  // the live instance materializes on a graph change; `task sync` stays
  // the deliberate, operator-run door.
  if (!isLive()) return
  clearTimeout(syncing)
  syncing = setTimeout(async () => {
    try {
      // The projection universe is a bounded keyed walk (every persona +
      // project, closed over tiers), never the whole-graph snapshot — this
      // fires on every persona-ish change, and snapshot() here cost the
      // graph each time (M-21143).
      let { all, deps } = projectionGraph(db)
      let files = projection(all, deps, Date.now())
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
      `select 1 from persona
         where entity = (select id from entity where eid = :e)
       union select 1 from dependency d
         join persona p on p.entity = d.parent
         where d.child = (select id from entity where eid = :e)`,
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
// The single-writer gate. Everything below WRITES the graph — migrations (on a
// --join successor), the reconcilers, the boot sweeps — so nothing below may run
// until this process holds the writer baton and, if it is a successor, has
// migrated (T-20223). The port has been listening since Deno.serve above, so
// requests queue on `boot` through the brief wait rather than being refused; a
// failure here rejects this top-level await, the process exits, and the
// supervisor heals it with a fresh boot.
await becomeWriter()

// A restart may occur after a hook queued its boundary but before the file
// watcher observed it. Boot consumes that durable remainder.
turnSweep()

// Boot migrations may reshape those graph-owned teachings without an apply
// trace. Reconcile once here too, or the source migrates while its generated
// persona files keep teaching the retired vocabulary.
syncSoon()

// Managed children are detached (setsid) and this process restarts on every
// server-file edit — so booting means picking them back up: adopt the ones
// still alive, finalize the ones that died while we were away. Nothing here
// reaps a child; the watcher below must never learn how.
recover(cast)

// The lease half of the same reconcile: a session that ended abnormally never
// ran its wrap, so its claim leaked and the board lies about who is working.
// Release every lease whose session has ended, the same way its wrap would have
// (sessions.ts). Idempotent, so it self-heals on every boot.
reapLeases(cast)

// Backfill the native-session `standing` facet (T-17855): existing sessions
// have logs but no facet stamped until their next transition, so their dots
// would read idle until then. Backgrounded and yielding per session — never
// holds boot (the sweep-saturation incident above is why this cannot be a
// synchronous loop). A rejection nobody handles ends the process, so .catch.
standingBackfill(cast).catch((e) => console.warn('standing backfill —', e))

// Dreams with no pending wake are seeded by the dream system role's sweep
// (T-18730, registered below) — the system tick's boot run covers what the
// boot-only loop here did, and keeps covering it every tick thereafter.

// The file-first Sessions that ended before live ingestion are no longer
// bulk-imported at boot (T-16822's sweep, retired in T-17797): they resolve as
// ephemeral pass-through entities from their file sources and persist lazily,
// one at a time, only when a real write engages one (graduation, D-17790). No
// boot sweep, no saturation, no megabytes of settled transcript in the db.

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
  repeat(run, ms)
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
  repeat(async () => {
    try {
      let sessions = db.prepare(
        `select o.eid as eid, s.id, s.cwd, s.pid from session s
         join entity o on o.id = s.entity`,
      )
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
      let { killed, leaked } = await reapProbes(seen.verdicts)
      let gone = seen.trees.filter((t) => t.prune && pruneTree(repo, t.tree))
      for (let v of seen.verdicts.filter((v) => v.reap)) {
        console.log(`swept ${v.proc.pid} — ${v.why}`)
      }
      for (let t of gone) console.log(`swept ${t.tree.path} — ${t.why}`)
      for (let dir of leaked) console.warn(`profile not removed — ${dir}`)
      if (killed.length || gone.length || leaked.length) {
        record(db, {
          source: 'http',
          name: 'probes',
          // A leak left behind is the failure this run must own, not hide.
          ok: leaked.length == 0,
          detail: `${killed.length} process(es), ${gone.length} worktree(s)` +
            (leaked.length
              ? `, ${leaked.length} profile(s) NOT removed: ${
                leaked.join(', ')
              }`
              : ''),
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
  db.prepare(sweepSelect(comp, pending)).all() as Record<
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
// session wearing the scribe persona writes the briefs and memories. A
// system role (T-18728): registered with roles.ts, its on/off and
// throttle live as role data on the scribe-desk entity, and each pass
// stamps its decision there. The ten-minute tick is the cadence that
// carries its time-based trigger; the throttle keeps it to one desk an
// hour regardless.
registerSystem(SCRIBE)
// The fixer rides the same seam (T-18729): its cap/cooldown/mute are role
// data on the `fixer` alias, and its sweep re-drives gated bugs continuously.
registerSystem(FIXER_ROLE)
// So does the dream (T-18730): pause/cadence are role data on the `dream`
// alias, and its sweep seeds every unwoken dream — at boot and thereafter.
registerSystem(DREAM_ROLE)
tick('system', () => systemSweep(cast), 10 * 60_000)

// Embeddings (embed.ts): every non-comment doc keeps a semantic vector,
// refreshed a few seconds after its text moves — that's what lets a
// create reply say "this already exists" while the ink is still wet.
// Boot sweeps the backfill; the interval catches anything the debounce
// dropped. A box without the model sweeps zero rows, forever, silently.
// Only the live instance sweeps: a probe on a scratch copy stays inert,
// never loading the 400MB model to rewrite vectors it will throw away
// (T-14612). Reads still answer from whatever vectors the copy holds, so
// /similar keeps working.
if (isLive()) {
  // No boot pass: the first sweep loads the ~400MB onnx model and runs
  // synchronous inference chunks that block the event loop for ~18s measured —
  // landing exactly on the freshly-bound listener of every reload handoff.
  // Defer it a minute so a new server breathes first; the interval and the
  // doc-edit debounce keep vectors fresh from then on.
  let embedding = tick('embed', () => embedSweep(db), 10 * 60_000, false)
  setTimeout(embedding, 60_000)
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
}

// Dispatch (dispatch.ts): approved+ready tasks spawn their own sessions
// under the slot cap (T-21323, D-21287 Phase 1). On by default — approval
// (`decided` on an open task) is the owner's arming act, so a mark IS the
// decision to spend. Only the live instance dispatches: a probe on a
// scratch copy must not launch agents. The minute tick owns slot frees
// (session ends); the hooks answer the acts themselves within seconds.
if (isLive()) {
  let dispatching = tick(
    'dispatch',
    () => dispatchSweep(cast, readyProviders),
    60_000,
  )
  let dispatchSoon = (() => {
    let t: ReturnType<typeof setTimeout> | undefined
    return () => {
      clearTimeout(t)
      t = setTimeout(dispatching, 3_000)
    }
  })()
  on('decided', {
    created: dispatchSoon,
    doc: 'an approval may make its task ready — dispatch sweeps soon',
  })
  on('task', {
    changed: { status: dispatchSoon },
    doc: 'a status move can open a requires gate — dispatch sweeps soon',
  })
  on('claim', {
    removed: dispatchSoon,
    doc: 'a released claim can return a ready task — dispatch sweeps soon',
  })
  on('dependency', {
    created: (_eid, comp) => comp.type == 'wants' && dispatchSoon(),
    doc: 'a spawn-rule mark wants a persona run — dispatch sweeps soon',
  })
} else {
  console.log('dispatch sweep dormant — not the live instance')
}

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
// The supervisor (dev.ts) owns server-graph restarts as a start-before-drain
// handoff: a successor binds beside this process and reaches READY before
// dev.ts stops us, so the port always has a ready listener. We must NOT close
// client sockets when we see a serverFile edit — that fired the browser's
// reconnect-and-reload immediately, seconds before the successor was listening,
// so the page reloaded into the handoff gap and bricked. Just stop this stale
// watcher and keep serving; our eventual death (post-READY) drops the sockets,
// and the client then reconnects/reloads onto the already-ready successor.
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
      for (let c of clients) {
        if (c.readyState == WebSocket.OPEN) c.send(JSON.stringify(msg))
      }
    }, 50)
  }
}
watch()

// Turn hooks append to a durable local spool and return without waiting for a
// loaded event loop. The server resolves the provider id through its unique
// index and sends the ordinary graph change once it gets a turn.
function turnSweep() {
  if (Deno.env.get('DB_PATH')) return
  try {
    drainTurns(({ sid, turn }) => {
      let row = db.prepare(
        `select e.eid as eid from session s
         join entity e on e.id = s.entity where s.id = ?`,
      ).get(sid) as { eid: string } | undefined
      if (!row) return
      let t = trace()
      let out = apply(
        db,
        [{
          eid: row.eid,
          name: 'session',
          comp: { turn },
        }],
        t,
        sid,
      )
      cast(out)
      effect(out, t)
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
    if (e.paths.some((p) => p.endsWith('/turns.jsonl'))) turnSweep()
    if (!e.paths.some((p) => p.endsWith('/theme.css'))) continue
    let msg = JSON.stringify({ css: ++gen })
    for (let c of clients) {
      if (c.readyState == WebSocket.OPEN) c.send(msg)
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
  // listener closes: this drain is what keeps a source-edit handoff from
  // killing a live codex turn, and it can run for minutes (settle caps at
  // 300s). The successor binds only when READY (see the bind at the bottom of
  // boot), so through this whole settle we are still the port's one listener —
  // settling above shutdown() keeps the graph answering instead of dark for
  // the duration.
  await managed.settle()
  for (let c of clients) c.close(1012, 'server restart')
  // shutdown() waits for EVERY in-flight response, and the streaming doors
  // (a /logs tail) hold theirs open indefinitely — unbounded, this wait held
  // the baton 13+ minutes while the prepped successor parked every request
  // (observed live). Bound it: past the bound, the exit below is what frees
  // the graph, and Deno.exit ends the straggler streams regardless.
  await Promise.race([
    http.shutdown(),
    new Promise((r) => setTimeout(r, 15_000)),
  ])
  await codexAccount.close()
  ownership.close()
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
  Deno.exit(0)
}

// Bind LAST. Everything above — the baton, migrate, the boot reconcilers — is
// done, so the first connection the kernel deals us is one we can answer NOW.
// Until this line the predecessor was the port's only listener and served
// through its settle; the dark gap is just its shutdown→exit plus our migrate,
// seconds instead of the whole boot. reusePort stays: it is what lets this
// bind land while the predecessor's closing listener still drains its last
// accepted connections.
let http = Deno.serve({ port, reusePort: true }, handle)
bound(ownership)

Deno.addSignalListener('SIGINT', drain)
Deno.addSignalListener('SIGTERM', drain)
booted()
// Beat 2 (or the sole "ready" of a non-join boot): fully up, migrated, serving.
// A --join successor already sent beat 1 ("bound") from becomeWriter; this is
// what tells the supervisor the handoff is COMPLETE and it may return.
await signalReady()
