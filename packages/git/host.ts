// Git checkouts on the machine this process runs on: find one, record what Git
// reports about it, and create a new worktree.
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
let row = async (g: Graph, eid: string) =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]
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

/** Find the checkout containing `cwd`, and update the repository's refs from
 * Git. A ref that Git no longer has keeps its row, marked absent. */
export let discover = async (g: Graph, cwd: string): Promise<Bundle> => {
  let path = await Deno.realPath(
    (await git(cwd, ['rev-parse', '--show-toplevel']))!,
  )
  let common = await Deno.realPath(
    (await git(path, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]))!,
  )
  let gitdir = await Deno.realPath(
    (await git(path, ['rev-parse', '--absolute-git-dir']))!,
  )
  let repository = repositoryEid(common)
  let eid = worktreeEid(repository, path)
  let head = await git(path, ['rev-parse', '--verify', 'HEAD'], true)
  let branch = await git(path, ['symbolic-ref', '-q', 'HEAD'], true)
  let refs = (await git(path, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(symref)',
  ]))!
  let changes: Bundle[] = [{
    entity: { eid: repository },
    repository: { common },
  }]
  let found = new Set<string>()
  for (let line of refs.split('\n').filter(Boolean)) {
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
  let previous = await g.storage.tx((tx) =>
    tx.get(changes.map((b) => b.entity.eid))
  )
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
  if (intent && request.base != null && intent.requested != request.base) {
    throw new Error('checkout request conflicts with pinned base intent')
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
    base = intent?.base ? String(intent.base) : (await git(source, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      (request.base ?? 'HEAD') + '^{commit}',
    ]))!
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

// Serialize requests for the same path within this process, including ones
// from different graph clients. Across processes, Git's own locks and the
// stored `checkout` row are what allow recovery.
let pending = new Map<string, Promise<unknown>>()
export let createWorktree = async (
  g: Graph,
  source: string,
  request: CheckoutRequest,
): Promise<Bundle> => {
  let path = await canonical(request.path)
  let before = pending.get(path) ?? Promise.resolve()
  let run = before.catch(() => {}).then(async () => {
    // An advisory lock file holds across processes, and the kernel releases it
    // if this one dies. The lock files are left in place: unlinking one races
    // with the processes waiting on it.
    let common = await Deno.realPath(
      (await git(source, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]))!,
    )
    let dir = common + '/yaks-locks'
    await Deno.mkdir(dir, { recursive: true })
    let file = await Deno.open(
      dir + '/' + worktreeEid(repositoryEid(common), path),
      { create: true, write: true },
    )
    try {
      await file.lock()
      return await create(g, source, { ...request, path })
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
