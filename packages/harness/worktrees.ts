// A checkout's whole life: handed to a session, taken back when that session
// is over, and cut again where it stood when the session comes back.
// workspace.ts cuts `<root>/<child id>` per delegated session and nothing ever
// reclaimed it: 412 of them at 167M each filled the root disk twice in one day
// (T-37640). A checkout is garbage when its session is OVER and it holds
// nothing — a clean working tree whose HEAD already exists on some other
// branch, the base it was cut from, the parent's branch, main. Its own branch
// never counts; that is what "unlanded" means. Anything dirty or ahead is KEPT
// and named in the answer, so a leak has nowhere to hide but that list.
// Nothing here passes `--force`, so Git's own refusal is the second guard
// behind our first.
//
// Over is read off the graph, never off the pool: a dispatch settling is the
// pool letting go of a child, while the transcript ends with a `stop` line, an
// exception, an exit of the process behind it, or a turn that asked for
// nothing. `collecting()` wires every one of those endings to the same test.
//
// A session that is over can still be RESUMED, and then it wants its work
// back. So the row is made true before the bytes go — `discover` records the
// commit the checkout stands on — and `restore()` cuts it again at that
// commit, on the same branch, at the same path. Nothing new had to be
// recorded for that: `worktree{path, head, branch}` already said it, it had
// only gone stale since the day the checkout was cut.
//
// Boot sweeps the whole root the same way, and also removes the checkouts Git
// has already forgotten — a `.git` file naming a gitdir that is gone —
// because the CI runner recreates its repository between jobs and left 281 of
// those behind.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import { discover } from '@yaks/git/host'
import { worktrees } from './paths.ts'

/** Why a checkout was kept: uncommitted files, commits that are nowhere else,
 * or a removal that did not succeed. */
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

/** What a git command said, or nothing where it failed. */
let git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  let said = await run(cwd, args)
  return said.ok ? said.out : undefined
}

/** The same, loud: a checkout that cannot be cut again has to say why. */
let must = async (cwd: string, args: string[]): Promise<string> => {
  let said = await run(cwd, args)
  if (!said.ok) throw new Error('git ' + args.join(' ') + ': ' + said.err)
  return said.out
}

let row = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/** A checkout Git has already lost: the gitdir its `.git` file names is gone,
 * so nothing can be committed from it and nothing read out of it. */
export let lost = async (path: string): Promise<boolean> => {
  let named = /^gitdir:\s*(.+)$/m.exec(
    await Deno.readTextFile(path + '/.git').catch(() => ''),
  )?.[1]
  return !!named &&
    !await Deno.stat(named.trim()).then(() => true, () => false)
}

/** What this checkout still holds, `undefined` when it holds nothing. A path
 * that is not a checkout at all reads as `unlanded` — kept, never guessed at. */
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

/** Take back one checkout — the directory and the branch it was cut onto —
 * unless it still holds something. Answers what kept it, or nothing. */
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
  // The branch outlives its checkout, and only the repository can delete it.
  // `-D` is safe here: the commits were proved to exist on another branch.
  if (branch && common) {
    await git(common, ['--git-dir=' + common, 'branch', '-D', branch])
  }
  return undefined
}

/** The checkout workspace.ts cuts for this session, by name. */
export let cutFor = (session: string, dir = worktrees()): string =>
  `${dir}/${session.replaceAll(':', '-')}`

/** What a transcript reads as once nothing is owed in it. */
export let ENDED = ['settled', 'stopped', 'failed']

/** A session nothing will be performed in again: its transcript has ended —
 * a `stop` line, an exception, or a turn that asked for nothing — and where
 * the session IS a host process, that process has exited. A settled
 * transcript counts: it can be resumed, and a resume cuts its checkout
 * again. */
export let over = (b: Bundle): boolean =>
  ENDED.includes(String((b.session as Comp | undefined)?.status)) &&
  !(b.process && !b.exit)

/** The sessions a sweep must leave alone: every one not yet over — `over()`
 * said as two queries, the ENDED list and the running process, rather than
 * read off the whole table: a graph holding years of transcripts is swept at
 * every boot. A session still being started, with no lines in it at all, is
 * one of these: nothing is owed in it yet, but nothing has ended either. */
export let going = async (g: Graph): Promise<Bundle[]> => [
  ...await g.read(`.session&.session.status!=${ENDED.join(',')}`),
  ...await g.read('.session&.process&.exit='),
]

/** Take one checkout back, its row made true first: where it stands is all a
 * resume has to cut it again from, and Git is the only one who knows. A path
 * Git has lost answers nothing and is removed outright. */
let take = async (g: Graph, path: string): Promise<Held | undefined> => {
  await discover(g, path).catch(() => {})
  return reclaim(path)
}

/** Hand back the checkout this session was given, if the session is over and
 * the checkout holds nothing. Answers what kept it, or nothing — including
 * for a session that never had a checkout of its own. */
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

/** Wire collection to the graph: a checkout comes back the moment its session
 * is over, however that ending landed — a `stop` line in the transcript, the
 * exit of the process behind it, or the pool letting go of a child. Three
 * doors, one test, so no door can collect a session that is still going. */
export let collecting = (
  g: Graph,
  fx: Effects,
  report: (error: unknown, session: Eid) => void,
  dir = worktrees(),
): void => {
  // Never awaited: a `git worktree remove` must not hold the batch that
  // ended the session, and what a crash leaves is the boot sweep's to find.
  let at = (session: Eid) =>
    void collect(g, session, dir).catch((error) => report(error, session))
  fx.created('stop', async (e) => {
    let session = ((await row(g, e.entity.eid))?.entry as Comp | undefined)
      ?.session
    // `stop` is also how @yaks/process says a service is wanted down.
    if (typeof session == 'string') at(session)
  })
  fx.created('exit', (e) => at(e.entity.eid))
  fx.changed('dispatch', 'state', (e) => {
    if (e.comp?.state == 'settled') at(e.entity.eid)
  })
}

/** Where this checkout stands, standing. One that was collected is cut again
 * exactly where it was — same path, same branch, at the commit it held when
 * its bytes were handed back, which is on a landed branch or it would never
 * have been handed back — so a session picked up again picks up its work. */
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
  // Collection deletes the branch with the checkout, but a branch somebody
  // kept is the truth about where that work stands, not our stale copy of it.
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

/** The checkouts these sessions still call home — never swept. Both halves
 * are needed: the name covers a child whose checkout is being cut right now
 * and has no `home` row yet, the row covers a descendant that INHERITED an
 * ancestor's home and so lives under a name that is not its own. */
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

/** Take back every checkout under the root, answering the ones kept and why.
 * A missing root is an empty sweep, not a fault.
 *
 * A sweep is about what an earlier run LEFT, so a directory that appeared
 * after it began is never its business: that is a session still starting, and
 * its fresh checkout reads as clean and landed exactly like garbage does. */
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
