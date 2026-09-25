import { assertEquals } from '@std/assert'
import { parse } from '@std/yaml'

type Step = {
  name?: string
  if?: string
  run?: string
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
  for (let name of ['check', 'test']) {
    assertEquals(
      tasks[name],
      `deno run -A bin/suite-time.ts ${name} deno task ${name}:run`,
    )
  }
})
