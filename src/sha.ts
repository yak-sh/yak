// What a precondition compares, and what an edge is NAMED by, defined ONCE.
// `apply()` hashes the stored value and the caller hashes the value it read; if
// the two ends computed the hash with different code, a guard could pass or
// refuse for no reason the caller can see. db.ts owns the rule, mcp.ts hands
// agents their token, and edge.ts derives an edge's eid from its sentence — so
// the function lives here rather than in any of them.
//
// A column holds text, a number or a bool in one slot, so String() is the
// single normalization both ends apply. null is never hashed: it IS the
// sentinel for "I read no value", which is how expected-absent compares equal
// without colliding with the hash of some value.
//
// SHA-256 written out rather than taken from `node:crypto`, because the BROWSER
// hashes too now: a client that mints an edge computes its eid, and a node
// builtin has no import-map answer on a page (browser_test walks the served
// graph for exactly this). WebCrypto is async and a guard token is read inline,
// so the algorithm itself is the portable answer. ~1µs per short value, which
// is the same order as the native call once the FFI hop is counted.

// FIPS 180-4 §4.2.2: the first 32 bits of the fractional parts of the cube
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

let utf8 = new TextEncoder()
let w = new Uint32Array(64)
let hex = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

// The digest of the bytes, as lowercase hex — the one shape every caller uses.
export let sha256 = (bytes: Uint8Array): string => {
  // Padding: the message, a 1 bit, zeros, then the 64-bit bit-length.
  let len = bytes.length
  let blocks = ((len + 8) >> 6) + 1
  let buf = new Uint8Array(blocks << 6)
  buf.set(bytes)
  buf[len] = 0x80
  let bits = len * 8
  // The length is 64 bits; a JS number carries 53, so the high word is the
  // overflow above 2^32 rather than a shift (which would wrap at 32).
  new DataView(buf.buffer).setUint32(buf.length - 8, Math.floor(bits / 2 ** 32))
  new DataView(buf.buffer).setUint32(buf.length - 4, bits >>> 0)
  // The first 32 bits of the fractional parts of the square roots of the first
  // eight primes.
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19
  for (let i = 0; i < buf.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      let j = i + t * 4
      w[t] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) |
        buf[j + 3]
    }
    for (let t = 16; t < 64; t++) {
      let a = w[t - 15], b = w[t - 2]
      let s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      let s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let t = 0; t < 64; t++) {
      let S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7))
      let ch = (e & f) ^ (~e & g)
      let t1 = (h + S1 + ch + K[t] + w[t]) >>> 0
      let S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10))
      let maj = (a & b) ^ (a & c) ^ (b & c)
      let t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }
  let out = ''
  for (let v of [h0, h1, h2, h3, h4, h5, h6, h7]) {
    out += hex[(v >>> 24) & 0xff] + hex[(v >>> 16) & 0xff] +
      hex[(v >>> 8) & 0xff] + hex[v & 0xff]
  }
  return out
}

export let sha = (v: unknown) => sha256(utf8.encode(String(v)))
