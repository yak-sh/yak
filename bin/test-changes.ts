// Git supplies the changed paths; dependency selection stays in @yaks/testing.
type Run = (args: string[]) => Promise<string>

let git: Run = async (args) => {
  let result = await new Deno.Command('git', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    throw new Error(
      `Cannot select relevant tests: ${
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
