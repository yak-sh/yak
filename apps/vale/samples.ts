// Hosted builder outputs supply every sound clip. A missing or undecodable
// blob leaves the procedural voice in place.
let clips: Record<string, string> = {}

/** Each chosen main recording, with its sound row and clip beside it. */
export let SOUNDS = '.built.current=true&.built.artifact' +
  '&.built.build.build.variant=main&.fields=built.current,' +
  'built.build.build.variant,built.build.build.for.sfx.name,' +
  'built.build.build.for.built.build,' +
  'built.artifact.artifact.address,built.artifact.artifact.media_type'

export type Row = {
  entity: { eid: string }
  built?: { build: string; artifact?: string; current?: boolean }
  build?: { for?: string; variant?: string }
  sfx?: { name: string }
  artifact?: { address: string; media_type: string }
}

/** Recordings by sound eid. Seed sounds also have their fixed game names;
 * generated takes share names, so their names never select a recording. */
export let catalog = (rows: Row[]): Record<string, string> => {
  let at = new Map(rows.map((row) => [row.entity.eid, row]))
  return Object.fromEntries(rows.flatMap(({ built }) => {
    let build = built && at.get(built.build)?.build
    if (!built?.current || build?.variant != 'main') return []
    let made = build.for, sound = made ? at.get(made) : undefined
    if (!made || !sound?.sfx) return []
    let name = sound.sfx.name
    let blob = built?.artifact && at.get(built.artifact)?.artifact
    return blob && blob.media_type.startsWith('audio/')
      ? [[made, blob.address], ...sound.built ? [] : [[name, blob.address]]]
      : []
  }))
}

let waiting = new Map<string, Set<(hash: string) => void>>()
let watching: Promise<void> | null = null
/** Accept the current catalogue delivered by the store subscription. */
export let accept = (rows: Row[]) => {
  let current = catalog(rows)
  for (let name of Object.keys(clips)) {
    if (!(name in current)) delete clips[name]
  }
  for (let [name, hash] of Object.entries(current)) {
    clips[name] = hash
    for (let ready of waiting.get(name) ?? []) ready(hash)
    waiting.delete(name)
  }
}

/** Follow hosted outputs so a rebuilt description is heard on the next play. */
export let watch = () => {
  if (watching) return watching
  watching = import(new URL('api/client.js', document.baseURI).href)
    .then(({ subscribe }) => {
      subscribe(SOUNDS, (rows: Row[]) => {
        accept(rows)
      })
    })
    .catch((error) => {
      watching = null
      reportError(error)
    })
  return watching
}

let address = (name: string): Promise<string> => {
  if (clips[name]) return Promise.resolve(clips[name])
  void watch()
  return new Promise((ready) => {
    let group = waiting.get(name) ?? new Set()
    group.add(ready)
    waiting.set(name, group)
  })
}

type State = {
  buffers: Map<string, { hash: string; buffer: AudioBuffer }>
  pending: Map<string, Promise<AudioBuffer | null>>
}
let states = new WeakMap<BaseAudioContext, State>()
let loops = new WeakMap<AudioBuffer, AudioBuffer>()
let state = (ctx: BaseAudioContext) => {
  let found = states.get(ctx)
  if (found) return found
  let made: State = { buffers: new Map(), pending: new Map() }
  states.set(ctx, made)
  return made
}

export let loaded = (ctx: BaseAudioContext, name: string) =>
  state(ctx).buffers.get(name)?.hash == clips[name]
    ? state(ctx).buffers.get(name)?.buffer
    : undefined

// Analyze one-shots without changing the buffer loops and music share.
let bounds = new WeakMap<AudioBuffer, { offset: number; dur: number }>()
export let audible = (buffer: AudioBuffer) => {
  let cached = bounds.get(buffer)
  if (cached) return cached
  let channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, ch) => buffer.getChannelData(ch),
  )
  let peak = 0
  for (let data of channels) {
    for (let value of data) {
      peak = Math.max(peak, Math.abs(value))
    }
  }
  // Ignore codec noise, but keep quiet clips and their attack and decay.
  let threshold = Math.max(0.0001, peak * 0.01)
  let first = buffer.length, last = -1
  for (let data of channels) {
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) < threshold) continue
      first = Math.min(first, i)
      last = Math.max(last, i)
    }
  }
  let found = {
    offset: last < 0 ? 0 : first / buffer.sampleRate,
    dur: last < 0 ? 0 : (last + 1 - first) / buffer.sampleRate,
  }
  bounds.set(buffer, found)
  return found
}

/** Overlap a recording's end with its start, then loop at adjacent samples. */
export let blendLoop = (input: Float32Array, fade: number) => {
  let length = input.length - fade
  let output = input.slice(0, length)
  for (let i = 0; i < fade; i++) {
    let mix = (i + 1) / (fade + 1)
    output[i] = input[length + i] * (1 - mix) + input[i] * mix
  }
  return output
}

/** A decoded ambient clip made seamless once, shared by its nearby sources. */
export let looping = (ctx: AudioContext, source: AudioBuffer) => {
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

export let load = (ctx: AudioContext, name: string) => {
  let s = state(ctx)
  let ready = loaded(ctx, name)
  if (ready) return Promise.resolve(ready)
  let pending = s.pending.get(name)
  if (pending) return pending
  let work = (async () => {
    try {
      let hash = await address(name)
      let response = await fetch(
        new URL(`api/blob/${hash}`, document.baseURI),
      )
      if (!response.ok) throw new Error(`Sound ${name}: ${response.status}`)
      let buffer = await ctx.decodeAudioData(await response.arrayBuffer())
      if (clips[name] != hash) return null
      audible(buffer)
      s.buffers.set(name, { hash, buffer })
      return buffer
    } catch (error) {
      reportError(error)
      return null
    } finally {
      s.pending.delete(name)
    }
  })()
  s.pending.set(name, work)
  return work
}
