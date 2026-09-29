// SHA-256, in about sixty lines, because the precondition check has to be
// synchronous. The platform's own digest (`crypto.subtle.digest`) returns a
// promise, and hashing through it would make every guarded write async —
// including one over an embedded database that is otherwise synchronous end to
// end (see ./pipe.ts). A precondition hashes a handful of small strings per
// change, so the cost of hashing them here is nothing next to making the whole
// pipeline asynchronous.
//
// This is FIPS 180-4 SHA-256 over the UTF-8 bytes of a string, hex-encoded —
// the same digest `crypto.subtle.digest('SHA-256', …)` produces, and the same
// one any other implementation produces, since a precondition token travels
// between a reader and a writer that share no code.

// The round constants: the first 32 bits of the fractional parts of the cube
// roots of the first 64 primes.
let K = new Int32Array([
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

let rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

let encoder = new TextEncoder()
let ASCII = /^\p{ASCII}*$/u

// The buffer a message is padded into, kept between calls up to a size worth
// keeping; a longer message gets one of its own.
let kept = new Uint8Array(256)

// The padded message: the string's UTF-8 bytes, a 1 bit, zeros, and the bit
// length as a 64-bit big-endian tail, rounded up to whole 64-byte blocks. An
// ASCII string, which nearly every eid and token is, is its own bytes, copied
// without a trip through the encoder.
let padded = (input: string): Uint8Array => {
  let ascii = ASCII.test(input)
  let bytes = ascii ? null : encoder.encode(input)
  let len = bytes ? bytes.length : input.length
  let size = (((len + 8) >> 6) + 1) << 6
  let out = size <= kept.length ? kept : new Uint8Array(size)
  if (bytes) out.set(bytes)
  else for (let i = 0; i < len; i++) out[i] = input.charCodeAt(i)
  out.fill(0, len, size)
  out[len] = 0x80
  let bits = len * 8
  let hi = Math.floor(bits / 0x100000000), lo = bits >>> 0
  for (let i = 0; i < 4; i++) {
    out[size - 8 + i] = hi >>> (24 - 8 * i)
    out[size - 4 + i] = lo >>> (24 - 8 * i)
  }
  return out.subarray(0, size)
}

// Each byte as two hex digits.
let HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

// The initial hash value: the first 32 bits of the fractional parts of the
// square roots of the first 8 primes.
let IV = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
]

// The state and the message schedule, kept between calls: a digest runs to
// completion synchronously, so one of each serves every call, and a call
// allocates nothing per block. Every derived eid and precondition token is a
// digest, so this loop is on every write's path.
let h = new Int32Array(8)
let w = new Int32Array(64)

/**
 * The SHA-256 of a string's UTF-8 bytes, as lowercase hex. Synchronous by
 * design — the `$was` precondition hashes with it inside a transaction that
 * must not be forced to become a promise.
 */
export let sha256 = (input: string): string => {
  let msg = padded(input)
  h.set(IV)
  for (let at = 0; at < msg.length; at += 64) {
    for (let i = 0, j = at; i < 16; i++, j += 4) {
      w[i] = (msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) |
        msg[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      let a = w[i - 15], b = w[i - 2]
      let s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      let s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = w[i - 16] + s0 + w[i - 7] + s1
    }
    let a = h[0], b = h[1], c = h[2], d = h[3]
    let e = h[4], f = h[5], g = h[6], hh = h[7]
    for (let i = 0; i < 64; i++) {
      let S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      let ch = (e & f) ^ (~e & g)
      let t1 = (hh + S1 + ch + K[i] + w[i]) | 0
      let S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      let maj = (a & b) ^ (a & c) ^ (b & c)
      let t2 = (S0 + maj) | 0
      hh = g, g = f, f = e, e = (d + t1) | 0
      d = c, c = b, b = a, a = (t1 + t2) | 0
    }
    h[0] += a, h[1] += b, h[2] += c, h[3] += d
    h[4] += e, h[5] += f, h[6] += g, h[7] += hh
  }
  let hex = ''
  for (let i = 0; i < 8; i++) {
    let x = h[i]
    hex += HEX[x >>> 24] + HEX[(x >>> 16) & 255] + HEX[(x >>> 8) & 255] +
      HEX[x & 255]
  }
  return hex
}
