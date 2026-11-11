import * as system from '@yaks/process/system'
import { command as processCommand } from '@yaks/process/command'
import { formatConfig, formatting } from './format.ts'
export { formatting } from './format.ts'
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
//     the whole job when it works. If the base has an upstream (config `@{u}`,
//     nothing configured anywhere else), the branch is pushed to it first.
//   - If the base moved (it is no longer an ancestor), or its upstream moved
//     (the push was refused and a fetch shows commits the branch lacks, which
//     the base then catches up to), the fast-forward is refused: rebase
//     the branch onto the base and return without merging, printing what
//     happened, a `git diff --stat` of what the base pulled in (so the caller
//     can judge whether re-running its tests matters — docs-only versus code
//     it touches), and, on a rebase conflict, Git's conflict output verbatim. The caller re-runs its tests if needed and lands again, which
//     then fast-forwards cleanly.
//
// A landing is also guarded: before the fast-forward, land refuses a branch
// whose files carry content no commit on it wrote — the rebase artifact that
// quietly reverts the base (see {@link reverts}). `allow` names the files
// whose rewind is deliberate.
//
// The `--ff-only` merge is the compare-and-swap that serializes concurrent
// landers: a lander whose base moved is refused, rebases, and comes back.
// Everything land writes in the shared checkout (its index, its files, the
// base) happens under that checkout's land lock ({@link hold}), held
// exclusively, so two landers never take its index at once and a reader that
// holds the lock shared (a runtime snapshot) never meets a landing half done.
// Landing means landing in the shared checkout — the one that is actually
// used; pushing to a remote only publishes bytes and is never what makes work
// take effect, so a remote that cannot be reached still lands the work
// locally. But the push runs under the same lock, before the fast-forward, so
// the remote's own compare-and-swap serializes this checkout's landers with
// anything else that moved the upstream: a base that took commits the
// upstream refused would split the two. A base holding unpublished commits
// catches up by replaying them onto the fetched upstream under the lock;
// conflicts abort that replay before releasing the checkout. Landing is the
// only path that writes the base or pushes it.
//
// Running a test suite is the caller's job, not this operation's — before
// landing, and again after a rebase if the incoming diff could affect it. Land
// neither runs tests nor knows of any. It runs `git` as a subprocess, so like
// ./host.ts it is kept out of this package's portable entry point (./mod.ts).
import { backoff, type Clock, sleep } from '@yaks/fp'
import { CallError } from '@yaks/tools/errors'
import { hold } from './hold.ts'

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
 * a branch, a dirty worktree, local changes in the shared checkout that the
 * landing would overwrite, a revert the guard caught, or commits the base's
 * upstream declined. It is a `CallError`,
 * so whatever tool lands, a refusal reaches its caller as an answer and never
 * as a fault. An unexpected Git command failure is a plain `Error`, a fault
 * somebody has to hear about. */
export class LandError extends CallError {
  constructor(message: string) {
    super('land', message)
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
// One generic process boundary for Git and the formatter; output stays raw.
let execute = async (
  command: string,
  args: string[],
  cwd: string,
): Promise<Ran> => {
  try {
    let out = await processCommand(command, {
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
      err: `${command} ${args.join(' ')} in ${cwd}: ${e}`,
    }
  }
}

/** Run git without a terminal prompt. */
export let run: Run = (args, cwd) => execute('git', args, cwd)

let format: Run = async (files, cwd) => {
  try {
    let config = await formatConfig(cwd)
    if (config === undefined) return { ok: true, code: 0, out: '', err: '' }
    return execute(system.execPath(), formatting(files, config), cwd)
  } catch (e) {
    return { ok: false, code: 1, out: '', err: String(e) }
  }
}

// Resolves the manifests into the lockfile without linking node_modules: the
// checkout's own install (packages/cli/dependencies.ts) follows the lockfile.
let lock = (cwd: string) =>
  execute(
    'pnpm',
    ['install', '--lockfile-only', '--prefer-offline', '--ignore-scripts'],
    cwd,
  )

let lockfile = 'pnpm-lock.yaml'

/** A commit that landed, with its whole message. */
export type Commit = { sha: string; message: string }

/// commits('a\0One\n\nwhy\n\x01\nb\0Two\n\x01')
///   -> [{ sha: 'a', message: 'One\n\nwhy' }, { sha: 'b', message: 'Two' }]
/** Commits from `git log --format=%H%x00%B%x01`. */
export let commits = (log: string): Commit[] =>
  log.split('\x01').map((c) => c.trim()).filter(Boolean).map((c) => {
    let at = c.indexOf('\0')
    return { sha: c.slice(0, at), message: c.slice(at + 1).trim() }
  })

/** Landed carries the merged commit sha, the commits that landed with it, and
 * the shared checkout's path, so the caller can clean up whatever the merge
 * left behind. */
export type Landed = { landed: string; root: string; commits: Commit[] }

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
  /** Format changed paths; Deno selects file types and honors checkout config. */
  format?: Run
  /** Bring pnpm-lock.yaml up to the checkout at cwd's manifests. */
  lock?: (cwd: string) => Promise<Ran>
  write?: (text: string, error?: boolean) => void
  /** files whose rewind is deliberate: warned about, then landed */
  allow?: string[]
  /** wait for the shared checkout to be this landing's alone, given its Git
   * directory; the release ends that. {@link hold}, exclusive, by default */
  hold?: (gitdir: string) => Promise<() => void>
  /** where a failure land catches and carries on past is reported: a push
   * the remote refused. The host's telemetry (@yaks/host `report`). */
  report?: (
    error: unknown,
    context?: { tags?: Record<string, string> },
  ) => unknown
  /** the time a push waits before it tries again; the runtime's by default */
  clock?: Clock
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
  // Three reads that need nothing from each other, asked at once: what the
  // branch's commits touch, what the base's history held, and the landing
  // tree. `--no-renames` as the diff above: a move names both paths, or the
  // old one reads as the rebase's.
  let [log, raw, tree] = await Promise.all([
    ask(['log', '--format=', '--name-only', '--no-renames', `${base}..HEAD`]),
    ask([
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
    ask(['ls-tree', '-r', 'HEAD']),
  ])
  let touched = new Set(lines(log))
  let found = changed.filter((f) => !touched.has(f))
    .map((file) => ({ file, rewound: false }))
  let rest = changed.filter((f) => touched.has(f))
  let past = held(raw)
  let now = blobs(tree)
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

// Raw, NUL-delimited diff records keep unusual names intact. Only regular
// files go to fmt: a symlink or submodule must never lead it outside the diff.
let regular = (raw: string) => {
  let fields = raw.split('\0')
  let files: string[] = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (/^:\d+ 100(?:644|755) /.test(fields[i])) files.push(fields[i + 1])
  }
  return files
}

/// named(':100644 000000 a b D\0gone.ts\0:000000 100644 a b A\0new.ts\0')
///   -> ['gone.ts', 'new.ts']
/** Every path in raw, NUL-delimited diff records. */
export let named = (raw: string): string[] =>
  raw.split('\0').filter((_, i) => i % 2)

/// manifest('packages/a/package.json') -> true
/// manifest('pnpm-workspace.yaml') -> true
/// manifest('packages/a/mod.ts') -> false
/** Whether a path is one the pnpm lockfile is resolved from. */
export let manifest = (path: string): boolean =>
  /(^|\/)package\.json$/.test(path) || path == 'pnpm-workspace.yaml'

/** Land the branch you are standing on: fast-forward it into the base, or
 * rebase onto a base that moved and return, for the caller to re-run its tests
 * and land again. */
export let land = async (ops: LandOps = {}): Promise<Outcome> => {
  let command = ops.run ?? run
  let write = ops.write ?? defaultWrite
  let cwd = ops.cwd ?? system.cwd()
  let git = async (at: string, args: string[], show = true) => {
    let r = await command(args, at)
    if (show) {
      write(r.out)
      write(r.err, true)
    }
    return r
  }
  let must = (label: string, r: Ran) => {
    if (r.code) throw new Error(message(label, r))
    return r.out.trim()
  }
  let need = async (label: string, at: string, args: string[]) =>
    must(label, await git(at, args, false))
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
  // the caller stood, and so is a worktree with no branch checked out. The
  // worktree's branch, the list and its status need nothing from each other,
  // so they are asked at once and judged in that order.
  let top = await git(cwd, ['rev-parse', '--show-toplevel'], false)
  if (top.code) throw new LandError(message('land: find worktree', top))
  let tree = top.out.trim()
  // The common Git directory is the shared checkout's own, where its lock
  // lives.
  let [on, listed, status, common] = await Promise.all([
    git(tree, ['symbolic-ref', '-q', '--short', 'HEAD'], false),
    git(tree, ['worktree', 'list', '--porcelain'], false),
    git(tree, ['status', '--porcelain=v1', '--untracked-files=all'], false),
    git(
      tree,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      false,
    ),
  ])
  if (on.code == 1) throw new LandError('land: the worktree is detached')
  if (on.code) throw new Error(message('read branch', on))
  let branch = on.out.trim()
  let list = must('list worktrees', listed)
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
  let dirty = must('git status', status)
  if (dirty) throw new LandError(`land: worktree is dirty:\n${dirty}`)
  let gitdir = must('find the shared checkout', common)

  // Ancestry decides which of the two things this invocation does, and it is
  // asked before the merge because the guard's refusal has to come before the
  // merge too: once the base has fast-forwarded, the bad content has landed.
  let ancestry = async () => {
    let r = await git(
      tree,
      ['merge-base', '--is-ancestor', base, branch],
      false,
    )
    if (r.code != 0 && r.code != 1) {
      throw new Error(message('read merge contention', r))
    }
    return r.code
  }

  if (await ancestry() == 0) {
    // The base has not moved: the branch is rebased onto it (or never left it),
    // so `base...HEAD` is the landing diff and the guard can read it.
    let found = await reverts(read, base)
    let allow = new Set(ops.allow ?? [])
    let refuse = found.filter((r) => !allow.has(r.file))
    if (refuse.length) throw new LandError(await refusal(read, base, refuse))
    for (let r of found) {
      write(`land: --allow-revert — landing anyway:${why(r, base, '')}`, true)
    }
    let changed = await read([
      'diff',
      '--raw',
      '-z',
      '--no-renames',
      '--diff-filter=ACDMT',
      `${base}...HEAD`,
    ])
    let files = regular(changed)
    let edited = new Set(files)
    if (files.length) {
      let formatted = await (ops.format ?? format)(
        files.map((f) => `./${f}`),
        tree,
      )
      write(formatted.out)
      write(formatted.err, true)
      // A parser failure can still leave other files formatted. Keep those
      // changes and land; formatting is an edit, never a new gate.
      if (formatted.code) write(message('land: format', formatted), true)
    }
    // A manifest the branch changed lands with the lockfile resolved from it,
    // so a frozen install of the base never meets a stale lockfile. Only a
    // checkout that tracks one is asked.
    if (
      named(changed).some(manifest) &&
      (await read(['ls-files', '--', lockfile])).trim()
    ) {
      let locked = await (ops.lock ?? lock)(tree)
      write(locked.out)
      write(locked.err, true)
      if (locked.code) {
        let said = message(`land: update ${lockfile}`, locked)
        write(said, true)
        await ops.report?.(new Error(said), { tags: { step: 'land: lock' } })
      }
      edited.add(lockfile)
    }
    if (edited.size) {
      let paths = [...edited]
      let diff = await git(tree, [
        '--literal-pathspecs',
        'diff',
        '--quiet',
        '--',
        ...paths,
      ], false)
      if (diff.code != 0 && diff.code != 1) {
        must('read landing edits', diff)
      }
      if (diff.code == 1) {
        await need('stage landing edits', tree, [
          '--literal-pathspecs',
          'add',
          '--',
          ...paths,
        ])
        await need('commit landing edits', tree, [
          'commit',
          '--amend',
          '--no-edit',
          '--allow-empty',
        ])
      }
    }
    // The shared checkout need not be spotless: Git leaves unrelated edits
    // alone. `read-tree` runs the same two-tree/worktree safety check as the
    // fast-forward, without changing the index or files. A refusal here is the
    // checkout's state. Another landing can still move the base while this one
    // waits for the lock; then the merge is refused, and ancestry distinguishes
    // that contention from a Git fault. The
    // fast-forward refreshes the index before its check and `read-tree` does
    // not, so the refresh comes first: a file touched but not changed is not
    // in the way. Its exit code only says some file differs, which the check
    // reads for itself.
    // From the refresh to reading the landed commit, every git command here
    // takes the shared checkout's index, so the checkout is this landing's
    // alone until then.
    let up = await upstream(git, root, base)
    let release = await (ops.hold ?? ((dir) => hold(dir, true)))(gitdir)
    let sha: string | undefined
    let landing: Commit[] = []
    try {
      await git(root, ['update-index', '-q', '--refresh'], false)
      let ready = await git(
        root,
        ['read-tree', '-n', '-m', '-u', 'HEAD', branch],
        false,
      )
      if (ready.code) {
        throw new LandError(
          message('land: shared checkout blocks landing', ready),
        )
      }
      // What lands: the branch's commits the base lacks.
      landing = commits(
        await need('list landing commits', root, [
          'log',
          '--format=%H%x00%B%x01',
          `HEAD..${branch}`,
        ]),
      )
      // Under the lock nothing that lands moves the base, so what is pushed
      // contains it, and the fast-forward after the push follows it.
      let moved = await ancestry() == 1
      if (!moved && up) {
        let to = await publish(git, write, ops, root, branch, up)
        if (to) await catchUp(git, write, root, base, up, to)
        moved = !!to
      }
      if (!moved) {
        let merged = await git(root, ['merge', '--ff-only', branch])
        if (merged.code) {
          if (await ancestry() != 1) {
            throw new Error(message('git merge', merged))
          }
        } else {
          sha = await need('read landed commit', root, ['rev-parse', 'HEAD'])
        }
      }
    } finally {
      release()
    }
    if (sha) {
      // The worktree and its branch survive landing: the caller does its own
      // cleanup afterwards, and a command whose working directory was unlinked
      // under it is refused by the kernel. Unlock it instead — whoever handed the
      // worktree out locked it to mark it as in use, and this is that worker
      // reporting it has finished. The unlock's exit code decides nothing: the
      // only failure reachable is "not locked".
      await git(root, ['worktree', 'unlock', tree], false)
      return { landed: sha, root, commits: landing }
    }
  }

  // The base moved; rebase onto it and return, for the caller to re-run its
  // tests and land again. The guard runs on that second landing, once the
  // rebase is finished.

  write(`land: ${base} moved — rebasing ${branch} onto it, not merging.`)
  write(`land: changes pulled in from ${base}:`)
  // Three dots: from where the branch forked to the base.
  await git(tree, ['diff', '--stat', `${branch}...${base}`])
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
    'land: rebased cleanly. Run affected tests if the diff above reaches them, then ' +
      'land again.',
  )
  return { diverged: true, conflict: false }
}

type Git = (at: string, args: string[], show?: boolean) => Promise<Ran>

/** The base's upstream, split into the remote and its branch. */
type Upstream = { remote: string; branch: string }

// The base's upstream: just `@{u}`, nothing configured anywhere else.
let upstream = async (
  git: Git,
  root: string,
  base: string,
): Promise<Upstream | undefined> => {
  let up = await git(root, ['rev-parse', '--abbrev-ref', `${base}@{u}`], false)
  if (up.code) return
  let ref = up.out.trim()
  let cut = ref.indexOf('/')
  return { remote: ref.slice(0, cut), branch: ref.slice(cut + 1) }
}

// Push the landing branch to the base's upstream, under the land lock and
// before the base takes it. The remote's fast-forward check is the
// compare-and-swap: a refusal followed by a fetch that finds commits the
// branch lacks means the upstream moved, and what it moved to is returned, for
// the landing to rebase onto rather than merge. A push the remote answers with
// a 5xx, or whose connection drops, is tried again after a backoff, up to
// {@link tries} times: a retry of a push that did reach the remote finds it
// up to date. A push the remote declined (`[remote rejected]` with no server
// fault: a secret it found, a rule of the repository) refuses the landing, and
// the base stays where it was: the remote read those commits and will decline
// every later landing that carries them, so landing them here would stop
// everyone's pushes, not just this one. Any other failure, an unreachable
// remote included, leaves the work to land locally: the push only publishes
// bytes. It is still a failure,
// so it is reported with the remote's whole account, once. The push runs to
// completion with no deadline: its exit code is the only report of whether the
// remote has the commit, and a killed push may already have reached it.
let publish = async (
  git: Git,
  write: (text: string, error?: boolean) => void,
  ops: LandOps,
  root: string,
  branch: string,
  up: Upstream,
): Promise<string | undefined> => {
  let push = () =>
    git(root, ['push', '--quiet', up.remote, `${branch}:${up.branch}`], false)
  let sent = await push()
  for (let n = 1; sent.code && n < tries && transient(sent); n++) {
    await sleep(backoff(n), undefined, ops.clock)
    sent = await push()
  }
  if (!sent.code) return
  // FETCH_HEAD is read once, at once: anything fetching in the shared
  // checkout rewrites it.
  let fetched = await git(
    root,
    ['fetch', '--quiet', up.remote, up.branch],
    false,
  )
  let to = fetched.code ? undefined : await git(
    root,
    ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
    false,
  )
  if (to && !to.code) {
    let sha = to.out.trim()
    let behind = await git(
      root,
      ['merge-base', '--is-ancestor', sha, branch],
      false,
    )
    if (behind.code == 1) return sha
  }
  let label = `land: publish to ${up.remote}/${up.branch}`
  if (declined(sent)) {
    throw new LandError(
      `${label} was declined, so nothing landed. Rewrite the commits it ` +
        `names, then land again:\n${(sent.err || sent.out).trim()}`,
    )
  }
  write(`${message(label, sent)} — landed locally, publish separately`, true)
  let said = (sent.err || sent.out).trim()
  await ops.report?.(
    new Error(
      `${label} failed with exit ${sent.code}${said ? `:\n${said}` : ''}`,
    ),
    { tags: { step: 'land: publish', remote: up.remote } },
  )
}

// How many times a push is tried while the remote's answers are transient.
let tries = 4

// A refusal that says nothing about the push itself: the remote's server
// failed (a 5xx) or the connection dropped. Git exits 1 or 128 for these and
// for refusals that mean something, so only its words tell them apart.
let transient = (r: Ran) =>
  /(error|HTTP)[: ]+5\d\d\b|internal server error|bad gateway|service unavailable|gateway time-?out|the remote end hung up|early eof|connection (reset|timed out|refused)|RPC failed/i
    .test(r.err + r.out)

// The remote received the push and declined it, for a reason no retry
// changes.
let declined = (r: Ran) =>
  !transient(r) && /\[remote rejected\]/.test(r.err + r.out)

// Bring the base up to the fetched commit under its land lock. A failed push
// can leave locally landed commits the upstream lacks; replay those rather
// than treating the divergence as a fault. Unlike a caller's rebase, a shared
// checkout's replay must be aborted on conflict before readers get it back.
let catchUp = async (
  git: Git,
  write: (text: string, error?: boolean) => void,
  root: string,
  base: string,
  up: Upstream,
  to: string,
) => {
  let at = `${up.remote}/${up.branch}`
  let contained = await git(
    root,
    ['merge-base', '--is-ancestor', base, to],
    false,
  )
  if (contained.code != 0 && contained.code != 1) {
    throw new Error(message('read upstream', contained))
  }
  if (contained.code == 1) {
    await replay(git, write, root, base, at, to)
    return
  }
  write(`land: ${at} moved — bringing ${base} up to it.`)
  let merged = await git(root, ['merge', '--ff-only', to])
  if (merged.code) {
    throw new LandError(
      message('land: shared checkout blocks catching up', merged),
    )
  }
}

let replay = async (
  git: Git,
  write: (text: string, error?: boolean) => void,
  root: string,
  base: string,
  at: string,
  to: string,
) => {
  let dirty = await git(
    root,
    ['status', '--porcelain=v1', '--untracked-files=no'],
    false,
  )
  if (dirty.code) throw new Error(message('read shared checkout', dirty))
  if (dirty.out.trim()) {
    throw new LandError(
      `land: shared checkout blocks catching up — commit or stash its edits:\n${dirty.out.trim()}`,
    )
  }
  write(`land: ${at} moved — rebasing unpublished ${base} commits onto it.`)
  // Ignore config that would stash shared edits or rewrite other branches.
  let rebased = await git(root, [
    '-c',
    'rebase.autoStash=false',
    'rebase',
    '--no-update-refs',
    to,
  ])
  if (!rebased.code) return
  let aborted = await git(root, ['rebase', '--abort'])
  let said = message('land: shared checkout blocks catching up', rebased)
  if (aborted.code) {
    throw new Error(`${said}\n${message('restore shared checkout', aborted)}`)
  }
  throw new LandError(`${said}\nland: restored ${base}; nothing landed.`)
}
