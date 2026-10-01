// Git checkouts on the machine this process runs on: find one, record what Git
// reports about it, create a new worktree, take one back once it holds
// nothing, and create it again where it stood.
//
// Git is authoritative here. The graph holds an observation of what Git
// reports, and writing that observation again changes nothing, so discovery
// can be run at any time. These functions run `git` as a subprocess, so they
// are kept out of ./mod.ts, which type-checks with only the web platform in
// scope.

import {
  type Bundle,
  type Comp,
  derivedEid,
  type Graph,
  identityEid,
} from '@yaks/graph'
import { refEid } from './refs.ts'

export { checkoutDoc } from './checkout_vocab.ts'

/** The entity id of a repository: its declared identity, the canonical common
 * Git directory. */
export let repositoryEid = (common: string): string =>
  identityEid('repository', [common])
/** The entity id of a checkout, derived from its repository and its canonical
 * root path. */
export let worktreeEid = (repository: string, path: string): string =>
  derivedEid('worktree|' + repository + '|' + path)

let git = async (cwd: string, args: string[], optional = false) => {
  let p = await new Deno.Command('git', {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let text = new TextDecoder().decode(p.stdout).trimEnd()
  if (!p.success && !optional) {
    throw new Error(
      'git ' + args.join(' ') + ': ' +
        new TextDecoder().decode(p.stderr).trim(),
    )
  }
  return p.success ? text : undefined
}
let row = async (g: Graph, eid: string) => (await g.get([eid]))[0]
let canonical = async (path: string): Promise<string> => {
  // The parent directories that do exist are canonicalized, so a path can be
  // canonicalized before the checkout at the end of it has been created.
  try {
    return await Deno.realPath(path)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
    let absolute = path.startsWith('/') ? path : Deno.cwd() + '/' + path
    let parts: string[] = []
    for (let part of absolute.split('/')) {
      if (part == '..') parts.pop()
      else if (part && part != '.') parts.push(part)
    }
    let normalized = '/' + parts.join('/')
    let at = normalized.lastIndexOf('/')
    return await canonical(normalized.slice(0, at) || '/') + '/' +
      normalized.slice(at + 1)
  }
}

// Serialize creation and restoration at one worktree path, including requests
// through different graph clients. The advisory lock holds across processes,
// and the kernel releases it if this one dies. Lock files stay: unlinking one
// races with processes waiting on it.
let pending = new Map<string, Promise<unknown>>()
let locked = async <T>(
  common: string,
  path: string,
  change: () => Promise<T>,
): Promise<T> => {
  let before = pending.get(path) ?? Promise.resolve()
  let run = before.catch(() => {}).then(async () => {
    let dir = common + '/yaks-locks'
    await Deno.mkdir(dir, { recursive: true })
    let file = await Deno.open(
      dir + '/' + worktreeEid(repositoryEid(common), path),
      { create: true, write: true },
    )
    try {
      await file.lock()
      return await change()
    } finally {
      file.close()
    }
  })
  pending.set(path, run)
  try {
    return await run
  } finally {
    if (pending.get(path) === run) pending.delete(path)
  }
}

/** Find the checkout containing `cwd`, and update the repository's refs from
 * Git. A ref that Git no longer has keeps its row, marked absent. */
export let discover = async (g: Graph, cwd: string): Promise<Bundle> => {
  // Git is asked everything at once: each answer is about the checkout that
  // holds `cwd`, from wherever in it `cwd` is, and a session opening pays for
  // one round of processes rather than six in a row.
  let [dirs, head, branch, refs] = await Promise.all([
    git(cwd, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
      '--absolute-git-dir',
    ]),
    git(cwd, ['rev-parse', '--verify', 'HEAD'], true),
    git(cwd, ['symbolic-ref', '-q', 'HEAD'], true),
    git(cwd, [
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(symref)',
    ]),
  ])
  let [path, common, gitdir] = await Promise.all(
    dirs!.split('\n').map((dir) => Deno.realPath(dir)),
  )
  let repository = repositoryEid(common)
  let eid = worktreeEid(repository, path)
  let changes: Bundle[] = [{
    entity: { eid: repository },
    repository: { common },
  }]
  let found = new Set<string>()
  for (let line of refs!.split('\n').filter(Boolean)) {
    let [name, oid, target] = line.split('\t')
    let id = refEid(repository, name)
    found.add(id)
    changes.push({
      entity: { eid: id },
      ref: {
        app: repository,
        name,
        oid,
        target: target || null,
        present: true,
      },
    })
  }
  // A branch with no commits yet still gets an entity, even though Git has no
  // ref for it.
  if (branch && !found.has(refEid(repository, branch))) {
    let id = refEid(repository, branch)
    found.add(id)
    changes.push({
      entity: { eid: id },
      ref: {
        app: repository,
        name: branch,
        oid: null,
        target: null,
        present: false,
      },
    })
  }
  for (let old of await g.read('.ref.app=' + repository)) {
    if (!found.has(old.entity.eid)) {
      changes.push({
        entity: old.entity,
        ref: { present: false, oid: null, target: null },
      })
    }
  }
  let old = await row(g, eid)
  let tree: Bundle = {
    entity: { eid },
    worktree: {
      repository,
      path,
      gitdir,
      head: head ?? null,
      branch: branch ? refEid(repository, branch) : null,
      managed: Boolean((old?.worktree as Comp | undefined)?.managed),
    },
  }
  changes.push(tree)
  // Write only the rows whose values actually changed, so that discovering an
  // unchanged checkout updates no timestamps and notifies nobody.
  let previous = await g.get(changes.map((b) => b.entity.eid))
  let byId = new Map(previous.map((b) => [b.entity.eid, b]))
  let changed = changes.filter((b) =>
    Object.entries(b).some(([k, v]) =>
      k != 'entity' &&
      Object.entries(v as Comp).some(([prop, value]) =>
        (typeof value == 'boolean'
          ? Boolean((byId.get(b.entity.eid)?.[k] as Comp | undefined)?.[prop])
          : ((byId.get(b.entity.eid)?.[k] as Comp | undefined)?.[prop] ??
            null)) !== (value ?? null)
      )
    )
  )
  if (changed.length) await g.apply(changed)
  return (await row(g, eid))!
}

export type CheckoutRequest = { path: string; base?: string; branch?: string }
let resolve = async (source: string, base: string): Promise<string> =>
  (await git(source, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    base + '^{commit}',
  ]))!
/** Create a worktree, safely repeatable after a failure. A path that already
 * exists must be a checkout of the same repository. HEAD is detached unless a
 * branch is named, and the base is resolved to a commit, so uncommitted files
 * are never copied. Git's own worktree and ref locks settle races between
 * processes. */
let create = async (g: Graph, source: string, request: CheckoutRequest) => {
  let home = await discover(g, source)
  let repository = String((home.worktree as Comp).repository)
  let path = await canonical(request.path)
  let eid = worktreeEid(repository, path)
  let old = await row(g, eid)
  let intent = old?.checkout as Comp | undefined
  let resolved: string | undefined
  if (intent && request.base != null) {
    resolved = await resolve(source, request.base)
    let pinned = intent.base ?? await resolve(source, String(intent.requested))
    if (pinned != resolved) {
      throw new Error('checkout request conflicts with pinned base intent')
    }
  }
  if (intent && (intent.branch ?? null) !== (request.branch ?? null)) {
    throw new Error('checkout request conflicts with existing branch intent')
  }
  if (old?.worktree && !intent) {
    throw new Error(
      'existing checkout must be attached by home, not created again',
    )
  }
  if (old?.worktree && intent?.state == 'ready') {
    let current = await discover(g, path)
    if ((current.worktree as Comp).repository != repository) {
      throw new Error('worktree repository mismatch')
    }
    return current
  }
  if (!intent) {
    try {
      await Deno.stat(path)
      throw new Error('checkout path already exists; attach with home instead')
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
  await g.apply([{
    entity: { eid },
    checkout: {
      repository,
      path,
      requested: intent?.requested ?? request.base ?? 'HEAD',
      branch: request.branch ?? null,
      state: 'preparing',
      error: null,
    },
  }])
  let base: string
  try {
    base = intent?.base
      ? String(intent.base)
      : resolved ?? await resolve(source, request.base ?? 'HEAD')
    await g.apply([{ entity: { eid }, checkout: { base } }])
  } catch (error) {
    await g.apply([{
      entity: { eid },
      checkout: { state: 'failed', error: String(error) },
    }])
    throw error
  }
  let args = [
    'worktree',
    'add',
    ...(request.branch ? ['-b', request.branch] : ['--detach']),
    path,
    base,
  ]
  try {
    await git(source, args)
  } catch (failure) {
    // Another process, or a crash after `git worktree add` succeeded, may have
    // already done this; check before reporting a failure.
    try {
      let current = await discover(g, path)
      let c = current.worktree as Comp
      let desiredBranch = request.branch
        ? refEid(repository, 'refs/heads/' + request.branch)
        : null
      if (
        c.repository != repository || c.head != base ||
        (c.branch ?? null) != desiredBranch
      ) throw failure
    } catch {
      await g.apply([{
        entity: { eid },
        checkout: { state: 'failed', error: String(failure) },
      }])
      throw failure
    }
  }
  let current = await discover(g, path)
  await g.apply([{
    entity: current.entity,
    worktree: { managed: true },
    checkout: { state: 'ready', error: null },
  }])
  return (await row(g, current.entity.eid))!
}

/** The checkout containing `cwd`, or undefined when `cwd` is not inside one.
 * Creating a worktree always goes through `discover`, which refuses that. */
export let checkoutAt = async (
  g: Graph,
  cwd: string,
): Promise<Bundle | undefined> => {
  if (await git(cwd, ['rev-parse', '--is-inside-work-tree'], true) != 'true') {
    return undefined
  }
  return discover(g, cwd)
}

export let createWorktree = async (
  g: Graph,
  source: string,
  request: CheckoutRequest,
): Promise<Bundle> => {
  let path = await canonical(request.path)
  let common = await Deno.realPath(
    (await git(source, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]))!,
  )
  return locked(
    common,
    path,
    () => create(g, source, { ...request, path }),
  )
}

/** Why a worktree was kept: uncommitted files, commits that exist nowhere
 * else, or a removal that did not succeed. */
export type Held = 'dirty' | 'unlanded' | 'failed'

// A git command's output, or nothing when it failed or could not run at all —
// a path that is not a checkout is an answer here, not an error.
let quiet = (cwd: string, args: string[]): Promise<string | undefined> =>
  git(cwd, args, true).catch(() => undefined)

// The gitdir a linked worktree's `.git` file names, or nothing for a primary
// checkout or a path that is not a checkout at all. A worktree linked with
// `--relative-paths` names it relative to itself, never to this process.
let gitdirOf = async (path: string): Promise<string | undefined> => {
  let named = /^gitdir:\s*(.+)$/m.exec(
    await Deno.readTextFile(path + '/.git').catch(() => ''),
  )?.[1]?.trim()
  return named && !named.startsWith('/') ? `${path}/${named}` : named
}

/** A worktree Git has already lost: the gitdir its `.git` file names is gone,
 * so nothing can be committed from it and nothing read out of it. */
export let lost = async (path: string): Promise<boolean> => {
  let named = await gitdirOf(path)
  return !!named && !await Deno.stat(named).then(() => true, () => false)
}

/** How long, in milliseconds, since Git last wrote this linked worktree's own
 * state: its HEAD, index or reflog, which a commit, checkout, rebase or add
 * rewrites. Editing a file writes none of them, but it makes the worktree
 * dirty, and a dirty worktree is kept at any age. Zero for anything that is
 * not a linked worktree. */
export let idleFor = async (
  path: string,
  now: number = Date.now(),
): Promise<number> => {
  let dir = await gitdirOf(path)
  if (!dir) return 0
  let times = await Promise.all(
    ['HEAD', 'index', 'logs/HEAD'].map((f) =>
      Deno.stat(dir + '/' + f).then((s) => s.mtime?.getTime() ?? 0, () => 0)
    ),
  )
  return Math.max(0, now - Math.max(...times))
}

/** The linked worktrees of the repository whose common Git directory is
 * `common`: every checkout `git worktree list` names but the primary one.
 * Git's records of worktrees whose directory is already gone are pruned
 * first, so none of those is named. */
export let linked = async (common: string): Promise<string[]> => {
  let at = ['--git-dir=' + common, 'worktree']
  await quiet(common, [...at, 'prune'])
  let list = await quiet(common, [...at, 'list', '--porcelain']) ?? ''
  return list.split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .slice(1)
}

// What `git status` says of a checkout, from one process: whether it has
// uncommitted files, the commit it stands at and the branch it is on, by its
// short name. Nothing when the path is not a checkout.
let standing = async (path: string) => {
  let said = await quiet(path, ['status', '--porcelain=v2', '--branch'])
  if (said == null) return undefined
  let lines = said.split('\n')
  let header = (key: string) =>
    lines.find((l) => l.startsWith(`# branch.${key} `))?.split(' ')[2]
  let head = header('oid')
  let branch = header('head')
  return {
    dirty: lines.some((l) => l && !l.startsWith('#')),
    head: head == '(initial)' ? undefined : head,
    branch: branch == '(detached)' ? undefined : branch,
  }
}

// What a checkout holds, beside the branch it stands on.
let holding = async (
  path: string,
): Promise<{ held?: Held; branch?: string }> => {
  let at = await standing(path)
  if (at?.dirty) return { held: 'dirty' }
  if (!at?.head) return { held: 'unlanded' }
  let own = at.branch && `refs/heads/${at.branch}`
  let elsewhere = (await quiet(path, [
    'for-each-ref',
    '--contains',
    at.head,
    '--format=%(refname)',
    'refs/heads/',
  ]) ?? '').split('\n').filter((ref) => ref && ref != own)
  return { held: elsewhere.length ? undefined : 'unlanded', branch: at.branch }
}

/** What this worktree still holds, `undefined` when it holds nothing: a clean
 * working tree whose HEAD already exists on some other branch — the base it was
 * created from, a parent's branch, main. Its own branch never counts; that is
 * what "unlanded" means. A path that is not a worktree at all is reported as
 * `unlanded` — kept, never guessed at. */
export let holds = async (path: string): Promise<Held | undefined> =>
  (await holding(path)).held

/** Remove one worktree — the directory and the branch it was created on —
 * unless it still holds something. Returns what kept it, or nothing. A worktree
 * Git has lost is deleted outright. Nothing here passes `--force`, so Git's own
 * refusal is a second guard behind `holds`. */
export let reclaim = async (path: string): Promise<Held | undefined> => {
  if (await lost(path)) {
    return await Deno.remove(path, { recursive: true })
      .then(() => undefined, () => 'failed' as Held)
  }
  let { held, branch } = await holding(path)
  if (held) return held
  let common = await quiet(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  if (await quiet(path, ['worktree', 'remove', path]) == null) return 'failed'
  // The branch outlives its worktree, and only the repository can delete it.
  // `-D` is safe here: the commits were proved to exist on another branch.
  if (branch && common) {
    await quiet(common, ['--git-dir=' + common, 'branch', '-D', branch])
  }
  return undefined
}

/** The path this worktree is checked out at, creating it again if it was
 * removed — same path, same branch, at the commit its row recorded — so work
 * taken back by `reclaim` comes back where it stood. Nothing new has to be
 * recorded for that: `worktree{path, head, branch}` already holds it, as long
 * as `discover` brought it up to date before the files went. */
export let restore = async (g: Graph, tree: Bundle): Promise<string> => {
  let w = tree.worktree as Comp | undefined
  if (!w?.path) throw new Error('worktree ' + tree.entity.eid + ' has no path')
  let path = String(w.path)
  let common =
    ((await row(g, String(w.repository)))?.repository as Comp | undefined)
      ?.common
  let head = w.head
  if (typeof common != 'string') {
    if (await Deno.stat(path).then(() => true, () => false)) return path
    throw new Error('nothing recorded to cut ' + path + ' again from')
  }
  return locked(common, path, async () => {
    // A peer may have restored it while this request waited for the lock.
    if (await Deno.stat(path).then(() => true, () => false)) return path
    if (typeof head != 'string') {
      throw new Error('nothing recorded to cut ' + path + ' again from')
    }
    let name = w.branch
      ? String(
        ((await row(g, String(w.branch)))?.ref as Comp | undefined)?.name ?? '',
      )
      : ''
    let branch = name.replace(/^refs\/heads\//, '')
    // Removing a worktree deletes its branch too, but a branch somebody else
    // kept is where that work actually is, not a stale copy of it.
    let standing = !!branch &&
      await quiet(common, ['rev-parse', '--verify', '--quiet', name]) != null
    await git(common, [
      'worktree',
      'add',
      ...branch ? standing ? [] : ['-b', branch] : ['--detach'],
      path,
      standing ? branch : head,
    ])
    await discover(g, path)
    return path
  })
}
