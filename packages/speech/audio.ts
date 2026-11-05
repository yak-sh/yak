// Raw audio between formats: 16-bit PCM at one rate as μ-law at a lower one,
// for a provider whose voice speaks PCM to a telephone line.
// https://www.itu.int/rec/T-REC-G.711

let BIAS = 0x84, CLIP = 32635

/** One 16-bit sample as G.711 μ-law. */
export let mulawOf = (sample: number): number => {
  let sign = sample < 0 ? 0x80 : 0
  let s = Math.min(Math.abs(sample), CLIP) + BIAS
  let exponent = 7
  for (let mask = 0x4000; !(s & mask) && exponent > 0; mask >>= 1) exponent--
  let mantissa = (s >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

/**
 * A stream of little-endian 16-bit PCM at `from` Hz as μ-law at `to` Hz,
 * `from` a whole multiple of `to`: each `from / to` samples are averaged
 * into one, and a chunk that ends mid-sample waits for the next.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { mulawed } from '@yaks/speech'
 * let pcm = new Uint8Array(new Int16Array([0, 0, 0, 1000, 1000, 1000]).buffer)
 * let out = new Uint8Array(
 *   await new Response(
 *     new Response(pcm).body!.pipeThrough(mulawed(24000, 8000)),
 *   ).arrayBuffer(),
 * )
 * equal(out.length, 2)
 * ```
 */
export let mulawed = (
  from: number,
  to: number,
): TransformStream<Uint8Array, Uint8Array> => {
  let step = from / to
  if (!Number.isInteger(step) || step < 1) {
    throw new Error(`${from} Hz is not a whole multiple of ${to} Hz`)
  }
  let held = new Uint8Array(0)
  return new TransformStream({
    transform(chunk, out) {
      let bytes = new Uint8Array(held.length + chunk.length)
      bytes.set(held)
      bytes.set(chunk, held.length)
      let whole = Math.floor(bytes.length / (2 * step))
      let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
      let samples = new Uint8Array(whole)
      for (let i = 0; i < whole; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) {
          sum += view.getInt16((i * step + j) * 2, true)
        }
        samples[i] = mulawOf(Math.round(sum / step))
      }
      held = bytes.slice(whole * 2 * step)
      if (whole) out.enqueue(samples)
    },
  })
}

/** Bytes as base64, the way a JSON stream carries audio. */
export let base64 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

/** Base64 as bytes. */
export let unbase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
