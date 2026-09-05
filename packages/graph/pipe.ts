// Sync pass-through. Every seam in this package is async-OR-sync: a storage
// adapter over an embedded database answers immediately, one over a network
// answers with a promise, and the same pipeline has to serve both. So instead
// of making everything `async` (which would turn every embedded write into a
// promise, and every caller into an `await`), each step is threaded with
// `then`: a promise is awaited, a plain value flows straight through.
//
// The rule that falls out: a pipeline built only from synchronous parts stays
// synchronous end to end, and the first asynchronous part turns the rest of
// that one run into a promise chain. Nothing in between needs to know which.

/** Whether a value is thenable — the test `then` and `each` branch on. */
export let isPromise = <T>(v: T | Promise<T>): v is Promise<T> =>
  !!v && typeof (v as Promise<T>).then == 'function'

/**
 * Apply `f` to a value that may still be in flight: a promise is awaited, a
 * plain value is passed straight in, and the result is a promise only when the
 * input was one. The one primitive behind this package's sync pass-through.
 */
export let then = <A, B>(
  v: A | Promise<A>,
  f: (a: A) => B,
): B | Promise<Awaited<B>> =>
  isPromise(v)
    ? v.then(f) as Promise<Awaited<B>>
    : f(v) as B | Promise<Awaited<B>>

/**
 * Fold over `items` one at a time, awaiting a step only when it returns a
 * promise. While every step answers synchronously this is a plain loop; the
 * first promise defers the remaining items into a promise chain, so a long
 * synchronous batch never grows the stack.
 */
export let each = <T, A>(
  items: T[],
  seed: A,
  step: (acc: A, item: T) => A | Promise<A>,
): A | Promise<A> => {
  let acc: A | Promise<A> = seed
  for (let i = 0; i < items.length; i++) {
    if (isPromise(acc)) {
      let rest = items.slice(i)
      return acc.then((a) => each(rest, a, step))
    }
    acc = step(acc, items[i])
  }
  return acc
}

/**
 * Run `fn` over each item in order, for effect, awaiting only the steps that
 * are asynchronous. {@link each} without an accumulator.
 */
export let over = <T>(
  items: T[],
  fn: (item: T) => unknown,
): null | Promise<null> =>
  each(items, null, (_, item) => then(fn(item), () => null))
