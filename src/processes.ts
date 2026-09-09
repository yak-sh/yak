// The fleet's binding of @yaks/process: the two verbs that package asks a host
// for, answered against the live graph, plus the boot reconcile the doing owner
// runs (doing.ts).
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
import { type Store, watch } from '@yaks/process'

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

/** The live graph as @yaks/process's store. */
export let processStore = (cast: Cast): Store => ({
  apply: (bundles) => {
    cast(apply(db, lower(bundles)))
    return bundles
  },
  running,
})

/**
 * Boot reconcile: pick every unfinished process back up, and stamp the ones
 * that died while we were away. Backgrounded — a supervisor's first look must
 * never hold boot — and a rejection nobody handles would end the process.
 */
export let watchProcesses = (cast: Cast) =>
  watch(processStore(cast)).catch((e) => console.warn('process watch —', e))
