// The fleet's binding of @yaks/process: the three verbs that package asks a
// host for, answered against the live graph, plus the boot reconcile and the
// supervisor pass the doing owner runs (doing.ts).
//
// The package speaks bundles and one query; we speak `Change[]` through
// apply() — so the whole binding is a lowering and a statement. It goes through
// apply(), not a raw insert, because a process row is ordinary graph data: it
// journals, it dispatches effects, and the cast is what keeps every open client
// from holding a ghost.
//
// A process a SESSION names is not this supervisor's to watch. The session
// launcher already tails that child, keeps its files under LOGS_DIR, and stamps
// the process's `exit` from its own settle with the code it observed
// (sessions.ts); recover() re-adopts it at boot the same way. Two watchers over
// one pid would only race, and the loser's answer — `exit{code: null}`, since
// this supervisor's code file was never written — is the worse one. So the read
// below leaves them out and covers every OTHER process the graph tracks.
import { apply } from './db.ts'
import { db } from './live_db.ts'
import { type Change } from './types.ts'
import type { Bundle } from '@yaks/graph'
import { type Store, supervise, watch } from '@yaks/process'

type Cast = (changes: Change[]) => void

// A bundle is one entity's comps; a Change is one comp. `entity` carries no
// writable column of ours, so it names the eid and nothing more.
let lower = (bundles: Bundle[]): Change[] =>
  bundles.flatMap((b) =>
    Object.entries(b).filter(([name]) => name != 'entity').map((
      [name, comp],
    ) => ({
      eid: b.entity.eid,
      name,
      comp: (comp ?? null) as Record<string, unknown> | null,
    }))
  )

// The one read the package makes: every process with no `exit` yet — minus the
// ones a session owns (see the header).
let running = () =>
  (db.prepare(
    `select o.eid as eid, p.pid as pid
       from process p join entity o on o.id = p.entity
      where not exists (select 1 from "exit" x where x.entity = p.entity)
        and not exists (select 1 from session s where s.process = p.entity)`,
  ).all() as { eid: string; pid: number | null }[])
    .map((r): Bundle => ({ entity: { eid: r.eid }, process: { pid: r.pid } }))

// Desired state, the package's other read (T-35328): every service row with
// the process, ending and stop that ride the same entity. One statement, since
// the supervisor asks about whole rows and a join beats four queries. The three
// `is not null` flags are what tell "no process yet" from "a process with no
// pid" — the package decides differently on each.
let services = () =>
  (db.prepare(
    `select o.eid as eid, s.command as command, s.cwd as cwd,
            s.restart as restart, s.attempts as attempts,
            p.entity is not null as started, p.pid as pid,
            x.entity is not null as over, x.code as code,
            t.entity is not null as stopping
       from service s
       join entity o on o.id = s.entity
       left join process p on p.entity = s.entity
       left join "exit" x on x.entity = s.entity
       left join stop t on t.entity = s.entity`,
  ).all() as {
    eid: string
    command: string | null
    cwd: string | null
    restart: string | null
    attempts: number | null
    started: number
    pid: number | null
    over: number
    code: number | null
    stopping: number
  }[]).map((r): Bundle => ({
    entity: { eid: r.eid },
    service: {
      command: r.command,
      cwd: r.cwd,
      restart: r.restart,
      attempts: r.attempts,
    },
    ...(r.started ? { process: { pid: r.pid } } : {}),
    ...(r.over ? { exit: { code: r.code } } : {}),
    ...(r.stopping ? { stop: {} } : {}),
  }))

/** The live graph as @yaks/process's store. */
export let processStore = (cast: Cast): Store => ({
  apply: (bundles) => {
    cast(apply(db, lower(bundles)))
    return bundles
  },
  running,
  services,
})

// The one program this supervisor may never run. Exactly one supervisor sits
// above effectsd — systemd, in the unit that starts it — and a daemon that
// respawned itself would be a fork bomb with a restart policy. The package
// already refuses its OWN program, which covers split mode where this code IS
// effectsd; this covers inline mode, where the doing owner is the web server
// and a row naming effectsd would not be its own program.
let daemon = (command: string) =>
  command.split(/\s+/).some((a) => a.split('/').pop() == 'effectsd.ts')

/**
 * The supervisor pass, for the doing owner's tick: spawn a service that has no
 * process, respawn one whose process ended per its `restart`, and take down one
 * that carries a `stop`. Built once — the pass remembers when each backoff
 * expires — so call this at boot and hand the result to `tick`.
 */
export let superviseServices = (cast: Cast) =>
  supervise(processStore(cast), { refuse: daemon })

/**
 * Boot reconcile: pick every unfinished process back up, and stamp the ones
 * that died while we were away. Backgrounded — a supervisor's first look must
 * never hold boot — and a rejection nobody handles would end the process.
 */
export let watchProcesses = (cast: Cast) =>
  watch(processStore(cast)).catch((e) => console.warn('process watch —', e))
