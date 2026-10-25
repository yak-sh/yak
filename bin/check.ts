// `deno task check [--verbose]`: the checks `check:run` depends on in
// deno.json (fmt, lint, bytes, types, …), run at once. Each says one line as
// it ends, `ok check:fmt (1.2s)`, and one that failed says what it printed
// after that line, cut short (`cut`): an agent reads a run on every later
// turn, and a passing check's output is never news. The run closes with one
// line naming every check that failed (`closing`), so its last line is the
// verdict even when a failure that ended early scrolled away. `--verbose` runs
// `check:run` itself, every check's output said as it comes, each line led by
// its task's name.
import config from '../deno.json' with { type: 'json' }

/** The checks, by their task names. */
export let CHECKS: string[] = config.tasks['check:run'].dependencies

/// cut('Check file:///a.ts\nerror: no\nfound 1', 'check:types') -> 'error: no\nfound 1'
/// cut('1\n2\n3\n4\n5', 'check:lint', 1, 2) -> '1\n… 2 more lines; `deno task check:lint` says them all\n4\n5'
/**
 * What a failed check says: its output without Deno's progress (`Check …`
 * and `Download …`, what `--quiet` leaves out), and, past `head` + `tail`
 * lines, its first `head` and its last `tail`: the first error is often the
 * cause, and a tool's summary comes last.
 */
export let cut = (text: string, task: string, head = 20, tail = 40) => {
  let lines = text.trimEnd().split('\n')
    .filter((l) => !/^(Check|Download) \S+$/.test(l))
  let more = lines.length - head - tail
  return more > 0
    ? [
      ...lines.slice(0, head),
      `… ${more} more lines; \`deno task ${task}\` says them all`,
      ...lines.slice(-tail),
    ].join('\n')
    : lines.join('\n')
}

let took = (ms: number) => `${(ms / 1000).toFixed(1)}s`

/// closing([], 9, 52500) -> 'ok | 9 passed | 0 failed (52.5s)'
/// closing(['check:content'], 9, 3100) -> 'FAILED | 8 passed | 1 failed: check:content (3.1s)'
/** The run's last line, as the test runner closes its own. */
export let closing = (failed: string[], total: number, ms: number) =>
  `${failed.length ? 'FAILED' : 'ok'} | ${total - failed.length} passed | ${
    failed.length ? `${failed.length} failed: ${failed.join(', ')}` : '0 failed'
  } (${took(ms)})`

// One check, its output and errors as one stream, in the order they came.
let check = async (task: string) => {
  let start = performance.now()
  let child = new Deno.Command(Deno.execPath(), {
    args: ['task', '-q', task],
    // Color is for a terminal; captured, it is only bytes.
    env: Deno.stdout.isTerminal() ? {} : { NO_COLOR: '1' },
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let parts: string[] = []
  let drain = async (stream: ReadableStream<Uint8Array>) => {
    let text = new TextDecoder()
    for await (let bytes of stream) {
      parts.push(text.decode(bytes, { stream: true }))
    }
  }
  await Promise.all([drain(child.stdout), drain(child.stderr)])
  let { success } = await child.status
  let said = `${success ? 'ok' : 'FAILED'} ${task} (${
    took(performance.now() - start)
  })`
  console.log(success ? said : `${said}\n${cut(parts.join(''), task)}`)
  return success
}

if (import.meta.main) {
  if (Deno.args.includes('--verbose')) {
    let { code } = await new Deno.Command(Deno.execPath(), {
      args: ['task', 'check:run'],
    }).spawn().status
    Deno.exit(code)
  }
  let start = performance.now()
  let passed = await Promise.all(CHECKS.map(check))
  let failed = CHECKS.filter((_, i) => !passed[i])
  console.log(closing(failed, CHECKS.length, performance.now() - start))
  Deno.exit(failed.length ? 1 : 0)
}
