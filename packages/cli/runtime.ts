// A long-lived command pins its source tree. Deno's resolver is fixed when a
// process starts, so deferred imports must never read a checkout that can land.
import { wind } from '@yaks/process/wind'

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
export let readinessPid = (): number => launcherPid ?? Deno.pid

/** Runtime metadata belongs only to code loaded from that runtime's tree,
 * not to another checkout invoked with an inherited environment. */
export let runtimeRoot = (): boolean =>
  Deno.env.get('YAK_RUNTIME_ROOT') == ROOT.href.replace(/\/$/, '')

let git = async (root: string, ...args: string[]) => {
  let result = await new Deno.Command('git', {
    args,
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error(decode(result.stderr).trim())
  return result.stdout
}
let feed = async (
  command: string,
  args: string[],
  bytes: Uint8Array,
  cwd?: string,
) => {
  let child = new Deno.Command(command, {
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
    let { stdout } = await new Deno.Command('ps', {
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
      commit: Deno.env.get('YAK_RUNTIME_COMMIT')!,
      release: () => {},
    }
  }
  let commit = decode(await git(root, 'rev-parse', 'HEAD')).trim()
  let patch = await git(root, 'diff', '--binary', commit)
  let files = await Promise.all(
    decode(
      await git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
    ).split('\0').filter(Boolean).sort().map(async (name) => ({
      name,
      bytes: await Deno.readFile(`${root}/${name}`),
      mode: (await Deno.stat(`${root}/${name}`)).mode,
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
  let cache = Deno.env.get('YAK_RUNTIME_CACHE') ??
    `${
      Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`
    }/yak/runtime`
  await Deno.mkdir(cache, { recursive: true })
  let lock = await Deno.open(`${cache}/.lock`, { create: true, write: true })
  await lock.lock(true)
  let held = true
  let release = () => {
    if (held) lock.close()
    held = false
  }
  try {
    let entries = []
    for await (let { name } of Deno.readDir(cache)) {
      if (name == '.lock') continue
      let mark = await Deno.readTextFile(`${cache}/${name}/.hash`)
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
      await Deno.remove(`${cache}/${name}`, { recursive: true })
    }
    if (pick.fresh) await build({ root, commit, patch, files, target, hash })
    return { root: target, commit, release }
  } catch (error) {
    release()
    throw error
  }
}

/** Write a slot from scratch. Its `.hash` comes last, so a slot cut short
 * while building is never matched and is rewritten by the next launch. */
let build = async ({ root, commit, patch, files, target, hash }: {
  root: string
  commit: string
  patch: Uint8Array
  files: { name: string; bytes: Uint8Array; mode: number | null }[]
  target: string
  hash: string
}) => {
  await Deno.remove(target, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  })
  await Deno.mkdir(target)
  await feed('tar', ['-x', '-C', target], await git(root, 'archive', commit))
  if (patch.length) await feed('git', ['apply', '--binary', '-'], patch, target)
  for (let { name, bytes, mode } of files) {
    let to = `${target}/${name}`
    await Deno.mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true })
    await Deno.writeFile(to, bytes, { mode: mode ?? undefined })
  }
  // Absolute source imports from a file plugin or provider follow the same
  // tree, including imports made by modules outside the source checkout.
  let config = JSON.parse(await Deno.readTextFile(`${target}/deno.json`))
  config.imports = {
    ...config.imports,
    [new URL(`file://${root}/`).href]: new URL(`file://${target}/`).href,
  }
  await Deno.writeTextFile(`${target}/deno.json`, JSON.stringify(config))
  await Deno.writeTextFile(`${target}/.hash`, hash)
}

/** A file plugin inside the checkout follows the runtime's private tree too.
 * Paths outside it, including the graph's database, keep their own identity. */
export let runtimePath = (
  spec: string,
  from = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_ROOT') : undefined,
): string =>
  from && to && spec.startsWith(from + '/')
    ? to + spec.slice(from.length)
    : spec

/// runtimeSource('file:///cache/0/packages/', 'file:///src', 'file:///cache/0') -> 'file:///src/packages/'
/// runtimeSource('file:///elsewhere/a.ts', 'file:///src', 'file:///cache/0') -> 'file:///elsewhere/a.ts'
/** The checkout a URL in this runtime's private tree was copied from, the
 * inverse of {@link runtimePath}: what a plugin running git or a checkout's
 * tools asks for, since the private tree has no `.git`. */
export let runtimeSource = (
  url: string,
  from: string | undefined = runtimeRoot()
    ? Deno.env.get('YAK_RUNTIME_FROM')
    : undefined,
  to: string | undefined = runtimeRoot()
    ? Deno.env.get('YAK_RUNTIME_ROOT')
    : undefined,
): string =>
  from && to && url.startsWith(to + '/') ? from + url.slice(to.length) : url

/** Stack traces keep the checkout's source addresses for the code catalog. */
export let runtimeStack = (
  stack: string,
  from = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_ROOT') : undefined,
): string => from && to ? stack.replaceAll(to + '/', from + '/') : stack

/// alive(Deno.pid) -> true
/// alive(1) -> true
/// alive(2 ** 31 - 1) -> false
/** Whether a pid names a process: one this user may not signal still does. */
export let alive = (pid: number): boolean => {
  try {
    Deno.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Deno.errors.NotFound)
  }
}

/** The command line that starts a launcher's child: tied to the launcher, so
 * it ends however the launcher ends, and in a session of its own.
 *
 * The tie is Linux's parent-death signal, set by util-linux `setpriv` before
 * the child's program starts: once the launcher is gone, killed outright as
 * surely as any other way, the kernel sends the child SIGKILL. Nothing in the
 * child has to notice, which it cannot while its event loop is busy. So a
 * unit that signals only its main process still cuts the child's drain at its
 * stop timeout, when it kills the launcher. The kernel sends the signal when
 * the thread that spawned the child ends; Deno spawns on its main thread,
 * which lasts as long as the launcher.
 *
 * The session keeps a terminal interrupt from reaching the child twice:
 * directly from the terminal and again through the launcher's wind hold. */
export let tethered = (argv: string[]): string[] => [
  'setpriv',
  '--pdeathsig',
  'KILL',
  'setsid',
  ...argv,
]

/** Run a persistent CLI command from immutable sources, forwarding its terminal
 * and interrupts and waiting for the child to drain. JSR releases are already
 * immutable. Independent workers reuse the sources with their own lifetime. */
/** A worker's inspector is local and opt-in at launch, never a live signal. */
export let inspector = (port: string): string => {
  if (!/^\d+$/.test(port) || Number(port) < 0 || Number(port) > 65535) {
    throw new Error('YAK_WORK_INSPECT must be a local port (0..65535)')
  }
  return `--inspect=127.0.0.1:${Number(port)}`
}

export let runtime = async (argv: string[]): Promise<number | undefined> => {
  if (!ROOT.href.startsWith('file:')) return
  let { fileURLToPath } = await import('node:url')
  let root = fileURLToPath(ROOT).replace(/\/$/, '')
  let here = ROOT.href.replace(/\/$/, '')
  let privateTree = runtimeRoot()
  if (privateTree && Deno.env.get('YAK_RUNTIME_PINNED') == '1') {
    // Consume the launch token: an independent CLI invocation must own its
    // child, even if it inherits this process's environment and sources.
    Deno.env.delete('YAK_RUNTIME_PINNED')
    let launcher = Number(Deno.env.get('YAK_LAUNCH_PID'))
    if (launcher > 0 && launcher == Deno.ppid) launcherPid = launcher
    // The tie holds from when it was made: a launcher gone before then left
    // this child to the reaper, so it ends now as the tie would have ended it.
    else if (launcher > 0 && !alive(launcher)) return 137
    return
  }
  let child: Deno.ChildProcess | undefined
  let finished = Promise.withResolvers<void>()
  let stopped = wind.draining
  let stop = () => {
    stopped = true
    try {
      child?.kill('SIGTERM')
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
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
    let [command, ...args] = tethered([
      Deno.execPath(),
      'run',
      '-A',
      ...Deno.env.get('YAK_WORK_INSPECT') && argv.includes('work')
        ? [inspector(Deno.env.get('YAK_WORK_INSPECT')!)]
        : [],
      '--config',
      `${dir}/deno.json`,
      `${dir}/packages/cli/yak.ts`,
      ...argv,
    ])
    child = new Deno.Command(command, {
      args,
      env: {
        YAK_RUNTIME_FROM: privateTree
          ? Deno.env.get('YAK_RUNTIME_FROM')!
          : here,
        YAK_RUNTIME_ROOT: url,
        YAK_RUNTIME_COMMIT: commit,
        YAK_RUNTIME_PINNED: '1',
        YAK_LAUNCH_PID: String(Deno.pid),
      },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
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

/** The immutable source snapshot a running command owns. The systemd main PID
 * may be its launcher, so follow children to the process carrying the runtime
 * metadata. Only these two non-secret fields are read from its environment. */
export let runtimeBuild = async (
  pid: number,
  read = Deno.readTextFile,
): Promise<
  { hash: string; root: string; from?: string; commit?: string } | undefined
> => {
  let pending = [pid], seen = new Set<number>()
  while (pending.length) {
    let process = pending.shift()!
    if (seen.has(process)) continue
    seen.add(process)
    try {
      let environment = (await read(`/proc/${process}/environ`)).split('\0')
      let root = environment.find((s) => s.startsWith('YAK_RUNTIME_ROOT='))
        ?.slice('YAK_RUNTIME_ROOT='.length)
      if (root) {
        return {
          hash: await read(new URL('.hash', `${root}/`).pathname),
          root,
          from: environment.find((s) => s.startsWith('YAK_RUNTIME_FROM='))
            ?.slice('YAK_RUNTIME_FROM='.length),
          commit: environment.find((s) => s.startsWith('YAK_RUNTIME_COMMIT='))
            ?.slice('YAK_RUNTIME_COMMIT='.length),
        }
      }
      let children = await read(`/proc/${process}/task/${process}/children`)
      pending.push(...children.trim().split(/\s+/).filter(Boolean).map(Number))
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotFound) &&
        !(error instanceof Deno.errors.PermissionDenied)
      ) throw error
    }
  }
}

/** Source identity for comparison, independent of a checkout path, commit id
 * or runtime slot. Cache identity remains the snapshot's separate `.hash`. */
export let sourceIdentity = async (
  files: readonly { path: string; bytes: Uint8Array }[],
): Promise<string> => {
  let sources = files.filter(({ path }) =>
    /\.(tsx?|[cm]?js|jsonc?|css|html|svg|wasm)$/.test(path) ||
    path == 'deno.lock'
  )
    .filter(({ path }) => !/(?:_test|_bench|\.baseline|\.results)\./.test(path))
    .sort((a, b) => a.path.localeCompare(b.path))
  let values = await Promise.all(
    sources.map(async ({ path, bytes }) => [path, await digest(bytes)]),
  )
  return await digest(new TextEncoder().encode(JSON.stringify(values)))
}

/** Read only the pinned tree's production inputs; generated dependency caches
 * and repository metadata do not participate in its content identity. */
export let runtimeContent = async (
  build: { root: string; from?: string },
): Promise<string> => {
  let root = new URL(`${build.root}/`).pathname
  let files: { path: string; bytes: Uint8Array }[] = []
  let walk = async (path: string) => {
    try {
      for await (let entry of Deno.readDir(`${root}${path}`)) {
        if (entry.name.startsWith('.') || entry.name == 'node_modules') continue
        let name = `${path}${entry.name}`
        if (entry.isDirectory) await walk(`${name}/`)
        else if (
          entry.isFile &&
          /\.(tsx?|[cm]?js|jsonc?|css|html|svg|wasm)$/.test(name) &&
          !/(?:_test|_bench|\.baseline|\.results)\./.test(name)
        ) {
          files.push({
            path: name,
            bytes: await Deno.readFile(`${root}${name}`),
          })
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  }
  for (let path of ['packages/', 'workers/', 'apps/']) await walk(path)
  let config = JSON.parse(await Deno.readTextFile(`${root}deno.json`))
  if (build.from) delete config.imports?.[build.from.replace(/\/$/, '') + '/']
  files.push({
    path: 'deno.json',
    bytes: new TextEncoder().encode(JSON.stringify({
      imports: config.imports,
      compilerOptions: config.compilerOptions,
      unstable: config.unstable,
      nodeModulesDir: config.nodeModulesDir,
    })),
  })
  files.push({
    path: 'deno.lock',
    bytes: await Deno.readFile(`${root}deno.lock`),
  })
  return await sourceIdentity(files)
}
