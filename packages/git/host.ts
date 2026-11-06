import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { command as processCommand } from '@yaks/process/command'
// Git checkouts on the machine this process runs on: find one, record what Git
// reports about it, create a new worktree, take one back once it holds
// nothing, and create it again where it stood.
//
// Git is authoritative here. The graph holds an observation of what Git
// reports, and writing that observation again changes nothing, so discovery
// can be run at any time. These functions run `git` as a subprocess, so they
// are kept out of ./mod.ts, which type-checks with only the web platform in
// scope.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import { and, distinct, eq, fields, list, present } from '@yaks/query'
import { refEid } from './comp.ts'
import { localFilesystem } from './placement.ts'
import { checkoutBase } from './checkout.ts'
export { filesystemEid, localFilesystem } from './placement.ts'

export { checkoutDoc } from './checkout_vocab.ts'

/** The entity id of a repository: its declared identity, the canonical common
 * Git directory. */
export let repositoryEid = (common: string, workspace: string): string =>
  identityEid('repository', [workspace, common])
/** The entity id of a checkout, derived from its repository and its canonical
 * root path. */
export let worktreeEid = (repository: string, path: string): string =>
  derivedEid('worktree|' + repository + '|' + path)

let git = async (cwd: string, args: string[], optional = false) => {
  let p = await processCommand('git', {
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
    return await io.realPath(path)
  } catch (e) {
    if (!io.isNotFound(e)) throw e
    let absolute = path.startsWith('/') ? path : system.cwd() + '/' + path
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
    await io.mkdir(dir, { recursive: true })
    let file = await io.open(
      dir + '/' + derivedEid('worktree lock|' + common + '|' + path),
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

/** Canonical Git directories for the checkout containing `cwd`, or nothing
 * when that directory is gone or is not a checkout. Other filesystem and
 * subprocess failures remain errors. This observation writes no graph rows. */
export let locate = async (cwd: string): Promise<
  { path: string; common: string; gitdir: string } | undefined
> => {
  let dirs: string | undefined
  try {
    dirs = await git(cwd, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
      '--absolute-git-dir',
    ])
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('fatal: not a git repository')
    ) {
      try {
        await io.lstat(`${cwd}/.git`)
      } catch (missing) {
        if (io.isNotFound(missing)) return undefined
        throw missing
      }
    }
    if (!io.isNotFound(error)) {
      throw new Error(`Git checkout ${cwd}: ${String(error)}`, { cause: error })
    }
    // ENOENT can also mean the git executable is missing. Only a missing
    // checkout directory is an absent observation.
    try {
      await io.stat(cwd)
    } catch (missing) {
      if (io.isNotFound(missing)) return undefined
      throw missing
    }
    throw new Error(`Git checkout ${cwd}: ${String(error)}`, { cause: error })
  }
  if (!dirs) return undefined
  let [path, common, gitdir] = await Promise.all(
    dirs.split('\n').map((dir) => io.realPath(dir)),
  )
  return { path, common, gitdir }
}

/** Current primary checkouts on this filesystem. Historical observations and
 * managed restore records do not stand in for a checkout that Git can open. */
export let primary = async (g: Graph): Promise<string[]> => {
  let filesystem = await localFilesystem(g)
  let refs = await g.rows(and(
    present('worktree'),
    eq('worktree.repository.repository.workspace', filesystem.entity.eid),
    distinct('worktree.repository'),
  ))
  let ids = refs.map((r) => r.value).filter((id): id is string =>
    typeof id == 'string'
  )
  let repos = ids.length ? await g.get(ids, ['repository']) : []
  let dirs = repos.flatMap((b) => {
    let common = (b.repository as Comp | undefined)?.common
    return typeof common == 'string' ? [common] : []
  })
  if (!dirs.length) return []
  let rows = await g.read(and(
    present('worktree'),
    eq('worktree.repository.repository.workspace', filesystem.entity.eid),
    eq('worktree.repository', list(...ids)),
    eq('worktree.gitdir', list(...dirs)),
    fields(
      'worktree.repository',
      'worktree.gitdir',
      'workspace.root',
      'worktree.repository.repository.common',
    ),
  ))
  let common = new Map(
    rows.filter((b) => b.repository).map((b) => [
      b.entity.eid,
      (b.repository as Comp).common,
    ]),
  )
  let trees = rows.filter((b) => b.worktree)
  let roots: string[] = []
  for (let b of trees) {
    let tree = b.worktree as Comp
    let root = (b.workspace as Comp | undefined)?.root
    let dir = common.get(String(tree.repository))
    if (
      typeof dir != 'string' || tree.gitdir != dir || typeof root != 'string'
    ) {
      continue
    }
    let current = await locate(root)
    if (
      current && current.gitdir == dir && current.common == dir &&
      current.path == root
    ) roots.push(root)
  }
  return [...new Set(roots)].sort()
}

/** Retire obsolete unmanaged checkout observations, keeping the entity and its
 * other components. Managed rows retain the history required by restore. */
export let reconcile = async (g: Graph, common: string): Promise<void> => {
  let filesystem = await localFilesystem(g)
  let repository = repositoryEid(common, filesystem.entity.eid)
  for (
    let tree of await g.read(
      '.worktree.repository=' + repository + ' ?workspace',
    )
  ) {
    let w = tree.worktree as Comp
    let path = (tree.workspace as Comp | undefined)?.root
    if (w.managed || typeof path != 'string') continue
    let current = await locate(path)
    if (
      current?.path == path && current.common == common &&
      current.gitdir == w.gitdir
    ) continue
    await g.apply([{
      entity: { eid: tree.entity.eid },
      worktree: null,
      $was: {
        worktree: Object.fromEntries(
          Object.entries(w).map(([key, value]) => [key, token(value)]),
        ),
      },
    }])
  }
}

/** Find the checkout containing `cwd`, and update the repository's refs from
 * Git. A ref that Git no longer has keeps its row, marked absent. */
export let discover = async (g: Graph, cwd: string): Promise<Bundle> => {
  // Git is asked everything at once: each answer is about the checkout that
  // holds `cwd`, from wherever in it `cwd` is, and a session opening pays for
  // one round of processes rather than six in a row.
  let [dirs, head, branch, refs] = await Promise.all([
    locate(cwd),
    git(cwd, ['rev-parse', '--verify', 'HEAD'], true),
    git(cwd, ['symbolic-ref', '-q', 'HEAD'], true),
    git(cwd, [
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(symref)',
    ]).catch((error: Error) => error),
  ])
  // Outside a checkout every command fails; that it is not one is the answer.
  if (!dirs) throw new Error('not a checkout: ' + cwd)
  if (refs instanceof Error) throw refs
  let { path, common, gitdir } = dirs
  let filesystem = await localFilesystem(g)
  let repository = repositoryEid(common, filesystem.entity.eid)
  let eid = worktreeEid(repository, path)
  let bundles: Bundle[] = [{
    entity: { eid: repository },
    repository: { common, workspace: filesystem.entity.eid },
  }]
  let found = new Set<string>()
  for (let line of refs!.split('\n').filter(Boolean)) {
    let [name, oid, target] = line.split('\t')
    let id = refEid(repository, name)
    found.add(id)
    bundles.push({
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
    bundles.push({
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
  // Only a ref still marked present can have gone: the repository's absent
  // ones, every branch a session ever cut, are many times the present.
  let present = await g.rows(
    '.ref.app=' + repository + '&.ref.present=true .fields=entity.eid',
  ) as { eid: string }[]
  for (let { eid } of present) {
    if (!found.has(eid)) {
      bundles.push({
        entity: { eid },
        ref: { present: false, oid: null, target: null },
      })
    }
  }
  let old = await row(g, eid)
  let tree: Bundle = {
    entity: { eid },
    worktree: {
      repository,
      gitdir,
      head: head ?? null,
      branch: branch ? refEid(repository, branch) : null,
      managed: Boolean((old?.worktree as Comp | undefined)?.managed),
    },
  }
  tree.workspace = {
    machine: (filesystem.workspace as Comp).machine,
    root: path,
  }
  bundles.push(tree)
  // Write only the rows whose values actually changed, so that discovering an
  // unchanged checkout updates no timestamps and notifies nobody.
  let previous = await g.get(
    bundles.map((b) => b.entity.eid),
    ['repository', 'ref', 'worktree', 'workspace'],
  )
  let byId = new Map(previous.map((b) => [b.entity.eid, b]))
  let changed = bundles.filter((b) =>
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

/** Repeating the same base request uses its original commit, even after a
 * branch moves. A different base must still name that pinned commit. With
 * `spare`, the checkout is made from the spare beside it ({@link keepSpare}) when
 * there is one. */
export type CheckoutRequest = {
  path: string
  base?: string
  branch?: string
  spare?: boolean
}
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
  let resolved = intent
    ? await checkoutBase(intent, request.base, (name) => resolve(source, name))
    : undefined
  if (intent && (intent.branch ?? null) !== (request.branch ?? null)) {
    throw new Error('checkout request conflicts with existing branch intent')
  }
  if (old?.worktree && !intent) {
    throw new Error(
      'existing checkout must be attached by home, not created again',
    )
  }
  if (old?.worktree && intent?.state == 'ready') {
    await replace(g, path, old.worktree as Comp, request.spare)
    let current = await discover(g, path)
    if ((current.worktree as Comp).repository != repository) {
      throw new Error('worktree repository mismatch')
    }
    return current
  }
  if (!intent) {
    try {
      await io.stat(path)
      throw new Error('checkout path already exists; attach with home instead')
    } catch (e) {
      if (!io.isNotFound(e)) throw e
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
    base = resolved ?? await resolve(source, request.base ?? 'HEAD')
    await g.apply([{ entity: { eid }, checkout: { base } }])
  } catch (error) {
    await g.apply([{
      entity: { eid },
      checkout: { state: 'failed', error: String(error) },
    }])
    throw error
  }
  try {
    await add(
      source,
      path,
      request.branch ? ['-b', request.branch] : ['--detach'],
      base,
      request.spare,
    )
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
    entity: { eid: current.entity.eid },
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
  if (!await locate(cwd)) {
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
  return locked(
    await commonOf(source),
    path,
    () => create(g, source, { ...request, path }),
  )
}

let commonOf = async (source: string): Promise<string> =>
  io.realPath(
    (await git(source, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]))!,
  )

// The spare beside the checkouts in `path`'s directory.
let spareBeside = (path: string) =>
  path.slice(0, path.lastIndexOf('/')) + '/.spare'

// Put a worktree at `path`, as `git worktree add` with these flags (`-b X`,
// `--detach`, or neither for a branch that stands) and target would: with
// `spare`, by renaming the spare beside it there and checking it out to the
// target, which rewrites only the files that differ and, through the
// repository's post-checkout hook, installs only what its lockfile changed.
// The rename takes it, so of two requests one has it; with none there, the
// worktree is cut whole.
let add = async (
  source: string,
  path: string,
  flags: string[],
  target: string,
  spare?: boolean,
): Promise<void> => {
  let taken = spare &&
    await io.rename(spareBeside(path), path).then(() => true, (e) => {
      if (io.isNotFound(e)) return false
      throw e
    })
  if (!taken) {
    await git(source, ['worktree', 'add', ...flags, path, target])
    return
  }
  try {
    await git(source, ['worktree', 'repair', path])
    await git(path, ['checkout', '--quiet', ...flags, target])
  } catch (failure) {
    await quiet(source, ['worktree', 'remove', '--force', path])
    throw failure
  }
}

/**
 * Cut the spare checkout beside `path` from `base` (a commit or ref of the
 * repository `source` is a checkout of), unless one is there: a checkout
 * created in that directory with `spare` is made from it in about a second,
 * where one cut whole writes every file and installs its dependencies. It is
 * cut under a name of its own and renamed once whole, so nothing takes it half
 * made; what a cut that never finished left there is removed first.
 *
 * ```ts ignore
 * import { createWorktree, keepSpare } from '@yaks/git/host'
 *
 * let path = '/srv/runs/S-1'
 * await createWorktree(graph, '/srv/repo', { path, branch: 'b', spare: true })
 * await keepSpare('/srv/repo', path, 'refs/heads/main') // for the next one
 * ```
 */
export let keepSpare = async (
  source: string,
  path: string,
  base = 'HEAD',
): Promise<void> => {
  let common = await commonOf(source)
  let at = spareBeside(await canonical(path))
  await locked(common, at, async () => {
    if (await io.stat(at).then(() => true, () => false)) return
    let dir = at.slice(0, at.lastIndexOf('/'))
    for await (let e of io.readDir(dir)) {
      if (!e.name.startsWith('.spare-')) continue
      await quiet(source, ['worktree', 'remove', '--force', `${dir}/${e.name}`])
      await io.remove(`${dir}/${e.name}`, { recursive: true })
    }
    let cut = `${at}-${crypto.randomUUID()}`
    await git(source, ['worktree', 'add', '--detach', cut, base])
    await io.rename(cut, at)
    // A request may take it the moment it is renamed; its repair is then the
    // one that tells Git where it went.
    await quiet(source, ['worktree', 'repair', at])
  })
}

/** Why a worktree was kept: uncommitted files, commits that exist nowhere
 * else, or a removal that did not succeed. */
export type Held = 'dirty' | 'unlanded' | 'failed'

/** What the scan reads of this host's processes, each read failing as procfs
 * does: `procfs` reads Linux's, and a test hands the scan its own. */
export type Procs = {
  /** Every process listed, by pid. */
  pids: () => Promise<string[]>
  /** The uid that owns a process. */
  owner: (pid: string) => Promise<number>
  /** A process's canonical working directory. */
  cwd: (pid: string) => Promise<string>
  /** Where a process's open descriptors point; one that closed reads `''`. */
  links: (pid: string) => Promise<string[]>
  /** The cwd and absolute open file paths of a same-user process ptrace
   * hides, or nothing when they cannot be read. */
  privileged: (pid: string) => Promise<string[] | undefined>
}

// Linux's ptrace checks can hide even a same-user cwd (a capability-bearing
// manager or a non-dumpable PAM helper). Ask the user manager for a privileged
// cwd reader. Its only operation reads this same-user link: no signal to
// the observed PID and no filesystem mutation. The root-owned helper and sudo
// permission are installed as described in README.md.
let privileged = async (pid: string): Promise<string[] | undefined> => {
  let read = await processCommand('systemd-run', {
    args: [
      '--user',
      '--quiet',
      '--wait',
      '--pipe',
      '--collect',
      '/usr/bin/sudo',
      '-n',
      '/usr/local/libexec/yak-process-cwd',
      pid,
    ],
    env: {
      XDG_RUNTIME_DIR: `/run/user/${system.uid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${system.uid()}/bus`,
    },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!read.success) return
  let found: unknown
  try {
    found = JSON.parse(new TextDecoder().decode(read.stdout))
  } catch {
    return
  }
  return Array.isArray(found) && found.length &&
      found.every((path) => typeof path == 'string' && path.startsWith('/'))
    ? found
    : undefined
}

/** This Linux host's processes, read from `/proc`. */
export let procfs: Procs = {
  pids: async () => {
    if (system.os != 'linux') {
      throw new Error('Worktree collection requires a local process scan')
    }
    return (await Array.fromAsync(io.readDir('/proc')))
      .map((entry) => entry.name).filter((name) => /^\d+$/.test(name))
  },
  owner: async (pid) => (await io.stat(`/proc/${pid}`)).uid,
  cwd: (pid) => io.realPath(`/proc/${pid}/cwd`),
  links: async (pid) => {
    let fd = `/proc/${pid}/fd`
    return await Promise.all(
      (await Array.fromAsync(io.readDir(fd))).map((entry) =>
        io.readLink(`${fd}/${entry.name}`).catch((error) => {
          if (io.isNotFound(error)) return ''
          throw error
        })
      ),
    )
  },
  privileged,
}

// What `read` finds for each of this user's processes, asked of them all at
// once, and what `hidden` keeps of a privileged read of one ptrace hides. A process that cannot be read holds nothing: it exited while it was
// read, turned non-dumpable, or the privileged helper refused it, as it does
// one whose cwd was deleted. Linux restricts other users' links even when
// procfs is readable; their sessions are protected by their graph homes.
let scan = async (
  procs: Procs,
  read: (pid: string) => Promise<string[]>,
  hidden = (paths: string[]) => paths,
): Promise<string[]> =>
  (await Promise.all((await procs.pids()).map(async (pid) => {
    try {
      if (await procs.owner(pid) != system.uid()) return []
      try {
        return await read(pid)
      } catch (error) {
        if (!io.isPermissionDenied(error)) throw error
        return hidden(await procs.privileged(pid) ?? [])
      }
    } catch {
      return []
    }
  }))).flat()

/** Canonical directories occupied by this user's live local processes,
 * including agents outside the graph. A process that cannot be read holds
 * nothing. */
export let processCwds = async (procs = procfs): Promise<Set<string>> =>
  new Set([
    await io.realPath(system.cwd()),
    ...await scan(
      procs,
      async (pid) => [await procs.cwd(pid)],
      (paths) => paths.slice(0, 1),
    ),
  ])

/** Paths occupied by this user's processes: their directories and open files.
 * Procfs links name the canonical file even when it was opened through a
 * symlink. A process that cannot be read holds nothing. */
export let processPaths = async (procs = procfs): Promise<Set<string>> =>
  new Set(
    await scan(procs, async (pid) => [
      await procs.cwd(pid),
      ...(await procs.links(pid)).filter((path) => path.startsWith('/'))
        .map((path) => path.replace(/ \(deleted\)$/, '')),
    ]),
  )

/** A process using any path inside a worktree keeps the whole checkout. */
export let inUse = (path: string, cwds: Set<string>): boolean =>
  [...cwds].some((cwd) => cwd == path || cwd.startsWith(path + '/'))

// A git command's output, or nothing when it failed or could not run at all —
// a path that is not a checkout is an answer here, not an error.
let quiet = (cwd: string, args: string[]): Promise<string | undefined> =>
  git(cwd, args, true).catch(() => undefined)

// The gitdir a linked worktree's `.git` file names, or nothing for a primary
// checkout or a path that is not a checkout at all. A worktree linked with
// `--relative-paths` names it relative to itself, never to this process.
let gitdirOf = async (path: string): Promise<string | undefined> => {
  let named = /^gitdir:\s*(.+)$/m.exec(
    await io.readTextFile(path + '/.git').catch(() => ''),
  )?.[1]?.trim()
  return named && !named.startsWith('/') ? `${path}/${named}` : named
}

/** A worktree Git has already lost: the gitdir its `.git` file names is gone,
 * so nothing can be committed from it and nothing read out of it. */
export let lost = async (path: string): Promise<boolean> => {
  let named = await gitdirOf(path)
  return !!named && !await io.stat(named).then(() => true, () => false)
}

/// moved('a b J <j@x> 1700000000 -0400\tcommit: x\n') -> 1700000000000
/// moved('') -> 0
/** When a reflog's last entry moved HEAD, in milliseconds: the time written
 * in the entry, not the file's. `git gc` expires every worktree's reflog,
 * rewriting each file whole with the same entries, so its mtime says when
 * gc last ran. */
export let moved = (reflog: string): number => {
  let last = reflog.trimEnd().split('\n').at(-1) ?? ''
  let at = Number(/ (\d+) [+-]\d{4}\t/.exec(last)?.[1])
  return Number.isSafeInteger(at) ? at * 1000 : 0
}

/** How long, in milliseconds, since Git last moved this linked worktree's
 * HEAD: a commit, checkout, rebase or reset, by its reflog's last entry, or
 * HEAD's own write. Editing or staging a file moves neither, but it makes the
 * worktree dirty, and a dirty worktree is kept at any age. Zero for anything
 * that is not a linked worktree. */
export let idleFor = async (
  path: string,
  now: number = Date.now(),
): Promise<number> => {
  let dir = await gitdirOf(path)
  if (!dir) return 0
  let [head, reflog] = await Promise.all([
    io.stat(dir + '/HEAD').then((s) => s.mtime?.getTime() ?? 0, () => 0),
    io.readTextFile(dir + '/logs/HEAD').then(moved, () => 0),
  ])
  return Math.max(0, now - Math.max(head, reflog))
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

// Containment on main proves landing only after the branch wrote work of its
// own. Reflogs retain commits through a rebase; a creation or a fast-forward
// alone is not work. Missing/expired evidence keeps the checkout.
let committed = async (path: string, branch: string, head: string) => {
  let log = await quiet(path, [
    'reflog',
    'show',
    '--format=%H%x09%gs',
    branch,
  ])
  let entries = log?.split('\n').filter(Boolean) ?? []
  let start = entries.at(-1)?.split('\t')[0]
  if (!start) return false
  let headLog = await quiet(path, [
    'reflog',
    'show',
    '--format=%H%x09%gs',
    'HEAD',
  ])
  for (let entry of [...entries, ...headLog?.split('\n') ?? []]) {
    let [hash, message] = entry.split('\t')
    if (
      !/^(commit(?: \([^)]*\))?|cherry-pick|rebase \(pick\)):/.test(
        message ?? '',
      )
    ) continue
    if (
      await quiet(path, ['merge-base', '--is-ancestor', hash, start]) == null &&
      await quiet(path, ['merge-base', '--is-ancestor', hash, head]) != null
    ) return true
  }
  return false
}

// What a checkout holds, beside the branch it stands on.
let holding = async (
  path: string,
  landed?: string,
  base?: string,
): Promise<{ held?: Held; branch?: string }> => {
  let at = await standing(path)
  if (at?.dirty) return { held: 'dirty' }
  if (!at?.head) return { held: 'unlanded' }
  let own = at.branch && `refs/heads/${at.branch}`
  if (landed) {
    let merged = !!own && own != landed &&
      (at.head == base || await committed(path, own, at.head)) &&
      await quiet(path, [
          'merge-base',
          '--is-ancestor',
          at.head,
          landed,
        ]) != null
    return { held: merged ? undefined : 'unlanded', branch: at.branch }
  }
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
 * `unlanded` — kept, never guessed at. With `landed`, only that full local
 * branch ref counts as a landing (for example `refs/heads/main`), and the
 * branch reflog must prove it committed work still contained in HEAD. A fresh
 * branch or missing reflog evidence is kept. A caller supplying the checkout's
 * pinned `base` can also take back a clean checkout still at that commit. */
export let holds = async (
  path: string,
  landed?: string,
  base?: string,
): Promise<Held | undefined> => (await holding(path, landed, base)).held

/** Remove one worktree — the directory and the branch it was created on —
 * unless it still holds something. Returns what kept it, or nothing. A worktree
 * Git has lost is deleted outright. Nothing here passes `--force`, so Git's own
 * refusal is a second guard behind `holds`. */
export let reclaim = async (
  path: string,
  landed?: string,
  base?: string,
): Promise<Held | undefined> => {
  if (await lost(path)) {
    // Without Git's index and HEAD, cleanliness and landing cannot be proved.
    if (landed) return 'unlanded'
    return await io.remove(path, { recursive: true })
      .then(() => undefined, () => 'failed' as Held)
  }
  let { held, branch } = await holding(path, landed, base)
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
 * recorded for that: `workspace{root}` and `worktree{head, branch}` already holds it, as long
 * as `discover` brought it up to date before the files went. */
export let restore = async (g: Graph, tree: Bundle): Promise<string> => {
  let w = tree.worktree as Comp | undefined
  let place = tree.workspace as Comp | undefined
  if (!w || typeof place?.root != 'string') {
    throw new Error('worktree has no workspace root')
  }
  let local = (await localFilesystem(g)).workspace as Comp
  if (place.machine != local.machine || place.sandbox) {
    throw new Error('Worktree is not on the explicitly local filesystem')
  }
  let path = place.root
  let repo = (await row(g, String(w.repository)))?.repository as
    | Comp
    | undefined
  if (repo?.workspace != (await localFilesystem(g)).entity.eid) {
    throw new Error('Repository is not on the local filesystem')
  }
  let common = repo.common
  if (typeof common != 'string') {
    if (await io.stat(path).then(() => true, () => false)) return path
    throw new Error('nothing recorded to cut ' + path + ' again from')
  }
  return locked(common, path, () => replace(g, path, w))
}

// Called with the checkout path locked by create or restore. A peer may have
// restored it while this request waited; an existing path is never replaced.
let replace = async (
  g: Graph,
  path: string,
  w: Comp,
  spare?: boolean,
): Promise<string> => {
  if (await io.stat(path).then(() => true, () => false)) return path
  let common = ((await row(g, String(w.repository)))?.repository as Comp)
    ?.common
  let head = w.head
  if (typeof head != 'string' || typeof common != 'string') {
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
  await add(
    common,
    path,
    branch ? standing ? [] : ['-b', branch] : ['--detach'],
    standing ? branch : head,
    spare,
  )
  await discover(g, path)
  return path
}
