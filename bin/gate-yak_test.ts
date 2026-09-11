import { assertEquals, assertRejects } from '@std/assert'
import { parse } from '@std/yaml'

type Step = {
  id?: string
  name?: string
  if?: string
  run?: string
  'continue-on-error'?: boolean
  env?: Record<string, string>
  uses?: string
}
let workflow = parse(
  Deno.readTextFileSync(
    new URL('../.github/workflows/gate.yml', import.meta.url),
  ),
) as {
  jobs: {
    gate: {
      'runs-on': string[]
      steps: Step[]
      defaults: { run: { shell: string } }
    }
  }
}
let steps = workflow.jobs.gate.steps

Deno.test('every CI run step has a stable timing label and failures retain the artifact', () => {
  assertEquals(
    workflow.jobs.gate.defaults.run.shell,
    'deno run -A bin/suite-time.ts --ci bash --noprofile --norc -eo pipefail {0}',
  )
  for (let step of steps.filter((s) => s.run)) {
    assertEquals(step.env?.SUITE_STEP, step.name)
  }
  assertEquals(
    steps.find((s) => s.uses === 'actions/upload-artifact@v4')?.if,
    'always()',
  )
  let tasks =
    JSON.parse(Deno.readTextFileSync(new URL('../deno.json', import.meta.url)))
      .tasks
  for (let name of ['check', 'test', 'test:workerd']) {
    assertEquals(
      tasks[name],
      `deno run -A bin/suite-time.ts ${name} deno task ${name}:run`,
    )
  }
})

Deno.test('the workerd tier is path-scoped, self-hosted, and reports without blocking', () => {
  assertEquals(workflow.jobs.gate['runs-on'], ['self-hosted', 'yak'])
  let workerd = steps.find((s) => s.run == 'deno task test:workerd')!
  assertEquals(workerd.if, "steps.paths.outputs.workers == 'true'")
  // Tests exercise and report; they never hold a deploy back.
  for (let name of ['workerd tests', 'bench gate']) {
    assertEquals(steps.find((s) => s.name == name)!['continue-on-error'], true)
  }
  // Nothing here publishes: Workers Builds watches main itself.
  assertEquals(steps.some((s) => (s.run ?? '').includes('promote')), false)
  let tasks = JSON.parse(
    Deno.readTextFileSync(new URL('../deno.json', import.meta.url)),
  ).tasks
  assertEquals(
    tasks['test:workerd:run'],
    'deno run -A bin/test-workerd.ts',
  )
})

Deno.test('worker path scope covers nested files and deletions; a bad diff fails closed', async () => {
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
    // A PR compares against its own base, not the previous push.
    assertEquals(await scoped('', later, docs), true)
    await assertRejects(() => scoped('', later, 'nonexistent'))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
