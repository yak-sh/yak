#!/usr/bin/env -S deno run -A
// The command: @yaks/cli's `main` carrying this package's verbs and nothing
// else. `harness` with no word opens the TUI; `harness new "…"` starts a
// transcript.
//
//   deno task harness new 'reply with the word pong'
//   deno task harness ls
//   deno task harness show <session>

import { main } from '@yaks/cli'
import { plugin } from './cli.ts'

if (import.meta.main) {
  if (!Deno.args.length) {
    let { tui } = await import('./app.ts')
    await tui()
    Deno.exit(0)
  }
  Deno.exit(await main(Deno.args, [plugin]))
}
