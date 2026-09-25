/** Test fixtures for code that starts in a checkout or cuts one. A harness
 * started in `Deno.cwd()` works in the repository the suite runs in: it reads
 * every ref there into the graph on each start, over a thousand of them, and a
 * child it delegates cuts its worktree and a `task-child-*` branch there, which
 * outlive the run's scratch directory — 405 worktree entries and 925 branches
 * piled up in the real repository (T-38366). So every test hands `local()` a
 * repository of its own: `repo()` when it only needs somewhere to start, and
 * `scratchRepo()` when it cuts checkouts it will look at. */

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

// One commit on `main`, made synchronously so `repo()` can answer anywhere.
let seed = (repo: string) => {
  let run = (...args: string[]) => {
    let p = new Deno.Command('git', { cwd: repo, args, stderr: 'piped' })
      .outputSync()
    if (!p.success) throw new Error(new TextDecoder().decode(p.stderr))
  }
  run('init', '-q', '-b', 'main', '.')
  run('config', 'user.email', 'test@example.org')
  run('config', 'user.name', 'Test')
  Deno.writeTextFileSync(repo + '/file', 'committed')
  run('add', '.')
  run('commit', '-qm', 'initial')
}

/** A throwaway directory holding a one-commit repository on `main` at
 * `repo` and an empty worktree root at `root`; `free()` removes all of it. */
export let scratchRepo = async () => {
  let dir = await Deno.makeTempDir()
  let repo = dir + '/repo'
  let root = dir + '/worktrees'
  await Deno.mkdir(repo)
  await Deno.mkdir(root)
  seed(repo)
  return {
    dir,
    repo,
    root,
    free: () => Deno.remove(dir, { recursive: true }),
  }
}

let made: string | undefined

/** This test process's one-commit repository, made on first use and removed
 * when the process ends: where a harness starts when its test does not look
 * at the checkout. */
export let repo = (): string => {
  if (made) return made
  let dir = Deno.makeTempDirSync()
  seed(dir)
  addEventListener('unload', () => {
    try {
      Deno.removeSync(dir, { recursive: true })
    } catch {
      // Already gone with the run's scratch directory.
    }
  })
  return made = dir
}
