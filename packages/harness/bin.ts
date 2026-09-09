#!/usr/bin/env -S deno run -A
// The command: @yaks/cli's `main` carrying this package's verbs and nothing
// else. `harness` with no word prints the usage; `harness new "…"` starts a
// transcript.
//
//   deno task harness new 'reply with the word pong'
//   deno task harness ls
//   deno task harness show <session>

import { main } from '@yaks/cli'
import { plugin } from './cli.ts'

if (import.meta.main) Deno.exit(await main(Deno.args, [plugin]))
