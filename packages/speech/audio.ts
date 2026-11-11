// Raw audio between formats: 16-bit PCM at one rate as μ-law at a lower one,
// for a provider whose voice speaks PCM to a telephone line, and μ-law with
// the silence around its sound trimmed.
// https://www.itu.int/rec/T-REC-G.711

import type { Raw } from './mod.ts'

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

// A μ-law sample this close to silence, below about -48 dBFS: exponent 0.
let quiet = (b: number) => (b & 0x7f) >= 0x70

/**
 * Whether raw samples hold a sound louder than a quiet line, about -36 dBFS:
 * μ-law of exponent 4 or more, or 16-bit PCM over 512.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { sounds } from '@yaks/speech'
 * equal(sounds(new Uint8Array([0xff, 0x7f, 0xc5]), { encoding: 'mulaw', rate: 8000 }), false)
 * equal(sounds(new Uint8Array([0xff, 0x10]), { encoding: 'mulaw', rate: 8000 }), true)
 * let pcm = new Uint8Array(new Int16Array([40, -600]).buffer)
 * equal(sounds(pcm, { encoding: 'linear16', rate: 24000 }), true)
 * ```
 */
export let sounds = (bytes: Uint8Array, format: Raw): boolean => {
  if (format.encoding == 'mulaw') return bytes.some((b) => (b & 0x7f) < 0x40)
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (Math.abs(view.getInt16(i, true)) > 512) return true
  }
  return false
}

/**
 * A quiet line as long as `bytes`, in their format.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { muted, sounds } from '@yaks/speech'
 * let mulaw = { encoding: 'mulaw', rate: 8000 } as const
 * let quiet = muted(new Uint8Array([0x10, 0x20, 0x30]), mulaw)
 * equal([quiet.length, sounds(quiet, mulaw)], [3, false])
 * ```
 */
export let muted = (bytes: Uint8Array, format: Raw): Uint8Array =>
  new Uint8Array(bytes.length).fill(format.encoding == 'mulaw' ? 0xff : 0)

/**
 * A stream of μ-law at `rate` Hz without the silence before its first sound
 * and after its last, but `keep` seconds of each. A provider pads every
 * clip it speaks, and speaking faster never shortens the padding, so a call
 * said a sentence at a time would pause the same between sentences at any
 * speed. Silence between sounds passes as it was, once the next sound comes.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { trimmed } from '@yaks/speech'
 * let clip = new Uint8Array([0xff, 0xff, 0xff, 0x10, 0xff, 0x10, 0xff, 0xff])
 * let out = new Uint8Array(
 *   await new Response(
 *     new Response(clip).body!.pipeThrough(trimmed(1, 1)),
 *   ).arrayBuffer(),
 * )
 * equal([...out], [0xff, 0x10, 0xff, 0x10, 0xff])
 * ```
 */
export let trimmed = (
  rate: number,
  keep = 0.05,
): TransformStream<Uint8Array, Uint8Array> => {
  let margin = Math.round(rate * keep)
  let started = false
  // The quiet run since the last sound, held until a sound follows it.
  let held: number[] = []
  return new TransformStream({
    transform(chunk, out) {
      let sent: number[] = []
      for (let b of chunk) {
        if (quiet(b)) {
          held.push(b)
          continue
        }
        sent.push(...(started ? held : held.slice(-margin)), b)
        held = []
        started = true
      }
      if (sent.length) out.enqueue(new Uint8Array(sent))
    },
    flush(out) {
      if (started && held.length) {
        out.enqueue(new Uint8Array(held.slice(0, margin)))
      }
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
