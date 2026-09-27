// Each land plays its two songs in turn, with quiet between them. The two
// nearest lands fade through the same border blend as the ground.
import { blend } from './regions.ts'
import { TRACKS } from './music_tracks.ts'
import type { Vec3 } from './play.ts'

let LOUD = 0.28
let QUIET = 8
let FADE = 0.7
let level = 0.7
let muted = false
try {
  level = Number(localStorage.getItem('mossvale.music.level') ?? 0.7)
  muted = localStorage.getItem('mossvale.music.muted') == '1'
} catch { /* A page without storage keeps its setting for this visit. */ }
level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0.7

type Land = {
  id: string
  gain: GainNode
  next: number
  source: AudioBufferSourceNode | null
  wait: ReturnType<typeof setTimeout> | null
  retire: ReturnType<typeof setTimeout> | null
  target: number
}

let ctx: AudioContext | null = null
let out: AudioNode | null = null
let lands = new Map<string, Land>()
let ducked = false
let at: Vec3 | null = null

let song = async (land: Land) => {
  let c = ctx!
  let index = land.next
  let sha = TRACKS[land.id][index]
  land.wait = null
  try {
    let response = await fetch(new URL(`api/blob/${sha}`, document.baseURI))
    if (!response.ok) {
      throw new Error(`Music: ${response.status} for ${land.id}`)
    }
    let buffer = await c.decodeAudioData(await response.arrayBuffer())
    if (lands.get(land.id) != land || land.retire != null) return
    let source = new AudioBufferSourceNode(c, { buffer })
    land.source = source
    source.connect(land.gain)
    source.onended = () => {
      if (land.source != source) return
      source.disconnect()
      land.source = null
      land.next = 1 - index
      land.wait = setTimeout(() => void song(land), QUIET * 1000)
    }
    source.start()
  } catch (error) {
    reportError(error)
    if (lands.get(land.id) == land && land.retire == null) {
      land.wait = setTimeout(() => void song(land), QUIET * 1000)
    }
  }
}

let enter = (id: string) => {
  let land = lands.get(id)
  if (land) {
    if (land.retire != null) clearTimeout(land.retire)
    land.retire = null
    return land
  }
  let gain = ctx!.createGain()
  gain.gain.value = 0
  gain.connect(out!)
  land = {
    id,
    gain,
    next: 0,
    source: null,
    wait: null,
    retire: null,
    target: -1,
  }
  lands.set(id, land)
  void song(land)
  return land
}

let fade = (land: Land, to: number) => {
  if (Math.abs(to - land.target) < 0.002) return
  land.target = to
  let p = land.gain.gain, t = ctx!.currentTime
  p.cancelScheduledValues(t)
  p.setValueAtTime(p.value, t)
  p.setTargetAtTime(to, t, FADE)
}

let leave = (land: Land) => {
  fade(land, 0)
  if (land.retire != null) return
  land.retire = setTimeout(() => {
    land.source?.stop()
    land.source = null
    if (land.wait != null) clearTimeout(land.wait)
    land.gain.disconnect()
    lands.delete(land.id)
  }, 5_000)
}

let update = (pos: Vec3) => {
  at = pos
  if (!ctx) return
  let b = blend(pos[0], pos[2])
  let heard = new Map<string, number>()
  if (TRACKS[b.a]) heard.set(b.a, b.t)
  if (TRACKS[b.b] && 1 - b.t > 0.002) heard.set(b.b, 1 - b.t)
  for (let [id, share] of heard) {
    let land = enter(id)
    fade(land, LOUD * (muted ? 0 : level) * (ducked ? 0.35 : 1) * share)
  }
  for (let [id, land] of lands) if (!heard.has(id)) leave(land)
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
    } catch { /* A page without storage keeps its setting for this visit. */ }
    if (at) update(at)
  },
  toggle: () => {
    muted = !muted
    try {
      localStorage.setItem('mossvale.music.muted', muted ? '1' : '0')
    } catch { /* A page without storage keeps its setting for this visit. */ }
    if (at) update(at)
  },
  duck: (voice: boolean) => {
    if (ducked == voice) return
    ducked = voice
    if (at) update(at)
  },
  start: (c: AudioContext, into: AudioNode) => {
    if (ctx) return
    ctx = c
    out = into
    if (at) update(at)
  },
  at: update,
}
