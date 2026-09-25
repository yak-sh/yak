/** Test fixtures for code that cuts checkouts. A test that lets a child cut
 * its worktree from `Deno.cwd()` registers it in the repository the suite runs
 * in, and the run's scratch directory is deleted without telling git: 405 such
 * entries piled up in the real `.git/worktrees` (T-38366). So a test that
 * delegates a child hands `local()` a repository of its own. */

/** Run git in `cwd`, answering its trimmed stdout; a failure throws stderr. */
export let git = async (cwd: string, ...args: string[]) => {
  let p = await new Deno.Command('git', {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!p.success) throw new Error(new TextDecoder().decode(p.stderr))
  return new TextDecoder().decode(p.stdout).trim()
}

/** A throwaway directory holding a one-commit repository on `main` at
 * `repo` and an empty worktree root at `root`; `free()` removes all of it. */
export let scratchRepo = async () => {
  let dir = await Deno.makeTempDir()
  let repo = dir + '/repo'
  let root = dir + '/worktrees'
  await Deno.mkdir(repo)
  await Deno.mkdir(root)
  await git(repo, 'init', '-q', '-b', 'main', '.')
  await git(repo, 'config', 'user.email', 'test@example.org')
  await git(repo, 'config', 'user.name', 'Test')
  await Deno.writeTextFile(repo + '/file', 'committed')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-qm', 'initial')
  return {
    dir,
    repo,
    root,
    free: () => Deno.remove(dir, { recursive: true }),
  }
}
