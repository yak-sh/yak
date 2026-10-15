// SHA-256 as a state carried from one piece of bytes to the next. An upload in
// parts is checked against its file's hash as each part passes (parts.ts), so
// the whole is never read back to be hashed: each part is hashed on from the
// state the bytes before it left, and the states chain. WebCrypto hashes only
// bytes held whole in memory and gives no state to carry, so this is FIPS
// 180-4 written out: the same digest, as lowercase hex, and the same state the
// served client records at each part's start (workers/yak/public/client.js).

// The first 32 bits of the fractional parts of the cube roots of the first 64
// primes.
let K = new Uint32Array([
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
])

/** The state before any bytes, SHA-256's initial hash value, as hex. */
export let START =
  '6a09e667bb67ae853c6ef372a54ff53a510e527f9b05688c1f83d9ab5be0cd19'

let hex = (h: Uint32Array) =>
  [...h].map((v) => v.toString(16).padStart(8, '0')).join('')

let words = (state: string) => {
  if (!/^[0-9a-f]{64}$/.test(state)) throw new Error(`no state: ${state}`)
  return Uint32Array.from(
    { length: 8 },
    (_, i) => parseInt(state.slice(i * 8, i * 8 + 8), 16),
  )
}

// Each 64-byte block of `b` from `at` to `end` folded into `h`.
let blocks = (
  h: Uint32Array,
  w: Uint32Array,
  b: Uint8Array,
  at: number,
  end: number,
) => {
  for (let i = at; i < end; i += 64) {
    for (let t = 0; t < 16; t++) {
      let j = i + t * 4
      w[t] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]
    }
    for (let t = 16; t < 64; t++) {
      let x = w[t - 15], y = w[t - 2]
      let s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      let s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^
        (y >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
    }
    let [a, b1, c, d, e, f, g, k] = h
    for (let t = 0; t < 64; t++) {
      let S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7))
      let t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0
      let S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10))
      let t2 = (S0 + ((a & b1) ^ (a & c) ^ (b1 & c))) | 0
      k = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b1
      b1 = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b1
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += k
  }
}

/** Bytes hashed a piece at a time: `add` each, then `end` once. */
export type Hasher = {
  add: (bytes: Uint8Array) => void
  end: (total?: number) => string
}

/**
 * Bytes hashed on from `from`, a piece at a time with `add`. `end()` answers
 * the state after them, which only whole 64-byte blocks leave; given `total`,
 * the length of everything hashed since {@link START}, it answers the
 * finished digest instead.
 */
export let hasher = (from = START): Hasher => {
  let h = words(from)
  let w = new Uint32Array(64)
  let carry = new Uint8Array(64)
  let held = 0
  return {
    add: (b: Uint8Array) => {
      let at = 0
      if (held) {
        at = Math.min(64 - held, b.length)
        carry.set(b.subarray(0, at), held)
        held += at
        if (held < 64) return
        blocks(h, w, carry, 0, 64)
        held = 0
      }
      let whole = b.length - ((b.length - at) % 64)
      blocks(h, w, b, at, whole)
      carry.set(b.subarray(whole))
      held = b.length - whole
    },
    end: (total?: number) => {
      if (total == null) {
        if (held) throw new Error('a state is only left by whole blocks')
        return hex(h)
      }
      // What was left, a 1 bit, zeros, and the length in bits as 64.
      let tail = new Uint8Array(held < 56 ? 64 : 128)
      tail.set(carry.subarray(0, held))
      tail[held] = 0x80
      let view = new DataView(tail.buffer)
      view.setUint32(tail.length - 8, Math.floor(total / 2 ** 29))
      view.setUint32(tail.length - 4, (total * 8) >>> 0)
      blocks(h, w, tail, 0, tail.length)
      return hex(h)
    },
  }
}

/**
 * `bytes` hashed on from `from`: the state after them, or with `total`, the
 * digest of everything hashed since {@link START}.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { address, encode, fold, START } from '@yaks/blob'
 *
 * let text = 'a'.repeat(64) + 'and the rest'
 * let half = fold(START, encode('a'.repeat(64)))
 * equal(fold(half, encode('and the rest'), 76), address(text))
 * equal(fold(START, encode(text), 76), address(text))
 * ```
 */
export let fold = (from: string, bytes: Uint8Array, total?: number): string => {
  let h = hasher(from)
  h.add(bytes)
  return h.end(total)
}
