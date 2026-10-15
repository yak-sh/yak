/** The audible region of one decoded clip, in seconds. */
export interface Audible {
  offset: number
  dur: number
}
/** Independent keyed voices that may steal only their own previous action. */
export interface OneShots {
  prune(): void
  play(voice: Voice, key?: string): void
}
/** A URL-addressed audio cache, isolated by audio context. */
export interface Clips {
  loaded(ctx: BaseAudioContext, url: string | URL): AudioBuffer | undefined
  load(ctx: AudioContext, url: string | URL): Promise<AudioBuffer | null>
}

// URL-addressed audio clips, fallback voices and seamless loops.
let loops = new WeakMap<AudioBuffer, AudioBuffer>()

// Analyze one-shots without changing the buffer loops and music share.
let bounds = new WeakMap<AudioBuffer, { offset: number; dur: number }>()
export let audible = (buffer: AudioBuffer): Audible => {
  let cached = bounds.get(buffer)
  if (cached) return cached
  let channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, ch) => buffer.getChannelData(ch),
  )
  let peak = 0
  for (let data of channels) {
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]))
    }
  }
  // Ignore codec noise, but keep quiet clips and their attack and decay.
  let threshold = Math.max(0.0001, peak * 0.01)
  let heard = (i: number) =>
    channels.some((data) => Math.abs(data[i]) >= threshold)
  // The sound runs from the first sample heard to the last, each found by
  // walking in from its end of the clip.
  let first = 0, last = buffer.length - 1
  while (first <= last && !heard(first)) first++
  while (last > first && !heard(last)) last--
  let found = first > last ? { offset: 0, dur: 0 } : {
    offset: first / buffer.sampleRate,
    dur: (last + 1 - first) / buffer.sampleRate,
  }
  bounds.set(buffer, found)
  return found
}

/** Overlap a recording's end with its start, then loop at adjacent samples. */
export let blendLoop = (
  input: Float32Array,
  fade: number,
): Float32Array<ArrayBuffer> => {
  let length = input.length - fade
  let output = input.slice(0, length)
  for (let i = 0; i < fade; i++) {
    let mix = (i + 1) / (fade + 1)
    output[i] = input[length + i] * (1 - mix) + input[i] * mix
  }
  return output
}

/** A decoded ambient clip made seamless once, shared by its nearby sources. */
export let looping = (ctx: AudioContext, source: AudioBuffer): AudioBuffer => {
  let cached = loops.get(source)
  if (cached) return cached
  let fade = Math.min(
    Math.floor(source.sampleRate * 0.7),
    Math.floor(source.length / 4),
  )
  if (!fade) return source
  let out = ctx.createBuffer(
    source.numberOfChannels,
    source.length - fade,
    source.sampleRate,
  )
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    out.copyToChannel(blendLoop(source.getChannelData(ch), fade), ch)
  }
  loops.set(source, out)
  return out
}

/** A sound: how long it lasts in seconds, how loud it is at its source, and
 * how it is made into `o`. */
export type Voice = {
  dur: number
  loud: number
  key?: string
  play: (o: AudioNode) => void | (() => void)
}

// One voice per action at a source; independent actions can sound together.
// The gate also silences procedural voices when their next event steals them.
export let oneShots = (into: AudioNode): OneShots => {
  let playing = new Map<string, { until: number; end: () => void }>()
  let prune = () => {
    for (let [key, shot] of playing) {
      if (shot.until > into.context.currentTime) continue
      shot.end()
      playing.delete(key)
    }
  }
  return {
    prune,
    play: (v: Voice, key = v.key ?? 'action') => {
      prune()
      playing.get(key)?.end()
      let gate = into.context.createGain()
      gate.connect(into)
      let stop = v.play(gate)
      playing.set(key, {
        until: into.context.currentTime + v.dur + 0.05,
        end: () => {
          gate.disconnect()
          stop?.()
        },
      })
    },
  }
}

export let recorded = (
  buffer: AudioBuffer,
  fallback: Voice,
  gain: number,
  key: string,
): Voice => {
  let { offset, dur: length } = audible(buffer)
  if (!length) return { ...fallback, key }
  let dur = Math.min(length, fallback.dur)
  return {
    dur,
    loud: fallback.loud,
    key,
    play: (into) => {
      let c = into.context, at = c.currentTime
      let s = new AudioBufferSourceNode(c, { buffer })
      let g = c.createGain()
      g.gain.setValueAtTime(gain, at)
      g.gain.setValueAtTime(gain, at + Math.max(0, dur - 0.008))
      g.gain.linearRampToValueAtTime(0, at + dur)
      s.connect(g).connect(into)
      let ended = false
      s.onended = () => {
        ended = true
        s.disconnect()
        g.disconnect()
      }
      s.start(at, offset, dur)
      return () => {
        if (!ended) s.stop()
      }
    },
  }
}

type State = {
  buffers: Map<string, AudioBuffer>
  pending: Map<string, Promise<AudioBuffer | null>>
}

/** Decode URL-addressed clips once per context. Failures leave callers' fallback
 * voices in use and may be retried; pending requests are shared. */
export let clips = (failed: (error: unknown) => void = reportError): Clips => {
  let states = new WeakMap<BaseAudioContext, State>()
  let state = (ctx: BaseAudioContext) => {
    let found = states.get(ctx)
    if (found) return found
    let made: State = { buffers: new Map(), pending: new Map() }
    states.set(ctx, made)
    return made
  }
  let loaded = (ctx: BaseAudioContext, url: string | URL) =>
    state(ctx).buffers.get(String(url))
  let load = (ctx: AudioContext, url: string | URL) => {
    let s = state(ctx), key = String(url)
    let ready = loaded(ctx, key)
    if (ready) return Promise.resolve(ready)
    let pending = s.pending.get(key)
    if (pending) return pending
    let work = (async () => {
      try {
        let response = await fetch(url)
        if (!response.ok) throw new Error(`Sound ${url}: ${response.status}`)
        let buffer = await ctx.decodeAudioData(await response.arrayBuffer())
        audible(buffer)
        s.buffers.set(key, buffer)
        return buffer
      } catch (error) {
        failed(error)
        return null
      } finally {
        s.pending.delete(key)
      }
    })()
    s.pending.set(key, work)
    return work
  }
  return { loaded, load }
}
