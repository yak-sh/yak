// One volume control per kind of sound. Its setting is kept in this browser;
// the gain belongs in the audio graph, so a change reaches sounds in flight.
let clamp = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback

/** Relative fire level while speech is actually present. */
export let fireLevel = (voice: boolean) => voice ? 0.22 : 1

export let bus = (
  name: string,
  fallback: number,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
) => {
  let key = `mossvale.${name}.level`
  let level = fallback
  let gain: GainNode | null = null
  try {
    let saved = (storage ?? localStorage).getItem(key)
    if (saved != null) level = clamp(Number(saved), fallback)
  } catch { /* A page without storage keeps its setting for this visit. */ }
  return {
    get level() {
      return level
    },
    set: (value: number) => {
      level = clamp(value, fallback)
      try {
        let store = storage ?? localStorage
        store.setItem(key, String(level))
      } catch { /* A page without storage keeps its setting for this visit. */ }
      if (gain) {
        let at = gain.context.currentTime
        gain.gain.cancelScheduledValues(at)
        gain.gain.setValueAtTime(gain.gain.value, at)
        gain.gain.linearRampToValueAtTime(level, at + 0.02)
      }
    },
    into: (ctx: AudioContext, out: AudioNode) => {
      if (!gain || gain.context != ctx) {
        gain?.disconnect()
        gain = new GainNode(ctx, { gain: level })
        gain.connect(out)
      }
      return gain
    },
  }
}
