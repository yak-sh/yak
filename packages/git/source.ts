// Read a commit's regular-file blobs, never the checkout's mutable files.
// Paths and revisions are data, restricted before they reach Git's arguments.

import { type Run, run } from './land.ts'

// deno-lint-ignore no-control-regex
let unsafe = /[\\\x00-\x1f\x7f]/

export let repoPath = (path: string): boolean =>
  !!path && !path.startsWith('/') && !unsafe.test(path) &&
  path.split('/').every((part) => !!part && part != '.' && part != '..')

export let treeAt = async (
  cwd: string,
  commit: string,
  paths: string[],
  ask: Run = run,
): Promise<Map<string, string>> => {
  let out = new Map<string, string>()
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return out
  let safe = [...new Set(paths.filter(repoPath))]
  if (!safe.length) return out
  let got = await ask([
    '--literal-pathspecs',
    'ls-tree',
    '-z',
    `${commit}^{commit}`,
    '--',
    ...safe,
  ], cwd)
  if (!got.ok) return out
  for (let entry of got.out.split('\0')) {
    let match = entry.match(/^100(?:644|755) blob ([a-f0-9]+)\t(.+)$/)
    if (match && safe.includes(match[2])) out.set(match[2], match[1])
  }
  return out
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
