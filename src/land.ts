// `task land` is a pure git primitive. It reads NOTHING from the graph — the
// worktree you stand in and `git worktree list` name every coordinate: the
// primary worktree is the shared checkout to merge into, and the branch that
// checkout holds is the base every sibling lands onto. Landing runs no gate
// and is never a black box; its output stays git's own, so an agent can always
// see exactly what happened. Git exit codes decide every transition; git's
// prose is only diagnostics, never control flow.
//
// One invocation does at most ONE thing:
//   - Fast-forward the current branch into the base. This succeeds exactly
//     when the base is still an ancestor of the branch — the common case, and
//     the whole job when it works → landed. A best-effort push follows if the
//     base has a git upstream (config `@{u}`, not a graph grant).
//   - If the base MOVED (no longer an ancestor) the fast-forward is refused:
//     rebase the branch onto the base and RETURN WITHOUT MERGING, printing
//     what happened, a `git diff --stat` of what the base pulled in (so the
//     agent can judge whether a re-gate matters — docs-only vs code that
//     touches it), and — on a rebase conflict — git's conflict output
//     verbatim. The agent re-gates if needed and runs `task land` again, which
//     then fast-forwards cleanly.
//
// A landing is also GUARDED: before the fast-forward, land refuses a branch
// whose files carry content no commit on it wrote — the rebase artifact that
// quietly reverts the base (see `reverts` below). `--allow-revert` names the
// files whose rewind is deliberate.
//
// ff-only is the compare-and-swap that serializes concurrent landers: a lander
// whose base moved is refused, rebases, and comes back. Landing means the
// SHARED CHECKOUT — the tree the server runs from; pushing to a remote only
// publishes bytes and is never the thing that makes work take effect, which is
// why the local fast-forward is the landing and the push is an afterthought.
//
// Running the gate (`deno task check && deno task test`) is the AGENT's job,
// not this verb's — before landing, and again after a rebase if the incoming
// diff could affect it. Land neither runs nor knows about a gate.
import { resolve } from 'node:path'
import { git as spawn, type Ran } from './repo.ts'

export type Unlanded = { line: string; message: string }

// One verdict for a session that ended with commits it never landed, whether
// git observed it at a refusal or the session wrap does. Used by the session
// health signal (sessions.ts), not by land itself, which no longer refuses —
// it either fast-forwards or rebases-and-returns for the agent to re-land.
export let unlanded = (
  branch: string,
  base: string,
  count: number,
  verdict = '',
): Unlanded => {
  let work = `${count} commit${
    count == 1 ? '' : 's'
  } on ${branch} not in ${base}`
  let line = `⚠ UNLANDED: ${work}`
  let tail = verdict.replace(/\s+/g, ' ').trim().slice(-240)
  return {
    line,
    message: `UNLANDED: ${work}${tail ? ` — ${tail}` : ''}`,
  }
}

// git is the only binary land runs, and repo.ts is the only place that spawns
// it. Output stays as git wrote it: land prints it verbatim, and `diff --stat`
// indents its first line.
type Run = (args: string[], cwd: string) => Promise<Ran>

let run: Run = (args, cwd) => spawn(cwd, args)

// Landed carries the merged sha and the shared checkout, so the caller can
// sweep the siblings the merge left mergeable. Diverged says the base moved:
// the branch is rebased and waiting, and `conflict` tells whether the rebase
// is sitting unresolved for the agent to finish before it re-lands.
export type Landed = { landed: string; root: string }
export type Diverged = { diverged: true; conflict: boolean }
export type Outcome = Landed | Diverged

type LandOps = {
  cwd?: string
  run?: Run
  write?: (text: string, error?: boolean) => void
  // Files whose rewind is deliberate (`--allow-revert=a,b`): warned about,
  // then landed.
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

// A rebase can leave content no commit on the branch ever wrote. Resolving a
// conflict by taking the branch's side wholesale rewinds a file to what the
// branch forked from, undoing every base commit in between — 2d63045b took 22
// files back to their pre-base content, and the gate passed because the tests
// rewound with the code. Two questions catch that, both asked of the rebased
// branch in the instant before it lands:
//
//   - which files does `base..HEAD` change that NO commit on the branch
//     touches? After a clean rebase that set is empty; anything in it is the
//     rebase's own doing.
//   - for the rest, does the landing blob equal a blob that path already HELD
//     earlier in the base's history? Content the base moved past and the
//     branch moves back is a revert nobody wrote.
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
// (`:mode mode src dst status\tpath`), so ONE walk of the base's recent
// history yields every content each path has held — no per-file, per-commit
// `rev-parse`. Merge commits show no raw lines and contribute nothing, which
// is right: a merge introduces no content of its own. The base TIP rides along
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

// Every file this landing would change that the branch did not author. Asked
// only when the base is an ancestor of the branch, so `base...HEAD` is exactly
// the landing diff.
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
// that last touched each, the diff to read, and the spelling that lands anyway.
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
    `  deliberate: task land --allow-revert=${names.join(',')}`,
  ].join('\n')
}

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
  // one ref store), and the branch it holds is the base. A detached primary
  // has no base to land onto — refuse rather than guess.
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
  if (resolve(tree) == resolve(root)) {
    throw new Error(
      'land: run it inside a session worktree, not the shared checkout',
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
    // The base has not moved: the branch is rebased onto it (or never left
    // it), so `base...HEAD` is the landing diff and the guard can read it.
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
    // The tree and its branch SURVIVE landing — the caller's own cleanup
    // (release the claim, delete scratch, write its wrap) comes after us, and a
    // command whose cwd was unlinked under it is refused by the kernel. Unlock
    // instead: the harness locked the tree to say "someone works here", and
    // this is that agent saying it has finished; probes.ts collects it once
    // nobody is inside. The unlock's exit decides nothing — the only failure
    // reachable is "not locked".
    await git(root, ['worktree', 'unlock', tree], false)
    return { landed: sha, root }
  }

  // The base moved; rebase onto it and return for the agent to re-gate and
  // re-land. The guard runs on that second landing, when the rebase is done.

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
    // Rebase left in progress on purpose: the agent resolves the conflict,
    // `git rebase --continue`, then `task land` again. git printed the
    // conflict above; this only names the next step.
    write(
      'land: rebase hit conflicts — resolve them, `git rebase --continue`, ' +
        'then `task land` again.',
      true,
    )
    return { diverged: true, conflict: true }
  }
  write(
    'land: rebased cleanly. Re-gate if the diff above could affect you, then ' +
      '`task land` again.',
  )
  return { diverged: true, conflict: false }
}

// Best-effort publish of the base branch to its git upstream, if it has one —
// no graph grant, just `@{u}`. Never throws: an unreachable remote or no
// upstream is landed-but-unpublished, since the merge already took effect in
// the tree that runs.
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
  // under load, and a push is idempotent — a second attempt costs nothing
  // and turns a blip into a publish (T-22282).
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
