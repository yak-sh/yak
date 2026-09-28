// Generated effects are blobs in the vale's store. The listening set is pinned
// here; hosted builders supply the rest through their output rows. A missing
// or undecodable blob leaves the procedural voice in place.
export let SAMPLES: Record<string, string> = {
  campfire: '92e3de164ac57f9806a300a9e50f0f48568f7f3fd3c65064c6729c5a7eb3b204',
  forge: '579c76352d873716929daf518eebd007471c463d67f1ac237310ffbf39b37248',
  hammer: '410000827723e43c197861e59ee1045fead0f8ec34503e1f80294a3bfbd41c35',
  sword: 'fa331f1e59bd6e42fadbe184c5f6c424640d57103ad93aa3de1e5e26e534e0d5',
  spell: 'f39d94d4680b9fd6b85e8ccad2919848718f7fc18696e73c346479302550ca0b',
  wolf: 'd5a019cc0df66f1cc3e2ca5a049235b12678f78595d7fd0759058623a1b3911c',
}

type Built = {
  doc?: { title?: string }
  built?: { artifact?: string; media_type?: string }
}

/** The names and blob addresses a builder has finished. */
export let catalog = (rows: Built[]): Record<string, string> =>
  Object.fromEntries(rows.flatMap((row) => {
    let name = row.doc?.title, hash = row.built?.artifact
    return name && hash && row.built?.media_type?.startsWith('audio/') &&
        !(name in SAMPLES && PINNED.has(name))
      ? [[name, hash]]
      : []
  }))

let PINNED = new Set(Object.keys(SAMPLES))
let waiting = new Map<string, Set<(hash: string) => void>>()
let watching: Promise<void> | null = null

/** Follow hosted outputs so a rebuilt description is heard on the next play. */
export let watch = () => {
  if (watching) return watching
  watching = import(new URL('api/client.js', document.baseURI).href)
    .then(({ subscribe }) => {
      subscribe('.built.variant=main&.built.artifact&?doc', (rows: Built[]) => {
        for (let [name, hash] of Object.entries(catalog(rows))) {
          SAMPLES[name] = hash
          for (let ready of waiting.get(name) ?? []) ready(hash)
          waiting.delete(name)
        }
      })
    })
    .catch((error) => {
      watching = null
      reportError(error)
    })
  return watching
}

let address = (name: string): Promise<string> => {
  if (SAMPLES[name]) return Promise.resolve(SAMPLES[name])
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
  state(ctx).buffers.get(name)?.hash == SAMPLES[name]
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
      if (SAMPLES[name] != hash) return null
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
