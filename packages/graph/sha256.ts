// SHA-256, in about sixty lines, because the precondition guard has to be
// SYNCHRONOUS. The platform's own digest (`crypto.subtle.digest`) is
// promise-only, and hashing through it would make every guarded write async —
// including one over an embedded database that is otherwise synchronous end to
// end (see ./pipe.ts). A guard is a handful of small strings per batch, so the
// cost of hashing them here is nothing next to losing sync pass-through.
//
// This is FIPS 180-4 SHA-256 over the UTF-8 bytes of a string, hex-encoded —
// the same digest `crypto.subtle.digest('SHA-256', …)` produces, and the same
// one any other implementation produces, since a precondition token travels
// between a reader and a writer that share no code.

// The round constants: the first 32 bits of the fractional parts of the cube
// roots of the first 64 primes.
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

let rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

// The padded message: the bytes, a 1 bit, zeros, and the bit length as a
// 64-bit big-endian tail, rounded up to whole 64-byte blocks.
let padded = (bytes: Uint8Array): Uint8Array => {
  let len = bytes.length
  let out = new Uint8Array((((len + 8) >> 6) + 1) << 6)
  out.set(bytes)
  out[len] = 0x80
  let bits = len * 8
  let view = new DataView(out.buffer)
  view.setUint32(out.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(out.length - 4, bits >>> 0)
  return out
}

let encoder = new TextEncoder()

/**
 * The SHA-256 of a string's UTF-8 bytes, lowercase hex. Synchronous by design
 * — the `$was` precondition hashes with it inside a transaction that may not
 * become a promise.
 */
export let sha256 = (input: string): string => {
  let msg = padded(encoder.encode(input))
  let h = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  let w = new Uint32Array(64)
  let view = new DataView(msg.buffer)
  for (let at = 0; at < msg.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4)
    for (let i = 16; i < 64; i++) {
      let a = w[i - 15], b = w[i - 2]
      let s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      let s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      let S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      let ch = (e & f) ^ (~e & g)
      let t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      let S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      let maj = (a & b) ^ (a & c) ^ (b & c)
      let t2 = (S0 + maj) >>> 0
      hh = g, g = f, f = e, e = (d + t1) >>> 0
      d = c, c = b, b = a, a = (t1 + t2) >>> 0
    }
    let next = [a, b, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = (h[i] + next[i]) >>> 0
  }
  let hex = ''
  for (let x of h) hex += x.toString(16).padStart(8, '0')
  return hex
}
