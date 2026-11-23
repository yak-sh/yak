// Git supplies the changed paths and what each hunk edits; dependency
// selection stays in @yaks/testing.
import { members } from '@yaks/cli/dependencies'
import { tested } from '@yaks/testing/find'

type Run = (args: string[]) => Promise<string>
type Comparison = { run?: Run; at?: string }

/** Git's answer to `args`, or why it refused. */
export let git: Run = async (args) => {
  let result = await new Deno.Command('git', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    throw new Error(
      `git ${args[0]} refused: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    )
  }
  return new TextDecoder().decode(result.stdout)
}

/** Paths changed on this branch, including staged, unstaged and untracked
 * files. On main, the latest commit supplies the committed changes. */
export let changes = async (
  { run = git, at }: Comparison = {},
): Promise<string[]> => {
  let tracked = await run([
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    at ?? await base(run),
  ])
  let added = await run(['ls-files', '--others', '--exclude-standard', '-z'])
  return [...new Set((tracked + added).split('\0').filter(Boolean))]
}

/** The commit this change is measured from. On main it is the latest
 * commit's parent. */
export let base = async (run: Run = git): Promise<string> => {
  let branch = (await run(['branch', '--show-current'])).trim()
  let compare = branch == 'main'
    ? ['rev-parse', 'HEAD^']
    : ['merge-base', 'main', 'HEAD']
  return (await run(compare)).trim()
}

/** What this branch changes in each module. Tests run for being changed.
 * The source check handles type-only changes even when there is no runtime
 * declaration to name. */
export let edits = async (
  { run = git, at, paths, read = (p) => Deno.readTextFile(p) }: Comparison & {
    paths?: string[]
    read?: (path: string) => Promise<string>
  } = {},
): Promise<Record<string, string[]>> => {
  let from = at ?? await base(run)
  let modules = (paths ?? await changes({ run, at: from })).filter((path) =>
    path == 'workers/yak/wrangler.toml' ||
    /\.[mc]?[jt]sx?$/.test(path) && !tested(path)
  )
  if (!modules.length) return {}
  let { declarations } = await import('./test-edits.ts')
  return Object.fromEntries(
    await Promise.all(modules.map(async (path) => {
      let [before, after] = await Promise.all([
        run(['show', `${from}:${path}`]).catch(() => undefined),
        read(path).catch(() => undefined),
      ])
      return [
        path,
        before == undefined || after == undefined
          ? ['*']
          : path.endsWith('.toml')
          ? await configEdits(before, after)
          : declarations(path, before, after),
      ]
    })),
  )
}

// Wrangler and the configuration probes consume the parsed bindings. A
// comment about a deploy secret does not change any of those bindings.
let configEdits = async (before: string, after: string) => {
  let { parse } = await import('smol-toml')
  let { isDeepStrictEqual } = await import('node:util')
  try {
    return isDeepStrictEqual(parse(before), parse(after)) ? [] : ['*']
  } catch {
    return ['*']
  }
}

let workspace = new Set(members())
// Selection asks of each module many times.
let owners = new Map<string, string | undefined>()

/// member('packages/sql/render.ts') -> 'packages/sql'
/// member('bin/test.ts') -> undefined
/** The workspace package a path belongs to. */
export let member = (path: string): string | undefined => {
  if (!owners.has(path)) {
    let dirs = path.split('/').slice(0, -1)
    let at = dirs.findIndex((_, i) =>
      workspace.has(dirs.slice(0, i + 1).join('/'))
    )
    owners.set(path, at < 0 ? undefined : dirs.slice(0, at + 1).join('/'))
  }
  return owners.get(path)
}
