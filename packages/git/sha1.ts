// SHA-1 with its state left open between chunks — the one digest in this
// package that is not `crypto.subtle`'s.
//
// A pack ends in the SHA-1 of every byte before it, and a pack is a STREAM:
// objects arrive one at a time and leave as soon as they are deflated.
// `crypto.subtle.digest` wants the whole message in one buffer, so naming a
// pack with it would mean holding the finished pack in memory to write twenty
// bytes at the end — a clone's worth of bytes, for a trailer. Here the digest
// is fed as the stream goes by, so a pack of any size costs one 64-byte block.
//
// SHA-1 is a NAME here and never a security claim, the same as the object ids
// in ./oid.ts: it is what the pack format spells, so it is what we write.
//
// The algorithm is FIPS 180-4 §6.1.2 verbatim, in 32-bit integer arithmetic:
// `| 0` after every addition is what keeps a JavaScript number a machine word.

/** A digest being taken: bytes in, the twenty that name them out. */
export type Sha1 = {
  /** fold another run of bytes in */
  update: (bytes: Uint8Array) => void
  /** pad, finish, and answer the twenty bytes — once */
  digest: () => Uint8Array<ArrayBuffer>
}

let rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n))

/** A SHA-1 in progress. */
export let sha1 = (): Sha1 => {
  let h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  let block = new Uint8Array(64)
  let view = new DataView(block.buffer)
  let w = new Uint32Array(80)
  let at = 0 // bytes waiting in the block
  let len = 0 // bytes seen, all told

  // One 64-byte block: the message schedule, then eighty rounds of it.
  let round = () => {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4)
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }
    let [a, b, c, d, e] = h
    for (let i = 0; i < 80; i++) {
      let f = i < 20
        ? (b & c) | (~b & d)
        : i < 40
        ? b ^ c ^ d
        : i < 60
        ? (b & c) | (b & d) | (c & d)
        : b ^ c ^ d
      let k = i < 20
        ? 0x5a827999
        : i < 40
        ? 0x6ed9eba1
        : i < 60
        ? 0x8f1bbcdc
        : 0xca62c1d6
      let t = (rotl(a, 5) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = t
    }
    h = [h[0] + a | 0, h[1] + b | 0, h[2] + c | 0, h[3] + d | 0, h[4] + e | 0]
  }

  let update = (bytes: Uint8Array) => {
    len += bytes.length
    for (let i = 0; i < bytes.length;) {
      let n = Math.min(64 - at, bytes.length - i)
      block.set(bytes.subarray(i, i + n), at)
      at += n
      i += n
      if (at == 64) {
        round()
        at = 0
      }
    }
  }

  let one = new Uint8Array(1)
  let pad = new Uint8Array(64)

  let digest = (): Uint8Array<ArrayBuffer> => {
    // The length is the message's, so it is read before the padding adds to it.
    let bits = len * 8
    one[0] = 0x80
    update(one)
    update(pad.subarray(0, (56 - at + 64) % 64))
    view.setUint32(56, Math.floor(bits / 0x100000000))
    view.setUint32(60, bits >>> 0)
    round()
    at = 0
    let out = new Uint8Array(20)
    let name = new DataView(out.buffer)
    h.forEach((x, i) => name.setUint32(i * 4, x >>> 0))
    return out
  }

  return { update, digest }
}
