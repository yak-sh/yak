import { assertEquals } from '@std/assert'

let fixture = new URL('./test_runner_fixture.ts', import.meta.url).pathname

async function waitFor(path: string): Promise<void> {
  // This module itself runs in the broad parallel pass, where process spawn
  // can be delayed substantially by the rest of the repository inventory.
  let deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await Deno.stat(path)
      return
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function fixtureExists(pid: number, dir: string): Promise<boolean> {
  try {
    let command = await Deno.readTextFile(`/proc/${pid}/cmdline`)
    return command.includes(fixture) && command.includes(dir)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

async function waitForFixtureExit(pid: number, dir: string): Promise<void> {
  let deadline = Date.now() + 2_000
  while (Date.now() < deadline && await fixtureExists(pid, dir)) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assertEquals(await fixtureExists(pid, dir), false)
}

async function cancellationCase(
  phase: string,
  signal: Deno.Signal,
): Promise<void> {
  let dir = await Deno.makeTempDir({ prefix: 'test-runner-' })
  try {
    let process = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', fixture, 'orchestrator', phase, dir],
      stdout: 'null',
      stderr: 'inherit',
    }).spawn()
    await waitFor(`${dir}/${phase}.ready`)
    await waitFor(`${dir}/grandchild.pid`)
    let grandchild = Number(await Deno.readTextFile(`${dir}/grandchild.pid`))
    process.kill(signal)
    let status = await process.status
    assertEquals(status.signal, signal)
    assertEquals(await Deno.readTextFile(`${dir}/grandchild.signal`), signal)
    await waitForFixtureExit(grandchild, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

async function overlappingCancellationCase(
  phase: string,
  first: Deno.Signal,
  later: Deno.Signal,
  stubborn = false,
): Promise<void> {
  let dir = await Deno.makeTempDir({ prefix: 'test-runner-overlap-' })
  try {
    let process = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        fixture,
        'orchestrator',
        `${stubborn ? 'stubborn-' : ''}${phase}`,
        dir,
      ],
      stdout: 'null',
      stderr: 'inherit',
    }).spawn()
    await waitFor(`${dir}/${phase}.ready`)
    await waitFor(`${dir}/grandchild.pid`)
    let grandchild = Number(await Deno.readTextFile(`${dir}/grandchild.pid`))

    let startedAt = Date.now()
    process.kill(first)
    // This receipt proves the first signal was accepted and forwarded before
    // the later delivery. The grandchild deliberately remains alive briefly,
    // keeping the orchestrator in process-group settlement during the probe.
    await waitFor(`${dir}/grandchild.signal`)
    process.kill(later)

    let status = await process.status
    let elapsed = Date.now() - startedAt
    assertEquals(status.signal, first)
    assertEquals(await Deno.readTextFile(`${dir}/grandchild.signal`), first)
    assertEquals(
      await Deno.readTextFile(`${dir}/grandchild.signals`),
      `${first}\n`,
    )
    if (stubborn) {
      assertEquals(
        await Deno.readTextFile(`${dir}/${phase}.leader.signals`),
        `${first}\n`,
      )
      // Both handlers deliberately survive the accepted signal. A result
      // below this budget proves escalation started without awaiting either
      // the phase leader or its descendant.
      if (elapsed < 1_800 || elapsed > 4_500) {
        throw new Error(`stubborn group settled in ${elapsed}ms`)
      }
    }
    await waitForFixtureExit(grandchild, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// Declare separately so every phase/signal combination is visible in output.
for (let phase of ['broad', 'isolated']) {
  for (let signal of ['SIGTERM', 'SIGINT'] as const) {
    Deno.test(`runner preserves ${signal} and cleans ${phase} descendants`, () =>
      cancellationCase(phase, signal))
  }

  for (
    let [first, later] of [
      ['SIGTERM', 'SIGINT'],
      ['SIGINT', 'SIGTERM'],
      ['SIGTERM', 'SIGTERM'],
      ['SIGINT', 'SIGINT'],
    ] as const
  ) {
    Deno.test(
      `runner keeps ${phase} ${first} outcome after ${later}`,
      () => overlappingCancellationCase(phase, first, later),
    )
  }
}

// The same overlap/repeat matrix with a phase leader and grandchild that both
// handle the first signal and remain alive. These fresh processes require the
// runner's deadline (and eventual SIGKILL), rather than cooperating with TERM.
for (let phase of ['broad', 'isolated']) {
  for (
    let [first, later] of [
      ['SIGTERM', 'SIGINT'],
      ['SIGINT', 'SIGTERM'],
      ['SIGTERM', 'SIGTERM'],
      ['SIGINT', 'SIGINT'],
    ] as const
  ) {
    Deno.test(
      `runner bounds stubborn ${phase} ${first} after ${later}`,
      () => overlappingCancellationCase(phase, first, later, true),
    )
  }
}

for (
  let [phase, code] of [['broad-code', 23], ['isolated-code', 24]] as const
) {
  Deno.test(`runner preserves ordinary nonzero status in ${phase}`, async () => {
    let dir = await Deno.makeTempDir({ prefix: 'test-runner-' })
    try {
      let status = await new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', fixture, 'orchestrator', phase, dir, `${code}`],
        stdout: 'null',
        stderr: 'inherit',
      }).output()
      assertEquals(status.code, code)
      assertEquals(status.signal, null)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  })
}
