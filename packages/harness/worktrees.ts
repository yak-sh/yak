// A git worktree's whole life: created for a session, removed when that
// session is over, and created again in the same place when the session comes
// back. workspace.ts creates `<root>/<child id>` per delegated session and
// nothing ever removed them: 412 of them at 167M each filled the root disk
// twice in one day (T-37640). A worktree can be removed when its session is
// over and it holds nothing; what "holds nothing" means, the removal itself and
// the re-creation are Git's business and live in @yaks/git/host (`holds`,
// `reclaim`, `restore`). This file ties them to sessions. Anything a worktree
// still holds is kept and listed in the result, so a leak has nowhere to hide
// but that list.
//
// Whether a session is over is read from the graph, never from the pool: a
// dispatch settling means the pool has let go of a child, while the transcript
// ends with a `stop` entry, an exception, the exit of the process behind it, or
// a turn that asked for nothing. `collecting()` connects every one of those
// endings to the same test.
//
// A session that is over can still be resumed, and then it needs its work back.
// So the row is brought up to date before the files are deleted — `discover`
// records the commit the worktree is checked out at — and @yaks/git/host's
// `restore()` creates it again at that commit, on the same branch, at the same
// path.
//
// Startup sweeps the whole root directory the same way, and also removes the
// worktrees Git has already forgotten — a `.git` file naming a gitdir that no
// longer exists — because the CI runner recreates its repository between jobs
// and left 281 of those behind.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import { discover, type Held, reclaim } from '@yaks/git/host'

let row = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/** The path workspace.ts creates this session's worktree at. */
export let cutFor = (session: string, dir: string): string =>
  `${dir}/${session.replaceAll(':', '-')}`

/** The statuses a transcript has once nothing is left to do in it. */
export let ENDED = ['settled', 'stopped', 'failed']

/** A session that will not run anything again: its transcript has ended — a
 * `stop` entry, an exception, or a turn that asked for nothing — and where the
 * session is a child process, that process has exited. A settled transcript
 * counts: it can be resumed, and resuming it creates its worktree again. */
export let over = (b: Bundle): boolean =>
  ENDED.includes(String((b.session as Comp | undefined)?.status)) &&
  !(b.process && !b.exit)

/** The sessions a sweep must leave alone: every one not yet over — the same
 * test as `over()`, written as two queries (the ENDED list and the running
 * process) rather than by reading the whole table, because a graph holding
 * years of transcripts is swept at every startup. A session still starting,
 * with no entries in it at all, is one of these: nothing is pending in it yet,
 * but nothing has ended either. */
export let going = async (g: Graph): Promise<Bundle[]> => [
  ...await g.read(`.session&.session.status!=${ENDED.join(',')}&.home?`),
  ...await g.read('.session&.process&.exit=&.home?'),
]

/** Remove one worktree, bringing its row up to date first: where it is checked
 * out is all a resume needs to create it again, and only Git knows that. A path
 * Git has lost returns nothing and is deleted outright. */
let take = async (g: Graph, path: string): Promise<Held | undefined> => {
  await discover(g, path).catch(() => {})
  return reclaim(path)
}

/** Remove the worktree this session was given, if the session is over and the
 * worktree holds nothing. Returns what kept it, or nothing — including for a
 * session that never had a worktree of its own. */
export let collect = async (
  g: Graph,
  session: Eid,
  dir: string,
): Promise<Held | undefined> => {
  let path = cutFor(session, dir)
  if (!await Deno.stat(path).then(() => true, () => false)) return undefined
  let b = await row(g, session)
  if (!b?.session || !over(b)) return undefined
  return take(g, path)
}

/** Register the effect handlers that remove a worktree the moment its session
 * is over, however that ending arrived — a `stop` entry in the transcript, the
 * exit of the process behind it, or the pool letting go of a child. Three
 * handlers, one test, so none of them can remove the worktree of a session that
 * is still running. */
export let collecting = (
  g: Graph,
  fx: Effects,
  report: (error: unknown, session: Eid) => void,
  dir: string,
): void => {
  // Never awaited: a `git worktree remove` must not hold open the transaction
  // that ended the session, and whatever a crash leaves behind is for the
  // startup sweep to find.
  let at = (session: Eid) =>
    void collect(g, session, dir).catch((error) => report(error, session))
  fx.created('stop', async (e) => {
    let session = ((await row(g, e.entity.eid))?.entry as Comp | undefined)
      ?.session
    // `stop` is also how @yaks/process records that a service should be
    // stopped.
    if (typeof session == 'string') at(session)
  })
  fx.created('exit', (e) => at(e.entity.eid))
  fx.changed('dispatch', 'state', (e) => {
    if (e.comp?.state == 'settled') at(e.entity.eid)
  })
}

/** The worktrees these sessions are still using — never swept. Both halves are
 * needed: the path covers a child whose worktree is being created right now and
 * has no `home` row yet, and the row covers a descendant that inherited an
 * ancestor's home and so lives under a path that is not named after it. */
export let homes = async (
  g: Graph,
  sessions: Bundle[],
  dir: string,
): Promise<Set<string>> => {
  let live = new Set(sessions.map((b) => cutFor(b.entity.eid, dir)))
  let ids = sessions
    .map((b) => (b.home as Comp | undefined)?.worktree)
    .filter((eid): eid is string => typeof eid == 'string')
  if (!ids.length) return live
  let rows = await g.storage.tx((tx) => tx.get([...new Set(ids)]))
  for (let b of rows) {
    let path = (b.worktree as Comp | undefined)?.path
    if (typeof path == 'string') live.add(path)
  }
  return live
}

/** Remove every worktree under the root directory, returning the ones kept and
 * why. A missing root directory is an empty sweep, not an error.
 *
 * A sweep is about what an earlier run left behind, so a directory that
 * appeared after the sweep began is never its business: that is a session still
 * starting, and its new worktree looks clean and merged exactly as an
 * abandoned one does. */
export let sweep = async (
  g: Graph,
  dir: string,
  live: Set<string> = new Set(),
): Promise<Record<string, Held>> => {
  let began = Date.now()
  let kept: Record<string, Held> = {}
  let entries: Deno.DirEntry[] = []
  try {
    for await (let e of Deno.readDir(dir)) entries.push(e)
  } catch {
    return kept
  }
  for (let e of entries) {
    if (!e.isDirectory) continue
    let path = `${dir}/${e.name}`
    if (live.has(path)) continue
    let cut = await Deno.stat(path).then(
      (s) => (s.birthtime ?? s.mtime)?.getTime() ?? 0,
      () => 0,
    )
    if (cut > began) continue
    let held = await take(g, path).catch(() => 'failed' as Held)
    if (held) kept[path] = held
  }
  return kept
}
