/** Host Git checkouts. Git is authoritative; the graph is an idempotent observation.
 * Kept off the portable object/HTTP entrypoint: these operations require a host.
 */
import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import { refEid } from './refs.ts'

export { checkoutDoc } from './checkout_vocab.ts'

export let repositoryEid = (common: string) =>
  derivedEid('repository|' + common)
export let worktreeEid = (repository: string, path: string) =>
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
  // Existing parents are canonicalized even before a new checkout exists.
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

/** Discover a checkout and refresh shared refs. Deleted refs remain historical rows. */
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
  // Unborn branches still have an identity even though no shared ref exists yet.
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
  // No timestamp churn or graph notifications when Git has not changed.
  let previous = await g.storage.tx((tx) =>
    tx.get(changes.map((b) => b.entity.eid))
  )
  let byId = new Map(previous.map((b) => [b.entity.eid, b]))
  let changed = changes.filter((b) =>
    Object.entries(b).some(([k, v]) =>
      k != 'entity' &&
      Object.entries(v as Comp).some(([col, value]) =>
        (typeof value == 'boolean'
          ? Boolean((byId.get(b.entity.eid)?.[k] as Comp | undefined)?.[col])
          : ((byId.get(b.entity.eid)?.[k] as Comp | undefined)?.[col] ??
            null)) !== (value ?? null)
      )
    )
  )
  if (changed.length) await g.apply(changed)
  return (await row(g, eid))!
}

export type CheckoutRequest = { path: string; base?: string; branch?: string }
/** Retry-safe creation. Existing paths must be checkouts of the same repository.
 * Detached by default; base is resolved to a commit, never dirty working files.
 * Git's own worktree/ref locks arbitrate concurrent processes.
 */
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
    // A rival or a crash after git add may already have completed this operation.
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

/** Outside Git is an ordinary workspace. Explicit creation always uses strict discovery. */
export let checkoutAt = async (g: Graph, cwd: string) => {
  if (await git(cwd, ['rev-parse', '--is-inside-work-tree'], true) != 'true') {
    return undefined
  }
  return discover(g, cwd)
}

// Serialize same-path requests within the host, including distinct graph clients.
// Across processes Git's locks and the durable intent provide recovery.
let pending = new Map<string, Promise<unknown>>()
export let createWorktree = async (
  g: Graph,
  source: string,
  request: CheckoutRequest,
): Promise<Bundle> => {
  let path = await canonical(request.path)
  let before = pending.get(path) ?? Promise.resolve()
  let run = before.catch(() => {}).then(async () => {
    // Advisory OS lock survives process contention; kernel releases it on crash.
    // Leave lock files in place: unlinking them races waiting processes.
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
