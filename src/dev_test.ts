// The supervisor trusts a child only after its private ready handshake. This
// probe uses a tiny child instead of booting the graph server.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { handoff, insist, launch, retire } from './dev.ts'
import { FakeTime } from '@std/testing/time'
import { slow } from './testing.ts'

let tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

// Route the supervisor's durable stderr log to a throwaway dir so a launch
// never writes to the live ~/.tasks/dev/dev.log during the suite.
let withLogs = async (fn: (dir: string) => Promise<void>) => {
  let dir = await Deno.makeTempDir()
  let prev = Deno.env.get('LOGS_DIR')
  Deno.env.set('LOGS_DIR', dir)
  try {
    await fn(dir)
  } finally {
    prev == null ? Deno.env.delete('LOGS_DIR') : Deno.env.set('LOGS_DIR', prev)
    await Deno.remove(dir, { recursive: true })
  }
}

slow('launch: returns a child only after its ready signal', async () => {
  await withLogs(async () => {
    let js = `
      let arg = Deno.args.find((a) => a.startsWith('--ready='))
      using conn = await Deno.connect({
        hostname: '127.0.0.1',
        port: Number(arg.split('=')[1]),
      })
      await conn.write(new Uint8Array([1]))
    `
    // '--' hands the appended --ready flag to the code as Deno.args.
    let child = await launch(Deno.execPath(), ['eval', js, '--'])
    assertEquals((await child.status).success, true)
  })
})

slow('launch: a child that dies leaves its reason on disk', async () => {
  // The bug this closes: `inherit` sent every death reason to a dead socket,
  // so four replacement failures left no error text (T-14308). A child that
  // refuses to start must now be readable afterward.
  await withLogs(async (dir) => {
    let js = `console.error('boom: this server refused to start')
      Deno.exit(3)`
    await assertRejects(() => launch(Deno.execPath(), ['eval', js, '--']))
    let log = await Deno.readTextFile(`${dir}/dev.log`)
    assertStringIncludes(log, 'boom: this server refused to start')
  })
})

// Capture what the supervisor says to its OWN stderr (console.error), where a
// boot-duration line and a failure diagnosis land — the journal, not dev.log.
let saying = async (fn: () => Promise<void>) => {
  let said: string[] = []
  let was = console.error
  console.error = (...a: unknown[]) => said.push(a.map(String).join(' '))
  try {
    await fn()
  } finally {
    console.error = was
  }
  return said.join('\n')
}

slow('launch: a ready boot surfaces its duration (T-13914)', async () => {
  // A creeping regression must be visible before it crosses the deadline, so
  // every successful boot logs how long it took.
  await withLogs(async () => {
    let js = `let arg = Deno.args.find((a) => a.startsWith('--ready='))
      using conn = await Deno.connect({
        hostname: '127.0.0.1',
        port: Number(arg.split('=')[1]),
      })
      await conn.write(new Uint8Array([1]))`
    let said = await saying(async () => {
      let child = await launch(Deno.execPath(), ['eval', js, '--'])
      await child.status
    })
    assertStringIncludes(said, 'ready in')
    assertStringIncludes(said, 'ms')
  })
})

slow(
  'launch: a child that exits before ready is named, not silent',
  async () => {
    // Distinguish "died" from "never answered": the exit path names the pid and
    // its code, so a failed attempt is a diagnosis rather than a silent retry.
    await withLogs(async () => {
      let js = `Deno.exit(7)`
      let err = await assertRejects(() =>
        launch(Deno.execPath(), ['eval', js, '--'])
      ) as Error & { exitCode?: number }
      assertStringIncludes(err.message, 'exited before ready')
      assertStringIncludes(err.message, 'code 7')
      assertEquals(err.exitCode, 7)
    })
  },
)

slow(
  'insist: a replacement that failed comes back until it takes',
  async () => {
    let tries = 0
    insist(() => Promise.resolve(++tries == 3), [0], 0)()
    while (tries < 3) await tick(1)
    await tick(10)
    assertEquals(tries, 3) // and stops the moment one succeeds
  },
)

slow('insist: a rejected attempt is a failure, not a death', async () => {
  let tries = 0
  let fail = () => Promise.reject('insist probe: this rejection is the test')
  insist(() => ++tries == 2 ? Promise.resolve(true) : fail(), [0], 0)()
  while (tries < 2) await tick(1)
  await tick(10)
  assertEquals(tries, 2)
})

slow('insist: edits arriving together make one attempt', async () => {
  let tries = 0
  let poke = insist(() => Promise.resolve(!!++tries), [0], 5)
  poke()
  poke()
  poke()
  await tick(60)
  assertEquals(tries, 1)
})

// Fast-tier protocol tests: status and READY are independent gates. A signal
// (even SIGKILL) must never be mistaken for an exited writer.
let deferred = <T>() => Promise.withResolvers<T>()
let status = { success: true, code: 0, signal: null }
let process = (pid: number, events: string[]) => {
  let exited = deferred<Deno.CommandStatus>()
  let killed = deferred<void>()
  return {
    pid,
    status: exited.promise,
    killed: killed.promise,
    kill: (signal: Deno.Signal = 'SIGTERM') => {
      events.push(`${pid} ${signal}`)
      if (signal == 'SIGKILL') killed.resolve()
    },
    exit: () => exited.resolve(status),
  }
}

for (let mode of ['swap', 'server crash', 'exit 42']) {
  Deno.test(`handoff: ${mode} reaps both old writers before replacement`, async () => {
    using time = new FakeTime()
    let events: string[] = []
    let effects = process(10, events)
    let server = process(11, events)
    if (mode == 'server crash') server.exit()
    let ready = deferred<void>()
    let launched = deferred<void>()
    let serverStopping = deferred<void>()
    let pair = handoff({
      stopEffects: () => retire(effects, 'effectsd'),
      stopServer: () => {
        serverStopping.resolve()
        return retire(server, 'server')
      },
      launch: async () => {
        events.push('new server opens graph')
        launched.resolve()
        await ready.promise
        events.push('new server checkpointed ready')
      },
      startEffects: () => events.push('new effects opens graph'),
    })
    let replacing = mode == 'exit 42' ? pair.stop() : pair.replace()
    assertEquals(events, ['10 SIGTERM'])
    // A settle can use its whole grace period, but no new writer starts.
    await time.tickAsync(29_999)
    assertEquals(events, ['10 SIGTERM'])
    effects.exit()
    await serverStopping.promise
    assertEquals(events, ['10 SIGTERM', '11 SIGTERM'])
    server.exit()
    if (mode == 'exit 42') {
      await replacing
      assertEquals(events, ['10 SIGTERM', '11 SIGTERM'])
      // The shell's next supervisor only starts after this one's stop.
      replacing = pair.start()
    }
    await launched.promise
    assertEquals(events.at(-1), 'new server opens graph')
    assertEquals(events.includes('new effects opens graph'), false)
    ready.resolve()
    await replacing
    assertEquals(events.slice(-2), [
      'new server checkpointed ready',
      'new effects opens graph',
    ])
  })
}

Deno.test('handoff: deadline kills a settler but still waits for kernel exit', async () => {
  using time = new FakeTime()
  let events: string[] = []
  let effects = process(20, events)
  let pair = handoff({
    stopEffects: () => retire(effects, 'effectsd'),
    stopServer: () => {
      events.push('old server stopped')
      return Promise.resolve()
    },
    launch: () => {
      events.push('new server ready')
      return Promise.resolve()
    },
    startEffects: () => events.push('new effects started'),
  })
  let said = await saying(async () => {
    let replacing = pair.replace()
    await time.tickAsync(30_000)
    await effects.killed
    assertEquals(events, ['20 SIGTERM', '20 SIGKILL'])
    await time.tickAsync(60_000)
    assertEquals(events, ['20 SIGTERM', '20 SIGKILL'])
    effects.exit()
    await replacing
  })
  assertEquals(events.slice(2), [
    'old server stopped',
    'new server ready',
    'new effects started',
  ])
  assertStringIncludes(said, 'effectsd pid 20 exit deadline exceeded — SIGKILL')
  assertStringIncludes(said, 'effectsd pid 20 exited code=0')
})

Deno.test('handoff: failed readiness never starts effectsd; retry stays ordered', async () => {
  let events: string[] = []
  let attempt = 0
  let pair = handoff({
    stopEffects: () => {
      events.push('effects exited')
      return Promise.resolve()
    },
    stopServer: () => {
      events.push('server exited')
      return Promise.resolve()
    },
    launch: () => {
      events.push('launch')
      return ++attempt == 1
        ? Promise.reject(new Error('checkpoint failed'))
        : Promise.resolve()
    },
    startEffects: () => events.push('effects started'),
  })
  await assertRejects(pair.replace, Error, 'checkpoint failed')
  assertEquals(events, ['effects exited', 'server exited', 'launch'])
  await pair.start()
  assertEquals(events.slice(3), ['launch', 'effects started'])
})

Deno.test('retire: already departed child is reaped without waiting for deadline', async () => {
  using time = new FakeTime()
  await retire({
    pid: 30,
    status: Promise.resolve(status),
    kill: () => {
      throw new TypeError('Child process has already terminated')
    },
  }, 'server')
  assertEquals(time.now, time.start)
})
