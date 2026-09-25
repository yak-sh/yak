// Landing a branch: the plain Git operation, and the guard that keeps a rebase
// from quietly reverting the base. It reads nothing from a graph — the
// checkout you are standing in and `git worktree list` supply every
// coordinate: the primary worktree is the shared checkout to merge into, and
// the branch that checkout has checked out is the base every linked worktree
// lands onto. Landing runs no test suite and hides nothing; its output stays
// Git's own, so whoever ran it can see exactly what happened. Git exit codes
// decide every branch in the control flow; Git's prose is diagnostics only.
//
// One invocation does at most one thing:
//   - Fast-forward the current branch into the base. This succeeds exactly
//     when the base is still an ancestor of the branch — the common case, and
//     the whole job when it works. A best-effort push follows if the base has
//     an upstream (config `@{u}`, nothing configured anywhere else).
//   - If the base moved (it is no longer an ancestor) the fast-forward is
//     refused: rebase the branch onto the base and return without merging,
//     printing what happened, a `git diff --stat` of what the base pulled in
//     (so the caller can judge whether re-running its tests matters — docs-only
//     versus code it touches), and, on a rebase conflict, Git's conflict output
//     verbatim. The caller re-runs its tests if needed and lands again, which
//     then fast-forwards cleanly.
//
// A landing is also guarded: before the fast-forward, land refuses a branch
// whose files carry content no commit on it wrote — the rebase artifact that
// quietly reverts the base (see {@link reverts}). `allow` names the files
// whose rewind is deliberate.
//
// The `--ff-only` merge is the compare-and-swap that serializes concurrent
// landers: a lander whose base moved is refused, rebases, and comes back.
// Landing means landing in the shared checkout — the one that is actually
// used; pushing to a remote only publishes bytes and is never what makes work
// take effect, which is why the local fast-forward is the landing and the push
// is an afterthought.
//
// Running a test suite is the caller's job, not this operation's — before
// landing, and again after a rebase if the incoming diff could affect it. Land
// neither runs tests nor knows of any. It runs `git` as a subprocess, so like
// ./host.ts it is kept out of this package's portable entry point (./mod.ts).

/** One run of git. `out` and `err` are RAW, exactly as Git wrote them — a
 * caller that prints Git's own output must not have it trimmed out from under
 * it (land prints `git diff --stat`, whose first line is indented), so
 * trimming is the reader's job, at the point it wants a value. `ok` is whether
 * Git succeeded and `code` is its exit status: a command like
 * `merge-base --is-ancestor` reports its answer as an exit code, so a failed
 * run is often an answer rather than a fault. */
export type Ran = { ok: boolean; code: number; out: string; err: string }

/** How land runs git. It is a parameter so that a test can answer without a
 * repository. */
export type Run = (args: string[], cwd: string) => Promise<Ran>

/** A landing refused for the caller's own state: not in a linked worktree on
 * a branch, a dirty worktree, a revert the guard caught. A Git command that
 * fails is a plain `Error`, a fault somebody has to hear about. */
export class LandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LandError'
  }
}

let dec = new TextDecoder()

// No terminal prompts, ever: this may run with nobody there to answer, and a
// credential prompt would hang the caller instead of failing it.
let quiet = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }

// A subprocess that failed to start (no git, no such directory, EAGAIN under
// load) is returned as a failed run carrying the reason, never thrown: every
// caller here already handles a git that failed, and none handles an
// exception.
/** How this package runs git: one subprocess, output raw, never throwing. */
export let run: Run = async (args, cwd) => {
  try {
    let out = await new Deno.Command('git', {
      args,
      cwd,
      env: quiet,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    return {
      ok: out.success,
      code: out.code,
      out: dec.decode(out.stdout),
      err: dec.decode(out.stderr),
    }
  } catch (e) {
    return {
      ok: false,
      code: -1,
      out: '',
      err: `git ${args.join(' ')} in ${cwd}: ${e}`,
    }
  }
}

/** Landed carries the merged commit sha and the shared checkout's path, so
 * the caller can clean up whatever the merge left behind. */
export type Landed = { landed: string; root: string }

/** Diverged means the base moved: the branch has been rebased and is waiting,
 * and `conflict` reports whether that rebase is sitting unresolved for the
 * caller to finish before landing again. */
export type Diverged = { diverged: true; conflict: boolean }

export type Outcome = Landed | Diverged

/** What a landing takes: which directory to work in, how to run git, where to
 * print, and the files whose rewind has been approved. */
export type LandOps = {
  cwd?: string
  run?: Run
  write?: (text: string, error?: boolean) => void
  /** files whose rewind is deliberate: warned about, then landed */
  allow?: string[]
}

let defaultWrite = (text: string, error = false) => {
  text = text.trimEnd()
  if (text) (error ? console.error : console.log)(text)
}

let message = (label: string, r: Ran) => {
  let detail = (r.err || r.out).trim().split('\n').find(Boolean)
  return `${label} failed with exit ${r.code}${detail ? `: ${detail}` : ''}`
}

// Git prints absolute paths in both outputs, so the only difference between
// them can be a trailing slash.
let same = (a: string, b: string) =>
  a.replace(/\/+$/, '') == b.replace(/\/+$/, '')

// A rebase can leave content that no commit on the branch ever wrote.
// Resolving a conflict by taking the branch's side wholesale rewinds a file to
// what the branch forked from, undoing every base commit in between — one such
// landing took 22 files back to their pre-base content, and the test suite
// passed because the tests had rewound along with the code. Two questions
// catch that, both asked of the rebased branch in the moment before it lands:
//
//   - which files does `base..HEAD` change that no commit on the branch
//     touches? After a clean rebase that set is empty; anything in it is the
//     rebase's own doing.
//   - for the rest, does the landing diff add lines, and does the landing blob
//     equal a blob that path already held earlier in the base's history?
//     Content the base moved past and the branch puts back is a revert nobody
//     wrote — but only lines the branch adds can put anything back. A hunk that
//     only takes lines away reintroduces nothing, so a pure deletion is a
//     deletion however far back its result happens to match.
//
// The second question exists because a rebase rewrites the branch's commits:
// afterwards a reverting resolution sits inside a branch commit's file list,
// where the first question cannot see it.
export type Revert = { file: string; rewound: boolean }

let lines = (out: string) => out.split('\n').filter(Boolean)

// How far back down the base the blob scan looks: the base's recent history,
// not its whole history.
let DEPTH = 200

// `git log --raw` names the blob each commit left at a path
// (`:mode mode src dst status\tpath`), so one walk of the base's recent history
// yields every content each path has held — no `rev-parse` per file per
// commit. Merge commits print no raw lines and contribute nothing, which is
// right: a merge introduces no content of its own. The base TIP is included
// harmlessly — its blob for a path is `base:path`, which a file in the
// `base...HEAD` diff cannot equal.
let held = (log: string) => {
  let past = new Map<string, Set<string>>()
  for (let line of lines(log)) {
    let m = /^:\S+ \S+ \S+ (\S+) \S+\t(.+)$/.exec(line)
    if (!m) continue
    if (!past.has(m[2])) past.set(m[2], new Set())
    past.get(m[2])!.add(m[1])
  }
  return past
}

// path → whether the landing diff adds anything there. `--numstat` reports
// added and deleted counts per path in the same walk that names the paths, so
// the guard learns both from one command. A binary file reports `-`: its added
// line count is unknowable, which the guard treats as content added.
// `--no-renames` keeps every path plain, so a rename reads as the deletion and
// the addition it is rather than as an `old => new` name that nothing else
// here would match.
let adding = (out: string) =>
  new Map(
    lines(out).flatMap((l) => {
      let m = /^(\d+|-)\t(?:\d+|-)\t(.+)$/.exec(l)
      return m ? [[m[2], m[1] != '0'] as [string, boolean]] : []
    }),
  )

// path → blob for the whole landing tree, from one `ls-tree -r`: cheaper than
// a `rev-parse` per file, and immune to a pathspec longer than argv allows.
let blobs = (out: string) =>
  new Map(
    lines(out).flatMap((l) => {
      let m = /^\S+ blob (\S+)\t(.+)$/.exec(l)
      return m ? [[m[2], m[1]] as [string, string]] : []
    }),
  )

/** Every file this landing would change that the branch did not author. Asked
 * only when the base is an ancestor of the branch, so that `base...HEAD` is
 * exactly the landing diff. How it runs git is a parameter, which is how a
 * test answers without a repository. */
export let reverts = async (
  ask: (args: string[]) => Promise<string>,
  base: string,
): Promise<Revert[]> => {
  let adds = adding(
    await ask(['diff', '--numstat', '--no-renames', `${base}...HEAD`]),
  )
  if (!adds.size) return []
  let changed = [...adds.keys()]
  // `--no-renames` as the diff above: a move names both paths, or the old one
  // reads as the rebase's.
  let touched = new Set(
    lines(
      await ask([
        'log',
        '--format=',
        '--name-only',
        '--no-renames',
        `${base}..HEAD`,
      ]),
    ),
  )
  let found = changed.filter((f) => !touched.has(f))
    .map((file) => ({ file, rewound: false }))
  let rest = changed.filter((f) => touched.has(f))
  if (!rest.length) return found
  let past = held(
    await ask([
      'log',
      `-${DEPTH}`,
      '--format=',
      '--raw',
      // Full object names: `--raw` abbreviates by default, and the tree these
      // are compared against does not.
      '--no-abbrev',
      '--no-renames',
      base,
    ]),
  )
  let now = blobs(await ask(['ls-tree', '-r', 'HEAD']))
  for (let file of rest) {
    let blob = now.get(file)
    // A file the branch deletes has no landing blob and nothing to rewind to,
    // and a diff that adds no line put nothing back to rewind to it.
    if (blob && adds.get(file) && past.get(file)?.has(blob)) {
      found.push({ file, rewound: true })
    }
  }
  return found
}

let why = (r: Revert, base: string, at: string) =>
  `  ${r.file} — ${
    r.rewound
      ? `lands at content ${base} already moved past`
      : `changed by the rebase, not by any commit on the branch`
  }${at ? `; ${base} last touched it at ${at}` : ''}`

// The refusal names the files and gives the caller the pointers it needs: the
// base commit that last touched each one, the diff to read, and the flag that
// lands anyway.
let refusal = async (
  ask: (args: string[]) => Promise<string>,
  base: string,
  found: Revert[],
) => {
  let at = await Promise.all(
    found.map((r) =>
      ask(['log', '-1', '--format=%h %s', base, '--', r.file])
        .then((s) => s.split('\n')[0].trim())
    ),
  )
  let names = found.map((r) => r.file)
  return [
    `land: refusing — the rebase left ${names.length} file${
      names.length == 1 ? '' : 's'
    } at content no commit on this branch wrote:`,
    ...found.map((r, i) => why(r, base, at[i])),
    `  inspect: git diff ${base}...HEAD -- ${names.join(' ')}`,
    `  deliberate: land --allow-revert=${names.join(',')}`,
  ].join('\n')
}

/** Land the branch you are standing on: fast-forward it into the base, or
 * rebase onto a base that moved and return, for the caller to re-run its tests
 * and land again. */
export let land = async (ops: LandOps = {}): Promise<Outcome> => {
  let command = ops.run ?? run
  let write = ops.write ?? defaultWrite
  let cwd = ops.cwd ?? Deno.cwd()
  let git = async (at: string, args: string[], show = true) => {
    let r = await command(args, at)
    if (show) {
      write(r.out)
      write(r.err, true)
    }
    return r
  }
  let need = async (label: string, at: string, args: string[]) => {
    let r = await git(at, args, false)
    if (r.code) throw new Error(message(label, r))
    return r.out.trim()
  }
  // What the guard reads: a git command run in this worktree whose output is
  // raw lines — a failure here is a broken read, never an answer.
  let read = async (args: string[]) => {
    let r = await git(tree, args, false)
    if (r.code) throw new Error(message(`git ${args[0]}`, r))
    return r.out
  }

  // Every coordinate from git alone. `git worktree list --porcelain` lists the
  // primary worktree first, whichever worktree you run it in, since worktrees
  // share one ref store — and the branch that primary worktree has checked out
  // is the base. A primary worktree with a detached HEAD has no base to land
  // onto, so refuse rather than guess. A directory git does not know is where
  // the caller stood, and so is a worktree with no branch checked out.
  let top = await git(cwd, ['rev-parse', '--show-toplevel'], false)
  if (top.code) throw new LandError(message('land: find worktree', top))
  let tree = top.out.trim()
  let on = await git(tree, ['symbolic-ref', '-q', '--short', 'HEAD'], false)
  if (on.code == 1) throw new LandError('land: the worktree is detached')
  if (on.code) throw new Error(message('read branch', on))
  let branch = on.out.trim()
  let list = await need('list worktrees', tree, [
    'worktree',
    'list',
    '--porcelain',
  ])
  let head = list.split('\n\n')[0].split('\n')
  let root = head.find((l) => l.startsWith('worktree '))?.slice(9) ?? ''
  let base = (head.find((l) => l.startsWith('branch '))?.slice(7) ?? '')
    .replace(/^refs\/heads\//, '')
  if (!base) {
    throw new LandError(
      'land: the shared checkout is detached — no base to land onto',
    )
  }
  if (same(tree, root)) {
    throw new LandError(
      'land: run it inside a linked worktree, not the shared checkout',
    )
  }
  if (branch == base) {
    throw new LandError('land: the worktree is on the base branch')
  }

  // Uncommitted work would not land and would break a rebase, so a dirty
  // worktree is refused: what you land must be what you tested.
  let dirty = await need('git status', tree, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (dirty) throw new LandError(`land: worktree is dirty:\n${dirty}`)

  // Ancestry decides which of the two things this invocation does, and it is
  // asked before the merge because the guard's refusal has to come before the
  // merge too: once the base has fast-forwarded, the bad content has landed.
  let anc = await git(
    tree,
    ['merge-base', '--is-ancestor', base, branch],
    false,
  )
  if (anc.code != 0 && anc.code != 1) {
    throw new Error(message('read merge contention', anc))
  }

  if (anc.code == 0) {
    // The base has not moved: the branch is rebased onto it (or never left it),
    // so `base...HEAD` is the landing diff and the guard can read it.
    let found = await reverts(read, base)
    let allow = new Set(ops.allow ?? [])
    let refuse = found.filter((r) => !allow.has(r.file))
    if (refuse.length) throw new LandError(await refusal(read, base, refuse))
    for (let r of found) {
      write(`land: --allow-revert — landing anyway:${why(r, base, '')}`, true)
    }
    // The shared checkout is not checked for uncommitted changes: git refuses
    // a merge that would overwrite someone's uncommitted work and names the
    // files, and leaves alone any edit it would not touch. If it refuses for
    // some other reason — a hook, a dirty checkout — surface git's own error.
    let merged = await git(root, ['merge', '--ff-only', branch])
    if (merged.code) throw new Error(message('git merge', merged))
    let sha = await need('read landed commit', root, ['rev-parse', 'HEAD'])
    await publish(git, write, root, base)
    // The worktree and its branch survive landing: the caller does its own
    // cleanup afterwards, and a command whose working directory was unlinked
    // under it is refused by the kernel. Unlock it instead — whoever handed the
    // worktree out locked it to mark it as in use, and this is that worker
    // reporting it has finished. The unlock's exit code decides nothing: the
    // only failure reachable is "not locked".
    await git(root, ['worktree', 'unlock', tree], false)
    return { landed: sha, root }
  }

  // The base moved; rebase onto it and return, for the caller to re-run its
  // tests and land again. The guard runs on that second landing, once the
  // rebase is finished.

  let fork = await need('find common ancestor', tree, [
    'merge-base',
    base,
    branch,
  ])
  write(`land: ${base} moved — rebasing ${branch} onto it, not merging.`)
  write(`land: changes pulled in from ${base}:`)
  await git(tree, ['diff', '--stat', `${fork}..${base}`])
  let rebased = await git(tree, ['rebase', base])
  if (rebased.code) {
    // The rebase is left in progress on purpose: the caller resolves the
    // conflict, runs `git rebase --continue`, then lands again. Git printed
    // the conflict above; this only names the next step.
    write(
      'land: rebase hit conflicts — resolve them, `git rebase --continue`, ' +
        'then land again.',
      true,
    )
    return { diverged: true, conflict: true }
  }
  write(
    'land: rebased cleanly. Re-gate if the diff above could affect you, then ' +
      'land again.',
  )
  return { diverged: true, conflict: false }
}

// Best-effort push of the base branch to its upstream, if it has one — just
// `@{u}`, nothing configured anywhere else. Never throws: an unreachable
// remote, or no upstream at all, leaves the work landed but unpushed, since
// the merge has already taken effect in the shared checkout.
let publish = async (
  git: (at: string, args: string[], show?: boolean) => Promise<Ran>,
  write: (text: string, error?: boolean) => void,
  root: string,
  base: string,
) => {
  let up = await git(root, ['rev-parse', '--abbrev-ref', `${base}@{u}`], false)
  if (up.code) return
  let ref = up.out.trim()
  let cut = ref.indexOf('/')
  let remote = ref.slice(0, cut)
  let branch = ref.slice(cut + 1)
  // One immediate retry: the failures seen in practice were transient
  // subprocess-spawn errors under load, and a push is idempotent, so a second
  // attempt costs nothing and turns a blip into a successful push.
  let push = () =>
    git(root, ['push', '--quiet', remote, `${base}:${branch}`], false)
  let sent = await push()
  if (sent.code) sent = await push()
  if (sent.code) {
    write(
      `${message(`land: publish to ${remote}/${branch}`, sent)} — landed ` +
        'locally, publish separately',
      true,
    )
  }
}
