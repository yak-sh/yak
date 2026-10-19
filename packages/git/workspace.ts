// Git acts through one explicitly connected filesystem. The transport may be
// local, SSH or a sandbox; no failed or unknown target chooses the host disk.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import {
  absent,
  and,
  contains,
  eq,
  fields,
  limit,
  list,
  present,
  want,
} from '@yaks/query'
import { quote } from '@yaks/machine/connectors'
import type { ComputerTransport } from '@yaks/machine'
import { filesystemEid } from './placement.ts'
import {
  type CheckoutRequest,
  type Held,
  repositoryEid,
  worktreeEid,
} from './host.ts'
import { refEid } from './refs.ts'

/** Resolve the stable filesystem, never a convenience directory. */
export let filesystem = async (
  g: Graph,
  workspace: string,
): Promise<Bundle> => {
  let [target] = await g.get([workspace])
  let place = target?.workspace as Comp | undefined
  if (!place || typeof place.root != 'string' || !place.root.startsWith('/')) {
    throw Error('Git requires an explicit workspace with an absolute root')
  }
  if (target.sandbox) return target
  if (place.sandbox) {
    let [sandbox] = await g.get([String(place.sandbox)])
    let enclosing = sandbox?.workspace as Comp | undefined
    if (!sandbox?.sandbox || !enclosing || enclosing.machine != place.machine) {
      throw Error('Workspace and enclosing sandbox placement disagree')
    }
    return sandbox
  }
  if (typeof place.machine != 'string') {
    throw Error('Git computer placement is unknown')
  }
  let [computer] = await g.get([place.machine])
  if (!computer?.machine) throw Error('Git workspace has no computer')
  let eid = filesystemEid(place.machine)
  let [root] = await g.get([eid])
  if (!root) {
    await g.apply([{
      entity: { eid },
      workspace: { machine: place.machine, root: '/' },
    }])
    ;[root] = await g.get([eid])
  }
  let canonical = root.workspace as Comp
  if (
    canonical.root != '/' || canonical.machine != place.machine ||
    canonical.sandbox || root.sandbox
  ) {
    throw Error('Computer filesystem workspace has conflicting placement')
  }
  return root
}

let absolute = (path: string) => {
  if (!path.startsWith('/') || path.includes('\0')) {
    throw Error('Git paths must be absolute')
  }
  return path
}

/** Operations bound to one explicitly connected filesystem. */
export type WorkspaceGit = {
  discover: (cwd?: string) => Promise<Bundle>
  create: (request: CheckoutRequest, source?: string) => Promise<Bundle>
  reclaim: (id: string) => Promise<Held | 'referenced' | undefined>
  context: string
}

/** Git on a selected workspace. The caller connects this exact filesystem
 * before binding the transport. All paths, realpath and locks run there. */
export let workspaceGit = async (
  g: Graph,
  workspace: string,
  transport: ComputerTransport,
): Promise<WorkspaceGit> => {
  let [target] = await g.get([workspace])
  let context = await filesystem(g, workspace)
  let place = target.workspace as Comp
  let root = absolute(String(place.root))
  let exec = (script: string) => transport.execute('set -eu\n' + script)
  let at = (cwd: string, args: string[]) =>
    exec(`git -C ${quote(absolute(cwd))} ${args.map(quote).join(' ')}`)
  let real = async (path: string, missing = false) =>
    (await exec(
      `realpath ${missing ? '-m' : '-e'} -- ${quote(absolute(path))}`,
    )).trimEnd()
  let same = async (bundles: Bundle[]) => {
    let previous = new Map(
      (await g.get(bundles.map((b) => b.entity.eid))).map((
        b,
      ) => [b.entity.eid, b]),
    )
    let changed = bundles.filter((b) =>
      Object.entries(b).some(([name, value]) =>
        name != 'entity' &&
        Object.entries(value as Comp).some(([key, val]) =>
          ((previous.get(b.entity.eid)?.[name] as Comp | undefined)?.[key] ??
            null) !== (val ?? null)
        )
      )
    )
    if (changed.length) await g.apply(changed)
  }
  let discover = async (cwd = root): Promise<Bundle> => {
    let dirs = (await at(cwd, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
      '--absolute-git-dir',
    ])).trimEnd().split('\n')
    if (dirs.length != 3) {
      throw Error('Git returned invalid checkout directories')
    }
    let [path, common, gitdir] = await Promise.all(dirs.map((p) => real(p)))
    let repository = repositoryEid(common, context.entity.eid)
    let eid = worktreeEid(repository, path)
    let head = (await exec(
      `git -C ${quote(cwd)} rev-parse --verify HEAD 2>/dev/null || :`,
    )).trimEnd()
    let branch = (await exec(`git -C ${quote(cwd)} symbolic-ref -q HEAD || :`))
      .trimEnd()
    let refs = await at(cwd, [
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(symref)',
    ])
    let bundles: Bundle[] = [{
      entity: { eid: repository },
      repository: { workspace: context.entity.eid, common },
    }]
    let found = new Set<string>()
    for (let line of refs.trimEnd().split('\n').filter(Boolean)) {
      let [name, oid, symbolic] = line.split('\t')
      let id = refEid(repository, name)
      found.add(id)
      bundles.push({
        entity: { eid: id },
        ref: {
          app: repository,
          name,
          oid,
          target: symbolic || null,
          present: true,
        },
      })
    }
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
    let [old] = await g.get([eid])
    let tree: Bundle = {
      entity: { eid },
      workspace: {
        machine: place.machine ?? null,
        root: path,
        sandbox: context.sandbox ? context.entity.eid : null,
      },
      worktree: {
        repository,
        gitdir,
        head: head || null,
        branch: branch ? refEid(repository, branch) : null,
        managed: Boolean((old?.worktree as Comp | undefined)?.managed),
      },
    }
    bundles.push(tree)
    await same(bundles)
    return (await g.get([eid]))[0]
  }
  let create = async (
    request: CheckoutRequest,
    source = root,
  ): Promise<Bundle> => {
    let home = await discover(source)
    let repository = String((home.worktree as Comp).repository)
    let [repo] = await g.get([repository])
    let common = String((repo.repository as Comp).common)
    let path = await real(request.path, true)
    let eid = worktreeEid(repository, path)
    let [old] = await g.get([eid])
    let intent = old?.checkout as Comp | undefined
    let base = (await at(source, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      (request.base ?? String(intent?.base ?? 'HEAD')) + '^{commit}',
    ])).trimEnd()
    if (
      intent &&
      (intent.base != base ||
        (intent.branch ?? null) != (request.branch ?? null))
    ) throw Error('Checkout request conflicts with pinned intent')
    if (old?.worktree && !intent) {
      throw Error('Existing checkout must be attached, not created again')
    }
    if (!intent) {
      await exec(`test ! -e ${quote(path)}`)
      await g.apply([{
        entity: { eid },
        checkout: {
          repository,
          path,
          base,
          requested: request.base ?? 'HEAD',
          branch: request.branch ?? null,
          state: 'preparing',
          error: null,
        },
        $was: { checkout: { repository: null } },
      }])
    }
    if (intent?.state == 'ready') {
      let tree = await discover(path)
      if ((tree.worktree as Comp).repository != repository) {
        throw Error('Worktree repository mismatch')
      }
      return tree
    }
    try {
      // The target's advisory lock spans existence check and Git mutation.
      // A crash after Git succeeds is recovered only if HEAD and branch agree.
      let expected = request.branch ? 'refs/heads/' + request.branch : ''
      await exec(`mkdir -p -- ${quote(common + '/yaks-locks')}
exec 9>${quote(common + '/yaks-locks/' + eid)}
flock -x 9
if test -e ${quote(path)}; then
  test "$(git -C ${quote(path)} rev-parse HEAD)" = ${quote(base)}
  test "$(git -C ${quote(path)} symbolic-ref -q HEAD || :)" = ${quote(expected)}
  test "$(realpath -e -- "$(git -C ${
        quote(path)
      } rev-parse --path-format=absolute --git-common-dir)")" = ${quote(common)}
else
  git -C ${quote(source)} worktree add ${
        request.branch ? '-b ' + quote(request.branch) : '--detach'
      } ${quote(path)} ${quote(base)}
fi`)
      let tree = await discover(path)
      if ((tree.worktree as Comp).repository != repository) {
        throw Error('Worktree repository mismatch')
      }
      await g.apply([{
        entity: tree.entity,
        worktree: { managed: true },
        checkout: { state: 'ready', error: null },
      }])
      return (await g.get([tree.entity.eid]))[0]
    } catch (error) {
      await g.apply([{
        entity: { eid },
        checkout: { state: 'failed', error: String(error) },
      }])
      throw error
    }
  }
  /** Only a positively managed checkout can be explicitly reclaimed. Unknown
   * references or commands keep it; cleanup is never a consequence of home. */
  let reclaim = async (
    id: string,
  ): Promise<Held | 'referenced' | undefined> => {
    let [tree] = await g.get([id])
    if (!tree?.worktree || !(tree.worktree as Comp).managed) {
      throw Error('Git reclaims only explicitly managed worktrees')
    }
    let checkoutContext = await filesystem(g, id)
    if (checkoutContext.entity.eid != context.entity.eid) {
      throw Error('Worktree belongs to another filesystem')
    }
    if (await retained(g, id)) return 'referenced'
    let path = absolute(String((tree.workspace as Comp).root))
    let [repo] = await g.get([String((tree.worktree as Comp).repository)])
    let common = String((repo.repository as Comp).common)
    if ((tree.worktree as Comp).gitdir == common) {
      throw Error('Primary checkout cannot be reclaimed')
    }
    // Dirty work is always kept, independent of process visibility.
    if ((await at(path, ['status', '--porcelain'])).trim()) return 'dirty'
    // Same-user processes outside the graph keep their cwd and open files.
    // An unreadable live process refuses collection rather than proving absence.
    let used = await exec(`
uid=$(id -u)
for proc in /proc/[0-9]*; do
  test -d "$proc" || continue
  test "$(stat -c %u "$proc" 2>/dev/null || :)" = "$uid" || continue
  for file in "$proc/cwd" "$proc"/fd/*; do
    test -L "$file" || continue
    link=$(readlink "$file") || { test ! -e "$proc" && continue; printf referenced; exit 0; }
    case "$link" in ${quote(path)}|${
      quote(path)
    }/*) printf referenced; exit 0;; esac
  done
done`)
    if (used) return 'referenced'
    // No orphan deletion or force. Detached/no-commit checkouts are kept.
    let result = (await exec(`
if test -n "$(git -C ${quote(path)} status --porcelain)"; then echo dirty
elif test -z "$(git -C ${
      quote(path)
    } symbolic-ref -q HEAD || :)"; then echo unlanded
elif test -z "$(git -C ${
      quote(path)
    } for-each-ref --contains HEAD --format='%(refname)' refs/heads/ | grep -Fxv "$(git -C ${
      quote(path)
    } symbolic-ref HEAD)" || :)"; then echo unlanded
else
  branch=$(git -C ${quote(path)} symbolic-ref --short HEAD)
  git -C ${quote(path)} worktree remove ${quote(path)}
  git --git-dir=${quote(common)} branch -D -- "$branch"
fi`)).trimEnd()
    if (result == 'dirty' || result == 'unlanded') return result
    // Keep the observation as restore history, never reconstruct it silently.
  }
  return { discover, create, reclaim, context: context.entity.eid }
}

/** Graph references that keep a checkout. A running process uses its launch
 * workspace even after a session switches its default. Missing placement is
 * not evidence that it runs elsewhere. */
export let retained = async (g: Graph, workspace: string): Promise<boolean> => {
  let [target] = await g.get([workspace], ['workspace'])
  let place = target?.workspace as Comp | undefined
  if (!place || typeof place.root != 'string') return true
  let root = place.root.replace(/\/+$/, '')
  let inTree = (path: unknown) =>
    typeof path == 'string' &&
    (path == place.root || path.startsWith(root + '/'))
  let beside = (b: Bundle) => {
    let p = b.workspace as Comp | undefined
    return p && p.machine == place.machine &&
      (p.sandbox ?? (b.sandbox ? b.entity.eid : null)) ==
        (place.sandbox ?? null)
  }
  let sandbox = g.vocab.comp('sandbox') ? ['sandbox'] : []
  let contexts = await g.read(and(
    present('workspace'),
    ...root ? [contains('workspace.root', root)] : [],
    ...sandbox.map(want),
  ))
  let ids = contexts.filter((b) =>
    beside(b) && inTree((b.workspace as Comp).root)
  ).map((b) => b.entity.eid)
  for (let name of ['process', 'home']) {
    if (!g.vocab.prop(name, 'workspace') || !g.vocab.prop(name, 'cwd')) continue
    let rows = await g.read(and(
      present(name),
      ...name == 'process' ? [absent('exit')] : [],
      ...root ? [contains(`${name}.cwd`, root)] : [],
      fields(`${name}.workspace`, `${name}.cwd`),
    ))
    let refs = [...new Set(rows.map((b) => (b[name] as Comp).workspace))]
      .filter((id): id is string => typeof id == 'string')
    let local = new Set(
      (await g.get(refs, ['workspace', ...sandbox]))
        .filter(beside).map((b) => b.entity.eid),
    )
    if (
      rows.some((b) => {
        let p = b[name] as Comp
        return local.has(String(p.workspace)) && inTree(p.cwd)
      })
    ) return true
  }
  // Recheck direct attachments after the cwd checks: another process can
  // attach while those reads yield. Never keep a liveness snapshot across passes.
  for (let name of ['home', 'process']) {
    if (!ids.length || !g.vocab.prop(name, 'workspace')) continue
    if (
      (await g.read(and(
        present(name),
        ...name == 'process' ? [absent('exit')] : [],
        eq(`${name}.workspace`, list(...ids)),
        fields('entity.eid'),
        limit(1),
      ))).length
    ) return true
  }
  return false
}
