// The supervisor trusts a child only after its private ready handshake. This
// probe uses a tiny child instead of booting the graph server.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { insist, launch } from './dev.ts'
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

slow('launch: a successor that dies leaves its reason on disk', async () => {
  // The bug this closes: `inherit` sent every death reason to a dead socket,
  // so four handoff failures left no error text (T-14308). A child that
  // refuses to start must now be readable afterward.
  await withLogs(async (dir) => {
    let js = `console.error('boom: this successor refused to start')
      Deno.exit(3)`
    await assertRejects(() => launch(Deno.execPath(), ['eval', js, '--']))
    let log = await Deno.readTextFile(`${dir}/dev.log`)
    assertStringIncludes(log, 'boom: this successor refused to start')
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
      ) as Error
      assertStringIncludes(err.message, 'exited before ready')
      assertStringIncludes(err.message, 'code 7')
    })
  },
)

slow('launch: a join handoff is two beats, onBound between them', async () => {
  // The single-writer contract (T-20223): a --join successor signals BOUND,
  // the supervisor stops the predecessor (onBound), THEN the successor signals
  // READY. launch() must fire onBound after beat 1 and resolve only on beat 2.
  await withLogs(async () => {
    let js = `
      let arg = Deno.args.find((a) => a.startsWith('--ready='))
      let port = Number(arg.split('=')[1])
      let dial = async () => {
        using conn = await Deno.connect({ hostname: '127.0.0.1', port })
        await conn.write(new Uint8Array([1]))
      }
      await dial()                                    // beat 1: bound
      await new Promise((r) => setTimeout(r, 30))     // let onBound run
      await dial()                                    // beat 2: ready
    `
    let bound = false
    let child = await launch(Deno.execPath(), ['eval', js, '--'], () => {
      bound = true
    })
    assertEquals(bound, true) // onBound fired during the handshake
    assertEquals((await child.status).success, true)
  })
})

slow(
  'launch: a successor that dies AFTER bound is a failed handoff',
  async () => {
    // Beat 1 arrives (predecessor gets stopped), then the successor dies before
    // beat 2 — a migrate-time failure. launch() must reject so swap() heals with
    // a fresh boot, but onBound still fired, so the predecessor is condemned.
    await withLogs(async () => {
      let js = `
      let arg = Deno.args.find((a) => a.startsWith('--ready='))
      let port = Number(arg.split('=')[1])
      using conn = await Deno.connect({ hostname: '127.0.0.1', port })
      await conn.write(new Uint8Array([1]))           // beat 1 only
      Deno.exit(5)                                    // died before beat 2
    `
      let bound = false
      await assertRejects(() =>
        launch(Deno.execPath(), ['eval', js, '--'], () => {
          bound = true
        })
      )
      assertEquals(bound, true) // we DID condemn the predecessor
    })
  },
)

slow('insist: a handoff that failed comes back until it takes', async () => {
  let tries = 0
  insist(() => Promise.resolve(++tries == 3), [0], 0)()
  while (tries < 3) await tick(1)
  await tick(10)
  assertEquals(tries, 3) // and stops the moment one succeeds
})

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
