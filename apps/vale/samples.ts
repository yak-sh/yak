// Hosted builder outputs name every sound clip. A missing or undecodable
// blob leaves the procedural voice in place.
let clips: Record<string, string> = {}

/** Every output a build now holds for a sound, each with the sound it was
 * built for (`build.for`) and its clip, which ride beside it. */
export let SOUNDS = '.built.current=true&.built.artifact' +
  '&.built.build.build.variant=main&.fields=built.build.build.for.sfx.name,' +
  'built.artifact.artifact.address,built.artifact.artifact.media_type'

export type Row = {
  entity: { eid: string }
  built?: { build: string; artifact?: string }
  build?: { for?: string }
  sfx?: { name: string }
  artifact?: { address: string; media_type: string }
}

/** The clip of each sound, from {@link SOUNDS}' rows: an audio clip, for a
 * sound. */
export let catalog = (rows: Row[]): Record<string, string> => {
  let at = new Map(rows.map((row) => [row.entity.eid, row]))
  return Object.fromEntries(rows.flatMap(({ built }) => {
    let made = built && at.get(built.build)?.build?.for
    let name = made && at.get(made)?.sfx?.name
    let blob = built?.artifact && at.get(built.artifact)?.artifact
    return name && blob && blob.media_type.startsWith('audio/')
      ? [[name, blob.address]]
      : []
  }))
}

let waiting = new Map<string, Set<(hash: string) => void>>()
let watching: Promise<void> | null = null
// Each sound row's name, by its eid, as the store has them.
let named = new Map<string, string>()

/** The name of the sound row an eid names (a creature's `sounds`), once the
 * store has said; until then a sound plays its procedural voice. */
export let nameOf = (sfx: string): string | undefined => {
  void watch()
  return named.get(sfx)
}

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
      subscribe('.sfx', (rows: Row[]) => {
        named = new Map(rows.map((row) => [row.entity.eid, row.sfx!.name]))
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
