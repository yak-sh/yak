// The worktree landing protocol: resolve no coordinates from the shell, test
// the exact rebased commit, and fast-forward the project's own checkout onto
// it. Git exit codes decide every transition; its prose is only diagnostics,
// never control flow.
//
// Landing means the shared checkout — the tree the server RUNS from. Pushing
// to origin publishes bytes and changes nothing anyone is executing, so it
// cannot be what makes work take effect; nothing else in the fleet brings that
// tree forward, which is why this verb must. Every step is local: worktrees
// share one ref store, so the base branch is a ref to rebase onto and
// fast-forward, and no network is involved. ff-only is still the
// compare-and-swap that serializes concurrent landers — a lander whose base
// moved is no longer a fast-forward, git refuses, and ancestry (never stderr)
// says whether that was contention worth retesting for.
//
// The harness's worktree isolation inspects the command string an AGENT types
// and refuses one aimed at the shared checkout; a subprocess spawned here is
// not subject to it. That guard stops an agent from editing a tree it does not
// own — not the project's own landing verb from fast-forwarding a branch.
import { resolve } from 'node:path'
import { commentChanges, type Row } from './client.ts'
import { type Change, idOf } from './types.ts'

export type Landing = {
  repo: string
  base: string
  gate: string
  tree: string
  task: Row
}

// A landed commit completes the task in the same graph transaction as its
// receipt. The exact receipt makes a lost-response retry idempotent.
export let landedChanges = (
  all: Row[],
  task: Row,
  sha: string,
  session?: string,
): Change[] => {
  let body = `Landed \`${sha}\`.`
  let recorded = all.some((r) =>
    r.comps.comment?.target_eid == task.eid && r.comps.doc?.body == body
  )
  return recorded ? [] : [
    { eid: task.eid, name: 'task', comp: { status: 'done' } },
    ...commentChanges(all, task.eid, body, session),
  ]
}

// A session's task is the one it is WORKING, however it came by it: the
// spawn builder's request when the graph named one, otherwise the task the
// session holds a claim on. Only a managed spawn ever writes
// requested_task_eid, so the claim is the sole coordinate a harness-spawned
// agent has — reading the request alone refused this verb to exactly the
// callers it exists for. Several claims name no single task: say which ones
// and stop, because guessing lands the work under the wrong ticket and
// closes it in the same transaction.
let taskFor = (all: Row[], session: Row): Row => {
  let requested = all.find((r) =>
    r.eid == String(session.comps.session?.requested_task_eid ?? '') &&
    r.comps.task
  )
  if (requested) return requested
  let claimed = all
    .filter((r) => r.comps.task && r.comps.claim?.session_eid == session.eid)
    .sort((a, b) => a.num - b.num)
  if (claimed.length > 1) {
    throw new Error(
      `land: this session claims ${claimed.map(idOf).join(', ')} — release ` +
        'the ones you are not landing (task release <id>)',
    )
  }
  if (!claimed.length) throw new Error('land: this session has no task')
  return claimed[0]
}

// A session can land only the task and worktree the graph assigned it. The
// project owns every variable capable of aiming a push or choosing its gate.
export let landing = (
  all: Row[],
  sid: string | undefined,
): Landing => {
  if (!sid) throw new Error('land: no session identity')
  let session = all.find((r) => String(r.comps.session?.id ?? '') == sid)
  if (!session) throw new Error(`land: no session entity for ${sid}`)
  let task = taskFor(all, session)
  let project = all.find((r) =>
    r.eid == String(task.comps.task?.project_eid ?? '')
  )
  if (!project?.comps.repo) {
    throw new Error(`${idOf(task)}: the task's project has no repo`)
  }
  let repo = String(project.comps.repo.path ?? '')
  let base = String(project.comps.repo.base_branch ?? '')
  let gate = String(project.comps.repo.gate ?? '').trim()
  if (!repo || !base) {
    throw new Error(
      `${idOf(project)}: repo.path and repo.base_branch are required`,
    )
  }
  if (!gate) {
    throw new Error(
      `${idOf(project)}: repo.gate is required — set it to one project ` +
        'command that runs the whole gate',
    )
  }
  let tree = String(session.comps.session?.cwd ?? '')
  if (!tree) throw new Error('land: this session has no worktree')
  return { repo, base, gate, tree, task }
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
  record?: (sha: string) => Promise<void>
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

  for (let attempt = 1; attempt <= retries; attempt++) {
    write(`land ${attempt}/${retries}: rebase onto ${spec.base}`)
    let rebased = await git(spec.tree, ['rebase', spec.base])
    if (rebased.code) throw new Error(message('git rebase', rebased))
    await clean()

    write(`land ${attempt}/${retries}: ${spec.gate}`)
    let gate = ops.gate
      ? await ops.gate(spec.tree, spec.gate)
      : await command('sh', ['-c', spec.gate], spec.tree).then((r) => {
        write(r.out)
        write(r.err, true)
        return r.code
      })
    if (gate) throw new Error(`project gate failed with exit ${gate}`)
    // A formatter or generator changing the tree means the tested filesystem
    // was not HEAD. Refuse it; the caller commits those bytes and lands again.
    await clean()
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
      let removed = await git(
        spec.repo,
        ['worktree', 'remove', spec.tree],
      )
      if (removed.code) throw new Error(message('remove worktree', removed))
      // The base branch already names this exact sha. Delete only the ref we
      // tested, by compare-and-swap, so a branch someone advanced meanwhile
      // survives.
      let dropped = await git(
        spec.repo,
        ['update-ref', '-d', `refs/heads/${branch}`, sha],
      )
      if (dropped.code) throw new Error(message('delete branch', dropped))
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
    if (current.code == 0) throw new Error(message('git merge', merged))
    if (current.code != 1) {
      throw new Error(message('read merge contention', current))
    }
    if (attempt == retries) {
      throw new Error(
        `${spec.base} moved during ${retries} landing attempts`,
      )
    }
  }
  throw new Error('land: retry bound must be positive')
}
