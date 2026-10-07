// The tool's portable landing boundary: Git operates on a lent machine;
// immutable objects and the accepted branch live in the graph. A legacy linked
// checkout supplies only its repository identity and a one-time bootstrap.
import type { Blobs } from '@yaks/blob'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Machine, MachineProvider } from '@yaks/machine'
import { CallError } from '@yaks/tools'
import { discover, locate, repositoryEid, sync } from './host.ts'
import { land, LandError, type Outcome, type Run } from './land.ts'
import { machineExec, machineRun, quote } from './machine.ts'
import { objects } from './objects.ts'
import { acceptPack } from './receive.ts'
import { refAt, type Repo } from './refs.ts'

/** Only capabilities the landing tool needs; no dependency on a concrete host. */
export type LandingHost = {
  roles: readonly string[]
  artifacts: Blobs
  machines?: {
    local?: Machine
    providers: Record<string, MachineProvider>
    defaultProvider: string
  }
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let encode = (bytes: Uint8Array) => {
  let pieces: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) {
    pieces.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  }
  return btoa(pieces.join(''))
}
let decode = new TextDecoder()

/** Resolve a session's explicitly recorded machine before the CLI's local
 * capability. A session never inherits the HTTP server's checkout. */
export let callerMachine = async (
  host: LandingHost,
  call: Bundle,
  g: Graph,
): Promise<{ machine: Machine; cwd: string }> => {
  // A passing CLI command explicitly lends its current local directory even
  // when its writer is a session. An HTTP/effects host cannot do that.
  let localCwd = comp(call, 'process')?.cwd
  if (
    host.roles.length == 1 && host.roles[0] == 'graph' &&
    host.machines?.local && localCwd
  ) {
    return { machine: host.machines.local, cwd: String(localCwd) }
  }
  let actor = call.$actor?.by
  let owner = actor ? (await g.get([actor]))[0] : undefined
  if (owner?.session) {
    let home = comp(owner, 'home')
    if (!home?.machine) {
      throw new CallError(
        'machine',
        'land needs the session’s recorded machine',
      )
    }
    let id = String(home.machine)
    let record = comp((await g.get([id]))[0], 'machine')
    if (!record) throw new CallError('machine', 'land: no machine record ' + id)
    let provider = host.machines?.providers[String(record.provider)]
    if (!provider) {
      throw new CallError('machine', 'land: unconfigured machine provider')
    }
    let lent = await provider.wake({
      id,
      ...record.address ? { address: String(record.address) } : {},
    })
    let cwd = home.cwd ? String(home.cwd) : lent.cwd
    if (!cwd) {
      throw new CallError('cwd', 'land needs a directory on its machine')
    }
    return { machine: lent.machine, cwd }
  }
  let cwd = localCwd
  if (!host.machines?.local || !cwd || host.roles.includes('web')) {
    throw new CallError(
      'machine',
      'land needs an explicitly lent caller machine and directory',
    )
  }
  return { machine: host.machines.local, cwd: String(cwd) }
}

/** Receive an ordinary Git pack from this machine, preserving raw commit
 * bytes (including signatures). No checkout is changed while exporting it. */
export let exportPack = async (
  machine: Machine,
  cwd: string,
  head: string,
  old?: string | null,
): Promise<Uint8Array> => {
  let input = head + '\n' + (old ? '^' + old + '\n' : '')
  let got = await machineExec(
    machine,
    'printf %s ' + quote(input) + ' | git pack-objects --stdout --revs',
    cwd,
  )
  if (!got.ok) {
    throw new Error('land: pack export failed: ' + decode.decode(got.err))
  }
  return got.out
}

/** Optional publication is downstream of graph acceptance, never its authority. */
let publish = async (
  run: import('./land.ts').Run,
  cwd: string,
  branch: string,
  head: string,
  write?: LandingOptions['write'],
) => {
  let remote = await run([
    'config',
    '--get',
    `branch.${branch.replace(/^refs\/heads\//, '')}.remote`,
  ], cwd)
  let target = await run([
    'config',
    '--get',
    `branch.${branch.replace(/^refs\/heads\//, '')}.merge`,
  ], cwd)
  if (!remote.ok || !target.ok || remote.out.trim() == '.') return
  let sent = await run([
    'push',
    '--quiet',
    remote.out.trim(),
    `${head}:${target.out.trim()}`,
  ], cwd)
  if (!sent.ok) {
    write?.(
      'land: accepted; upstream publication pending: ' + sent.err.trim(),
      true,
    )
  }
}

/** Make the accepted graph base available on the caller's machine without
 * moving any local branch, index, or working file. */
export let fetchObjects = async (
  g: Graph,
  bytes: Blobs,
  machine: Machine,
  cwd: string,
  head: string,
): Promise<void> => {
  let run = machineRun(machine)
  let held = await run(['rev-list', '--objects', '--missing=print', head], cwd)
  if (held.ok && !held.out.split('\n').some((line) => line.startsWith('?'))) {
    return
  }
  let stream = await objects(g, bytes).pack([head])
  let pack = new Uint8Array(await new Response(stream).arrayBuffer())
  let location = await run(['rev-parse', '--absolute-git-dir'], cwd)
  if (!location.ok) throw new LandError(location.err.trim())
  let path = location.out.trim() + '/yaks-fetch-' + crypto.randomUUID()
  try {
    // Machine.write is a file door, not an argv. A repository pack is often
    // much larger than the OS's per-argument limit.
    await machine.write(path, encode(pack))
    let got = await machineExec(
      machine,
      'set -o pipefail; base64 -d ' + quote(path) + ' | git unpack-objects -q',
      cwd,
    )
    if (!got.ok) {
      throw new Error(
        'land: fetching graph objects failed: ' + decode.decode(got.err),
      )
    }
  } finally {
    await machineExec(machine, 'rm -f -- ' + quote(path), cwd)
  }
}

export type LandingOptions = {
  run?: Run
  repository?: string
  branch?: string
  allow?: string[]
  write?: (text: string, error?: boolean) => void
}

/** Graph-backed landing, callable from a machine with no shared checkout. */
export let landGraph = async (
  g: Graph,
  bytes: Blobs,
  machine: Machine,
  cwd: string,
  options: LandingOptions = {},
): Promise<Outcome> => {
  let run = options.run ?? machineRun(machine)
  let read = async (args: string[]) => {
    let got = await run(args, cwd)
    if (!got.ok) throw new LandError(got.err.trim() || got.out.trim())
    return got.out.trim()
  }
  let app = options.repository
  let name = options.branch ?? 'refs/heads/main'
  if (!name.startsWith('refs/heads/')) name = 'refs/heads/' + name
  let mirror: string | undefined
  if (!app) {
    let location = await locate(cwd, machine)
    if (!location) throw new LandError('land: not a Git checkout')
    app = repositoryEid(location.common)
    // Discovery is an observation, not authority to replace an accepted ref.
    await discover(g, cwd, machine)
    let list = await read(['worktree', 'list', '--porcelain'])
    let primary = list.split('\n\n')[0].split('\n')
    mirror = primary.find((line) => line.startsWith('worktree '))?.slice(9)
    let base = primary.find((line) => line.startsWith('branch '))?.slice(7)
    if (base) name = base
    if (!base && !await refAt(g, app, name)) {
      throw new LandError(
        'land: no accepted base; give --repository and --branch',
      )
    }
  }
  let on = await run(['symbolic-ref', '-q', 'HEAD'], cwd)
  if (on.code == 1) throw new LandError('land: the checkout is detached')
  if (!on.ok) throw new LandError(on.err.trim())
  let current = on.out.trim()
  if (current == name) {
    throw new LandError('land: the checkout is on the base branch')
  }
  let dirty = await read(['status', '--porcelain=v1', '--untracked-files=all'])
  if (dirty) throw new LandError('land: checkout is dirty:\n' + dirty)
  let repo: Repo = { refs: g, objects: g, bytes }
  let old = await refAt(g, app, name)
  // Existing checkout observations predate object receiving. Import their
  // complete base once, and compare-and-set the SAME ref: discovery cannot
  // silently replace a newer accepted main.
  if (!old || !(await g.get([old], ['gitobj']))[0]?.gitobj) {
    if (options.repository) {
      throw new LandError(
        'land: this repository has no received base; push it first',
      )
    }
    let base = await read(['rev-parse', name])
    await acceptPack(repo, {
      app,
      branch: name,
      old,
      commit: base,
      pack: await exportPack(machine, cwd, base),
    }, { machine, cwd })
    old = base
  }
  let refresh = async () => {
    let tip = await refAt(g, app!, name)
    if (!tip) throw new LandError('land: accepted base disappeared')
    if (tip != old) await fetchObjects(g, bytes, machine, cwd, tip)
    old = tip
    return tip
  }
  await fetchObjects(g, bytes, machine, cwd, old)
  return land({
    cwd,
    run,
    base: old,
    allow: options.allow,
    write: options.write,
    refresh,
    accept: async (head) => {
      await acceptPack(repo, {
        app: app!,
        branch: name,
        old,
        commit: head,
        pack: await exportPack(machine, cwd, head, old),
      }, { machine, cwd })
      // Catch-up is not acceptance. A dirty/diverged mirror is reported and
      // left intact; the commit remains landed and the service can retry.
      if (mirror && mirror != cwd) {
        try {
          let caught = await sync(g, mirror, machine, {
            bytes,
            app: app!,
            branch: name,
            run: options.run,
          })
          if (caught != 'synced' && caught != 'current') {
            options.write?.(
              'land: accepted; checkout catch-up pending: ' + caught,
              true,
            )
          }
        } catch (error) {
          options.write?.(
            'land: accepted; checkout catch-up pending: ' + error,
            true,
          )
        }
      }
      await publish(run, cwd, name, head, options.write)
    },
  })
}
