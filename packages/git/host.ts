// Git checkouts on an explicitly lent machine: find one, record what Git
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
  token,
} from '@yaks/graph'
import { refEid } from './refs.ts'
import type { Blobs } from '@yaks/blob'
import type { Run } from './land.ts'
import { objects } from './objects.ts'
import type { Machine } from '@yaks/machine'
import {
  canonical,
  exists,
  machineExec,
  machineLocked,
  machineRun,
  python,
  quote,
} from './machine.ts'
export { machineExec, machineRun } from './machine.ts'

export { checkoutDoc } from './checkout_vocab.ts'

/** The entity id of a repository: its declared identity, the canonical common
 * Git directory. */
export let repositoryEid = (common: string): string =>
  identityEid('repository', [common])
/** The entity id of a checkout, derived from its repository and its canonical
 * root path. */
export let worktreeEid = (repository: string, path: string): string =>
  derivedEid('worktree|' + repository + '|' + path)

let git = async (
  cwd: string,
  args: string[],
  optional: boolean,
  machine: Machine,
) => {
  let ran = await machineRun(machine)(args, cwd)
  if (!ran.ok && !optional) {
    throw new Error('git ' + args.join(' ') + ': ' + ran.err.trim())
  }
  return ran.ok ? ran.out.trimEnd() : undefined
}
let row = async (g: Graph, eid: string) => (await g.get([eid]))[0]
let locked = <T>(
  common: string,
  path: string,
  change: () => Promise<T>,
  machine: Machine,
): Promise<T> =>
  machineLocked(
    machine,
    common + '/yaks-locks/' + worktreeEid(repositoryEid(common), path),
    change,
  )

/** Canonical Git directories for the checkout containing `cwd`, or nothing
 * when that directory is gone or is not a checkout. Other filesystem and
 * subprocess failures remain errors. This observation writes no graph rows. */
export let locate = async (cwd: string, machine: Machine): Promise<
  { path: string; common: string; gitdir: string } | undefined
> => {
  if (!await exists(cwd, machine)) return undefined
  let dirs = await git(
    cwd,
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
      '--absolute-git-dir',
    ],
    true,
    machine,
  )
  if (!dirs) return undefined
  let [path, common, gitdir] = await Promise.all(
    dirs.split('\n').map((dir) => canonical(dir, machine)),
  )
  return { path, common, gitdir }
}

/** Retire missing unmanaged checkout observations, keeping the entity and its
 * other components. Managed rows retain the history required by restore. */
export let reconcile = async (
  g: Graph,
  common: string,
  machine: Machine,
): Promise<void> => {
  let repository = repositoryEid(common)
  for (let tree of await g.read('.worktree.repository=' + repository)) {
    let w = tree.worktree as Comp
    if (w.managed || typeof w.path != 'string') continue
    if (!await exists(w.path, machine)) {
      await g.apply([{
        entity: tree.entity,
        worktree: null,
        $was: {
          worktree: Object.fromEntries(
            Object.entries(w).map(([key, value]) => [key, token(value)]),
          ),
        },
      }])
    }
  }
}

/** Find the checkout containing `cwd`, and update the repository's refs from
 * Git. A ref that Git no longer has keeps its row, marked absent. */
export let discover = async (
  g: Graph,
  cwd: string,
  machine: Machine,
): Promise<Bundle> => {
  // Git is asked everything at once: each answer is about the checkout that
  // holds `cwd`, from wherever in it `cwd` is, and a session opening pays for
  // one round of processes rather than six in a row.
  let [dirs, head, branch, refs] = await Promise.all([
    locate(cwd, machine),
    git(cwd, ['rev-parse', '--verify', 'HEAD'], true, machine),
    git(cwd, ['symbolic-ref', '-q', 'HEAD'], true, machine),
    git(
      cwd,
      [
        'for-each-ref',
        '--format=%(refname)%09%(objectname)%09%(symref)',
      ],
      false,
      machine,
    ),
  ])
  if (!dirs) throw new Error('not a checkout: ' + cwd)
  let { path, common, gitdir } = dirs
  let repository = repositoryEid(common)
  let eid = worktreeEid(repository, path)
  let bundles: Bundle[] = [{
    entity: { eid: repository },
    repository: { common },
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
  for (let old of await g.read('.ref.app=' + repository)) {
    if (!found.has(old.entity.eid)) {
      bundles.push({
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
  bundles.push(tree)
  // Write only the rows whose values actually changed, so that discovering an
  // unchanged checkout updates no timestamps and notifies nobody.
  let previous = await g.get(bundles.map((b) => b.entity.eid))
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

export type CheckoutRequest = { path: string; base?: string; branch?: string }
let resolve = async (
  source: string,
  base: string,
  machine: Machine,
): Promise<string> =>
  (await git(
    source,
    [
      'rev-parse',
      '--verify',
      '--end-of-options',
      base + '^{commit}',
    ],
    false,
    machine,
  ))!
/** Create a worktree, safely repeatable after a failure. A path that already
 * exists must be a checkout of the same repository. HEAD is detached unless a
 * branch is named, and the base is resolved to a commit, so uncommitted files
 * are never copied. Git's own worktree and ref locks settle races between
 * processes. */
let create = async (
  g: Graph,
  source: string,
  request: CheckoutRequest,
  machine: Machine,
) => {
  let home = await discover(g, source, machine)
  let repository = String((home.worktree as Comp).repository)
  let path = await canonical(request.path, machine)
  let eid = worktreeEid(repository, path)
  let old = await row(g, eid)
  let intent = old?.checkout as Comp | undefined
  let resolved: string | undefined
  if (intent && request.base != null) {
    resolved = await resolve(source, request.base, machine)
    let pinned = intent.base ??
      await resolve(source, String(intent.requested), machine)
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
    let current = await discover(g, path, machine)
    if ((current.worktree as Comp).repository != repository) {
      throw new Error('worktree repository mismatch')
    }
    return current
  }
  if (!intent && await exists(path, machine)) {
    throw new Error('checkout path already exists; attach with home instead')
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
      : resolved ?? await resolve(source, request.base ?? 'HEAD', machine)
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
    await git(source, args, false, machine)
  } catch (failure) {
    // Another process, or a crash after `git worktree add` succeeded, may have
    // already done this; check before reporting a failure.
    try {
      let current = await discover(g, path, machine)
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
  let current = await discover(g, path, machine)
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
  machine: Machine,
): Promise<Bundle | undefined> => {
  if (!await locate(cwd, machine)) {
    return undefined
  }
  return discover(g, cwd, machine)
}

export let createWorktree = async (
  g: Graph,
  source: string,
  request: CheckoutRequest,
  machine: Machine,
): Promise<Bundle> => {
  let path = await canonical(request.path, machine)
  let common = await canonical(
    (await git(
      source,
      [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ],
      false,
      machine,
    ))!,
    machine,
  )
  return locked(
    common,
    path,
    () => create(g, source, { ...request, path }, machine),
    machine,
  )
}

/** Why a worktree was kept: uncommitted files, commits that exist nowhere
 * else, or a removal that did not succeed. */
export type Held = 'dirty' | 'unlanded' | 'failed'

// The scan runs where the capability was lent. Hidden same-user procfs paths
// refuse collection unless the configured privileged helper proves them.
let scan = async (
  machine: Machine,
  pids: string[] | undefined,
  descriptors: boolean,
): Promise<Set<string>> => {
  let paths = await python<string[]>(
    machine,
    `import os,json,sys,subprocess
if sys.platform != 'linux': raise RuntimeError('Worktree collection requires Linux procfs')
paths=set()
for pid in ${
      pids
        ? JSON.stringify(pids)
        : "[p for p in os.listdir('/proc') if p.isdigit()]"
    }:
 proc='/proc/'+pid
 try:
  if os.stat(proc).st_uid != os.getuid(): continue
  try:
   paths.add(os.path.realpath(proc+'/cwd',strict=True))
   if ${descriptors ? 'True' : 'False'}:
    for fd in os.listdir(proc+'/fd'):
     try:
      path=os.readlink(proc+'/fd/'+fd)
      if path.startswith('/'): paths.add(path.removesuffix(' (deleted)'))
     except FileNotFoundError: pass
  except PermissionError:
   uid=str(os.getuid()); env=dict(os.environ,XDG_RUNTIME_DIR='/run/user/'+uid,DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/'+uid+'/bus')
   read=subprocess.run(['systemd-run','--user','--quiet','--wait','--pipe','--collect','/usr/bin/sudo','-n','/usr/local/libexec/yak-process-cwd',pid],env=env,capture_output=True)
   os.stat(proc)
   found=json.loads(read.stdout)
   if read.returncode or not isinstance(found,list) or not found or not all(isinstance(p,str) and p.startswith('/') for p in found): raise RuntimeError('Worktree collection cannot inspect '+proc)
   paths.update(found)
 except (FileNotFoundError,ProcessLookupError): pass
print(json.dumps(list(paths)))`,
  )
  return new Set(paths)
}
/** Same-user process directories on the lent machine, failing closed. */
export let processCwds = (machine: Machine): Promise<Set<string>> =>
  scan(machine, undefined, false)
/** Process directories and descriptors on the lent machine, failing closed. */
export let processPaths = (
  pids: string[] | undefined,
  machine: Machine,
): Promise<Set<string>> => scan(machine, pids, true)

/** A process using any path inside a worktree keeps the whole checkout. */
export let inUse = (path: string, cwds: Set<string>): boolean =>
  [...cwds].some((cwd) => cwd == path || cwd.startsWith(path + '/'))

// A git command's output, or nothing when it failed or could not run at all —
// a path that is not a checkout is an answer here, not an error.
let quiet = (
  cwd: string,
  args: string[],
  machine: Machine,
): Promise<string | undefined> =>
  git(cwd, args, true, machine).catch(() => undefined)

// The gitdir a linked worktree's `.git` file names, or nothing for a primary
// checkout or a path that is not a checkout at all. A worktree linked with
// `--relative-paths` names it relative to itself, never to this process.
let gitdirOf = async (
  path: string,
  machine: Machine,
): Promise<string | undefined> => {
  let named = /^gitdir:\s*(.+)$/m.exec(
    await machine.read(path + '/.git').catch(() => ''),
  )?.[1]?.trim()
  return named && !named.startsWith('/') ? `${path}/${named}` : named
}

/** A worktree Git has already lost: the gitdir its `.git` file names is gone,
 * so nothing can be committed from it and nothing read out of it. */
export let lost = async (path: string, machine: Machine): Promise<boolean> => {
  let named = await gitdirOf(path, machine)
  return !!named && !await exists(named, machine)
}

/** How long, in milliseconds, since Git last wrote this linked worktree's own
 * state: its HEAD, index or reflog, which a commit, checkout, rebase or add
 * rewrites. Editing a file writes none of them, but it makes the worktree
 * dirty, and a dirty worktree is kept at any age. Zero for anything that is
 * not a linked worktree. */
export let idleFor = async (
  path: string,
  now: number = Date.now(),
  machine: Machine,
): Promise<number> => {
  let dir = await gitdirOf(path, machine)
  if (!dir) return 0
  let times = await python<number[]>(
    machine,
    `import os,json
out=[]
for f in ['HEAD','index','logs/HEAD']:
 try: out.append(os.stat(${JSON.stringify(dir)}+'/'+f).st_mtime*1000)
 except FileNotFoundError: out.append(0)
print(json.dumps(out))`,
  )
  return Math.max(0, now - Math.max(...times))
}

/** The linked worktrees of the repository whose common Git directory is
 * `common`: every checkout `git worktree list` names but the primary one.
 * Git's records of worktrees whose directory is already gone are pruned
 * first, so none of those is named. */
export let linked = async (
  common: string,
  machine: Machine,
): Promise<string[]> => {
  let at = ['--git-dir=' + common, 'worktree']
  await quiet(common, [...at, 'prune'], machine)
  let list = await quiet(common, [...at, 'list', '--porcelain'], machine) ?? ''
  return list.split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .slice(1)
}

// What `git status` says of a checkout, from one process: whether it has
// uncommitted files, the commit it stands at and the branch it is on, by its
// short name. Nothing when the path is not a checkout.
let standing = async (path: string, machine: Machine) => {
  let said = await quiet(
    path,
    ['status', '--porcelain=v2', '--branch'],
    machine,
  )
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
let committed = async (
  path: string,
  branch: string,
  head: string,
  machine: Machine,
) => {
  let log = await quiet(path, [
    'reflog',
    'show',
    '--format=%H%x09%gs',
    branch,
  ], machine)
  let entries = log?.split('\n').filter(Boolean) ?? []
  let start = entries.at(-1)?.split('\t')[0]
  if (!start) return false
  let headLog = await quiet(path, [
    'reflog',
    'show',
    '--format=%H%x09%gs',
    'HEAD',
  ], machine)
  for (let entry of [...entries, ...headLog?.split('\n') ?? []]) {
    let [hash, message] = entry.split('\t')
    if (
      !/^(commit(?: \([^)]*\))?|cherry-pick|rebase \(pick\)):/.test(
        message ?? '',
      )
    ) continue
    if (
      await quiet(
          path,
          ['merge-base', '--is-ancestor', hash, start],
          machine,
        ) == null &&
      await quiet(path, ['merge-base', '--is-ancestor', hash, head], machine) !=
        null
    ) return true
  }
  return false
}

// What a checkout holds, beside the branch it stands on.
let holding = async (
  path: string,
  landed: string | undefined,
  machine: Machine,
): Promise<{ held?: Held; branch?: string }> => {
  let at = await standing(path, machine)
  if (at?.dirty) return { held: 'dirty' }
  if (!at?.head) return { held: 'unlanded' }
  let own = at.branch && `refs/heads/${at.branch}`
  if (landed) {
    let merged = !!own && own != landed &&
      await committed(path, own, at.head, machine) && await quiet(path, [
          'merge-base',
          '--is-ancestor',
          at.head,
          landed,
        ], machine) != null
    return { held: merged ? undefined : 'unlanded', branch: at.branch }
  }
  let elsewhere = (await quiet(path, [
    'for-each-ref',
    '--contains',
    at.head,
    '--format=%(refname)',
    'refs/heads/',
  ], machine) ?? '').split('\n').filter((ref) => ref && ref != own)
  return { held: elsewhere.length ? undefined : 'unlanded', branch: at.branch }
}

/** What this worktree still holds, `undefined` when it holds nothing: a clean
 * working tree whose HEAD already exists on some other branch — the base it was
 * created from, a parent's branch, main. Its own branch never counts; that is
 * what "unlanded" means. A path that is not a worktree at all is reported as
 * `unlanded` — kept, never guessed at. With `landed`, only that full local
 * branch ref counts as a landing (for example `refs/heads/main`), and the
 * branch reflog must prove it committed work still contained in HEAD. A fresh
 * branch or missing reflog evidence is kept. */
export let holds = async (
  path: string,
  landed: string | undefined,
  machine: Machine,
): Promise<Held | undefined> => (await holding(path, landed, machine)).held

/** Remove one worktree — the directory and the branch it was created on —
 * unless it still holds something. Returns what kept it, or nothing. A worktree
 * Git has lost is deleted outright. Nothing here passes `--force`, so Git's own
 * refusal is a second guard behind `holds`. */
export let reclaim = async (
  path: string,
  landed: string | undefined,
  machine: Machine,
): Promise<Held | undefined> => {
  if (await lost(path, machine)) {
    // Without Git's index and HEAD, cleanliness and landing cannot be proved.
    if (landed) return 'unlanded'
    return await machineExec(machine, 'rm -r -- ' + quote(path))
      .then(
        (ran) => ran.ok ? undefined : 'failed' as Held,
        () => 'failed' as Held,
      )
  }
  let { held, branch } = await holding(path, landed, machine)
  if (held) return held
  let common = await quiet(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ], machine)
  if (await quiet(path, ['worktree', 'remove', path], machine) == null) {
    return 'failed'
  }
  // The branch outlives its worktree, and only the repository can delete it.
  // `-D` is safe here: the commits were proved to exist on another branch.
  if (branch && common) {
    await quiet(
      common,
      ['--git-dir=' + common, 'branch', '-D', branch],
      machine,
    )
  }
  return undefined
}

/** The path this worktree is checked out at, creating it again if it was
 * removed — same path, same branch, at the commit its row recorded — so work
 * taken back by `reclaim` comes back where it stood. Nothing new has to be
 * recorded for that: `worktree{path, head, branch}` already holds it, as long
 * as `discover` brought it up to date before the files went. */
export let restore = async (
  g: Graph,
  tree: Bundle,
  machine: Machine,
): Promise<string> => {
  let w = tree.worktree as Comp | undefined
  if (!w?.path) throw new Error('worktree ' + tree.entity.eid + ' has no path')
  let path = String(w.path)
  let common =
    ((await row(g, String(w.repository)))?.repository as Comp | undefined)
      ?.common
  let head = w.head
  if (typeof common != 'string') {
    if (await exists(path, machine)) return path
    throw new Error('nothing recorded to cut ' + path + ' again from')
  }
  return locked(common, path, async () => {
    // A peer may have restored it while this request waited for the lock.
    if (await exists(path, machine)) return path
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
      await quiet(
          common,
          ['rev-parse', '--verify', '--quiet', name],
          machine,
        ) != null
    await git(
      common,
      [
        'worktree',
        'add',
        ...branch ? standing ? [] : ['-b', branch] : ['--detach'],
        path,
        standing ? branch : head,
      ],
      false,
      machine,
    )
    await discover(g, path, machine)
    return path
  }, machine)
}

/** Mirror the graph's accepted branch into one explicitly attached checkout.
 * Dirt and divergence keep their files; catchup never changes a graph ref. */
export let sync = async (
  g: Graph,
  path: string,
  machine: Machine,
  options: { bytes: Blobs; app?: string; branch?: string; run?: Run },
): Promise<'synced' | 'current' | 'dirty' | 'diverged' | 'missing'> => {
  let at = await locate(path, machine)
  if (!at) return 'missing'
  let branch = options.branch ?? 'refs/heads/main'
  let app = options.app ?? repositoryEid(at.common)
  return locked(at.common, at.path, async () => {
    let accepted =
      ((await row(g, refEid(app, branch)))?.ref as Comp | undefined)?.commit
    if (typeof accepted != 'string') return 'missing'
    let own = await quiet(at.path, ['symbolic-ref', '-q', 'HEAD'], machine)
    if (own != branch) return 'diverged'
    let state = await standing(at.path, machine)
    if (state?.dirty) return 'dirty'
    if (state?.head == accepted) return 'current'
    let stream = await objects(g, options.bytes).pack([accepted])
    let pack = new Uint8Array(await new Response(stream).arrayBuffer())
    let pieces: string[] = []
    for (let i = 0; i < pack.length; i += 8192) {
      pieces.push(String.fromCharCode(...pack.subarray(i, i + 8192)))
    }
    let file = at.gitdir + '/yaks-sync-' + crypto.randomUUID()
    try {
      await machine.write(file, btoa(pieces.join('')))
      let unpacked = await machineExec(
        machine,
        'base64 -d ' + quote(file) + ' | git unpack-objects -q',
        at.path,
      )
      if (!unpacked.ok) throw new Error(new TextDecoder().decode(unpacked.err))
    } finally {
      await machineExec(machine, 'rm -f -- ' + quote(file))
    }
    if (
      !state?.head ||
      await quiet(at.path, [
          'merge-base',
          '--is-ancestor',
          state.head,
          accepted,
        ], machine) == null
    ) return 'diverged'
    // Re-read cleanliness immediately before Git's own safe fast-forward guard.
    if ((await standing(at.path, machine))?.dirty) return 'dirty'
    if (
      await quiet(at.path, ['symbolic-ref', '-q', 'HEAD'], machine) != branch ||
      await quiet(at.path, ['rev-parse', 'HEAD'], machine) != state.head
    ) return 'diverged'
    let merged = await (options.run ?? machineRun(machine))([
      'merge',
      '--ff-only',
      '--no-edit',
      accepted,
    ], at.path)
    if (!merged.ok) throw new Error(merged.err.trim() || merged.out.trim())
    return 'synced'
  }, machine)
}
