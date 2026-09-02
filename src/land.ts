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
}

let defaultWrite = (text: string, error = false) => {
  text = text.trimEnd()
  if (text) (error ? console.error : console.log)(text)
}

let message = (label: string, r: Ran) => {
  let detail = (r.err || r.out).trim().split('\n').find(Boolean)
  return `${label} failed with exit ${r.code}${detail ? `: ${detail}` : ''}`
}

export let land = async (ops: LandOps = {}): Promise<Outcome> => {
  // A spawn-level failure (EAGAIN under fork pressure, a vanished binary)
  // REJECTS instead of returning a code, which would crash land after a
  // successful merge — the exact "Failed to spawn '/usr/bin/git'" seen when
  // the box is loaded (T-22282). Convert it to a failed run so every
  // caller keeps its own contract: need() throws its labeled error, publish
  // stays best-effort.
  let chosen = ops.run ?? run
  let command: Run = async (args, cwd) => {
    try {
      return await chosen(args, cwd)
    } catch (e) {
      return { ok: false, code: -1, out: '', err: `${e}` }
    }
  }
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

  // Try the fast-forward first — the whole job when the base has not moved. No
  // cleanliness check of the shared checkout: git refuses a merge that would
  // overwrite someone's uncommitted work and names the files, and leaves edits
  // it would not touch alone.
  let merged = await git(root, ['merge', '--ff-only', branch])
  if (!merged.code) {
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

  // The fast-forward refused. Ask ancestry, not stderr, why: if the base is
  // STILL an ancestor of the branch it should have fast-forwarded, so this was
  // a dirty checkout or a hook, not divergence — surface git's own error.
  // Otherwise the base moved; rebase onto it and return for the agent to
  // re-gate and re-land.
  let anc = await git(
    tree,
    ['merge-base', '--is-ancestor', base, branch],
    false,
  )
  if (anc.code == 0) throw new Error(message('git merge', merged))
  if (anc.code != 1) throw new Error(message('read merge contention', anc))

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
