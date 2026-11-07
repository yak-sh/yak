// Read a commit's regular-file blobs, never the checkout's mutable files.
// Paths and revisions are data, restricted before they reach Git's arguments.

import { type Run, run } from './land.ts'

// deno-lint-ignore no-control-regex
let unsafe = /[\\\x00-\x1f\x7f]/

export let repoPath = (path: string): boolean =>
  !!path && !path.startsWith('/') && !unsafe.test(path) &&
  path.split('/').every((part) => !!part && part != '.' && part != '..')

// What a commit holds at each path, or undefined where Git could not say.
let listed = async (
  cwd: string,
  commit: string,
  paths: string[],
  ask: Run,
): Promise<Map<string, string> | undefined> => {
  let got = await ask([
    '--literal-pathspecs',
    'ls-tree',
    '-z',
    `${commit}^{commit}`,
    '--',
    ...paths,
  ], cwd)
  if (!got.ok) return
  let out = new Map<string, string>()
  for (let entry of got.out.split('\0')) {
    let match = entry.match(/^100(?:644|755) blob ([a-f0-9]+)\t(.+)$/)
    if (match && paths.includes(match[2])) out.set(match[2], match[1])
  }
  return out
}

/** A commit's regular-file blobs: `(commit, paths)` maps each path the commit
 * holds as a regular file to its blob id. A commit never changes, so each path
 * is asked of Git once while its commit is among the `keep` read most
 * recently, however many callers ask at once; a read Git refused is asked
 * again next time. */
export let trees = (
  cwd: string,
  { keep = 16, ask = run }: { keep?: number; ask?: Run } = {},
): (commit: string, paths: string[]) => Promise<Map<string, string>> => {
  let commits = new Map<string, Map<string, Promise<string | undefined>>>()
  return async (commit, paths) => {
    let out = new Map<string, string>()
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return out
    let safe = [...new Set(paths.filter(repoPath))]
    if (!safe.length) return out
    let seen = commits.get(commit) ?? new Map()
    commits.delete(commit)
    commits.set(commit, seen)
    for (let old of commits.keys()) {
      if (commits.size <= keep) break
      commits.delete(old)
    }
    let missing = safe.filter((p) => !seen.has(p))
    if (missing.length) {
      let asked = listed(cwd, commit, missing, ask)
      for (let path of missing) {
        let blob = asked.then((got) => {
          if (!got && seen.get(path) == blob) seen.delete(path)
          return got?.get(path)
        })
        seen.set(path, blob)
      }
    }
    for (let path of safe) {
      let blob = await seen.get(path)
      if (blob) out.set(path, blob)
    }
    return out
  }
}

/// await commitsOf('.', 'zz') -> []
/** Every commit an abbreviated or full sha names in the repository at `cwd`,
 * by its full sha, as Git reads one: the one it names, none, or each of
 * several that start that way, which Git refuses to choose between. */
export let commitsOf = async (
  cwd: string,
  sha: string,
  ask: Run = run,
): Promise<string[]> => {
  if (!/^[0-9a-f]{4,64}$/.test(sha)) return []
  let commit = (id: string) =>
    ask(['rev-parse', '--verify', '--quiet', `${id}^{commit}`], cwd)
  let one = await commit(sha)
  if (one.ok) return [one.out.trim()]
  // A prefix Git would not read lists every object it starts, of any type;
  // the commits among them are the ones it names.
  let all = await ask(['rev-parse', `--disambiguate=${sha}`], cwd)
  if (!all.ok) return []
  let peeled = await Promise.all(
    all.out.split('\n').filter(Boolean).map(commit),
  )
  return [...new Set(peeled.filter((p) => p.ok).map((p) => p.out.trim()))]
}

/** All checkout roots, including the primary; observation never prunes Git. */
export let rootsOf = async (
  common: string,
  ask: Run = run,
): Promise<string[]> => {
  let got = await ask([
    '--git-dir=' + common,
    'worktree',
    'list',
    '--porcelain',
  ], common)
  if (!got.ok) throw Error(got.err.trim())
  return got.out.split('\n').filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}
