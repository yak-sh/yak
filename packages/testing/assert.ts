// What a test says it expects. Each check returns what it checked, so it
// reads as a value (`let row = ok(rows[0])`), and a failure throws with the
// difference shown.
import { assert, assertEquals, AssertionError } from '@std/assert'

/**
 * Deep equality: `actual` is `expected`, structurally.
 *
 * ```ts
 * equal({ a: [1, 2] }, { a: [1, 2] })
 * ```
 */
export let equal = <T>(actual: T, expected: T, message?: string): T => {
  assertEquals(actual, expected, message)
  return actual
}

/**
 * Truthiness: `actual` holds, and comes back.
 *
 * ```ts
 * ok([1].find((n) => n == 1)) // 1
 * ```
 */
export let ok = <T>(actual: T, message?: string): NonNullable<T> => {
  assert(actual, message)
  return actual
}

let object = (v: unknown): v is Record<string, unknown> =>
  typeof v == 'object' && v !== null

// `actual`, cut to the shape of `pattern`: a key the pattern leaves out is
// left out, a RegExp that tests true and a class the value is an instance of
// become the pattern itself, so what remains compares by equality and a
// failure shows only the difference that matters.
let cut = (actual: unknown, pattern: unknown): unknown =>
  pattern instanceof RegExp && !(actual instanceof RegExp)
    ? pattern.test(String(actual)) ? pattern : actual
    : typeof pattern == 'function'
    ? actual instanceof pattern ? pattern : actual
    : !object(pattern) || !object(actual) || !Object.keys(pattern).length
    ? actual
    : Array.isArray(pattern)
    ? Array.isArray(actual) ? pattern.map((p, i) => cut(actual[i], p)) : actual
    : Object.fromEntries(
      Object.entries(pattern).map(([k, p]) => [k, cut(actual[k], p)]),
    )

/**
 * A partial match: every key `pattern` names holds in `actual`, and every
 * item of a pattern array in the item at its index. A RegExp tests a value's
 * text and a class tests an instance; an empty array or object asks for an
 * empty one, and the rest is equality.
 *
 * ```ts
 * match({ id: 7, name: 'Ada', tags: ['a', 'b'] }, { name: /^A/, tags: ['a'] })
 * ```
 */
export let match = <T>(actual: T, pattern: unknown, message?: string): T => {
  assertEquals(cut(actual, pattern), pattern, message)
  return actual
}

/**
 * `fn` throws, or rejects, with an error whose message includes `message`
 * (or matches it, a RegExp). The error comes back.
 *
 * ```ts
 * await throws(() => JSON.parse('{'), 'JSON')
 * ```
 */
export let throws = async (
  fn: () => unknown,
  message?: string | RegExp,
): Promise<unknown> => {
  try {
    await fn()
  } catch (error) {
    let said = error instanceof Error ? error.message : String(error)
    let fits = message === undefined ||
      (message instanceof RegExp ? message.test(said) : said.includes(message))
    if (!fits) {
      throw new AssertionError(`threw "${said}", expected ${message}`)
    }
    return error
  }
  throw new AssertionError(`did not throw${message ? ` ${message}` : ''}`)
}
