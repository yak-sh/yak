// A seat as the directory said it, kept a moment for everyone who asks
// (build.ts `#seat`). An Operator's page socket stands by its person's seat as
// it is now, on every frame in and every delivery out (operator-api.ts
// `authorize`), and every tab of theirs asks again when a deploy drops it.
// Asked of the directory each time, that is the one object every page reads
// asked a hundred times for one answer: here it is read once for every ask
// within `SEATED` of it, and asks while it is read share the read.
import { type Clock, system } from '@yaks/fp'

/** How long a seat the directory said stands for every ask of it: a person
 * taken off a space hears nothing more within it. */
export let SEATED = 10_000

/** `read`, kept: each ask with the same `key` within `SEATED` of the read is
 * answered by it. An answer that `gives` nothing is not kept, so a seat just
 * given is read at once, and nor is a read that failed. */
export let seated = <A extends unknown[], T>(
  key: (...args: A) => string,
  read: (...args: A) => Promise<T>,
  gives: (answer: T) => boolean,
  clock: () => Clock = () => system,
) => {
  let kept = new Map<string, { at: number; answer: Promise<T> }>()
  return (...args: A): Promise<T> => {
    let k = key(...args), now = clock().now()
    let held = kept.get(k)
    if (held && now - held.at < SEATED) return held.answer
    let answer = read(...args)
    kept.set(k, { at: now, answer })
    let drop = () => {
      if (kept.get(k)?.answer == answer) kept.delete(k)
    }
    answer.then((a) => gives(a) || drop(), drop)
    return answer
  }
}
