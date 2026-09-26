// Randomness every page agrees on. The vale is built from these numbers, not
// sent: two players on two phones grow the same hills and the same trees
// because they hash the same coordinates.

/** A 32-bit hash of up to three integers.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(hash(3, 4, 5), hash(3, 4, 5))
 * ```
 */
export let hash = (x: number, y = 0, z = 0): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

/** {@link hash} as a number in [0, 1). */
export let rand = (x: number, y = 0, z = 0): number =>
  hash(x, y, z) / 4294967296

/** A string's hash, to seed from an eid or a name. */
export let hashOf = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  return h >>> 0
}

/** A UUID named by a string: the same wherever it is made from the same name,
 * for the things a level grows, which every page names alike.
 *
 * ```ts
 * import { assertEquals, assertMatch, assertNotEquals } from '@std/assert'
 * assertEquals(uuidOf('mossvale/slime/1'), uuidOf('mossvale/slime/1'))
 * assertNotEquals(uuidOf('mossvale/slime/1'), uuidOf('mossvale/slime/2'))
 * assertMatch(uuidOf('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
 * ```
 */
export let uuidOf = (name: string): string => {
  let r = stream(hashOf(name))
  let b = Array.from({ length: 16 }, () => Math.floor(r() * 256))
  b[6] = (b[6] & 0x0f) | 0x80
  b[8] = (b[8] & 0x3f) | 0x80
  let h = b.map((n) => n.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`
}

/** A seeded stream of numbers in [0, 1) (mulberry32). */
export let stream = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

let ease = (t: number) => t * t * (3 - 2 * t)

/** Value noise in [0, 1), smooth in both directions.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * let v = noise(1.5, 2.25)
 * assert(v >= 0 && v < 1)
 * ```
 */
export let noise = (x: number, y: number, seed = 0): number => {
  let xi = Math.floor(x), yi = Math.floor(y)
  let u = ease(x - xi), v = ease(y - yi)
  let a = rand(xi, yi, seed), b = rand(xi + 1, yi, seed)
  let c = rand(xi, yi + 1, seed), d = rand(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Octaves of {@link noise}, each twice as fine and half as loud. */
export let fbm = (x: number, y: number, seed = 0, octaves = 4): number => {
  let sum = 0, amp = 0.5, f = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f, seed + i * 17)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

/** `t` eased between 0 at `a` and 1 at `b`. */
export let smooth = (a: number, b: number, t: number): number =>
  ease(Math.min(1, Math.max(0, (t - a) / (b - a))))

export let lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export let clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v
