// Builder plans also run inside synchronous SQLite transactions. Yield only
// when an adapter actually returns a promise, never merely because a plan reads.
import { isPromise } from '@yaks/fp'

export function* step<T>(
  value: T | Promise<T>,
): Generator<unknown, T, unknown> {
  return (yield value) as T
}

export let steps = <T>(
  make: () => Generator<unknown, T, unknown>,
): T | Promise<T> => {
  let iterator = make()
  let next = (value?: unknown): T | Promise<T> => {
    let result = iterator.next(value)
    while (!result.done) {
      if (isPromise(result.value)) return result.value.then(next)
      result = iterator.next(result.value)
    }
    return result.value
  }
  return next()
}
