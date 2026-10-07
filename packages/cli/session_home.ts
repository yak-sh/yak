// The box's transition door for homes written before session machines.
// Only the SQLite-facing CLI knows the old column. The harness sees a machine
// home; retained worktree values let workers already in flight finish normally.
import { type Comp, derivedEid, type Graph } from '@yaks/graph'
import { col, type Driver, eq, select, table, val } from '@yaks/sql'
import { columns } from '@yaks/sqlite'

/** Stable per-session identity, shared with the one-time stored-row mover. */
export let migratedMachine = (session: string): string =>
  derivedEid('session machine home ' + session)

/** A legacy home as stored, resolving references at the SQLite boundary. */
export let legacyHome = (driver: Driver, session: string): Comp | undefined => {
  if (!columns(driver, 'home').includes('worktree')) return undefined
  let rows = driver.query(select({
    cols: [col('worktree', 'h'), col('cwd', 'h')],
    from: table('home', 'h'),
    joins: [{
      how: 'join',
      src: table('entity', 'e'),
      on: eq(col('entity', 'h'), col('id', 'e')),
    }],
    where: eq(col('eid', 'e'), val(session)),
  }))
  let row = rows[0]
  if (row?.worktree == null) return undefined
  let [tree] = driver.query(select({
    cols: [col('path', 'w'), col('head', 'w')],
    from: table('worktree', 'w'),
    where: eq(col('entity', 'w'), val(Number(row.worktree))),
  }))
  let path = tree?.path ?? row.cwd
  if (path == null) {
    // A swept parent checkout may leave children with only its kept identity.
    // Other homes naming that exact identity retain the explicit directory;
    // unanimous evidence is safe, whereas borrowing this host's cwd is not.
    let peers = driver.query(select({
      cols: [col('cwd')],
      from: table('home'),
      where: eq(col('worktree'), val(Number(row.worktree))),
    }))
    let paths = [
      ...new Set(
        peers.map((peer) => peer.cwd).filter((cwd) =>
          typeof cwd == 'string' && cwd.startsWith('/')
        ),
      ),
    ]
    if (paths.length == 1) path = paths[0]
  }
  if (typeof path != 'string' || !path.startsWith('/')) {
    throw new Error(
      'Legacy session home has no checkout or absolute cwd: ' + session,
    )
  }
  return {
    machine: migratedMachine(session),
    address: path,
    cwd: row.cwd ?? path,
    from: tree?.head,
  }
}

/** Lend old attached homes through today's machine capability. This neither
 * provisions nor deletes a checkout and never clears what an old worker reads. */
export let resolveSessionHome =
  (driver: Driver, graph: () => Graph) =>
  async (session: string): Promise<Comp | undefined> => {
    let old = legacyHome(driver, session)
    if (!old) return undefined
    let g = graph()
    let [existing] = await g.get([String(old.machine)])
    if (!existing?.machine) {
      let [commit] = old.from ? await g.get([String(old.from)]) : []
      await g.apply([{
        entity: { eid: String(old.machine) },
        machine: {
          provider: 'process',
          address: old.address,
          state: 'running',
          ...commit?.gitobj ? { from: old.from } : {},
        },
      }])
    }
    return { machine: old.machine, cwd: old.cwd }
  }
