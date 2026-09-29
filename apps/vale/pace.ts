// When to paint the world: keep its simulation on the screen's clock while
// limiting expensive scene draws to the rate the player chose.
/** Draw at most `rate` frames each second, without drifting behind the screen.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let draw = pace()
 * assertEquals([0, 8, 17, 25, 34].filter((t) => draw(t, 60)), [0, 17, 34])
 * let slower = pace()
 * assertEquals([0, 17, 34, 50, 67].filter((t) => slower(t, 30)), [0, 34, 67])
 * ```
 */
export let pace = () => {
  let next = 0
  return (now: number, rate: number): boolean => {
    if (now + 1 < next) return false
    let step = 1000 / rate
    next = Math.max(next + step, now + step / 2)
    return true
  }
}
