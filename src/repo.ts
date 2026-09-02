// A source tree with history, behind one door. Everything above this file asks
// a REPO about the code — the commit a promise was made at, the bytes at that
// commit, what has touched a path since, a working copy to work in — and
// nothing above it spawns git. Local git on the filesystem is the first
// adapter; a hosted repo (D-32318 "repos": an Artifacts repo) is a second
// implementation of the same verbs, not a fork of every caller.
//
// The verbs are exactly the questions the callers ask today and no more. What
// only a local checkout can have — land's ff-only merge and rebase, the
// shared-checkout fetch, a backup's pickaxe walk, `--git-common-dir` — is NOT
// a verb: there is no hosted counterpart to a shared working copy, and a
// portable-looking name over one would be a promise the second adapter could
// not keep. Those callers use `git()` below directly, which is still the seam:
// one file spawns git, and everyone else asks it to.

// One git run. `out`/`err` are RAW, exactly as git wrote them — a caller that
// prints git's own output must not have it trimmed out from under it (land
// shows `git diff --stat`, whose first line is indented), so trimming is the
// reader's, at the point it wants a value. `ok` is git's success, `code` its
// exit status: a verb like `merge-base --is-ancestor` answers by exit code, so
// a failed run is often an answer rather than a fault.
export type Ran = { ok: boolean; code: number; out: string; err: string }

let dec = new TextDecoder()

// No terminal prompts, ever: this runs from a server effect with nobody to
// answer, and a credential prompt would hang the caller instead of failing it.
let quiet = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }

let opts = (cwd: string, args: string[], signal?: AbortSignal) => ({
  args,
  cwd,
  env: quiet,
  stdout: 'piped' as const,
  stderr: 'piped' as const,
  signal,
})

let read = (out: Deno.CommandOutput): Ran => ({
  ok: out.success,
  code: out.code,
  out: dec.decode(out.stdout),
  err: dec.decode(out.stderr),
})

// A spawn that failed to spawn (no git, no such directory, EAGAIN under load)
// is a not-ok run carrying why, never a throw: every caller here already has a
// refusal path for a git that said no, and none has one for an exception.
let broke = (e: unknown): Ran => ({ ok: false, code: -1, out: '', err: `${e}` })

export let git = async (cwd: string, args: string[], signal?: AbortSignal) => {
  try {
    return read(await new Deno.Command('git', opts(cwd, args, signal)).output())
  } catch (e) {
    return broke(e)
  }
}

// The same run, waited on the calling thread. Not part of Repo — a hosted repo
// answers over the network and can only be async — and used only where an
// already-synchronous caller reads git (sessions' settle path, the CLI's
// repo root), so that the seam does not turn a sync call chain async.
export let gitSync = (cwd: string, args: string[]) => {
  try {
    return read(new Deno.Command('git', opts(cwd, args)).outputSync())
  } catch (e) {
    return broke(e)
  }
}

// One source tree, as its callers ask about it. Every verb hands back the whole
// run, because every caller reports git's own words when it refuses; only
// `upstreamCounts` parses, since counts are what it is named for.
export type Repo = {
  // Where the tree is. A hosted repo names itself the same way.
  root: string
  // The commit a ref resolves to (HEAD by default).
  revAt(ref?: string): Promise<Ran>
  // Does this repo hold this commit? A sha rebased away does not, which is why
  // the anchor audit asks this before it asks anything else.
  catFile(sha: string): Promise<Ran>
  // One path's bytes at one revision, out of the object store — never the
  // working copy, so an uncommitted edit cannot answer for a commit.
  readAt(rev: string, path: string): Promise<Ran>
  // The commits that touched `paths` after `sha`, short shas, newest first.
  logSince(sha: string, paths: string[]): Promise<Ran>
  // One path's unified diff from `sha` to HEAD, zero context.
  diff(sha: string, path: string): Promise<Ran>
  // Commit these paths' working-tree bytes and nothing else. An explicit
  // pathspec commits through a temporary index, so a concurrent agent's
  // staged work survives (see git.ts).
  commitPaths(paths: string[], msg: string): Promise<Ran>
  push(remote: string, refspec: string): Promise<Ran>
  // How the current branch sits against its upstream, or nothing when it has
  // none. Counts, not opinions: both non-zero is diverged.
  upstreamCounts(): Promise<{ ahead: number; behind: number } | undefined>
  // A working copy of a new `branch`, cut from `base`, at `tree`.
  worktreeCreate(tree: string, branch: string, base: string): Promise<Ran>
  worktreeRemove(tree: string): Promise<Ran>
}

export let gitRepo = (root: string): Repo => {
  let at = (args: string[]) => git(root, args)
  return {
    root,
    revAt: (ref = 'HEAD') => at(['rev-parse', '--verify', `${ref}^{commit}`]),
    catFile: (sha) => at(['cat-file', '-e', `${sha}^{commit}`]),
    readAt: (rev, path) => at(['show', `${rev}:${path}`]),
    logSince: (sha, paths) =>
      at(['log', '--format=%h', `${sha}..HEAD`, '--', ...paths]),
    diff: (sha, path) => at(['diff', '-U0', `${sha}..HEAD`, '--', path]),
    commitPaths: (paths, msg) =>
      at(['commit', '-q', '-m', msg, '--', ...paths]),
    push: (remote, refspec) => at(['push', '--quiet', remote, refspec]),
    upstreamCounts: async () => {
      let counts = await at(['rev-list', '--left-right', '--count', '@{u}...'])
      if (!counts.ok) return
      let [behind, ahead] = counts.out.trim().split(/\s+/).map(Number)
      return { ahead, behind }
    },
    worktreeCreate: (tree, branch, base) =>
      at(['worktree', 'add', tree, '-b', branch, base]),
    worktreeRemove: (tree) => at(['worktree', 'remove', tree]),
  }
}
