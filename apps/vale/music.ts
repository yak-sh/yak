// Mossvale's theme plays through the vale's sound context. The region's blend
// fades it across the border, while the player's own level and mute are kept.
import { blend } from './regions.ts'
import type { Vec3 } from './play.ts'

let SHA = '894e73ee132be8a2539e6e5493e46591f12d2faa657ceb2770b2a0cb508bf909'
let LOUD = 0.28
let level = 0.7
let muted = false
try {
  level = Number(localStorage.getItem('mossvale.music.level') ?? 0.7)
  muted = localStorage.getItem('mossvale.music.muted') == '1'
} catch { /* A page without storage keeps its setting for this visit. */ }
level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0.7

/** How much of this point belongs to Mossvale: one inside, zero beyond its
 * border's blend.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert(share(64, 64) == 1)
 * assert(share(-64, 64) == 0)
 * ```
 */
export let share = (x: number, z: number) => {
  let b = blend(x, z)
  return b.a == 'mossvale' ? b.t : b.b == 'mossvale' ? 1 - b.t : 0
}

let ctx: AudioContext | null = null
let gain: GainNode | null = null
let source: AudioBufferSourceNode | null = null
let target = -1

let volume = () => muted ? 0 : level
let update = (at: Vec3) => {
  if (!ctx || !gain) return
  let next = LOUD * volume() * share(at[0], at[2])
  if (Math.abs(next - target) < 0.002) return
  target = next
  gain.gain.setTargetAtTime(next, ctx.currentTime, 0.7)
}

export let music = {
  get level() {
    return level
  },
  get muted() {
    return muted
  },
  set: (value: number) => {
    level = Math.max(0, Math.min(1, value))
    try {
      localStorage.setItem('mossvale.music.level', String(level))
    } catch {
      /* A page without storage keeps its setting for this visit. */
    }
    target = -1
  },
  toggle: () => {
    muted = !muted
    try {
      localStorage.setItem('mossvale.music.muted', muted ? '1' : '0')
    } catch {
      /* A page without storage keeps its setting for this visit. */
    }
    target = -1
  },
  start: async (c: AudioContext, into: AudioNode) => {
    if (source) return
    ctx = c
    gain = c.createGain()
    gain.gain.value = 0
    gain.connect(into)
    let url = new URL(`api/blob/${SHA}`, document.baseURI)
    let response = await fetch(url)
    if (!response.ok) throw new Error(`Music: ${response.status}`)
    let buffer = await c.decodeAudioData(await response.arrayBuffer())
    source = new AudioBufferSourceNode(c, { buffer, loop: true })
    source.connect(gain)
    source.start()
  },
  at: update,
}
