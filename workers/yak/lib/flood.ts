// A flood guard, not a quota: how many times a key may pass in a minute,
// counted in this isolate and no further. Something looping must not write a
// thousand entities a second; a key spread over many isolates passing a few
// extra times is the harmless direction to err.

/** Whether `key` has passed more than `rate` times this minute.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { flood } from './flood.ts'
 *
 * let over = flood(2)
 * equal([over('a'), over('a'), over('a'), over('b')], [false, false, true, false])
 * ```
 */
export let flood = (rate: number) => {
  let counted = new Map<string, { minute: number; n: number }>()
  return (key: string): boolean => {
    let minute = Math.floor(Date.now() / 60_000)
    let hit = counted.get(key)
    if (!hit || hit.minute != minute) {
      counted.set(key, { minute, n: 1 })
      return false
    }
    return ++hit.n > rate
  }
}
