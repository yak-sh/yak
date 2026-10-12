// A long-lived command pins its source tree. Deno's resolver is fixed when a
// process starts, so deferred imports must never read a checkout that can land.
import { fileURLToPath } from 'node:url'
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

/** Capture committed sources plus the worktree's edits. Published trees are
 * immutable and shared: stable URLs reuse Deno's module cache and the CLI's
 * declaration memo. A child resolves its workspace afresh over this tree;
 * its cwd and graph config still name the caller's data. */
export let snapshot = async (
  root: string,
): Promise<{ root: string; commit: string }> => {
  if (runtimeRoot()) {
    return { root, commit: Deno.env.get('YAK_RUNTIME_COMMIT')! }
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
  let target = `${cache}/${hash}`
  try {
    await Deno.stat(`${target}/deno.json`)
    return { root: target, commit }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  await Deno.mkdir(cache, { recursive: true })
  let dir = await Deno.makeTempDir({ dir: cache, prefix: '.building-' })
  try {
    await feed('tar', ['-x', '-C', dir], await git(root, 'archive', commit))
    if (patch.length) await feed('git', ['apply', '--binary', '-'], patch, dir)
    for (let { name, bytes, mode } of files) {
      let to = `${dir}/${name}`
      await Deno.mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true })
      await Deno.writeFile(to, bytes, { mode: mode ?? undefined })
    }
    // Absolute source imports from a file plugin or provider follow the same
    // tree, including imports made by modules outside the source checkout.
    let config = JSON.parse(await Deno.readTextFile(`${dir}/deno.json`))
    config.imports = {
      ...config.imports,
      [new URL(`file://${root}/`).href]: new URL(`file://${target}/`).href,
    }
    await Deno.writeTextFile(`${dir}/deno.json`, JSON.stringify(config))
    try {
      await Deno.rename(dir, target)
    } catch (error) {
      // Another launcher can publish the same captured sources first.
      if (
        !(error instanceof Deno.errors.AlreadyExists) &&
        !(error instanceof Error && 'code' in error &&
          error.code == 'ENOTEMPTY')
      ) throw error
    }
    return { root: target, commit }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    })
  }
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

/** Stack traces keep the checkout's source addresses for the code catalog. */
export let runtimeStack = (
  stack: string,
  from = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_FROM') : undefined,
  to = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_ROOT') : undefined,
): string => from && to ? stack.replaceAll(to + '/', from + '/') : stack

/** Run a persistent CLI command from immutable sources, forwarding its terminal
 * and interrupts and waiting for the child to drain. JSR releases are already
 * immutable. Independent workers reuse the sources with their own lifetime. */
export let runtime = async (argv: string[]): Promise<number | undefined> => {
  if (!ROOT.href.startsWith('file:')) return
  let root = fileURLToPath(ROOT).replace(/\/$/, '')
  let here = ROOT.href.replace(/\/$/, '')
  let privateTree = runtimeRoot()
  if (privateTree && Deno.env.get('YAK_RUNTIME_PINNED') == '1') {
    // Consume the launch token: an independent CLI invocation must own its
    // child, even if it inherits this process's environment and sources.
    Deno.env.delete('YAK_RUNTIME_PINNED')
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
  try {
    let { root: dir, commit } = await snapshot(root)
    if (stopped) return 143
    let url = new URL(`file://${dir}`).href
    // A separate session keeps a terminal interrupt from reaching the child
    // twice: directly from the terminal and again through our wind hold.
    child = new Deno.Command('setsid', {
      args: [
        Deno.execPath(),
        'run',
        '-A',
        '--config',
        `${dir}/deno.json`,
        `${dir}/packages/cli/yak.ts`,
        ...argv,
      ],
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
    return (await child.status).code
  } finally {
    finished.resolve()
    release()
  }
}
