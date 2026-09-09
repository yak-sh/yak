// The effects daemon (D-22388 step 3): the process that DOES. It holds the
// `-effects.lock` lease (exactly one dispatcher per graph file), tails the
// journal through the same catchup feed the server broadcasts from, and fires
// every `where:'do'` effect off rows journaled with a fed() trace — the
// server's writes and any other library writer's, uniformly. The serving
// process keeps the sockets; this process owns the worldly half: spawns,
// kills, mail, knocks, wakes, sweeps, persona sync, embeddings, dispatch —
// and, since T-35018, the graph-native runner itself, so a slow or dead web
// server can no longer slow or stop a native session.
//
// The supervisor (dev.ts) starts this only after the server's READY beat, so a
// deployment never opens a worker against a mid-migration schema. open() is
// transactional and idempotent for manual starts; SQLite owns serialization.
//
// Casts reach no socket on purpose: every write a handler makes journals
// (apply() or record()), and the SERVER's feed rebroadcasts journaled rows to
// its sockets — which is what retires the handler-internal-cast residue
// T-22496 documented. The one thing that cannot ride the journal is the
// runner's transient observation stream, and observe_link.ts pushes that to
// the serving process directly.
import { db } from './live_db.ts'
import { file as graph } from './store/sqlite.ts'
import { catchup } from './catchup.ts'
import { configureEffects, dispatch, type Where } from './effects.ts'
import { takeEffectsLease } from './effects_lease.ts'
import { bootDoing, type Doing, wireDoing } from './doing.ts'
import { known } from './catalog.ts'
import { accountService } from './accounts.ts'
import { codexIssuer, codexStore } from './codex_auth.ts'
import { responses } from './responses.ts'
import { codexReadiness } from './codex_ready.ts'
import { credentialService } from './credentials.ts'
import { type OllamaConfig } from './ollama.ts'
import { resolve } from './config.ts'
import { settingValue } from './db.ts'
import { maintainStandingFor } from './sessions.ts'
import { localIO } from './local_io.ts'
import { nativeRunner } from './native_runner.ts'
import { observeLink } from './observe_link.ts'
import { type Change } from './types.ts'
import { record } from './telemetry.ts'
import { stop as stopTimers } from './timers.ts'

// The same last line of defence the server keeps: an unhandled rejection ends
// a Deno process, and this process dying parks every pending effect until the
// supervisor respawns it.
globalThis.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  console.error('unhandled rejection —', e.reason)
})

// Exactly one dispatcher per graph file. A replacement waits here for the old
// worker's exit to free the flock; the kernel releases it on every exit.
let lease = await takeEffectsLease(graph, { wait: true })
void lease // held for the process lifetime, released by exit

// Doing needs a codex-readiness probe, the provider table for dispatch, and —
// since T-35018 — the transport the graph-native runner generates over. All
// three come from the same file-backed stores the server reads; holding a
// second accountService is reading the same auth files, not a second sign-in.
let codexAccount = accountService(codexStore(), codexIssuer())
// How long a provider exchange may make no progress before the transport
// aborts it as stalled: a hung Responses bus otherwise renews its lease forever
// and strands the generation `running` with no error (T-24135).
let stallMs = Number(Deno.env.get('CODEX_STALL_MS') ?? 300_000)
// The dispatch gate DISPATCH_EXCLUDE complements (c0b12f6): route the sweep away
// from codex when its account is signed out OR its Responses bus is unreachable
// — creds alone left a wedged bus in the rotation, where every drawn generation
// stalled behind a live claim (T-24135). One transport answers both the reach
// probe and the runner's generations, the way the server's did.
let codexBus = responses({
  credentials: codexAccount.credentials,
  headers: { originator: 'tasks', version: '0' },
  retries: 1,
  stallMs,
})
let codexReady = codexReadiness(
  () => codexAccount.status(),
  () => codexBus.reach(),
)
// Same readiness routing the server offers dispatch: graph-native codex only
// when the account is signed in. A codex session this daemon's dispatch sweep
// mints launches here too, on the runner below.
let readyProviders = async () => {
  let ok = await codexReady()
  return known(db, (name) => name != 'codex' || ok)
}

// This process reaches no socket, but the `standing` facet is maintained at the
// cast edge by whoever WROTE the turn edge (T-17855) — and the runner writes
// here now. The stamp itself journals, so browsers hear it through the server's
// feed like every other row.
let cast = (changes: Change[]) => maintainStandingFor(changes, () => {})

// Ollama's base URL, resolved at each request boundary: graph override > env >
// catalog default. The key is the server-only credential store's, read from the
// same files — its bytes never enter the graph, the wire, or a child.
let secrets = credentialService()
let ollama: OllamaConfig = {
  base: () => resolve('OLLAMA_BASE_URL', (key) => settingValue(db, key)).value!,
  key: () => secrets.secret('OLLAMA_API_KEY'),
}

// The transient observation stream is the only thing the runner still owes the
// sockets, and this is the wire that carries it there (best-effort by design).
let observations = observeLink()

// The graph-native runner, held by the doing owner. `feed` is declared below —
// the settle closure runs at write time, long after boot.
let runner = nativeRunner({
  db,
  cast,
  io: localIO({
    db,
    cast,
    settle: () => feed.settle(),
    providers: readyProviders,
  }),
  transport: codexBus,
  ollama,
  stallMs,
  observe: observations.observe,
})

let deps: Doing = {
  cast,
  native: runner.native,
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
  dispatch(r.batch, r.trace, oops, mine)
    .finally(() => feed.settle())
})
feed.watch(graph)
configureEffects({ split: true, want: mine, settle: feed.settle, oops })
setInterval(() => feed.settle(), 2_000)

// Boot reconcile — recover/reapLeases/relay(do)/ticks — then serve the feed
// forever. bootDoing's relay covers everything committed before this cursor;
// the feed covers everything after.
bootDoing(deps, syncSoon)

// A clean stop: silence the reconcilers, let in-flight graph-native
// generations and calls finish and settle (a source-edit restart must not kill
// a live turn — the server's drain did this while the runner lived there), then
// exit. The lease frees with the process, and the pending journal rows wait for
// the replacement's boot relay + feed.
Deno.addSignalListener('SIGTERM', () => {
  stopTimers()
  console.error('effectsd: SIGTERM — settling the runner, then exiting')
  runner.settle().finally(() => {
    observations.close()
    Deno.exit(0)
  })
})

console.error(`effectsd: dispatching effects for ${graph} (cursor at top)`)
