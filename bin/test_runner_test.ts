import { test, until } from '@yaks/testing'
import { fileURLToPath } from 'node:url'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { denoDir, observe, RUN } from './test.ts'

// What a test file running under the runner imports, for one written here.
let TESTING = JSON.stringify(
  new URL('../packages/testing/mod.ts', import.meta.url).href,
)

test('denoDir is the cache deno runs on, and a child moving HOME keeps it', async () => {
  let cache = async (env: Record<string, string>) => {
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['info', '--json'],
      env,
      clearEnv: true,
      stdout: 'piped',
    }).output()
    let { denoDir } = JSON.parse(new TextDecoder().decode(out.stdout))
    return Deno.realPathSync(denoDir)
  }
  let { HOME = '', XDG_CACHE_HOME } = Deno.env.toObject()
  let unpinned = { HOME, ...XDG_CACHE_HOME ? { XDG_CACHE_HOME } : {} }
  assertEquals(await cache(unpinned), Deno.realPathSync(denoDir(unpinned)))
  let home = await Deno.makeTempDir({ prefix: 'tasks-cache-probe-' })
  try {
    let pinned = { HOME: home, DENO_DIR: denoDir() }
    assertEquals(await cache(pinned), Deno.realPathSync(denoDir()))
    assertEquals(Array.from(Deno.readDirSync(home)), [])
  } finally {
    await Deno.remove(home, { recursive: true })
  }
})

test('colored test results count as completed', async () => {
  let progress = { name: 'loading tests', completed: 0, count: 0 }
  let encoder = new TextEncoder()
  let output = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(encoder.encode('one ... \x1b[0m'))
      stream.enqueue(encoder.encode('\x1b[32mok\x1b[0m (1ms)\n'))
      stream.close()
    },
  })
  await observe(output, progress)
  assertEquals(progress.name, 'one')
  assert(progress.completed > 0)
  assertEquals(progress.count, 1)
})

test('a run started inside a run refuses at once', async () => {
  let out = await new Deno.Command(Deno.execPath(), {
    // A path that names nothing: a runner without the refusal fails on it
    // at once, rather than starting the suite from inside this test.
    args: [
      'run',
      '-A',
      fileURLToPath(new URL('./test.ts', import.meta.url)),
      'no/such/path',
    ],
    env: { [RUN]: '1' },
  }).output()
  assertEquals(out.code, 2)
  assertEquals(/refused/.test(new TextDecoder().decode(out.stderr)), true)
})

// A failing platform does not cancel the others: each runs to its own end
// and prints its own report, and the coordinator fails afterwards.
for (let failure of [false, true]) {
  test(`every platform runs to its end${failure ? ' past a failing one' : ''}`, async () => {
    let dir = await Deno.makeTempDir({ prefix: 'test-platforms-' })
    try {
      let pid = JSON.stringify(`${dir}/b.pid`)
      // a, on deno, waits for b, on the browser platform: they run at once.
      await Deno.writeTextFile(
        `${dir}/a_test.ts`,
        `import { test, until } from ${TESTING}
        test('a', async () => {
          await until(() => { try { Deno.statSync(${pid}); return true }
            catch { return false } }, { timeout: 15000 })
          ${failure ? "throw new Error('expected platform failure')" : ''}
        })`,
      )
      // b reports its runtime's pid and passes in both cases: the sibling of
      // a failing platform is expected to finish, not to be killed mid-run.
      await Deno.mkdir(`${dir}/packages/web`, { recursive: true })
      await Deno.writeTextFile(
        `${dir}/packages/web/b_test.ts`,
        `import { test } from ${TESTING}
        test('b', () => Deno.writeTextFileSync(${pid}, String(Deno.pid)))`,
      )
      let out = await new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', fixture, 'bulk', 'broad', dir],
        env: { XDG_CACHE_HOME: `${dir}/.cache` },
      }).output()
      assertEquals(
        out.code,
        failure ? 1 : 0,
        new TextDecoder().decode(out.stderr),
      )
      let b = Number(await Deno.readTextFile(`${dir}/b.pid`))
      assertEquals(
        await Deno.stat(`/proc/${b}`).then(() => true, () => false),
        false,
      )
      let text = new TextDecoder().decode(out.stdout)
      assertEquals((text.match(/1 passed/g) ?? []).length, failure ? 1 : 2)
      assertEquals(/1 failed/.test(text), failure)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  })
}

let waiting = async (dir: string) => {
  let file = `${dir}/waiting_test.ts`
  let held = JSON.stringify(`${dir}/held.pid`)
  await Deno.writeTextFile(
    file,
    `import { test } from ${TESTING}
    test('waiting on a lost reply', async () => {
      let held = new Deno.Command('sleep', { args: ['60'] }).spawn()
      Deno.writeTextFileSync(${held}, String(held.pid))
      await held.status
    })`,
  )
  return file
}

let gone = (pid: number) =>
  until(async () => {
    try {
      await Deno.stat(`/proc/${pid}`)
      return false
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
      return true
    }
  }, { timeout: 5_000, label: `test descendant ${pid} to exit` })

let killGroup = (pid: number) => {
  try {
    Deno.kill(-pid, 'SIGKILL')
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}

let killChild = (child: Deno.ChildProcess) => {
  try {
    child.kill('SIGKILL')
  } catch (error) {
    if (
      !(error instanceof Deno.errors.NotFound) &&
      !(error instanceof TypeError && /already terminated/.test(error.message))
    ) throw error
  }
}

test('a test that stops completing is named and its descendants end', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'test-idle-' })
  let child: Deno.ChildProcess | undefined
  try {
    let file = await waiting(dir)
    child = new Deno.Command('setsid', {
      args: [
        Deno.execPath(),
        'run',
        '-A',
        fileURLToPath(new URL('./test.ts', import.meta.url)),
        '--bulk',
        file,
      ],
      env: { TASKS_TEST_IDLE_MS: '3000' },
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let result = await child.output()
    assertEquals(result.signal, 'SIGTERM')
    assertMatch(
      new TextDecoder().decode(result.stderr),
      /no test completed for \d+s; last: waiting on a lost reply/,
    )
    let held = Number(await Deno.readTextFile(`${dir}/held.pid`))
    await gone(held)
  } finally {
    if (child) killGroup(child.pid)
    await Deno.remove(dir, { recursive: true })
  }
})

test('a platform run ends when its parent is killed', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'test-orphan-' })
  let parent: Deno.ChildProcess | undefined
  let bulk = 0
  try {
    let file = await waiting(dir)
    let fixture = `${dir}/parent.ts`
    let runner = JSON.stringify(
      fileURLToPath(new URL('./test.ts', import.meta.url)),
    )
    let pid = JSON.stringify(`${dir}/bulk.pid`)
    await Deno.writeTextFile(
      fixture,
      `let child = new Deno.Command('setsid', {
        args: [Deno.execPath(), 'run', '-A', ${runner}, '--bulk', ${
        JSON.stringify(file)
      }],
        stdout: 'null', stderr: 'null',
      }).spawn()
      Deno.writeTextFileSync(${pid}, String(child.pid))
      setInterval(() => {}, 1000)`,
    )
    parent = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', fixture],
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await waitFor(`${dir}/held.pid`)
    bulk = Number(await Deno.readTextFile(`${dir}/bulk.pid`))
    let held = Number(await Deno.readTextFile(`${dir}/held.pid`))
    parent.kill('SIGKILL')
    await parent.status
    parent = undefined
    await Promise.all([gone(bulk), gone(held)])
  } finally {
    if (bulk) killGroup(bulk)
    if (parent) killChild(parent)
    await Deno.remove(dir, { recursive: true })
  }
})

test('a phase ends with its runner killed outright', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'test-phase-orphan-' })
  let runner: Deno.ChildProcess | undefined
  let leader = 0
  try {
    runner = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', fixture, 'orchestrator', 'broad', dir],
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await waitFor(`${dir}/grandchild.pid`)
    let grandchild = Number(await Deno.readTextFile(`${dir}/grandchild.pid`))
    leader = Number(await Deno.readTextFile(`${dir}/broad.ready`))
    runner.kill('SIGKILL')
    await runner.status
    runner = undefined
    await until(async () =>
      !await fixtureExists(leader, dir) &&
      !await fixtureExists(grandchild, dir), {
      timeout: 5_000,
      label: 'phase and descendant to exit after runner death',
    })
  } finally {
    if (runner) killChild(runner)
    if (leader) killGroup(leader)
    await Deno.remove(dir, { recursive: true })
  }
})

let fixture = fileURLToPath(
  new URL('./test_runner_fixture.ts', import.meta.url),
)

async function waitFor(path: string): Promise<void> {
  // This module itself runs in the broad parallel pass, where process spawn
  // can be delayed substantially by the rest of the repository inventory.
  await until(async () => {
    try {
      await Deno.stat(path)
      return true
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
      return false
    }
  }, { timeout: 15_000, label: path })
}

async function fixtureExists(pid: number, dir: string): Promise<boolean> {
  try {
    let command = await Deno.readTextFile(`/proc/${pid}/cmdline`)
    return command.includes(fixture) && command.includes(dir)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    // Linux can remove a process after opening cmdline but before reading it.
    try {
      await Deno.stat(`/proc/${pid}`)
    } catch (gone) {
      if (gone instanceof Deno.errors.NotFound) return false
    }
    throw error
  }
}

async function waitForFixtureExit(pid: number, dir: string): Promise<void> {
  await until(async () => !await fixtureExists(pid, dir), {
    label: `fixture ${pid} to exit`,
  })
}

async function release(dir: string, count: number) {
  await until(async () => {
    try {
      return (await Deno.readTextFile(`${dir}/orchestrator.signals`)).trim()
        .split('\n').length >= count
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
      return false
    }
  }, { timeout: 15_000, label: 'orchestrator signal receipts' })
  await Deno.writeTextFile(`${dir}/release`, '')
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
    await release(dir, 1)
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
    // the later delivery. The grandchild remains alive until explicitly released,
    // keeping the orchestrator in process-group settlement during the probe.
    await waitFor(`${dir}/grandchild.signal`)
    process.kill(later)
    await release(dir, 2)

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
      // Both handlers survive the accepted signal. The virtual deadline
      // must elapse before SIGKILL; the wall budget catches a stuck cleanup.
      let clock = Number(await Deno.readTextFile(`${dir}/clock`))
      assertEquals(clock >= 2_000, true)
      if (elapsed > 4_500) {
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
    test(`runner preserves ${signal} and cleans ${phase} descendants`, () =>
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
    test(
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
    test(
      `runner bounds stubborn ${phase} ${first} after ${later}`,
      () => overlappingCancellationCase(phase, first, later, true),
    )
  }
}

for (
  let [phase, code] of [['broad-code', 23], ['isolated-code', 24]] as const
) {
  test(`runner runs every phase and preserves ${phase}'s status`, async () => {
    let dir = await Deno.makeTempDir({ prefix: 'test-runner-' })
    try {
      let status = await new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', fixture, 'orchestrator', phase, dir, `${code}`],
        stdout: 'null',
        stderr: 'inherit',
      }).output()
      assertEquals(status.code, code)
      assertEquals(status.signal, null)
      // Both phases ran: a failing one is a result to report, never a stop.
      for (let name of ['broad', 'isolated']) {
        await Deno.stat(`${dir}/${name}.ready`)
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  })
}
