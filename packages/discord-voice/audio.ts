// The relay's audio, as pure steps: what everyone in a Discord voice room
// said, mixed into the one track a host hears, and what the host says, made
// into what Discord plays. Discord carries 48 kHz stereo; the host's line
// (@yaks/discord `line`) carries 24 kHz mono. Samples are 16-bit little
// endian throughout.

/** Samples a channel carries in one of Discord's 20 ms frames. */
export let FRAME = 960

/** Bytes of one of Discord's 20 ms frames: 960 stereo 16-bit samples. */
export let FRAME_BYTES = FRAME * 2 * 2

let clamp = (n: number) => n > 32767 ? 32767 : n < -32768 ? -32768 : n

let samples = (bytes: Uint8Array) =>
  new Int16Array(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + (bytes.length & ~1),
    ),
  )

let bytesOf = (s: Int16Array) => new Uint8Array(s.buffer)

/**
 * One 20 ms frame of 48 kHz stereo from each speaker, mixed into 24 kHz
 * mono: each pair of stereo samples averaged, everyone summed, and each two
 * of those averaged. A speaker who sent nothing is left out; nobody at all
 * is silence.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { FRAME, mixed } from '@yaks/discord-voice'
 * let tone = (v: number) => new Uint8Array(new Int16Array(FRAME * 2).fill(v).buffer)
 * let out = new Int16Array(mixed([tone(100), tone(50)]).buffer)
 * equal([out.length, out[0], out[479]], [480, 150, 150])
 * equal(new Int16Array(mixed([]).buffer).every((s) => s == 0), true)
 * equal(new Int16Array(mixed([tone(30000), tone(30000)]).buffer)[0], 32767)
 * ```
 */
export let mixed = (frames: Uint8Array[]): Uint8Array => {
  let out = new Int16Array(FRAME / 2)
  let all = frames.map(samples)
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (let s of all) {
      let at = i * 4
      sum += ((s[at] ?? 0) + (s[at + 1] ?? 0) + (s[at + 2] ?? 0) +
        (s[at + 3] ?? 0)) / 4
    }
    out[i] = clamp(Math.round(sum))
  }
  return bytesOf(out)
}

/**
 * What turns the host's 24 kHz mono into Discord's 48 kHz stereo, a chunk at
 * a time: each sample, then the one halfway to the next, in both channels.
 * The last sample of a chunk waits for the first of the next, and an odd
 * byte for its other half.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { widener } from '@yaks/discord-voice'
 * let widen = widener()
 * let pcm = (...s: number[]) => new Uint8Array(new Int16Array(s).buffer)
 * let read = (b: Uint8Array) => [...new Int16Array(b.buffer)]
 * equal(read(widen(pcm(0, 100))), [0, 0, 50, 50])
 * equal(read(widen(pcm(200))), [100, 100, 150, 150])
 * equal(read(widen.flush()), [200, 200, 200, 200])
 * ```
 */
export let widener = () => {
  let last: number | undefined
  let odd: number | undefined
  let widen = (chunk: Uint8Array): Uint8Array => {
    let bytes = chunk
    if (odd != undefined) {
      bytes = new Uint8Array(chunk.length + 1)
      bytes.set([odd])
      bytes.set(chunk, 1)
    }
    odd = bytes.length % 2 ? bytes[bytes.length - 1] : undefined
    let s = samples(bytes)
    let all = last == undefined ? [...s] : [last, ...s]
    if (!all.length) return new Uint8Array(0)
    last = all[all.length - 1]
    let out = new Int16Array((all.length - 1) * 4)
    for (let i = 0; i + 1 < all.length; i++) {
      let a = all[i], half = Math.round((a + all[i + 1]) / 2)
      out.set([a, a, half, half], i * 4)
    }
    return bytesOf(out)
  }
  return Object.assign(widen, {
    /** the sample still waiting, said twice */
    flush: () => {
      let at = last
      last = undefined
      odd = undefined
      return at == undefined
        ? new Uint8Array(0)
        : bytesOf(Int16Array.of(at, at, at, at))
    },
  })
}

/**
 * A queue of bytes cut into frames of `size`: what is put in comes out a
 * whole frame at a time, the rest waiting for more, or drained as a last
 * frame padded with silence.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { frames } from '@yaks/discord-voice'
 * let q = frames(4)
 * q.put(new Uint8Array([1, 2, 3, 4, 5, 6]))
 * equal([q.take(), q.take(), q.length()], [new Uint8Array([1, 2, 3, 4]), undefined, 2])
 * equal(q.drain(), new Uint8Array([5, 6, 0, 0]))
 * q.put(new Uint8Array([7]))
 * q.clear()
 * equal([q.length(), q.drain()], [0, undefined])
 * ```
 */
export let frames = (size: number) => {
  let held: Uint8Array[] = []
  let length = 0
  return {
    put: (bytes: Uint8Array) => {
      if (!bytes.length) return
      held.push(bytes)
      length += bytes.length
    },
    take: (): Uint8Array | undefined => {
      if (length < size) return undefined
      let out = new Uint8Array(size)
      let at = 0
      while (at < size) {
        let first = held[0]
        let n = Math.min(size - at, first.length)
        out.set(first.subarray(0, n), at)
        at += n
        if (n == first.length) held.shift()
        else held[0] = first.subarray(n)
      }
      length -= size
      return out
    },
    /** what is left, short of a frame, padded to one with zeros */
    drain: (): Uint8Array | undefined => {
      if (!length) return undefined
      let out = new Uint8Array(size)
      let at = 0
      for (let b of held) {
        out.set(b, at)
        at += b.length
      }
      held = []
      length = 0
      return out
    },
    length: () => length,
    clear: () => {
      held = []
      length = 0
    },
  }
}

/** What the host sends the relay, read (@yaks/discord `line`): audio to
 * play, a stop to what is playing, or a mark to echo once what came before
 * it has played. */
export type Sent =
  | { audio: Uint8Array }
  | { clear: true }
  | { mark: string }
  | Record<string, never>

/**
 * A frame the host sent, read.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { sent } from '@yaks/discord-voice'
 * equal(sent('{"event":"media","payload":"AQI="}'), { audio: new Uint8Array([1, 2]) })
 * equal(sent('{"event":"clear"}'), { clear: true })
 * equal(sent('{"event":"mark","name":"m1"}'), { mark: 'm1' })
 * equal(sent('nonsense'), {})
 * ```
 */
export let sent = (data: string): Sent => {
  let f: { event?: string; payload?: string; name?: string }
  try {
    f = JSON.parse(data)
  } catch {
    return {}
  }
  if (f.event == 'media' && f.payload) {
    return { audio: Uint8Array.from(atob(f.payload), (c) => c.charCodeAt(0)) }
  }
  if (f.event == 'clear') return { clear: true }
  if (f.event == 'mark') return { mark: String(f.name ?? '') }
  return {}
}

let base64 = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

/** The frames the relay sends the host (@yaks/discord `line`). */
export let say = {
  start: (call: string) => JSON.stringify({ event: 'start', call }),
  media: (audio: Uint8Array) =>
    JSON.stringify({ event: 'media', payload: base64(audio) }),
  speaking: (user: string) => JSON.stringify({ event: 'speaking', user }),
  mark: (name: string) => JSON.stringify({ event: 'mark', name }),
  stop: () => JSON.stringify({ event: 'stop' }),
}

/** What the host asks of the relay: join a voice room with the session
 * Discord gave the bot there, streaming its audio over `stream`. */
export type Join = {
  server: string
  room: string
  /** the bot's own account */
  me: string
  session: string
  endpoint: string
  token: string
  /** the `wss://` address the room's audio streams to */
  stream: string
}

/**
 * A join the host asked for, read, or why it cannot be: every field must be
 * a string, and the stream must go to one of the `hosts` the relay serves.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { joined } from '@yaks/discord-voice'
 * let join = { server: 's', room: 'r', me: 'm', session: 'x', endpoint: 'e', token: 't', stream: 'wss://yaks.app/discord/stream?call=1' }
 * equal(joined(join, ['yaks.app']), join)
 * equal(joined({ ...join, stream: 'wss://evil.example/x' }, ['yaks.app']), 'The stream goes to evil.example, which this relay does not serve.')
 * equal(joined({ server: 's' }, ['yaks.app']), 'A join needs room, me, session, endpoint, token and stream.')
 * ```
 */
export let joined = (body: unknown, hosts: string[]): Join | string => {
  let b = (body ?? {}) as Record<string, unknown>
  let fields = [
    'server',
    'room',
    'me',
    'session',
    'endpoint',
    'token',
    'stream',
  ] as const
  let missing = fields.filter((f) => typeof b[f] != 'string' || !b[f])
  if (missing.length) {
    return `A join needs ${
      missing.length == 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`
    }.`
  }
  let url: URL
  try {
    url = new URL(String(b.stream))
  } catch {
    return 'The stream is not an address.'
  }
  if (url.protocol != 'wss:' || !hosts.includes(url.hostname)) {
    return `The stream goes to ${url.hostname}, which this relay does not serve.`
  }
  return Object.fromEntries(fields.map((f) => [f, String(b[f])])) as Join
}
