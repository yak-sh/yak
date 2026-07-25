// Git, only as far as a projection needs it: commit the files we just
// wrote, in the repos that already track them. Two rules make this safe
// to run from a server effect into somebody's live checkout. First,
// TRACKED ONLY — an untracked path is skipped, so the materializer never
// introduces a file into a repo unbidden. Second, `git commit -- <paths>`
// with an explicit pathspec and never `git add`: a pathspec commit records
// those files' working-tree bytes through a temporary index and leaves the
// repo's index untouched, so a concurrent agent's staged work survives.
// Everything else degrades: no repo, no HEAD, mid-rebase, no identity —
// the file stays written and uncommitted, which is where we started.

let dec = new TextDecoder()

let git = async (cwd: string, ...args: string[]) => {
  let { success, stdout, stderr } = await new Deno.Command('git', {
    args: ['-C', cwd, ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  return {
    ok: success,
    out: dec.decode(stdout).trim(),
    err: dec.decode(stderr).trim(),
  }
}

let dir = (p: string) => p.slice(0, p.lastIndexOf('/'))

let line = (s: string) => s.split('\n').find(Boolean)?.slice(0, 160) ?? ''

// The repo that tracks this path, or nothing. Asked from the file's own
// directory so a path under a nested checkout answers for that checkout.
let tracker = async (path: string) => {
  let at = dir(path)
  let root = await git(at, 'rev-parse', '--show-toplevel')
  if (!root.ok) return
  let known = await git(at, 'ls-files', '--error-unmatch', '--', path)
  return known.ok ? root.out : undefined
}

// Commit these paths where git already tracks them, one commit per repo.
// Safe to hand every projection path every time: a path already matching
// HEAD is a non-event, so this is the idempotent "leave the repos clean"
// move, not a "commit what I just wrote" one. Reports the repos that
// committed, the paths git doesn't track (the caller's `git add` is what
// adopts one), and the repos that refused — never throws at its caller.
export let commit = async (paths: string[], msg: string) => {
  let committed: string[] = []
  let untracked: string[] = []
  let failed: string[] = []
  let repos = new Map<string, string[]>()
  for (let p of paths) {
    let root = await tracker(p)
    if (!root) untracked.push(p)
    else repos.set(root, [...(repos.get(root) ?? []), p])
  }
  for (let [root, ps] of repos) {
    // Nothing here differs from HEAD: no empty commit, and nothing worth
    // reporting. An unborn HEAD errors instead of answering, and falls
    // through to make the initial commit.
    if ((await git(root, 'diff', '--quiet', 'HEAD', '--', ...ps)).ok) continue
    let done = await git(root, 'commit', '-q', '-m', msg, '--', ...ps)
    if (done.ok) committed.push(root)
    else failed.push(`${root}: ${line(done.err)}`)
  }
  return { committed, untracked, failed }
}
