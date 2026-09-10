import { assertEquals, assertRejects } from '@std/assert'
import { parse } from '@std/yaml'

type Step = { id?: string; name?: string; if?: string; run?: string }
let workflow = parse(
  Deno.readTextFileSync(
    new URL('../.github/workflows/gate.yml', import.meta.url),
  ),
) as { jobs: { gate: { 'runs-on': string[]; steps: Step[] } } }
let steps = workflow.jobs.gate.steps

Deno.test('workerd gates promotion on the self-hosted runner, never on a PR', () => {
  assertEquals(workflow.jobs.gate['runs-on'], ['self-hosted', 'yak'])
  let workerd = steps.findIndex((s) => s.run == 'deno task test:workerd')
  let promote = steps.findIndex((s) => s.id == 'promote')
  assertEquals(steps[workerd].if, "steps.paths.outputs.workers == 'true'")
  assertEquals(
    steps[promote].if,
    "github.event_name == 'push' && steps.paths.outputs.workers == 'true'",
  )
  for (
    let name of ['deno task check', 'tests', 'workerd tests', 'bench gate']
  ) {
    let at = steps.findIndex((s) => s.name == name)
    assertEquals(at >= 0 && at < promote, true, name)
  }
  let tasks = JSON.parse(
    Deno.readTextFileSync(new URL('../deno.json', import.meta.url)),
  ).tasks
  assertEquals(
    tasks['test:workerd'],
    'TASKS_SLOW=1 deno test -A --unstable-net --unstable-worker-options workers/yak/ workers/yak-tail/',
  )
})

Deno.test('worker path scope covers nested files, deletions and superseded pushes; bad diffs fail closed', async () => {
  let dir = await Deno.makeTempDir()
  let command = async (args: string[], env: Record<string, string> = {}) => {
    let out = await new Deno.Command(args[0], {
      args: args.slice(1),
      cwd: dir,
      env,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (out.code) throw new Error(new TextDecoder().decode(out.stderr))
    return new TextDecoder().decode(out.stdout).trim()
  }
  let git = (...args: string[]) => command(['git', ...args])
  let commit = async (path: string) => {
    await Deno.mkdir(`${dir}/${path.slice(0, path.lastIndexOf('/'))}`, {
      recursive: true,
    })
    await Deno.writeTextFile(`${dir}/${path}`, crypto.randomUUID())
    await git('add', '.')
    await git('commit', '-m', path)
    return git('rev-parse', 'HEAD')
  }
  let scoped = async (base: string, head: string, pr = '') => {
    let output = `${dir}/output`
    await Deno.writeTextFile(output, '')
    await command([
      'bash',
      '-eo',
      'pipefail',
      '-c',
      steps.find((s) => s.id == 'paths')!.run!,
    ], {
      BEFORE: base,
      PR_BASE: pr,
      GITHUB_SHA: head,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: dir,
    })
    return (await Deno.readTextFile(output)).includes('workers=true')
  }
  try {
    await git('init', '--initial-branch=main')
    await git('config', 'user.name', 'Test')
    await git('config', 'user.email', 'test@example.com')
    let first = await commit('docs/start.md')
    let docs = await commit('docs/next.md')
    assertEquals(await scoped(first, docs), false)
    let worker = await commit('workers/yak/nested/probe.ts')
    assertEquals(await scoped(docs, worker), true)
    assertEquals(await scoped('0'.repeat(40), worker), true)
    let packages = await commit('packages/sql/probe.ts')
    assertEquals(await scoped(worker, packages), true)
    await git('rm', 'workers/yak/nested/probe.ts')
    await git('commit', '-m', 'delete worker')
    let deleted = await git('rev-parse', 'HEAD')
    assertEquals(await scoped(packages, deleted), true)
    let later = await commit('docs/later.md')
    assertEquals(await scoped(deleted, later), false)
    // A cancelled gate left packages unpromoted: a subsequent docs push must
    // test that pending change. Once promoted, docs-only pushes skip workerd.
    await git('update-ref', 'refs/remotes/origin/deploy', docs)
    assertEquals(await scoped(deleted, later), true)
    await git('update-ref', 'refs/remotes/origin/deploy', deleted)
    assertEquals(await scoped(deleted, later), false)
    // PRs compare against their own base, not the production branch.
    assertEquals(await scoped('', later, docs), true)
    await assertRejects(() => scoped('', later, 'nonexistent'))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
