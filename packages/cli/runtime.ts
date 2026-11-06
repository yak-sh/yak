import * as system from '@yaks/process/system'
import * as disk from '@yaks/file/io'
import {
  type ChildProcess,
  command as launchCommand,
} from '@yaks/process/command'
// A long-lived command pins its source tree. Deno's resolver is fixed when a
// process starts, so deferred imports must never read a checkout that can land.
import { wind } from '@yaks/process/wind'
import { registerHooks } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

let ROOT = new URL('../../', import.meta.url)
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
let digest = async (bytes: Uint8Array) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
    ),
  )

// Inherited environment is not ownership. Only runtime() consuming this
// invocation's launch handshake may identify the launcher a caller can signal.
let launcherPid: number | undefined

/** The process a caller owns: its validated runtime launcher, or itself when
 * work() was imported directly rather than launched through the CLI. */
export let readinessPid = (): number => launcherPid ?? system.pid

/** Runtime metadata belongs only to code loaded from that runtime's tree,
 * not to another checkout invoked with an inherited environment. */
export let runtimeRoot = (): boolean =>
  system.env.get('YAK_RUNTIME_ROOT') == ROOT.href.replace(/\/$/, '')

let run = async (command: string, args: string[], cwd?: string) => {
  let result = await launchCommand(command, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error(decode(result.stderr).trim())
  return result.stdout
}
let git = (root: string, ...args: string[]) => run('git', args, root)
let feed = async (
  command: string,
  args: string[],
  bytes: Uint8Array,
  cwd?: string,
) => {
  let child = launchCommand(command, {
    args,
    cwd,
    stdin: 'piped',
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let writer = child.stdin.getWriter()
  await writer.write(bytes)
  await writer.close()
  let result = await child.output()
  if (!result.success) throw new Error(decode(result.stderr).trim())
}

/** Which slot a launch runs from, and which idle entries go. A slot already
 * holding these sources is shared. Otherwise the lowest number no live process
 * names is rewritten: its paths repeat, so Deno's emits and the CLI's memo for
 * unchanged files are reused, and the cache holds one tree per running
 * version. Nothing a live process names is ever touched.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let used = new Set(['0'])
 * assertEquals(
 *   slot([{ name: '0', hash: 'a' }, { name: '1', hash: 'b' }], used, 'b'),
 *   { name: '1', fresh: false, prune: [] },
 * )
 * assertEquals(
 *   slot([{ name: '0', hash: 'a' }, { name: '9f2c' }], used, 'c'),
 *   { name: '1', fresh: true, prune: ['9f2c'] },
 * )
 * ```
 */
export let slot = (
  entries: { name: string; hash?: string }[],
  used: Set<string>,
  hash: string,
): { name: string; fresh: boolean; prune: string[] } => {
  let hit = entries.find((e) => /^\d+$/.test(e.name) && e.hash == hash)
  let n = 0
  while (!hit && used.has(String(n))) n++
  let name = hit?.name ?? String(n)
  return {
    name,
    fresh: !hit,
    prune: entries.map((e) => e.name).filter((e) => e != name && !used.has(e)),
  }
}

let escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The cache entries a live process runs from, read from every command line.
 * When processes can't be listed, every entry counts as live. */
let live = async (cache: string, names: string[]): Promise<Set<string>> => {
  try {
    let { stdout } = await launchCommand('ps', {
      args: ['-axww', '-o', 'command='],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    let named = new RegExp(`${escape(cache)}/([^/\\s]+)`, 'g')
    return new Set([...decode(stdout).matchAll(named)].map((m) => m[1]))
  } catch {
    return new Set(names)
  }
}

/** Capture committed sources plus the worktree's edits into a runtime slot.
 * A slot never changes while a process runs from it. The cache's lock keeps
 * other launchers out until `release`, called once the child is started and
 * names its slot. A child resolves its workspace afresh over this tree; its
 * cwd and graph config still name the caller's data. */
export let snapshot = async (
  root: string,
): Promise<{ root: string; commit: string; release: () => void }> => {
  if (runtimeRoot()) {
    return {
      root,
      commit: system.env.get('YAK_RUNTIME_COMMIT')!,
      release: () => {},
    }
  }
  let commit = decode(await git(root, 'rev-parse', 'HEAD')).trim()
  // Status before the diff. Besides naming the untracked files, it refreshes
  // the index's record of each file's stat and writes it back when it can
  // take the index's lock; a diff refreshes it only in memory. In a checkout
  // whose index is no newer than its files (racily clean, as a new
  // worktree's can be), a diff alone hashed every tracked file again on every
  // launch.
  let untracked = decode(
    await git(
      root,
      'status',
      '--porcelain',
      '-z',
      '--no-renames',
      '--untracked-files=all',
    ),
  ).split('\0').filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3))
  let patch = await git(root, 'diff', '--binary', commit)
  let files = await Promise.all(
    untracked.sort().map(async (name) => ({
      name,
      bytes: await disk.readFile(`${root}/${name}`),
      mode: (await disk.stat(`${root}/${name}`)).mode,
    })),
  )
  let hash = await digest(new TextEncoder().encode(JSON.stringify([
    1,
    root,
    commit,
    await digest(patch),
    await Promise.all(
      files.map(async (
        { name, bytes, mode },
      ) => [name, mode, await digest(bytes)]),
    ),
  ])))
  let cache = system.env.get('YAK_RUNTIME_CACHE') ??
    `${
      system.env.get('XDG_CACHE_HOME') ?? `${system.env.get('HOME')}/.cache`
    }/yak/runtime`
  await disk.mkdir(cache, { recursive: true })
  let lock = await disk.open(`${cache}/.lock`, { create: true, write: true })
  await lock.lock(true)
  let held = true
  let release = () => {
    if (held) lock.close()
    held = false
  }
  try {
    let entries = []
    for await (let { name } of disk.readDir(cache)) {
      if (name == '.lock') continue
      let mark = await disk.readTextFile(`${cache}/${name}/.hash`)
        .catch(() => undefined)
      entries.push({ name, hash: mark })
    }
    let pick = slot(
      entries,
      await live(cache, entries.map((e) => e.name)),
      hash,
    )
    let target = `${cache}/${pick.name}`
    for (let name of pick.prune) {
      await disk.remove(`${cache}/${name}`, { recursive: true })
    }
    if (pick.fresh) await build({ root, commit, patch, files, target, hash })
    return { root: target, commit, release }
  } catch (error) {
    release()
    throw error
  }
}

/** Write a slot from scratch, its node_modules linked from pnpm's store. Its `.hash` comes last,
 * so a slot cut short while building is never matched and is rewritten by the
 * next launch. */
let build = async ({ root, commit, patch, files, target, hash }: {
  root: string
  commit: string
  patch: Uint8Array
  files: { name: string; bytes: Uint8Array; mode: number | null }[]
  target: string
  hash: string
}) => {
  await disk.remove(target, { recursive: true }).catch((error) => {
    if (!(error instanceof disk.errors.NotFound)) throw error
  })
  await disk.mkdir(target)
  await feed('tar', ['-x', '-C', target], await git(root, 'archive', commit))
  if (patch.length) await feed('git', ['apply', '--binary', '-'], patch, target)
  for (let { name, bytes, mode } of files) {
    let to = `${target}/${name}`
    await disk.mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true })
    await disk.writeFile(to, bytes, { mode: mode ?? undefined })
  }
  await (await import('./dependencies.ts')).installed(target)
  await disk.writeTextFile(`${target}/.hash`, hash)
}

/** A file plugin inside the checkout follows the runtime's private tree too.
 * Paths outside it, including the graph's database, keep their own identity. */
export let runtimePath = (
  spec: string,
  from = runtimeRoot() ? system.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? system.env.get('YAK_RUNTIME_ROOT') : undefined,
): string =>
  from && to && spec.startsWith(from + '/')
    ? to + spec.slice(from.length)
    : spec

// Deferred imports in a pinned runtime keep the same source tree, including
// absolute file imports from a provider outside that tree.
if (runtimeRoot()) {
  registerHooks({
    resolve(specifier, context, next) {
      let url = isAbsolute(specifier)
        ? pathToFileURL(specifier).href
        : specifier
      return next(runtimePath(url), context)
    },
  })
}

/// runtimeSource('file:///cache/0/packages/', 'file:///src', 'file:///cache/0') -> 'file:///src/packages/'
/// runtimeSource('file:///elsewhere/a.ts', 'file:///src', 'file:///cache/0') -> 'file:///elsewhere/a.ts'
/** The checkout a URL in this runtime's private tree was copied from, the
 * inverse of {@link runtimePath}: what a plugin running git or a checkout's
 * tools asks for, since the private tree has no `.git`. */
export let runtimeSource = (
  url: string,
  from: string | undefined = runtimeRoot()
    ? system.env.get('YAK_RUNTIME_FROM')
    : undefined,
  to: string | undefined = runtimeRoot()
    ? system.env.get('YAK_RUNTIME_ROOT')
    : undefined,
): string =>
  from && to && url.startsWith(to + '/') ? from + url.slice(to.length) : url

/** Stack traces keep the checkout's source addresses for the code catalog. */
export let runtimeStack = (
  stack: string,
  from = runtimeRoot() ? system.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? system.env.get('YAK_RUNTIME_ROOT') : undefined,
): string => from && to ? stack.replaceAll(to + '/', from + '/') : stack

/// import { pid } from '@yaks/process/system'
/// alive(pid) -> true
/// alive(1) -> true
/// alive(2 ** 31 - 1) -> false
/** Whether a pid names a process: one this user may not signal still does. */
export let alive = (pid: number): boolean => {
  try {
    system.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof disk.errors.NotFound)
  }
}

/** A worker's inspector is local and opt-in at launch, never a live signal. */
export let inspector = (port: string): string => {
  if (!/^\d+$/.test(port) || Number(port) < 0 || Number(port) > 65535) {
    throw new Error('YAK_WORK_INSPECT must be a local port (0..65535)')
  }
  return `--inspect=127.0.0.1:${Number(port)}`
}

/** Run a persistent CLI command from immutable sources, forwarding its terminal
 * and interrupts and waiting for the child to drain. JSR releases are already
 * immutable. Independent workers reuse the sources with their own lifetime. */
export let runtime = async (argv: string[]): Promise<number | undefined> => {
  if (!ROOT.href.startsWith('file:')) return
  let { fileURLToPath } = await import('node:url')
  let root = fileURLToPath(ROOT).replace(/\/$/, '')
  let here = ROOT.href.replace(/\/$/, '')
  let privateTree = runtimeRoot()
  if (privateTree && system.env.get('YAK_RUNTIME_PINNED') == '1') {
    // Consume the launch token: an independent CLI invocation must own its
    // child, even if it inherits this process's environment and sources.
    system.env.delete('YAK_RUNTIME_PINNED')
    let launcher = Number(system.env.get('YAK_LAUNCH_PID'))
    // If the launcher ended before startup, this child belongs to the reaper.
    if (launcher > 0 && launcher == system.ppid) {
      launcherPid = launcher
      system.disconnected().then(() => system.kill(system.pid, 'SIGKILL'))
    } else if (launcher > 0 && !alive(launcher)) return 137
    return
  }
  let child: ChildProcess | undefined
  let finished = Promise.withResolvers<void>()
  let stopped = wind.draining
  let stop = () => {
    stopped = true
    try {
      child?.kill('SIGTERM')
    } catch (error) {
      if (!(error instanceof disk.errors.NotFound)) throw error
    }
    return finished.promise
  }
  let release = wind.hold({ drain: stop, force: stop })
  let unlock = () => {}
  try {
    let { root: dir, commit, release: launched } = await snapshot(root)
    unlock = launched
    if (stopped) return 143
    let url = new URL(`file://${dir}`).href
    let [command, ...args] = [
      system.execPath(),
      'run',
      // Deno's own lines as a fresh tree fetches its modules say nothing to
      // whoever started the command; its errors print all the same.
      '-q',
      '-A',
      // TODO: deno.json's "no-legacy-abort" says this; Deno 2.9.1 ignores it
      // there (./install.ts).
      '--unstable-no-legacy-abort',
      ...system.env.get('YAK_WORK_INSPECT') && argv.includes('work')
        ? [inspector(system.env.get('YAK_WORK_INSPECT')!)]
        : [],
      '--config',
      `${dir}/deno.json`,
      `${dir}/packages/cli/yak.ts`,
      ...argv,
    ]
    child = launchCommand(command, {
      args,
      env: {
        YAK_RUNTIME_FROM: privateTree
          ? system.env.get('YAK_RUNTIME_FROM')!
          : here,
        YAK_RUNTIME_ROOT: url,
        YAK_RUNTIME_COMMIT: commit,
        YAK_RUNTIME_PINNED: '1',
        YAK_LAUNCH_PID: String(system.pid),
      },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      // IPC closes however the launcher ends, without taking terminal stdin.
      ipc: true,
      // A terminal interrupt reaches only the launcher, which forwards it.
      detached: true,
    }).spawn()
    // The child's command line now names its slot, so no launcher rewrites it.
    unlock()
    let status = await child.status
    // A command can finish normally while it drains. The launcher was still
    // interrupted: preserve failure semantics so systemd restarts a worker
    // signalled outside an explicit unit stop.
    return stopped ? 143 : status.code
  } finally {
    unlock()
    finished.resolve()
    release()
  }
}
