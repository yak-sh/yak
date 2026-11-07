// A command from a checkout pins its source tree: deferred imports must never
// read a checkout that can land. What a launch loads before it runs the
// snapshot is loaded with it (./yak.ts), under the checkout's land lock, and
// the snapshot loads its own copy of every module it runs.
import * as system from '@yaks/process/system'
import * as disk from '@yaks/file/io'
import { command as launchCommand } from '@yaks/process/command'
import { registerHooks } from 'node:module'
import { isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** Runtime metadata belongs only to code loaded from that runtime's tree,
 * not to another checkout invoked with an inherited environment. */
export let runtimeRoot = (): boolean =>
  system.env.get('YAK_RUNTIME_ROOT') == ROOT.href.replace(/\/$/, '')

let run = async (
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
) => {
  let result = await launchCommand(command, {
    args,
    cwd,
    env,
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
 * runs from is rewritten: its paths repeat, so Deno's emits and the CLI's memo
 * for unchanged files are reused, and the cache holds one tree per running
 * version. Nothing a live process runs from is ever touched.
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

/** The cache entries a live process runs from: a launch holds its slot's
 * `.live` lock while it runs, and a process started from a slot's `yak.ts`
 * names it on its command line. When processes can't be listed, every entry
 * counts as live. */
let live = async (cache: string, names: string[]): Promise<Set<string>> => {
  let used: Set<string>
  try {
    let { stdout } = await launchCommand('ps', {
      args: ['-axww', '-o', 'command='],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    let named = new RegExp(`${escape(cache)}/([^/\\s]+)`, 'g')
    used = new Set([...decode(stdout).matchAll(named)].map((m) => m[1]))
  } catch {
    return new Set(names)
  }
  for (let name of names) {
    if (used.has(name)) continue
    let file = await disk.open(`${cache}/${name}/.live`, { write: true })
      .catch(absent)
    if (!file) continue
    if (!(await file.tryLock(true))) used.add(name)
    file.close()
  }
  return used
}

// The commit a checkout stands at, its tracked edits as a binary patch, and
// its untracked files' bytes. A clean checkout, the common case, costs one
// status and nothing else.
let capture = async (root: string) => {
  // Besides naming the commit and every change, status refreshes the index's
  // record of each file's stat and writes it back when it can take the
  // index's lock; a diff refreshes it only in memory. In a checkout whose
  // index is no newer than its files (racily clean, as a new worktree's can
  // be), a diff alone hashed every tracked file again on every launch.
  let lines = decode(
    await git(
      root,
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--no-renames',
      '--untracked-files=all',
    ),
  ).split('\0')
  let commit = lines.find((line) => line.startsWith('# branch.oid '))!
    .slice(13)
  let untracked = lines.filter((line) => line.startsWith('? '))
    .map((line) => line.slice(2))
  let patch = lines.some((line) => /^[12u] /.test(line))
    ? await git(root, 'diff', '--binary', commit)
    : new Uint8Array()
  let files = await Promise.all(
    untracked.sort().map(async (name) => ({
      name,
      bytes: await disk.readFile(`${root}/${name}`),
      mode: (await disk.stat(`${root}/${name}`)).mode,
    })),
  )
  return { commit, patch, files }
}

/** Capture committed sources plus the worktree's edits into a runtime slot.
 * A slot never changes while a process runs from it. `whole` releases the
 * checkout's land lock, held shared by the caller (./yak.ts), once the
 * checkout is read: a landing writes it under that lock, held exclusively, so
 * a launch never captures half a merge, and the capture's own index write
 * never takes the index from a landing. The cache's lock keeps other
 * launchers out until `release`, called once the command holds its slot.
 * What runs from the slot resolves its workspace over this tree; its cwd and
 * graph config still name the caller's data. */
export let snapshot = async (
  root: string,
  whole: () => void = () => {},
): Promise<
  { root: string; commit: string; hash: string; release: () => void }
> => {
  let { commit, patch, files } = await capture(root).finally(whole)
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
    // A slot that holds these sources is the whole cost of a warm launch:
    // which processes are live matters only to a slot about to be written.
    let hit = entries.find((e) => /^\d+$/.test(e.name) && e.hash == hash)
    if (hit) return { root: `${cache}/${hit.name}`, commit, hash, release }
    let pick = slot(
      entries,
      await live(cache, entries.map((e) => e.name)),
      hash,
    )
    let target = `${cache}/${pick.name}`
    for (let name of pick.prune) {
      await disk.remove(`${cache}/${name}`, { recursive: true })
    }
    await build({ root, commit, patch, files, target, hash })
    return { root: target, commit, hash, release }
  } catch (error) {
    release()
    throw error
  }
}

let absent = (error: unknown): undefined => {
  if (!(error instanceof disk.errors.NotFound)) throw error
}

/** Write a slot, its node_modules linked from pnpm's store. A slot holds its
 * own Git index (`.index`), and one that held a commit alone (`.base`) moves
 * to the next as Git moves a checkout, writing only the files that differ,
 * so the first launch after a landing writes what landed and keeps its
 * node_modules. Any other slot is written from scratch. Its `.hash` comes
 * last, so a slot cut short while building is never matched and is rewritten
 * by the next launch. */
let build = async ({ root, commit, patch, files, target, hash }: {
  root: string
  commit: string
  patch: Uint8Array
  files: { name: string; bytes: Uint8Array; mode: number | null }[]
  target: string
  hash: string
}) => {
  let base = await disk.readTextFile(`${target}/.base`).catch(() => undefined)
  for (let mark of ['.hash', '.base']) {
    await disk.remove(`${target}/${mark}`).catch(absent)
  }
  let tree = (...args: string[]) =>
    run('git', ['--work-tree', target, 'read-tree', ...args], root, {
      GIT_INDEX_FILE: `${target}/.index`,
    })
  let moved = !!base && await tree('-m', '-u', base, commit).then(
    () => true,
    () => false,
  )
  if (!moved) {
    await disk.remove(target, { recursive: true }).catch(absent)
    await disk.mkdir(target)
    await tree('--reset', '-u', commit)
  }
  if (patch.length) await feed('git', ['apply', '--binary', '-'], patch, target)
  for (let { name, bytes, mode } of files) {
    let to = `${target}/${name}`
    await disk.mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true })
    await disk.writeFile(to, bytes, { mode: mode ?? undefined })
  }
  let { installed } = await import('./dependencies.ts')
  await installed(target)
  if (!patch.length && !files.length) {
    await disk.writeTextFile(`${target}/.base`, commit)
  }
  await disk.writeTextFile(`${target}/.hash`, hash)
}

/** A file plugin inside the checkout follows the runtime's private tree too.
 * Paths outside it, including the graph's database, keep their own identity.
 * An absolute path stays a path, since `require` takes no URL. */
export let runtimePath = (
  spec: string,
  from = runtimeRoot() ? system.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? system.env.get('YAK_RUNTIME_ROOT') : undefined,
): string => {
  if (isAbsolute(spec)) {
    let url = pathToFileURL(spec).href
    let moved = runtimePath(url, from, to)
    return moved == url ? spec : fileURLToPath(moved)
  }
  return from && to && spec.startsWith(from + '/')
    ? to + spec.slice(from.length)
    : spec
}

// Deferred imports in a pinned runtime keep the same source tree, including
// absolute file imports from a provider outside that tree.
if (runtimeRoot()) {
  registerHooks({
    resolve: (specifier, context, next) =>
      next(runtimePath(specifier), context),
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

/** The private tree this runtime runs from, as a path, and the digest that
 * names its contents (a slot's `.hash`): a slot is rewritten only while no
 * process runs from it, so nothing inside it changes while this one runs. */
export let runtimeTree = (): { root: string; id: string } | undefined => {
  let id = runtimeRoot() ? system.env.get('YAK_RUNTIME_TREE') : undefined
  return id ? { root: fileURLToPath(ROOT).replace(/\/$/, ''), id } : undefined
}

/** Stack traces keep the checkout's source addresses for the code catalog. */
export let runtimeStack = (
  stack: string,
  from = runtimeRoot() ? system.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? system.env.get('YAK_RUNTIME_ROOT') : undefined,
): string => from && to ? stack.replaceAll(to + '/', from + '/') : stack

/** A worker's inspector is local and opt-in at launch, never a live signal:
 * `YAK_WORK_INSPECT` names its port, 0 for any free one. */
export let inspector = (port: string): number => {
  if (!/^\d+$/.test(port) || Number(port) < 0 || Number(port) > 65535) {
    throw new Error('YAK_WORK_INSPECT must be a local port (0..65535)')
  }
  return Number(port)
}

// The flags `yak` runs with, beside its deno.json.
// TODO: deno.json's "no-legacy-abort" says this; Deno 2.9.1 ignores it there
// (./install.ts).
export let FLAGS = ['-q', '-A', '--unstable-no-legacy-abort']

// The open `.live` file of the slot this process runs from (`live`).
let held: disk.FsFile | undefined

/** Run a CLI command from immutable sources: its snapshot's own `yak.ts`, in
 * this process. Deno resolves the snapshot's imports through the snapshot's
 * own node_modules, so nothing the command loads comes from the checkout.
 * `whole` releases the checkout's land lock the caller holds (./yak.ts) once
 * the checkout is read. Deno read the checkout's deno.json as this process
 * started, before that lock: when a landing has written it since, the command
 * starts afresh from its snapshot in a process of its own, which names the
 * slot on its command line. JSR releases are already immutable and never
 * launch. */
export let launch = async (
  argv: string[],
  whole: () => void,
): Promise<void> => {
  let root = fileURLToPath(ROOT).replace(/\/$/, '')
  let { root: dir, commit, hash, release } = await snapshot(root, whole)
  let url = pathToFileURL(dir).href
  let env = {
    YAK_RUNTIME_FROM: ROOT.href.replace(/\/$/, ''),
    YAK_RUNTIME_ROOT: url,
    YAK_RUNTIME_COMMIT: commit,
    YAK_RUNTIME_TREE: hash,
  }
  let config = (await disk.stat(`${root}/deno.json`)).mtime
  if (config && config.getTime() >= performance.timeOrigin) {
    let child = launchCommand(system.execPath(), {
      args: [
        'run',
        ...FLAGS,
        '--config',
        `${dir}/deno.json`,
        `${dir}/packages/cli/yak.ts`,
        ...argv,
      ],
      env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn()
    release()
    // A terminal's interrupt reaches the command itself, which winds down.
    system.addSignalListener('SIGINT', () => {})
    system.addSignalListener('SIGTERM', () => child.kill('SIGTERM'))
    return system.exit((await child.status).code)
  }
  try {
    held = await disk.open(`${dir}/.live`, { create: true, write: true })
    await held.lock(false)
  } finally {
    release()
  }
  for (let [name, value] of Object.entries(env)) system.env.set(name, value)
  let { start } = await import(`${url}/packages/cli/yak.ts`)
  await start(argv)
}
