// The effects daemon (D-22388 step 3): the process that DOES. It holds the
// `-effects.lock` lease (exactly one dispatcher per graph file), tails the
// journal through the same catchup feed the server broadcasts from, and fires
// every `where:'do'` effect off rows journaled with a fed() trace — the
// server's writes and any other library writer's, uniformly. The serving
// process keeps the sockets and the graph-native runner (`where:'serve'`);
// this process owns the worldly half: spawns, kills, mail, knocks, wakes,
// sweeps, persona sync, embeddings, dispatch.
//
// Launched with `--join` so live_db connects WITHOUT migrating — schema stays
// the server's, under the writer baton. The supervisor (dev.ts) spawns this
// only after the server's READY beat, so the schema is always current here; a
// bare manual start against a mid-migration file fails loudly and the
// supervisor's backoff respawn is the retry loop.
//
// Casts are a no-op on purpose: every write a handler makes journals (apply()
// or record()), and the SERVER's feed rebroadcasts journaled rows to its
// sockets — which is what retires the handler-internal-cast residue T-22496
// documented. Nothing here talks to a browser.
import { db } from './live_db.ts'
import { file as graph, recast } from './db.ts'
import { catchup } from './catchup.ts'
import { dispatch, type Where } from './effects.ts'
import { takeBaton } from './baton.ts'
import { bootDoing, type Doing, wireDoing } from './doing.ts'
import { providers } from './adapters.ts'
import { accountService } from './accounts.ts'
import { codexIssuer, codexStore } from './codex_auth.ts'
import { record } from './telemetry.ts'
import { stop as stopTimers } from './timers.ts'

// The same last line of defence the server keeps: an unhandled rejection ends
// a Deno process, and this process dying parks every pending effect until the
// supervisor respawns it.
globalThis.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  console.error('unhandled rejection —', e.reason)
})

// Exactly one dispatcher per graph file. A deploy successor waits here for
// its predecessor's exit to free the flock; the kernel releases it on ANY end.
let lease = await takeBaton(graph, { wait: true, suffix: '-effects.lock' })
void lease // held for the process lifetime, released by exit

// Doing needs a codex-readiness probe and the provider table for dispatch —
// both buildable from the same file-backed stores the server reads; holding a
// second accountService is reading the same auth files, not a second sign-in.
let codexAccount = accountService(codexStore(), codexIssuer())
let codexReady = () =>
  codexAccount.status().then((s) => s.ready).catch(() => false)
// Same readiness routing the server offers dispatch: graph-native codex only
// when the account is signed in. A codex session this daemon's dispatch sweep
// mints still LAUNCHES in the server — its session-created row routes to the
// `where:'serve'` arm over there.
let readyProviders = async () => {
  let ok = await codexReady()
  return providers((name) => name != 'codex' || ok)
}
let noop = () => {}

let deps: Doing = {
  cast: noop,
  // No native hooks: the graph-native runner lives in the serving process,
  // whose feed dispatches the `where:'serve'` rows. The registry is still
  // wired whole here so docs() and the sweep declarations stay one list.
  codexReady,
  readyProviders,
}
let { syncSoon } = wireDoing(deps)

let mine = (w: Where) => w == 'do'
let oops = (comp: string, e: unknown) =>
  record(db, {
    source: 'http',
    name: `effect:${comp}`,
    ok: false,
    error: String(e),
  })

// The feed: dispatch-only — no sockets to cast to. Post-dispatch settles
// catch what an async handler wrote after its row's pass (our own commits
// never bump data_version, so the watcher alone would miss them), and a slow
// safety tick bounds the window either way.
let feed = catchup(db, (r) => {
  if (!r.trace) return
  dispatch(recast(db, r), r.trace, oops, mine)
    .finally(() => feed.settle())
})
feed.watch(graph)
setInterval(() => feed.settle(), 2_000)

// Boot reconcile — recover/reapLeases/relay(do)/ticks — then serve the feed
// forever. bootDoing's relay covers everything committed before this cursor;
// the feed covers everything after.
bootDoing(deps, syncSoon)

// A clean stop: silence the reconcilers, then exit — the lease frees with
// the process, and the pending journal rows wait for the successor's boot
// relay + feed.
Deno.addSignalListener('SIGTERM', () => {
  stopTimers()
  console.error('effectsd: SIGTERM — exiting; lease frees with the process')
  Deno.exit(0)
})

console.error(`effectsd: dispatching effects for ${graph} (cursor at top)`)
