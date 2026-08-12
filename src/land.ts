// The worktree landing protocol: rebase the tree you stand in onto its base,
// test the exact rebased commit, and fast-forward the project's own checkout
// onto it. Git exit codes decide every transition; its prose is only
// diagnostics, never control flow.
//
// Landing is MECHANICAL and task-free: the worktree you run it in — not a
// task, claim, or session — names what to land, and the project that owns the
// checkout that worktree belongs to supplies the base branch, gate, and push
// grant. Any worktree of a graphed project can be fast-forwarded into its
// base; closing the task and releasing claims is the agent's own step
// afterward, not this verb's side effect (T-16680). `--no-gate` lands despite
// a red gate for an operator who has decided to; it never bypasses the
// ff-only merge, which is the compare-and-swap that protects concurrent
// landers.
//
// Landing means the shared checkout — the tree the server RUNS from. Pushing
// to origin publishes bytes and changes nothing anyone is executing on ITS
// OWN, so it cannot be the thing that makes work take effect; the local
// fast-forward is, and nothing else in the fleet brings that tree forward,
// which is why this verb must. Every landing step is local: worktrees share
// one ref store, so the base branch is a ref to rebase onto and
// fast-forward, and no network is involved. ff-only is still the
// compare-and-swap that serializes concurrent landers — a lander whose base
// moved is no longer a fast-forward, git refuses, and ancestry (never stderr)
// says whether that was contention worth retesting for.
//
// Some ventures' production DOES run off a push (a host that deploys on a
// GitHub webhook, not off this checkout) — for those, `repo.push` grants
// this verb one more, best-effort step after a successful merge: publish the
// base branch to its configured upstream. A refusal is a warning, never a
// failed land, because the merge already took effect locally; publishing
// only stops it from sitting unpublished until some unrelated event (a
// persona sync, a later push) happens to carry it the rest of the way.
//
// The harness's worktree isolation inspects the command string an AGENT types
// and refuses one aimed at the shared checkout; a subprocess spawned here is
// not subject to it. That guard stops an agent from editing a tree it does not
// own — not the project's own landing verb from fast-forwarding a branch.
import { resolve } from 'node:path'
import { type Row } from './client.ts'
import { idOf } from './types.ts'

export type Landing = {
  repo: string
  base: string
  gate: string
  tree: string
  push: boolean
}

export type Unlanded = { line: string; message: string }

// One verdict, whether Git observes it at the refusal or settlement does.
// The source can add the reason it heard; the backstop can add the closing
// words the agent left behind.
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

// The worktree — not a task — names what to land, so the project supplying
// the base branch, gate, and push grant is the one whose checkout that
// worktree belongs to. `root` is the shared checkout the tree sits under (the
// caller reads it from git); the project claims it by `repo.path`. The gate
// may be absent here — land() decides whether that is fatal, since --no-gate
// makes a missing gate irrelevant.
export let landing = (all: Row[], tree: string, root: string): Landing => {
  let project = all.find((r) =>
    r.comps.repo && resolve(String(r.comps.repo.path ?? '')) == resolve(root)
  )
  if (!project) {
    throw new Error(`land: no project has a checkout at ${root}`)
  }
  let repo = String(project.comps.repo!.path ?? '')
  let base = String(project.comps.repo!.base_branch ?? '')
  let gate = String(project.comps.repo!.gate ?? '').trim()
  let push = !!project.comps.repo!.push
  if (!repo || !base) {
    throw new Error(
      `${idOf(project)}: repo.path and repo.base_branch are required`,
    )
  }
  return { repo, base, gate, tree, push }
}

type Result = { code: number; out: string; err: string }
type Run = (bin: string, args: string[], cwd: string) => Promise<Result>

let dec = new TextDecoder()
let run: Run = async (bin, args, cwd) => {
  let out = await new Deno.Command(bin, {
    args,
    cwd,
    env: bin == 'git'
      ? { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }
      : undefined,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  return {
    code: out.code,
    out: dec.decode(out.stdout),
    err: dec.decode(out.stderr),
  }
}

type LandOps = {
  cwd?: string
  retries?: number
  run?: Run
  // Skip the project gate and land the rebased tree anyway — the operator's
  // deliberate `--no-gate` override for a red or absent gate. It never touches
  // the ff-only merge; a non-fast-forward still refuses.
  force?: boolean
  record?: (sha: string) => Promise<void>
  outcome?: (error?: string) => Promise<void>
  write?: (text: string, error?: boolean) => void
  gate?: (cwd: string, command: string) => Promise<number>
}

let defaultWrite = (text: string, error = false) => {
  text = text.trimEnd()
  if (text) (error ? console.error : console.log)(text)
}

let message = (label: string, r: Result) => {
  let detail = (r.err || r.out).trim().split('\n').find(Boolean)
  return `${label} failed with exit ${r.code}${detail ? `: ${detail}` : ''}`
}

export let land = async (spec: Landing, ops: LandOps = {}) => {
  let command = ops.run ?? run
  let write = ops.write ?? defaultWrite
  let cwd = ops.cwd ?? Deno.cwd()
  let retries = ops.retries ?? 5
  let git = async (at: string, args: string[], show = true) => {
    let r = await command('git', args, at)
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
  // Best-effort publish of the base branch to its configured upstream, only
  // where the project grants it (repo.push). Never throws: a refusal, or no
  // upstream at all, is landed-but-unpublished, not a failed land — the
  // merge above already made the change take effect in the tree that runs.
  let publish = async () => {
    if (!spec.push) return
    let up = await git(spec.repo, ['rev-parse', '--abbrev-ref', '@{u}'], false)
    if (up.code) {
      write(`land: ${spec.base} has no upstream — landed, not published`, true)
      return
    }
    let ref = up.out.trim()
    let cut = ref.indexOf('/')
    let remote = ref.slice(0, cut)
    let branch = ref.slice(cut + 1)
    let sent = await git(
      spec.repo,
      ['push', '--quiet', remote, `HEAD:${branch}`],
      false,
    )
    if (sent.code) {
      write(
        `${message(`land: publish to ${remote}/${branch}`, sent)} — landed ` +
          'locally, publish separately',
        true,
      )
    }
  }
  let clean = async () => {
    let status = await need(
      'git status',
      spec.tree,
      ['status', '--porcelain=v1', '--untracked-files=all'],
    )
    if (status) throw new Error(`land: worktree is dirty:\n${status}`)
  }
  // The checkout we fast-forward has to be sitting on the base branch, or the
  // merge lands this work on whatever else it holds — silently, in the tree
  // the server runs from. Asked once to fail before a minutes-long gate, and
  // again after it, because that is long enough for someone to wander off.
  let onBase = async () => {
    let on = await need(
      'read project branch',
      spec.repo,
      ['symbolic-ref', '--short', 'HEAD'],
    )
    if (on != spec.base) {
      throw new Error(
        `land: ${spec.repo} is on ${on}, not ${spec.base} — check it out first`,
      )
    }
  }

  let top = await need('find worktree', cwd, ['rev-parse', '--show-toplevel'])
  if (resolve(top) != resolve(spec.tree)) {
    throw new Error(`land: run it inside this session's worktree: ${spec.tree}`)
  }
  let repo = await need(
    'find project repo',
    spec.repo,
    ['rev-parse', '--show-toplevel'],
  )
  if (resolve(repo) != resolve(spec.repo)) {
    throw new Error(`land: graph repo is not its checkout root: ${spec.repo}`)
  }
  let branch = await need(
    'read branch',
    spec.tree,
    ['symbolic-ref', '--short', 'HEAD'],
  )
  if (branch == spec.base) {
    throw new Error('land: the worktree is on the base branch')
  }
  await need(
    'validate base branch',
    spec.tree,
    ['check-ref-format', '--branch', spec.base],
  )
  await need(
    'validate worktree branch',
    spec.tree,
    ['check-ref-format', `refs/heads/${branch}`],
  )
  let common = await need(
    'read worktree repo',
    spec.tree,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  )
  let expected = await need(
    'read project repo',
    spec.repo,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  )
  if (resolve(common) != resolve(expected)) {
    throw new Error('land: the session worktree belongs to another repo')
  }
  await clean()
  await onBase()
  // An unconfigured gate must never masquerade as green (`sh -c ''` exits 0),
  // so a missing repo.gate is fatal — unless the operator waived it with
  // --no-gate, which makes the gate irrelevant.
  if (!ops.force && !spec.gate) {
    throw new Error(
      'land: this project has no repo.gate — set repo.gate, or pass ' +
        '--no-gate to land without a gate',
    )
  }

  let refuse = async (reason: string): Promise<never> => {
    let count = Number(
      await need(
        'count unlanded commits',
        spec.tree,
        ['rev-list', '--count', `${spec.base}..${branch}`],
      ),
    )
    await ops.outcome?.(
      count > 0
        ? unlanded(branch, spec.base, count, reason).message
        : undefined,
    )
    throw new Error(reason)
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    write(`land ${attempt}/${retries}: rebase onto ${spec.base}`)
    let rebased = await git(spec.tree, ['rebase', spec.base])
    if (rebased.code) throw new Error(message('git rebase', rebased))
    await clean()

    if (ops.force) {
      write(`land ${attempt}/${retries}: --no-gate — skipping the project gate`)
    } else {
      write(`land ${attempt}/${retries}: ${spec.gate}`)
      let gate = ops.gate
        ? await ops.gate(spec.tree, spec.gate)
        : await command('sh', ['-c', spec.gate], spec.tree).then((r) => {
          write(r.out)
          write(r.err, true)
          return r.code
        })
      if (gate) await refuse(`project gate failed with exit ${gate}`)
      // A formatter or generator changing the tree means the tested filesystem
      // was not HEAD. Refuse it; the caller commits those bytes and lands again.
      await clean()
    }
    let sha = await need('read tested commit', spec.tree, ['rev-parse', 'HEAD'])

    write(`land ${attempt}/${retries}: merge ${sha} into ${spec.base}`)
    await onBase()
    // No cleanliness check of our own: git refuses a merge that would
    // overwrite someone's uncommitted work and names the files, and leaves
    // edits it would not touch alone. Demanding a spotless shared checkout
    // would fail landings over dirt that has nothing to do with them.
    let merged = await git(spec.repo, ['merge', '--ff-only', branch])
    if (!merged.code) {
      await ops.record?.(sha)
      await ops.outcome?.()
      await publish()
      // The tree and its branch SURVIVE the landing. The caller is standing
      // here and its closing bookkeeping comes after us — releasing the
      // claim, filing what it found, deleting its scratch, writing its wrap —
      // and a command whose cwd was unlinked under it is refused by the
      // kernel, so removal here converts an agent's own cleanup into
      // somebody else's chore (T-13942).
      //
      // Unlock instead: the harness locks the tree it hands an agent to say
      // "someone works here", and this verb is that agent saying it has
      // finished, which is the one fact only it knows. Whoever comes next
      // collects — probes.ts prunes a worktree that is merged, clean, and has
      // nobody inside it, and that last clause is what waits for the agent to
      // leave. The unlock's exit code decides nothing: the only failure
      // reachable here is "not locked", and the tree was proven a worktree of
      // this repo before the gate ran.
      await git(spec.repo, ['worktree', 'unlock', spec.tree], false)
      return sha
    }

    // Ask ancestry, not stderr, why the merge refused. If base is still an
    // ancestor of HEAD this was never a fast-forward problem — a dirty tree,
    // a hook — and a retest cannot help. Otherwise another lander won the
    // CAS; rebase onto where it left the branch and retest.
    let current = await git(
      spec.tree,
      ['merge-base', '--is-ancestor', spec.base, 'HEAD'],
      false,
    )
    if (current.code == 0) await refuse(message('git merge', merged))
    if (current.code != 1) {
      throw new Error(message('read merge contention', current))
    }
    if (attempt == retries) {
      await refuse(`${spec.base} moved during ${retries} landing attempts`)
    }
  }
  throw new Error('land: retry bound must be positive')
}
