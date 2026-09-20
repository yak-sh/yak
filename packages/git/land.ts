// Landing a branch: the pure git primitive, and the guard that keeps a rebase
// from quietly reverting the base. It reads NOTHING from a graph — the
// worktree you stand in and `git worktree list` name every coordinate: the
// primary worktree is the shared checkout to merge into, and the branch that
// checkout holds is the base every sibling lands onto. Landing runs no gate and
// is never a black box; its output stays git's own, so whoever ran it can
// always see exactly what happened. Git exit codes decide every transition;
// git's prose is only diagnostics, never control flow.
//
// One invocation does at most ONE thing:
//   - Fast-forward the current branch into the base. This succeeds exactly when
//     the base is still an ancestor of the branch — the common case, and the
//     whole job when it works → landed. A best-effort push follows if the base
//     has a git upstream (config `@{u}`, nothing granted anywhere else).
//   - If the base MOVED (no longer an ancestor) the fast-forward is refused:
//     rebase the branch onto the base and RETURN WITHOUT MERGING, printing what
//     happened, a `git diff --stat` of what the base pulled in (so the caller
//     can judge whether a re-gate matters — docs-only vs code that touches it),
//     and — on a rebase conflict — git's conflict output verbatim. The caller
//     re-gates if needed and lands again, which then fast-forwards cleanly.
//
// A landing is also GUARDED: before the fast-forward, land refuses a branch
// whose files carry content no commit on it wrote — the rebase artifact that
// quietly reverts the base (see {@link reverts}). `allow` names the files whose
// rewind is deliberate.
//
// ff-only is the compare-and-swap that serializes concurrent landers: a lander
// whose base moved is refused, rebases, and comes back. Landing means the
// SHARED CHECKOUT — the tree that runs; pushing to a remote only publishes
// bytes and is never the thing that makes work take effect, which is why the
// local fast-forward is the landing and the push is an afterthought.
//
// Running a gate is the CALLER's job, not this verb's — before landing, and
// again after a rebase if the incoming diff could affect it. Land neither runs
// nor knows about a gate. It is a host verb: it spawns git, so it is kept off
// this package's portable front door (mod.ts) the way ./host is.

/** One git run. `out`/`err` are RAW, exactly as git wrote them — a caller that
 * prints git's own output must not have it trimmed out from under it (land
 * shows `git diff --stat`, whose first line is indented), so trimming is the
 * reader's, at the point it wants a value. `ok` is git's success, `code` its
 * exit status: a verb like `merge-base --is-ancestor` answers by exit code, so
 * a failed run is often an answer rather than a fault. */
export type Ran = { ok: boolean; code: number; out: string; err: string }

/** How land asks git something, so a test can answer without a repository. */
export type Run = (args: string[], cwd: string) => Promise<Ran>

let dec = new TextDecoder()

// No terminal prompts, ever: this can run with nobody to answer, and a
// credential prompt would hang the caller instead of failing it.
let quiet = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }

// A spawn that failed to spawn (no git, no such directory, EAGAIN under load)
// is a not-ok run carrying why, never a throw: every caller here already has a
// refusal path for a git that said no, and none has one for an exception.
let run: Run = async (args, cwd) => {
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

/** Landed carries the merged sha and the shared checkout, so the caller can
 * sweep whatever the merge left behind. */
export type Landed = { landed: string; root: string }

/** Diverged says the base moved: the branch is rebased and waiting, and
 * `conflict` tells whether the rebase is sitting unresolved for the caller to
 * finish before it lands again. */
export type Diverged = { diverged: true; conflict: boolean }

export type Outcome = Landed | Diverged

/** What a landing takes: where to stand, how to ask git, where to print, and
 * the files whose rewind is vouched for. */
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

// git prints absolute paths in both answers, so the only difference either can
// carry is a trailing slash.
let same = (a: string, b: string) =>
  a.replace(/\/+$/, '') == b.replace(/\/+$/, '')

// A rebase can leave content no commit on the branch ever wrote. Resolving a
// conflict by taking the branch's side wholesale rewinds a file to what the
// branch forked from, undoing every base commit in between — one such landing
// took 22 files back to their pre-base content, and the gate passed because the
// tests rewound with the code. Two questions catch that, both asked of the
// rebased branch in the instant before it lands:
//
//   - which files does `base..HEAD` change that NO commit on the branch
//     touches? After a clean rebase that set is empty; anything in it is the
//     rebase's own doing.
//   - for the rest, does the landing blob equal a blob that path already HELD
//     earlier in the base's history? Content the base moved past and the branch
//     moves back is a revert nobody wrote.
//
// The second question exists because a rebase rewrites the branch's commits:
// afterwards a reverting resolution sits INSIDE a branch commit's file list,
// where the first question cannot see it.
export type Revert = { file: string; rewound: boolean }

let lines = (out: string) => out.split('\n').filter(Boolean)

// How far back down the base the blob scan looks — the base's recent history,
// not its whole life.
let DEPTH = 200

// `git log --raw` names the blob each commit LEFT at a path
// (`:mode mode src dst status\tpath`), so ONE walk of the base's recent history
// yields every content each path has held — no per-file, per-commit
// `rev-parse`. Merge commits show no raw lines and contribute nothing, which is
// right: a merge introduces no content of its own. The base TIP rides along
// harmlessly — its blob for a path IS `base:path`, which a file in the
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

// path → blob for the whole landing tree, in one `ls-tree -r`: cheaper than a
// `rev-parse` per file, and immune to a pathspec longer than argv allows.
let blobs = (out: string) =>
  new Map(
    lines(out).flatMap((l) => {
      let m = /^\S+ blob (\S+)\t(.+)$/.exec(l)
      return m ? [[m[2], m[1]] as [string, string]] : []
    }),
  )

/** Every file this landing would change that the branch did not author. Asked
 * only when the base is an ancestor of the branch, so `base...HEAD` is exactly
 * the landing diff. Its git is an argument, which is the seam a test answers
 * through. */
export let reverts = async (
  ask: (args: string[]) => Promise<string>,
  base: string,
): Promise<Revert[]> => {
  let changed = lines(await ask(['diff', '--name-only', `${base}...HEAD`]))
  if (!changed.length) return []
  let touched = new Set(
    lines(await ask(['log', '--format=', '--name-only', `${base}..HEAD`])),
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
    // A file the branch DELETES has no landing blob and nothing to rewind to.
    if (blob && past.get(file)?.has(blob)) found.push({ file, rewound: true })
  }
  return found
}

let why = (r: Revert, base: string, at: string) =>
  `  ${r.file} — ${
    r.rewound
      ? `lands at content ${base} already moved past`
      : `changed by the rebase, not by any commit on the branch`
  }${at ? `; ${base} last touched it at ${at}` : ''}`

// The refusal names the files and hands over the pointers — the base commit
// that last touched each, the diff to read, and the flag that lands anyway.
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
 * rebase onto a base that moved and return for the caller to re-gate. */
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
  // What the guard reads: a git question asked of the session worktree, whose
  // answer is raw lines — a failure there is a broken read, never an answer.
  let read = async (args: string[]) => {
    let r = await git(tree, args, false)
    if (r.code) throw new Error(message(`git ${args[0]}`, r))
    return r.out
  }

  // Every coordinate from git alone. `git worktree list --porcelain` lists the
  // primary worktree first (whatever tree you ask from, since worktrees share
  // one ref store), and the branch it holds is the base. A detached primary has
  // no base to land onto — refuse rather than guess.
  let tree = await need('find worktree', cwd, ['rev-parse', '--show-toplevel'])
  let branch = await need(
    'read branch',
    tree,
    ['symbolic-ref', '--short', 'HEAD'],
  )
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
    throw new Error(
      'land: the shared checkout is detached — no base to land onto',
    )
  }
  if (same(tree, root)) {
    throw new Error(
      'land: run it inside a linked worktree, not the shared checkout',
    )
  }
  if (branch == base) {
    throw new Error('land: the worktree is on the base branch')
  }

  // Uncommitted work would not land and would break a rebase, so a dirty
  // worktree is refused: the thing you land must be the thing you tested.
  let dirty = await need('git status', tree, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (dirty) throw new Error(`land: worktree is dirty:\n${dirty}`)

  // Ancestry decides which of the two things this invocation is, and it is
  // asked BEFORE the merge because the guard's refusal has to come before the
  // merge too: once the base has fast-forwarded, the artifact has landed.
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
    if (refuse.length) throw new Error(await refusal(read, base, refuse))
    for (let r of found) {
      write(`land: --allow-revert — landing anyway:${why(r, base, '')}`, true)
    }
    // No cleanliness check of the shared checkout: git refuses a merge that
    // would overwrite someone's uncommitted work and names the files, and
    // leaves edits it would not touch alone. If it refuses anyway — a hook, a
    // dirty checkout — surface git's own error.
    let merged = await git(root, ['merge', '--ff-only', branch])
    if (merged.code) throw new Error(message('git merge', merged))
    let sha = await need('read landed commit', root, ['rev-parse', 'HEAD'])
    await publish(git, write, root, base)
    // The tree and its branch SURVIVE landing — the caller's own cleanup comes
    // after us, and a command whose cwd was unlinked under it is refused by the
    // kernel. Unlock instead: whoever handed the tree out locked it to say
    // "someone works here", and this is that worker saying it has finished. The
    // unlock's exit decides nothing — the only failure reachable is "not
    // locked".
    await git(root, ['worktree', 'unlock', tree], false)
    return { landed: sha, root }
  }

  // The base moved; rebase onto it and return for the caller to re-gate and
  // land again. The guard runs on that second landing, when the rebase is done.

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
    // Rebase left in progress on purpose: the caller resolves the conflict,
    // `git rebase --continue`, then lands again. git printed the conflict
    // above; this only names the next step.
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

// Best-effort publish of the base branch to its git upstream, if it has one —
// nothing granted anywhere else, just `@{u}`. Never throws: an unreachable
// remote or no upstream is landed-but-unpublished, since the merge already took
// effect in the tree that runs.
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
  // One immediate retry: the observed failures were transient spawn errors
  // under load, and a push is idempotent — a second attempt costs nothing and
  // turns a blip into a publish.
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
