/** Test fixtures: a harness graph composed as a `yak` config composes one
 * (`harness`, `at`), the runner working it as an agent works it, for a test
 * that drives the graph itself (`working`), and the repositories a harness
 * starts in.
 *
 * The repositories are for code that starts in a checkout or cuts one. A
 * harness started in `Deno.cwd()` works in the repository the suite runs in:
 * it reads every ref there into the graph on each start, over a thousand of
 * them, and a child it delegates cuts its worktree and a `task-child-*` branch
 * there, which outlive the run's scratch directory — 405 worktree entries and
 * 925 branches piled up in the real repository (T-38366). So every test hands
 * `local()` a repository of its own: `repo()` when it only needs somewhere to
 * start, and `scratchRepo()` when it cuts checkouts it will look at. */

import { type Runner, running } from '@yaks/session'
import { compose, type Config, type Host } from '@yaks/cli/host'
import { install } from '@yaks/connections'
import { type Harness, hosted } from './store.ts'

/** The packages a harness graph is made of in these tests: what a transcript
 * is (@yaks/session), what it asks for and what answers (@yaks/tools,
 * @yaks/context, @yaks/model and its providers), what a reply carries
 * (@yaks/blob), the programs it starts (@yaks/process), the sign-ins it keeps
 * (@yaks/secrets, @yaks/connections), the runs its commits owe (@yaks/effects),
 * the work it is doing, and the harness's own words. In a config's order: a
 * later package's computed property wins, so @yaks/session's claim is the step
 * in a task's status it contributes. */
export let PLUGINS: string[] = [
  '@yaks/kernel',
  '@yaks/id',
  '@yaks/secrets',
  '@yaks/edge',
  '@yaks/blob',
  '@yaks/doc',
  '@yaks/effects',
  '@yaks/task',
  '@yaks/project',
  '@yaks/session',
  '@yaks/tools',
  '@yaks/model',
  '@yaks/openai',
  '@yaks/openrouter',
  '@yaks/process',
  '@yaks/context',
  '@yaks/connections',
  '@yaks/mcp-client',
  '@yaks/git',
  '@yaks/harness',
]

/** A config naming the graph at `db` (`:memory:` by default) made of
 * {@link PLUGINS}; `lease` is how long a run it claims stands. */
export let at = (db = ':memory:', lease?: number): Config => ({
  db,
  plugins: PLUGINS,
  ...lease ? { lease } : {},
})

/** That graph, composed and open, as a harness runs over it, with the
 * integrations a process serving its effects installs on the way up (the
 * OpenRouter sign-in goes through one); closing it closes the graph. */
export let harness = async (
  db = ':memory:',
  lease?: number,
): Promise<Harness & { sql: Host['sql'] }> => {
  let host = await compose(at(db, lease), ['graph'])
  let g = host.graph
  await g.apply(await install(g.read), { trusted: true })
  return { ...hosted(host, () => host.close()), sql: host.sql }
}

/** The runner over `h`, lent `deps`, working its pool as an agent does;
 * `stop()` leaves the pool once what it started has settled. */
export let working = (h: Harness, deps: Omit<Runner, 'holder'>) => {
  let leave = new AbortController()
  h.fx.handle(running(h.g, { holder: h.me, ...deps }))
  let work = h.fx.work(h.g, leave.signal)
  return {
    stop: async () => {
      leave.abort()
      await h.fx.stop()
      await work
    },
  }
}

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
