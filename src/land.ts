// The worktree landing protocol: resolve no coordinates from the shell, test
// the exact rebased commit, and let origin's fast-forward update serialize
// concurrent landers. Git exit codes decide every transition; its prose is
// only diagnostics, never control flow.
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

// A session can land only the task and worktree the graph assigned it. The
// project owns every variable capable of aiming a push or choosing its gate.
export let landing = (
  all: Row[],
  sid: string | undefined,
): Landing => {
  if (!sid) throw new Error('land: no session identity')
  let session = all.find((r) => String(r.comps.session?.id ?? '') == sid)
  if (!session) throw new Error(`land: no session entity for ${sid}`)
  let taskEid = String(session.comps.session?.requested_task_eid ?? '')
  let task = all.find((r) => r.eid == taskEid)
  if (!task?.comps.task) throw new Error('land: this session has no task')
  let project = all.find((r) =>
    r.eid == String(task.comps.task.project_eid ?? '')
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

  for (let attempt = 1; attempt <= retries; attempt++) {
    write(`land ${attempt}/${retries}: fetch ${spec.base}`)
    let fetched = await git(spec.tree, ['fetch', 'origin', spec.base])
    if (fetched.code) throw new Error(message('git fetch', fetched))
    let rebased = await git(spec.tree, ['rebase', `origin/${spec.base}`])
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

    write(`land ${attempt}/${retries}: push ${sha} to ${spec.base}`)
    let pushed = await git(
      spec.tree,
      ['push', 'origin', `HEAD:${spec.base}`],
    )
    if (!pushed.code) {
      await ops.record?.(sha)
      let removed = await git(
        spec.repo,
        ['worktree', 'remove', spec.tree],
      )
      if (removed.code) throw new Error(message('remove worktree', removed))
      // The remote already names this exact sha. Delete only the local ref we
      // tested, by compare-and-swap, without asking stale local main about it.
      let dropped = await git(
        spec.repo,
        ['update-ref', '-d', `refs/heads/${branch}`, sha],
      )
      if (dropped.code) throw new Error(message('delete branch', dropped))
      return sha
    }

    // Refresh origin and ask ancestry, not stderr, why the push refused. If
    // origin/base is still behind HEAD, this was not contention and a retest
    // cannot help. Otherwise another lander won the CAS; rebase and retest.
    let refresh = await git(spec.tree, ['fetch', 'origin', spec.base])
    if (refresh.code) throw new Error(message('push and refresh', refresh))
    let current = await git(
      spec.tree,
      ['merge-base', '--is-ancestor', `origin/${spec.base}`, 'HEAD'],
      false,
    )
    if (current.code == 0) throw new Error(message('git push', pushed))
    if (current.code != 1) {
      throw new Error(message('read push contention', current))
    }
    if (attempt == retries) {
      throw new Error(
        `origin/${spec.base} moved during ${retries} landing attempts`,
      )
    }
  }
  throw new Error('land: retry bound must be positive')
}
