// Runs collected tests one at a time, in the order they were declared, and
// says how each went in the lines `deno test` prints (`name ... ok (12ms)`),
// which what watches a run reads.
import type { Test } from './suite.ts'

/** How one test went. */
export type Outcome = {
  test: Test
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
  if (test.skip) return { test, ok: true, skipped: true, ms: 0, errors: [] }
  let start = now()
  let timer: ReturnType<typeof later> | undefined
  let errors: unknown[] = []
  try {
    await Promise.race([
      (async () => await test.body())(),
      new Promise((_, no) =>
        timer = later(
          () => no(new Error(`the test did not end within ${timeout}ms`)),
          timeout,
        )
      ),
    ])
  } catch (error) {
    errors.push(error)
  } finally {
    cancel(timer)
  }
  errors.push(...stray.splice(0))
  return { test, ok: !errors.length, skipped: false, ms: now() - start, errors }
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

let shown = (error: unknown) =>
  error instanceof Error ? error.stack ?? String(error) : Deno.inspect(error)

/**
 * The closing report: every failure with its errors, then the counts, the
 * files left out as unchanged since they passed, and what the run spent
 * before its first test and loading its files.
 */
export let summary = (
  outcomes: Outcome[],
  ms: number,
  { left = 0, planned = 0, loading = 0 } = {},
) => {
  let failed = outcomes.filter((o) => !o.ok)
  let passed = outcomes.filter((o) => o.ok && !o.skipped).length
  let ignored = outcomes.filter((o) => o.skipped).length
  let text = ''
  if (failed.length) {
    text += `\n${paint(31, 'ERRORS')}\n\n`
    for (let o of failed) {
      text += `${o.test.name} => ${at(o.test.file)}\n`
      for (let e of o.errors) text += `${shown(e)}\n`
      text += '\n'
    }
    text += `${paint(31, 'FAILURES')}\n\n`
    for (let o of failed) text += `${o.test.name} => ${at(o.test.file)}\n`
  }
  text += `\n${failed.length ? paint(31, 'FAILED') : paint(32, 'ok')} | ${
    [
      `${passed} passed`,
      `${failed.length} failed`,
      ...ignored ? [`${ignored} ignored`] : [],
      ...left ? [`${left} unchanged since they passed`] : [],
    ].join(' | ')
  } ${paint(90, `(${took(ms)})`)}\n${
    paint(90, `planned in ${took(planned)}, loaded in ${took(loading)}`)
  }\n`
  say(text)
}
