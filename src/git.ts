// Git, only as far as a projection needs it: commit the files we just
// wrote, in the repos that already track them, and push where the venture
// permits. Two rules make this safe to run from a server effect into
// somebody's live checkout. First,
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
// what we commit here is never published. Commit onto it anyway and
// the fork deepens without bound — 100 commits in some repos — until the
// tree can no longer take a fix from origin at all, while looking perfectly
// current: clean status, recent commits, every one of them ours.
//
// Which is why the push is the drain, and why it is a PERMISSION rather
// than a policy (`repo.push`, off by default and off for anything this
// code can't ask about). Pushing generated output from a shared tree is a
// write that leaves the box, and in a venture whose main branch deploys it
// is a deploy. Granted, it also self-heals: the first sync after the grant
// pushes the whole backlog, and every one after keeps the tree at zero.

let dec = new TextDecoder()

type Result = { ok: boolean; out: string; err: string }

let run = async (
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<Result> => {
  // No terminal prompts, ever: this runs from a server effect with no one
  // to answer, and a credential prompt would hang the whole sync.
  let cmd = new Deno.Command('git', {
    args: ['-C', cwd, ...args],
    env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    stdout: 'piped',
    stderr: 'piped',
    signal,
  })
  try {
    let { success, stdout, stderr } = await cmd.output()
    return {
      ok: success,
      out: dec.decode(stdout).trim(),
      err: dec.decode(stderr).trim(),
    }
  } catch (e) {
    return { ok: false, out: '', err: String(e) }
  }
}

let git = (cwd: string, ...args: string[]) => run(cwd, args)

let dir = (p: string) => p.slice(0, p.lastIndexOf('/'))

let line = (s: string) => s.split('\n').find(Boolean)?.slice(0, 160) ?? ''

// A refused push opens its stderr with `To <url>` and buries the verdict
// in the `!` line. A ref race is more precise one line earlier, though:
// retain the cannot-lock reason rather than reducing it to "update failed".
let pick = (s: string, asks: (line: string) => boolean) =>
  line(s.split('\n').filter(asks).join('\n'))
let why = (s: string) =>
  pick(s, (l) => l.includes('cannot lock ref')) ||
  pick(s, (l) => l.trimStart().startsWith('!')) ||
  pick(s, (l) => /^(remote: )?(error|fatal):/.test(l.trimStart())) ||
  line(s)
let said = (done: Result, fallback: string) =>
  line(done.err) || line(done.out) || fallback
let refusal = (done: Result) =>
  why(done.err) || line(done.out) || 'git push exited without a diagnostic'

// The repo that tracks this path, or nothing. Asked from the file's own
// directory so a path under a nested checkout answers for that checkout.
let tracker = async (path: string) => {
  let at = dir(path)
  let root = await git(at, 'rev-parse', '--show-toplevel')
  if (!root.ok) return
  let known = await git(at, 'ls-files', '--error-unmatch', '--', path)
  return known.ok ? root.out : undefined
}

// The remote and branch this one tracks, split, or nothing when it
// tracks none. Read rather than assumed: `git push` with no refspec
// obeys push.default, and `origin HEAD` guesses at both halves — a
// projection must land on the branch the tree already answers to.
let upstream = async (root: string) => {
  let ref = await git(root, 'rev-parse', '--abbrev-ref', '@{u}')
  if (!ref.ok) return
  let cut = ref.out.indexOf('/')
  return { remote: ref.out.slice(0, cut), branch: ref.out.slice(cut + 1) }
}

// The revision `task commit` records: the sha a ref resolves to (HEAD by
// default), the repo root, and the whole commit message — or nothing when
// cwd is not a repo or the ref names no commit.
export let revision = async (cwd: string, ref = 'HEAD') => {
  let sha = await git(cwd, 'rev-parse', '--verify', `${ref}^{commit}`)
  if (!sha.ok) return
  let root = await git(cwd, 'rev-parse', '--show-toplevel')
  let message = await git(cwd, 'log', '-1', '--format=%B', sha.out)
  return { sha: sha.out, repo: root.out, message: message.out }
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
let fetchUp = (root: string, remote?: string, ms = 20_000) =>
  run(
    root,
    ['fetch', '--quiet', '--no-tags', ...(remote ? [remote] : [])],
    AbortSignal.timeout(ms),
  )

let level = async (root: string) => {
  await fetchUp(root)
  let at = await standing(root)
  // Behind and nothing of our own in the way: take theirs. Anything else
  // — level, ahead, diverged, no upstream — is left for the caller to read.
  if (at && at.behind && !at.ahead) {
    await git(root, 'merge', '--ff-only', '@{u}')
  }
  return await standing(root)
}

// Commit these paths where git already tracks them, one commit per repo,
// and push what the venture permits — a file says where it is and whether
// its venture lets our commits leave the box. Safe to hand every
// projection file every time: a path already matching HEAD is a non-event,
// so this is the idempotent "leave the repos level" move, not a "commit
// what I just wrote" one. Reports the repos that committed, the ones that
// pushed, the paths git doesn't track (the caller's `git add` is what
// adopts one), and the repos that refused — never throws at its caller.
export let commit = async (
  files: { path: string; push?: boolean }[],
  msg: string,
) => {
  let committed: string[] = []
  let pushed: string[] = []
  let untracked: string[] = []
  let failed: string[] = []
  // A repo's permission is the AND of its files' — two projects sharing a
  // checkout can only agree downward, which is the safe direction.
  let repos = new Map<string, { paths: string[]; push: boolean }>()
  for (let f of files) {
    let root = await tracker(f.path)
    if (!root) untracked.push(f.path)
    else {
      let at = repos.get(root)
      repos.set(root, {
        paths: [...(at?.paths ?? []), f.path],
        push: (at?.push ?? true) && !!f.push,
      })
    }
  }
  for (let [root, { paths, push }] of repos) {
    // Nothing here differs from HEAD: no empty commit. An unborn HEAD
    // errors instead of answering, and falls through to the first commit.
    let dirty = !(await git(root, 'diff', '--quiet', 'HEAD', '--', ...paths)).ok
    // The other reason to be here: a repo may hold an undrained chain with
    // nothing left to write, and the day push is granted is the day that
    // chain should go. Local and free — `ahead` is ours either way, and
    // only `behind` needs the fetch below.
    let chain = push && (await standing(root))?.ahead
    if (!dirty && !chain) continue
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
    if (dirty) {
      let done = await git(root, 'commit', '-q', '-m', msg, '--', ...paths)
      if (!done.ok) {
        failed.push(
          `${root}: commit failed (` +
            `${said(done, 'git commit exited without a diagnostic')})`,
        )
        continue
      }
      committed.push(root)
    }
    // Push, where the venture said we may. This is what keeps the tree
    // level instead of merely current: unpushed, every projection commit
    // is another one the next operator has to rebase past, and the fork
    // grows for as long as nobody drains it.
    let up = push ? await upstream(root) : undefined
    if (!up) continue
    let to = `HEAD:${up.branch}`
    let sent = await git(root, 'push', '--quiet', up.remote, to)
    if (sent.ok) {
      pushed.push(root)
      continue
    }
    let first = refusal(sent)
    // A ref may move after level() fetches but before this push updates it.
    // Fetch again to distinguish that race from a policy refusal. Rebasing
    // retains both commits; a failed rebase is aborted so the projection's
    // correct local commit and the checkout both remain usable.
    let fetched = await fetchUp(root, up.remote)
    if (!fetched.ok) {
      failed.push(
        `${root}: push refused (${first}); refresh failed (` +
          `${said(fetched, 'git fetch exited without a diagnostic')})`,
      )
      continue
    }
    let moved = await standing(root)
    if (!moved?.behind) {
      failed.push(`${root}: push refused (${first})`)
      continue
    }
    let based = await git(root, 'rebase', '@{u}')
    if (!based.ok) {
      await git(root, 'rebase', '--abort')
      failed.push(
        `${root}: push refused (${first}); rebase failed (` +
          `${said(based, 'git rebase exited without a diagnostic')})`,
      )
      continue
    }
    let retried = await git(root, 'push', '--quiet', up.remote, to)
    if (retried.ok) pushed.push(root)
    else {
      failed.push(
        `${root}: push retry refused (${refusal(retried)})`,
      )
    }
  }
  return { committed, pushed, untracked, failed }
}
