// What a test says it expects. Each check returns what it checked, so it
// reads as a value (`let row = ok(rows[0])`), and a failure throws with the
// difference shown.
import {
  assert,
  assertEquals,
  AssertionError,
  equal as same,
} from '@std/assert'

let object = (v: unknown): v is Record<string, unknown> =>
  typeof v == 'object' && v !== null

type Node = { nodeType: number; outerHTML?: string; textContent: unknown }

// A DOM node, linkedom's or a browser's. Its properties link the whole
// document, so showing them never ends; a failure shows its markup instead.
let node = (v: object): v is Node =>
  typeof (v as Node).nodeType == 'number' && 'textContent' in v

// `v` as a failure shows it: each DOM node within its arrays, plain objects,
// maps and sets as the node's markup, the rest as it is.
let shown = (v: unknown, path = new Set<object>()): unknown => {
  if (!object(v) || path.has(v)) return v
  if (node(v)) return v.outerHTML ?? v.textContent
  let within = new Set(path).add(v)
  let show = (x: unknown) => shown(x, within)
  return Array.isArray(v)
    ? v.map(show)
    : v instanceof Map
    ? new Map([...v].map(([k, x]) => [show(k), show(x)]))
    : v instanceof Set
    ? new Set([...v].map(show))
    : [Object.prototype, null].includes(Object.getPrototypeOf(v))
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, show(x)]))
    : v
}

// `actual` is `expected`, or a failure shows how they differ. Values unequal
// yet shown alike (two nodes with one markup) say so.
let check = (actual: unknown, expected: unknown, message?: string) => {
  if (same(actual, expected)) return
  let [a, b] = [shown(actual), shown(expected)]
  assertEquals(a, b, message)
  throw new AssertionError(
    `Values are not equal, though they show alike${
      message ? `: ${message}` : '.'
    }\n${Deno.inspect(a, { depth: 4 })}`,
  )
}

/**
 * Deep equality: `actual` is `expected`, structurally.
 *
 * ```ts
 * equal({ a: [1, 2] }, { a: [1, 2] })
 * ```
 */
export let equal = <T>(actual: T, expected: T, message?: string): T => {
  check(actual, expected, message)
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

// `actual`, cut to the shape of `pattern`: a key the pattern leaves out is
// left out, a RegExp that tests true and a class the value is an instance of
// become the pattern itself, so what remains compares by equality and a
// failure shows only the difference that matters. Only arrays and plain
// objects are cut: an instance in a pattern (a date, a class's) is a value,
// and so is a function with no prototype (an arrow), which is never a class.
let cut = (actual: unknown, pattern: unknown): unknown =>
  pattern instanceof RegExp && !(actual instanceof RegExp)
    ? pattern.test(String(actual)) ? pattern : actual
    : typeof pattern == 'function' && pattern.prototype
    ? actual instanceof pattern ? pattern : actual
    : !object(pattern) || !object(actual) || !Object.keys(pattern).length
    ? actual
    : Array.isArray(pattern)
    ? Array.isArray(actual) ? pattern.map((p, i) => cut(actual[i], p)) : actual
    : ![Object.prototype, null].includes(Object.getPrototypeOf(pattern))
    ? actual
    : Object.fromEntries(
      Object.entries(pattern).map(([k, p]) => [k, cut(actual[k], p)]),
    )

/**
 * A partial match: every key `pattern` names holds in `actual`, and every
 * item of a pattern array in the item at its index. A RegExp tests a value's
 * text and a class tests an instance; an empty array or object asks for an
 * empty one, and the rest is equality: an instance's, and an arrow's.
 *
 * ```ts
 * match({ id: 7, name: 'Ada', tags: ['a', 'b'] }, { name: /^A/, tags: ['a'] })
 * let twice = (n: number) => n * 2
 * match({ at: new Date(0), of: twice }, { at: Date, of: twice })
 * match({ at: new Date(0) }, { at: new Date(0) })
 * ```
 */
export let match = <T>(actual: T, pattern: unknown, message?: string): T => {
  check(cut(actual, pattern), pattern, message)
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
