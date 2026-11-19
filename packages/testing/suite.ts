// The words a test module declares its tests in, and the list they land in.
// A module only declares: the runner (./main.ts) collects what every module
// it loads declares and runs the lot in one runtime. A module loaded by
// anything else, `deno test` or an editor, hands each test to Deno.test.
import * as assertions from './assert.ts'

/** A test's tags, which a run is filtered by, and whether it is skipped. */
export type Options = { tags?: string[]; skip?: boolean }

/** One declared test. `file` is the module the runner was loading. */
export type Test = {
  name: string
  body: () => unknown
  tags: string[]
  skip: boolean
  file: string
}

let tests: Test[] | undefined
let file = ''
// Whether a stack has been read since the module now loading was named.
let mapped = false

/** Starts collecting: every test declared from now on lands in the list
 * returned, instead of going to Deno.test. */
export let collect = (): Test[] => tests = []

/** Names the module whose declarations follow, and opens its scope
 * (`afterAll`). */
export let from = (path: string) => {
  file = path
  mapped = false
  leaving = tests ? [] : undefined
}

/**
 * Declares a test: a name, a body that throws or rejects to fail, and the
 * tags a run can pick it by.
 *
 * ```ts ignore
 * test('two and two', () => equal(2 + 2, 4))
 * test('the whole shop', async () => ok(await shop()), { tags: ['kernel'] })
 * ```
 */
export let test = (
  name: string,
  body: () => unknown,
  { tags = [], skip = false }: Options = {},
): void => {
  if (tests) {
    // The first stack read that holds a module's frame reads the module's
    // source map, half a millisecond, once. A module declares from its own
    // frame, so the map is read here, in its load, rather than by whichever
    // of its tests first reports an error.
    mapped ||= !!Error().stack
    tests.push({ name, body, tags, skip, file })
  } else {
    globalThis.Deno?.test({ name, ignore: skip, fn: () => closing(body) })
  }
}

// What the running test asked to have done once it ends (`cleanup`), and
// what the file the runner loaded last asked to have done once its tests
// have run (`afterAll`).
let ending: (() => unknown)[] | undefined
let leaving: (() => unknown)[] | undefined

/**
 * Asks for `done` once the running test ends, before its time is taken, so
 * a test pays for closing what it opened and leaves nothing running into
 * the next one. Outside a test, it is the file's (`afterAll`). Outside the
 * runner and any test it does nothing, and answers false.
 *
 * ```ts ignore
 * let fixture = () => {
 *   let db = open()
 *   cleanup(() => db.close())
 *   return db
 * }
 * ```
 */
export let cleanup = (done: () => unknown): boolean => {
  let scope = ending ?? leaving
  scope?.push(done)
  return !!scope
}

/**
 * Asks for `done` once the file the runner loaded last has run its tests,
 * whichever of them asks. A runtime keeps every module it loads, and what a
 * module holds: a kernel a file opened for its tests would otherwise run on,
 * holding every store it made, beside every file the runtime loads after.
 * Outside the runner it does nothing, and answers false.
 *
 * ```ts ignore
 * let shared: Promise<Kernel> | undefined
 * let kernel = () => {
 *   if (!shared) afterAll(async () => (await shared)?.close())
 *   return shared ??= boot()
 * }
 * ```
 */
export let afterAll = (done: () => unknown): boolean => {
  leaving?.push(done)
  return !!leaving
}

/** What the file the runner loaded last asked for with `afterAll`, run last
 * asked first; none when it asked for nothing. The scope closes: the file
 * asks for no more. */
export let left = (): (() => Promise<void>) | undefined => {
  let asked = leaving
  leaving = undefined
  return asked?.length ? () => settle(asked) : undefined
}

/** Runs a test's body, then what it asked to have done once it ends, last
 * asked first. A body's failure is the test's; else the first cleanup's. */
export let closing = async (body: () => unknown): Promise<void> => {
  let was = ending
  let asked: (() => unknown)[] = ending = []
  let failed: { error: unknown } | undefined
  try {
    await body()
  } catch (error) {
    failed = { error }
  } finally {
    ending = was
  }
  await settle(asked, failed)
}

// Runs what a scope asked for, last asked first: the scope's failure, or else
// the first of theirs, is thrown once all have run.
let settle = async (
  asked: (() => unknown)[],
  failed?: { error: unknown },
): Promise<void> => {
  for (let done of asked.reverse()) {
    try {
      await done()
    } catch (error) {
      failed ??= { error }
    }
  }
  if (failed) throw failed.error
}

/** Declares one clause of a suite; `it.skip` declares it skipped. */
export type It =
  & ((name: string, body: () => unknown, options?: Options) => void)
  & { skip: (name: string, body: () => unknown) => void }

/** What a suite's body declares with: `it`, and the assertions. */
export type Spec = typeof assertions & { it: It }

/**
 * Declares a group of tests under one name, each clause named after it and
 * carrying its tags. A body that throws declares a failing test instead.
 *
 * ```ts ignore
 * suite('sum', ({ it, equal }) => {
 *   it('adds', () => equal(sum([1, 2]), 3))
 *   it('of nothing is zero', () => equal(sum([]), 0))
 * })
 * ```
 */
export let suite = (
  name: string,
  body: (spec: Spec) => void,
  options: Options = {},
): void => {
  let it: It = Object.assign(
    (what: string, fn: () => unknown, more: Options = {}) =>
      test(`${name} › ${what}`, fn, {
        tags: [...options.tags ?? [], ...more.tags ?? []],
        skip: options.skip || more.skip,
      }),
    { skip: (what: string, fn: () => unknown) => it(what, fn, { skip: true }) },
  )
  try {
    body({ ...assertions, it })
  } catch (error) {
    test(`${name} › declares its tests`, () => {
      throw error
    }, options)
  }
}
