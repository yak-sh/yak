// The checkouts a child session leaves behind, and the one place they are
// taken back. workspace.ts cuts `<root>/<child id>` per delegated session and
// nothing ever reclaimed it: 412 of them at 167M each filled the root disk
// twice in one day (T-37640). A checkout is garbage the moment its session
// ends AND it holds nothing — a clean working tree whose HEAD already exists
// on some other branch, the base it was cut from, the parent's branch, main.
// Its own branch never counts; that is what "unlanded" means. Anything dirty
// or ahead is KEPT and named in the answer, so a leak has nowhere to hide but
// that list. Nothing here passes `--force`, so Git's own refusal is the second
// guard behind our first.
//
// Two ends meet here, both in run.ts: one child's checkout goes when its
// dispatch settles, and the whole root is swept at boot. Boot also removes the
// checkouts Git has already forgotten — a `.git` file naming a gitdir that is
// gone — because the CI runner recreates its repository between jobs and left
// 281 of those behind.
//
// The graph keeps its record of what a session had; the bytes are what this
// file reclaims.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { worktrees } from './paths.ts'

/** Why a checkout was kept: uncommitted files, commits that are nowhere else,
 * or a removal that did not succeed. */
export type Held = 'dirty' | 'unlanded' | 'failed'

let git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  let p = await new Deno.Command('git', {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'null',
  }).output().catch(() => undefined)
  return p?.success ? new TextDecoder().decode(p.stdout).trimEnd() : undefined
}

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
    let held = await reclaim(path).catch(() => 'failed' as Held)
    if (held) kept[path] = held
  }
  return kept
}
