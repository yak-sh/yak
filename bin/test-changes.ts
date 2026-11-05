// Git supplies the changed paths; dependency selection stays in @yaks/testing.
import { members } from '@yaks/cli/dependencies'

type Run = (args: string[]) => Promise<string>

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
export let changes = async (run: Run = git): Promise<string[]> => {
  let branch = (await run(['branch', '--show-current'])).trim()
  let base = branch == 'main'
    ? 'HEAD^'
    : (await run(['merge-base', 'main', 'HEAD'])).trim()
  let tracked = await run(['diff', '--name-only', '--no-renames', '-z', base])
  let added = await run(['ls-files', '--others', '--exclude-standard', '-z'])
  return [...new Set((tracked + added).split('\0').filter(Boolean))]
}

let workspace = members()

/// member('packages/sql/render.ts') -> 'packages/sql'
/// member('bin/test.ts') -> undefined
/** The workspace package a path belongs to. */
export let member = (path: string): string | undefined =>
  workspace.find((w) => path.startsWith(`${w}/`))
