// Git, only as far as a projection needs it: commit the files we just
// wrote, in the repos that already track them. Two rules make this safe
// to run from a server effect into somebody's live checkout. First,
// TRACKED ONLY — an untracked path is skipped, so the materializer never
// introduces a file into a repo unbidden. Second, `git commit -- <paths>`
// with an explicit pathspec and never `git add`: a pathspec commit records
// those files' working-tree bytes through a temporary index and leaves the
// repo's index untouched, so a concurrent agent's staged work survives.
// Everything else degrades: no repo, no HEAD, mid-rebase, no identity,
// branch behind its upstream — the file stays written and uncommitted,
// which is where we started.
//
// That last one is why this file knows about upstreams at all. These are
// SHARED checkouts holding no work but ours, and nobody drains them:
// agents ship with `push origin HEAD:main`, which moves origin and leaves
// the shared tree's branch exactly where it was. Commit onto it anyway and
// the fork deepens without bound — 49 commits in some repos — until the
// tree can no longer take a fix from origin at all, while looking perfectly
// current: clean status, recent commits, every one of them ours.

let dec = new TextDecoder()

let git = async (cwd: string, ...args: string[]) => {
  // No terminal prompts, ever: this runs from a server effect with no one
  // to answer, and a credential prompt would hang the whole sync.
  let cmd = new Deno.Command('git', {
    args: ['-C', cwd, ...args],
    env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    stdout: 'piped',
    stderr: 'piped',
  })
  let { success, stdout, stderr } = await cmd.output()
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

// How this branch sits against its upstream, or nothing when it has no
// upstream to sit against. Counts, not opinions: `ahead` is ours alone,
// `behind` is theirs alone, and both non-zero is diverged.
export let standing = async (root: string) => {
  let counts = await git(root, 'rev-list', '--left-right', '--count', '@{u}...')
  if (!counts.ok) return
  let [behind, ahead] = counts.out.split(/\s+/).map(Number)
  return { ahead, behind }
}

// Bring the branch level with its upstream when that costs nothing: a
// fast-forward can't manufacture a merge and can't discard work, so it is
// safe to run unattended in a tree somebody else is reading.
//
// The fetch is the load-bearing half. `@{u}` only moves when someone
// fetches, and nobody fetches these shared checkouts — which is exactly
// why they all read `0 behind` while origin runs away from them. Bounded,
// because a network that hangs must cost us a sync, not the server.
let level = async (root: string, ms = 20_000) => {
  let stop = AbortSignal.timeout(ms)
  await new Deno.Command('git', {
    args: ['-C', root, 'fetch', '--quiet', '--no-tags'],
    env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    stdout: 'null',
    stderr: 'null',
    signal: stop,
  }).output().catch(() => {})
  let at = await standing(root)
  // Behind and nothing of our own in the way: take theirs. Anything else
  // — level, ahead, diverged, no upstream — is left for the caller to read.
  if (at && at.behind && !at.ahead) {
    await git(root, 'merge', '--ff-only', '@{u}')
  }
  return await standing(root)
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
    // Level up, then decline anything still behind. BEHIND, not merely
    // diverged: committing onto a behind branch is what makes it diverged,
    // and the fast-forward can't always clear it — when origin's commit
    // touched this same projection path, our own fresh write pins the
    // working tree and git refuses to move. Declining leaves the file on
    // disk and the tree repairable by `pull --ff-only`, which is the point.
    let at = await level(root)
    if (at?.behind) {
      failed.push(
        `${root}: ${at.behind} behind upstream (${at.ahead} ahead) — left ` +
          `written and uncommitted; git pull --ff-only`,
      )
      continue
    }
    let done = await git(root, 'commit', '-q', '-m', msg, '--', ...ps)
    if (done.ok) committed.push(root)
    else failed.push(`${root}: ${line(done.err)}`)
  }
  return { committed, untracked, failed }
}
