#!/usr/bin/env -S deno run -A
// test-budget — what on the deno platform runs slower than its 1ms budget
// (M-39441): every test, and every file's load, reported over it.
//
// It runs `deno task test --all --tag=deno`, streaming the run as usual, and
// reads the runner's lines as they pass: a file's header says what loading it
// took (`running 9 tests from ./a_test.ts (loaded in 12ms)`), and each test's
// line what the test took (`name ... ok (12ms)`). A duration in µs is under
// the budget, and `(1ms)` is the boundary it allows, so an offender is 2ms or
// more. The offenders print slowest first, each test beside its file.
//
// Advisory: the exit code is the run's own. TASKS_FAST_STRICT=1 also fails
// the run on any offender, for a branch holding a line locally.

// deno-lint-ignore no-control-regex -- ESC is the ANSI escape we strip
let ansi = /\x1b\[[0-9;]*m/g
let header = /^running \d+ tests from (.+) \(loaded in (.+)\)$/
let done = /^(.+?) \.\.\. ok \((.+)\)$/

/// ms('250µs') -> 0.25
/// ms('12ms') -> 12
/// ms('3s') -> 3000
/// ms('2m32s') -> 152000
/** A duration as the runner prints one, in milliseconds. */
export let ms = (took: string) => {
  let m = took.match(/^(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?(?:(\d+)µs)?$/)
  return m
    ? +(m[1] ?? 0) * 60_000 + +(m[2] ?? 0) * 1000 + +(m[3] ?? 0) +
      +(m[4] ?? 0) / 1000
    : 0
}

type Offender = { name: string; file: string; ms: number }

/// let r = reader()
/// r.read('running 2 tests from ./a_test.ts (loaded in 40ms)')
/// r.read('slow ... ok (3s)')
/// r.read('quick ... ok (250µs)')
/// r.tests -> [{ name: 'slow', file: './a_test.ts', ms: 3000 }]
/// r.loads -> [{ name: './a_test.ts', file: './a_test.ts', ms: 40 }]
/** Reads a run a line at a time, keeping what it reports over budget. */
export let reader = () => {
  let file = ''
  let tests: Offender[] = []
  let loads: Offender[] = []
  let read = (line: string) => {
    line = line.replace(ansi, '')
    let h = line.match(header)
    if (h) {
      file = h[1]
      if (ms(h[2]) >= 2) loads.push({ name: file, file, ms: ms(h[2]) })
      return
    }
    let t = line.match(done)
    if (t && ms(t[2]) >= 2) tests.push({ name: t[1], file, ms: ms(t[2]) })
  }
  return { read, tests, loads }
}

let listed = (title: string, rows: Offender[], named: boolean) => {
  rows.sort((a, b) => b.ms - a.ms)
  console.log(`\n─── deno budget: ${rows.length} ${title} over 1ms ───`)
  for (let o of rows) {
    console.log(
      `  ${String(Math.round(o.ms)).padStart(6)}ms  ${
        named ? `${o.name}  (${o.file})` : o.file
      }`,
    )
  }
}

if (import.meta.main) {
  let child = new Deno.Command('deno', {
    args: ['task', 'test', '--all', '--tag=deno'],
    stdout: 'piped',
    stderr: 'inherit',
  }).spawn()

  let dec = new TextDecoder()
  let buf = ''
  let { read, tests, loads } = reader()
  for await (let chunk of child.stdout) {
    await Deno.stdout.write(chunk)
    buf += dec.decode(chunk, { stream: true })
    let lines = buf.split('\n')
    buf = lines.pop() ?? ''
    lines.forEach(read)
  }
  read(buf)

  let { code } = await child.status
  listed('file loads', loads, false)
  listed('tests', tests, true)
  if (code !== 0) Deno.exit(code)
  if (Deno.env.get('TASKS_FAST_STRICT') && (tests.length || loads.length)) {
    Deno.exit(1)
  }
}
