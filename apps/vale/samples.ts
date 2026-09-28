// The six generated effects are content-addressed blobs in the vale's store.
// Load each once per AudioContext; a missing or undecodable blob leaves the
// procedural voice in place, and the next request can try again.
export let SAMPLES: Record<string, string> = {
  campfire: '92e3de164ac57f9806a300a9e50f0f48568f7f3fd3c65064c6729c5a7eb3b204',
  forge: '579c76352d873716929daf518eebd007471c463d67f1ac237310ffbf39b37248',
  hammer: '410000827723e43c197861e59ee1045fead0f8ec34503e1f80294a3bfbd41c35',
  sword: 'fa331f1e59bd6e42fadbe184c5f6c424640d57103ad93aa3de1e5e26e534e0d5',
  spell: 'f39d94d4680b9fd6b85e8ccad2919848718f7fc18696e73c346479302550ca0b',
  wolf: 'd5a019cc0df66f1cc3e2ca5a049235b12678f78595d7fd0759058623a1b3911c',
}

type State = {
  buffers: Map<string, AudioBuffer>
  pending: Map<string, Promise<AudioBuffer | null>>
}
let states = new WeakMap<BaseAudioContext, State>()
let state = (ctx: BaseAudioContext) => {
  let found = states.get(ctx)
  if (found) return found
  let made: State = { buffers: new Map(), pending: new Map() }
  states.set(ctx, made)
  return made
}

export let loaded = (ctx: BaseAudioContext, name: string) =>
  state(ctx).buffers.get(name)

export let load = (ctx: AudioContext, name: string) => {
  let s = state(ctx)
  let ready = s.buffers.get(name)
  if (ready) return Promise.resolve(ready)
  let pending = s.pending.get(name)
  if (pending) return pending
  let work = (async () => {
    try {
      let response = await fetch(
        new URL(`api/blob/${SAMPLES[name]}`, document.baseURI),
      )
      if (!response.ok) throw new Error(`Sound ${name}: ${response.status}`)
      let buffer = await ctx.decodeAudioData(await response.arrayBuffer())
      s.buffers.set(name, buffer)
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
