#!/usr/bin/env -S deno run -A
// The command: @yaks/cli's `main` carrying this package's verbs and nothing
// else. `harness` with no word opens the TUI; `harness new "…"` starts a
// transcript.
//
//   deno task harness new 'reply with the word pong'
//   deno task harness ls
//   deno task harness show <session>

import { main } from '@yaks/cli'
import { diagnostics, uncaught } from './diagnostics.ts'
import { plugin } from './cli.ts'

if (import.meta.main) {
  let reporter = diagnostics()
  let remove = uncaught(reporter, globalThis, () => {
    // Last-resort restoration when an asynchronous render callback throws.
    try {
      Deno.stdin.setRaw(false)
    } catch { /* not a tty */ }
    Deno.stderr.writeSync(
      new TextEncoder().encode(
        '\x1b[<u\x1b[>4;0m\x1b[?1006r\x1b[?1000r\x1b[?1007l\x1b[?2004l\x1b[?25h\x1b[?1049l',
      ),
    )
  })
  try {
    if (!Deno.args.length) {
      let { tui } = await import('./app.ts')
      await tui()
    } else Deno.exitCode = await main(Deno.args, [plugin])
  } catch (error) {
    reporter.report(error, { phase: 'harness-main' })
    throw error
  } finally {
    await reporter.drain()
    remove()
  }
}
