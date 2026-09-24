// Git, only as far as `task commit` needs it: the revision a ref names, with
// its repo root and whole message.

import { git as run, gitRepo } from './repo.ts'

let git = (cwd: string, ...args: string[]) => run(cwd, args)

// The revision `task commit` records: the sha a ref resolves to (HEAD by
// default), the repo root, and the whole commit message — or nothing when
// cwd is not a repo or the ref names no commit.
export let revision = async (cwd: string, ref = 'HEAD') => {
  let sha = await gitRepo(cwd).revAt(ref)
  if (!sha.ok) return
  let at = sha.out.trim()
  let root = await git(cwd, 'rev-parse', '--show-toplevel')
  let message = await git(cwd, 'log', '-1', '--format=%B', at)
  return { sha: at, repo: root.out.trim(), message: message.out.trim() }
}
