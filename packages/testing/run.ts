// Runs collected tests one at a time, in the order they were declared, and
// says how each went in the lines `deno test` prints (`name ... ok (12ms)`),
// which what watches a run reads.
import { closing, type Test } from './suite.ts'

/** How one test went. */
export type Outcome = {
  test: Omit<Test, 'body'>
  ok: boolean
  skipped: boolean
  ms: number
  errors: unknown[]
}

// The clock and timers a test cannot fake: @std/testing's FakeTime swaps the
// globals while a test runs.
let now = performance.now.bind(performance)
let later = setTimeout
let cancel = clearTimeout

/// took(0.25) -> '250µs'
/// took(12.4) -> '12ms'
/// took(1500) -> '1s'
/// took(152_000) -> '2m32s'
/** A duration as `deno test` prints one. */
export let took = (ms: number) =>
  ms < 1
    ? `${Math.round(ms * 1000)}µs`
    : ms < 1000
    ? `${Math.round(ms)}ms`
    : ms < 60_000
    ? `${Math.floor(ms / 1000)}s`
    : `${Math.floor(ms / 60_000)}m${Math.floor(ms % 60_000 / 1000)}s`

// A rejection nobody handled, or an error nobody caught, fails the test
// running when it surfaces, which is the nearest a single runtime can place
// it: often the test that left it, sometimes the one after.
let stray: unknown[] = []
let heard = (error: unknown) => stray.push(error)
globalThis.addEventListener?.('unhandledrejection', (e) => {
  e.preventDefault()
  heard(e.reason)
})
globalThis.addEventListener?.('error', (e) => {
  e.preventDefault()
  heard(e.error)
})

/** Runs one test, failing it once `timeout` passes without an end. */
export let one = async (test: Test, timeout: number): Promise<Outcome> => {
  let { body, ...reported } = test
  if (test.skip) {
    return { test: reported, ok: true, skipped: true, ms: 0, errors: [] }
  }
  let timer: ReturnType<typeof later> | undefined
  let errors: unknown[] = []
  // The deadline is set before the clock starts: a test's time is its own,
  // not the runner's, and a runtime's first timer costs a third of a
  // millisecond, which the first test to await would otherwise pay.
  let late = new Promise((_, no) =>
    timer = later(
      () => no(new Error(`the test did not end within ${timeout}ms`)),
      timeout,
    )
  )
  let start = now()
  try {
    await Promise.race([closing(body), late])
  } catch (error) {
    errors.push(error)
  } finally {
    cancel(timer)
  }
  errors.push(...stray.splice(0))
  return {
    test: reported,
    ok: !errors.length,
    skipped: false,
    ms: now() - start,
    errors,
  }
}

/// at('a_test.ts') -> './a_test.ts'
/// at('/tmp/a_test.ts') -> '/tmp/a_test.ts'
/** A file as a run names it: from the checkout, or whole outside it. */
export let at = (path: string) => path.startsWith('/') ? path : `./${path}`

let bytes = new TextEncoder()
let say = (text: string) => {
  let b = bytes.encode(text)
  while (b.length) b = b.subarray(Deno.stdout.writeSync(b))
}
let colored = Deno.stdout.isTerminal() && !Deno.env.get('NO_COLOR')
let paint = (code: number, text: string) =>
  colored ? `\x1b[${code}m${text}\x1b[0m` : text

/** How a test went, said after its name: `ok (12ms)`. */
export let how = (o: Outcome) =>
  `${
    o.skipped
      ? paint(33, 'ignored')
      : o.ok
      ? paint(32, 'ok')
      : paint(31, 'FAILED')
  } ${paint(90, `(${took(o.ms)})`)}\n`

/// running(9, 'a_test.ts', 12.4) -> 'running 9 tests from ./a_test.ts (loaded in 12ms)'
/** A file's header: how many of its tests run, and what loading it took. */
export let running = (count: number, path: string, loaded: number) =>
  `running ${count} tests from ${at(path)} (loaded in ${took(loaded)})`

/**
 * Runs the tests of one file, `loaded` being what loading it took. A test's
 * name is said as it starts and how it went ends the line, so what watches a
 * run knows which test it waits on.
 */
export let file = async (
  path: string,
  tests: Test[],
  timeout: number,
  loaded = 0,
): Promise<Outcome[]> => {
  if (!tests.length) return []
  say(paint(90, `${running(tests.length, path, loaded)}\n`))
  let out: Outcome[] = []
  for (let t of tests) {
    say(`${t.name} ... `)
    let o = await one(t, timeout)
    say(how(o))
    out.push(o)
  }
  return out
}

/** What a run took, in milliseconds: the whole of it, its planning and its
 * loading, each file's load and each test that ran; each file it remembered
 * as passed, by its key (./deps.ts), so a caller holding the run to more than
 * passing can take a pass back; and how many tests it skipped and files it
 * left out as unchanged since they passed. */
export type Times = {
  wall: number
  planned: number
  loading: number
  loads: Record<string, number>
  remembered: Record<string, string>
  ignored: number
  left: number
  tests: { file: string; name: string; ms: number; ok: boolean }[]
}

/** A run's times, as `--times` writes them: skipped tests took nothing. */
export let timed = (
  outcomes: Outcome[],
  run: Omit<Times, 'tests' | 'ignored'>,
): Times => ({
  ...run,
  ignored: outcomes.filter((o) => o.skipped).length,
  tests: outcomes.filter((o) => !o.skipped).map((o) => ({
    file: o.test.file,
    name: o.test.name,
    ms: o.ms,
    ok: o.ok,
  })),
})

let shown = (error: unknown) =>
  error instanceof Error ? error.stack ?? String(error) : Deno.inspect(error)

// This package's own modules: the runner's frames sit under every test's,
// and an assertion's or a wait's atop the line that called it.
let RUNNER = ['run', 'suite', 'main', 'load', 'assert', 'wait']
  .map((m) => new URL(`./${m}.ts`, import.meta.url).href)

/** The most of one error the closing report says, unless `--verbose`. */
export let LINES = 30

/// brief('Error: no\n\n\n  at f (file:///r/a_test.ts:2:1)\n  at g (ext:core/x.js:1:1)', 'file:///r/') -> 'Error: no\n\n  at f (a_test.ts:2:1)'
/// brief('a\nb\nc', 'file:///r/', 2) -> 'a\nb\n… 1 more line (--verbose says it whole)'
/**
 * An error as the closing report says it: its stack holds only the frames in
 * the checkout `root`, from it, and no more than one blank line in a row;
 * then it is cut to `lines`. A frame in a dependency, the runtime or this
 * package is never where a test failed, and its call site in the checkout
 * stays.
 */
export let brief = (text: string, root: string, lines = LINES) => {
  let kept = text.split('\n').filter((l, i, all) =>
    /^\s+at /.test(l)
      ? l.includes(root) && !RUNNER.some((m) => l.includes(m))
      : l.trim() || all[i - 1]?.trim()
  ).map((l) => l.replaceAll(root, ''))
  let more = kept.length - lines
  return more > 0
    ? [
      ...kept.slice(0, lines),
      `… ${more} more line${more == 1 ? '' : 's'} (--verbose says it whole)`,
    ].join('\n')
    : kept.join('\n')
}

/**
 * The closing report: every failure with its errors, then the counts and the
 * files left out as unchanged since they passed. Each error is `brief`;
 * `verbose` says each whole, then names the failures again and what the run
 * spent before its first test and loading its files.
 */
export let summary = (
  outcomes: Outcome[],
  ms: number,
  { left = 0, planned = 0, loading = 0 } = {},
  verbose = false,
) => {
  let failed = outcomes.filter((o) => !o.ok)
  let passed = outcomes.filter((o) => o.ok && !o.skipped).length
  let ignored = outcomes.filter((o) => o.skipped).length
  let root = `file://${Deno.cwd()}/`
  let text = ''
  if (failed.length) {
    text += `\n${paint(31, 'ERRORS')}\n\n`
    for (let o of failed) {
      text += `${o.test.name} => ${at(o.test.file)}\n`
      for (let e of o.errors) {
        text += `${verbose ? shown(e) : brief(shown(e), root)}\n`
      }
      text += '\n'
    }
    if (verbose) {
      text += `${paint(31, 'FAILURES')}\n\n`
      for (let o of failed) text += `${o.test.name} => ${at(o.test.file)}\n`
    }
  }
  text += `\n${failed.length ? paint(31, 'FAILED') : paint(32, 'ok')} | ${
    [
      `${passed} passed`,
      `${failed.length} failed`,
      ...ignored ? [`${ignored} ignored`] : [],
      ...left ? [`${left} unchanged since they passed`] : [],
    ].join(' | ')
  } ${paint(90, `(${took(ms)})`)}\n`
  if (verbose) {
    text += `${
      paint(90, `planned in ${took(planned)}, loaded in ${took(loading)}`)
    }\n`
  }
  say(text)
}
