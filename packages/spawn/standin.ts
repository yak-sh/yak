#!/usr/bin/env -S deno run --no-config
// A stand-in for `claude -p`: a program that takes claude's command line,
// prints a recorded stream and exits the way the recording ended. A provider
// row names it as its `command` and `claude` as its `api`, so a run of it goes
// through everything a live run does (the launch, the log, the reader, the
// ending) and spends nothing:
//
//   provider{name: 'standin', transport: 'process', api: 'claude',
//            command: '/srv/repo/packages/spawn/standin.ts'}
//
// The model it is asked for names the recording, so the provider serves one
// model per ending: `clean`, `limit`, `refusal`, `crash`. A model it has no
// recording of ends cleanly.
//
// The recordings are written to the shapes @yaks/session's claude reader
// reads; the texts of `limit` are those of the runs of 2026-11-10 (bugs
// dbc37007 and f9b77269), whose own logs were not kept.

/** How a recorded run went: what it printed, and the code it exited with. */
export type Played = { out: string; err: string; code: number }

type Recording = { lines: unknown[]; err?: string; code: number }

let say = (text: string, more: Record<string, unknown> = {}) => ({
  type: 'assistant',
  ...more,
  message: { content: [{ type: 'text', text }] },
})

// The turn's closing line: `refused` is the text of an API refusal, which
// claude reports as subtype `success` with `is_error` set.
let result = (refused?: string) => ({
  type: 'result',
  subtype: 'success',
  is_error: refused != null,
  result: refused ?? 'done',
  usage: { input_tokens: 0, output_tokens: 0 },
})

/** What the plan said when it ended the runs of 2026-11-10. */
export let LIMIT = "You've reached your Fable limit."

// What claude printed last on stderr in those runs, which the ending once
// took for its cause.
let POLICY = 'Warning: claude.ai MCP servers blocked by policy'

/** The recordings, by the ending each one is of. */
export let endings: Record<string, Recording> = {
  // The turn answered and the process exited 0.
  clean: { lines: [say('done'), result()], code: 0 },
  // The plan's limit refused the turn: the window's reading, the answer
  // claude writes itself, and a failed result.
  limit: {
    lines: [
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          unifiedWindows: {
            seven_day: { utilization: 1, resetsAt: 1794913200 },
          },
        },
      },
      say(LIMIT, { error: 'rate_limit' }),
      result(LIMIT),
    ],
    err: POLICY,
    code: 1,
  },
  // The API refused the turn for another reason.
  refusal: {
    lines: [result('API Error: 500 overloaded')],
    err: POLICY,
    code: 1,
  },
  // The process was killed mid-turn: no closing line, and the code a wrapper
  // records for SIGKILL.
  crash: { lines: [say('starting')], err: 'out of memory', code: 137 },
}

// The value after a flag on a command line, before the `--` that ends them.
let flag = (argv: string[], name: string): string | undefined => {
  let end = argv.indexOf('--')
  let at = (end < 0 ? argv : argv.slice(0, end)).indexOf(name)
  return at < 0 ? undefined : argv[at + 1]
}

/**
 * What the stand-in prints and exits with for a claude command line (without
 * the program): the recording `--model` names, opened as claude opens a run,
 * with the thread it was told to be.
 *
 * ```ts
 * import { played } from './standin.ts'
 * import { equal } from '@yaks/testing'
 *
 * let run = played(['-p', '--session-id', 'S1', '--model', 'crash', '--', 'go'])
 * equal([run.code, run.err], [137, 'out of memory\n'])
 * equal(JSON.parse(run.out.split('\n')[0]).session_id, 'S1')
 * equal(played(['-p', '--', '--model', 'crash']).code, 0)
 * ```
 */
export let played = (argv: string[]): Played => {
  let model = flag(argv, '--model')
  let { lines, err, code } = endings[model ?? ''] ?? endings.clean
  let init = {
    type: 'system',
    subtype: 'init',
    session_id: flag(argv, '--resume') ?? flag(argv, '--session-id'),
    model,
  }
  return {
    out: [init, ...lines].map((l) => JSON.stringify(l) + '\n').join(''),
    err: err ? err + '\n' : '',
    code,
  }
}

if (import.meta.main) {
  let { out, err, code } = played(Deno.args)
  let bytes = (s: string) => new TextEncoder().encode(s)
  Deno.stdout.writeSync(bytes(out))
  Deno.stderr.writeSync(bytes(err))
  Deno.exit(code)
}
