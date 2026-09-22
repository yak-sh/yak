// A git worktree's whole life: created for a session, removed when that
// session is over, and created again in the same place when the session comes
// back. workspace.ts creates `<root>/<child id>` per delegated session and
// nothing ever removed them: 412 of them at 167M each filled the root disk
// twice in one day (T-37640). A worktree can be removed when its session is
// over and holds nothing — a clean working tree whose HEAD already exists on
// some other branch: the base it was created from, the parent's branch, main.
// Its own branch never counts; that is what "unlanded" means. Anything dirty or
// ahead of those branches is kept and listed in the result, so a leak has
// nowhere to hide but that list. Nothing here passes `--force`, so Git's own
// refusal is a second guard behind ours.
//
// Whether a session is over is read from the graph, never from the pool: a
// dispatch settling means the pool has let go of a child, while the transcript
// ends with a `stop` entry, an exception, the exit of the process behind it, or
// a turn that asked for nothing. `collecting()` connects every one of those
// endings to the same test.
//
// A session that is over can still be resumed, and then it needs its work back.
// So the row is brought up to date before the files are deleted — `discover`
// records the commit the worktree is checked out at — and `restore()` creates
// it again at that commit, on the same branch, at the same path. Nothing new
// had to be recorded for that: `worktree{path, head, branch}` already held it;
// it had only gone stale since the worktree was created.
//
// Startup sweeps the whole root directory the same way, and also removes the
// worktrees Git has already forgotten — a `.git` file naming a gitdir that no
// longer exists — because the CI runner recreates its repository between jobs
// and left 281 of those behind.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import { discover } from '@yaks/git/host'
import { worktrees } from './paths.ts'

/** Why a worktree was kept: uncommitted files, commits that exist nowhere
 * else, or a removal that did not succeed. */
export type Held = 'dirty' | 'unlanded' | 'failed'

let run = async (cwd: string, args: string[]) => {
  let p = await new Deno.Command('git', {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output().catch(() => undefined)
  let say = (bytes?: Uint8Array) =>
    bytes ? new TextDecoder().decode(bytes).trimEnd() : ''
  return {
    ok: !!p?.success,
    out: say(p?.stdout),
    err: say(p?.stderr).trim() || 'git did not run',
  }
}

/** A git command's output, or nothing when it failed. */
let git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  let said = await run(cwd, args)
  return said.ok ? said.out : undefined
}

/** The same, but throwing: a worktree that cannot be created again has to
 * report why. */
let must = async (cwd: string, args: string[]): Promise<string> => {
  let said = await run(cwd, args)
  if (!said.ok) throw new Error('git ' + args.join(' ') + ': ' + said.err)
  return said.out
}

let row = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/** A worktree Git has already lost: the gitdir its `.git` file names is gone,
 * so nothing can be committed from it and nothing read out of it. */
export let lost = async (path: string): Promise<boolean> => {
  let named = /^gitdir:\s*(.+)$/m.exec(
    await Deno.readTextFile(path + '/.git').catch(() => ''),
  )?.[1]
  return !!named &&
    !await Deno.stat(named.trim()).then(() => true, () => false)
}

/** What this worktree still holds, `undefined` when it holds nothing. A path
 * that is not a worktree at all is reported as `unlanded` — kept, never guessed
 * at. */
export let holds = async (path: string): Promise<Held | undefined> => {
  if (await git(path, ['status', '--porcelain'])) return 'dirty'
  let head = await git(path, ['rev-parse', '--verify', 'HEAD'])
  if (!head) return 'unlanded'
  let own = await git(path, ['symbolic-ref', '--quiet', 'HEAD'])
  let elsewhere = (await git(path, [
    'for-each-ref',
    '--contains',
    head,
    '--format=%(refname)',
    'refs/heads/',
  ]) ?? '').split('\n').filter((ref) => ref && ref != own)
  return elsewhere.length ? undefined : 'unlanded'
}

/** Remove one worktree — the directory and the branch it was created on —
 * unless it still holds something. Returns what kept it, or nothing. */
export let reclaim = async (path: string): Promise<Held | undefined> => {
  if (await lost(path)) {
    return await Deno.remove(path, { recursive: true })
      .then(() => undefined, () => 'failed' as Held)
  }
  let held = await holds(path)
  if (held) return held
  let branch = await git(path, ['symbolic-ref', '--short', '--quiet', 'HEAD'])
  let common = await git(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  if (await git(path, ['worktree', 'remove', path]) == null) return 'failed'
  // The branch outlives its worktree, and only the repository can delete it.
  // `-D` is safe here: the commits were proved to exist on another branch.
  if (branch && common) {
    await git(common, ['--git-dir=' + common, 'branch', '-D', branch])
  }
  return undefined
}

/** The path workspace.ts creates this session's worktree at. */
export let cutFor = (session: string, dir = worktrees()): string =>
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
  ...await g.read(`.session&.session.status!=${ENDED.join(',')}`),
  ...await g.read('.session&.process&.exit='),
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
  dir = worktrees(),
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
  dir = worktrees(),
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

/** The path this worktree is checked out at, creating it again if it was
 * removed — same path, same branch, at the commit it held when it was removed,
 * which is on a merged branch or it would never have been removed — so a
 * session picked up again picks up its work. */
export let restore = async (g: Graph, tree: Bundle): Promise<string> => {
  let w = tree.worktree as Comp | undefined
  if (!w?.path) throw new Error('worktree ' + tree.entity.eid + ' has no path')
  let path = String(w.path)
  if (await Deno.stat(path).then(() => true, () => false)) return path
  let common =
    ((await row(g, String(w.repository)))?.repository as Comp | undefined)
      ?.common
  let head = w.head
  if (typeof common != 'string' || typeof head != 'string') {
    throw new Error('nothing recorded to cut ' + path + ' again from')
  }
  let name = w.branch
    ? String(
      ((await row(g, String(w.branch)))?.ref as Comp | undefined)?.name ?? '',
    )
    : ''
  let branch = name.replace(/^refs\/heads\//, '')
  // Removing a worktree deletes its branch too, but a branch somebody else
  // kept is where that work actually is, not our stale copy of it.
  let standing = !!branch &&
    await git(common, ['rev-parse', '--verify', '--quiet', name]) != null
  await must(common, [
    'worktree',
    'add',
    ...branch ? standing ? [] : ['-b', branch] : ['--detach'],
    path,
    standing ? branch : head,
  ])
  await discover(g, path)
  return path
}

/** The worktrees these sessions are still using — never swept. Both halves are
 * needed: the path covers a child whose worktree is being created right now and
 * has no `home` row yet, and the row covers a descendant that inherited an
 * ancestor's home and so lives under a path that is not named after it. */
export let homes = async (
  g: Graph,
  sessions: Bundle[],
  dir = worktrees(),
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
  dir = worktrees(),
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
