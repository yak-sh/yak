// Each land plays its two songs in turn, with quiet between them. Only one
// land owns the soundtrack; crossing a border fades it out before the next.
import { type Blend, blend } from './regions.ts'
import {
  type Catalog,
  catalog,
  type Row,
  SONGS,
  track,
} from './music_catalog.ts'
import type { Vec3 } from './play.ts'

let LOUD = 0.28
let QUIET = 8
let FADE = 0.7
let HOLD = 0.65
let muted = false
try {
  muted = localStorage.getItem('mossvale.music.muted') == '1'
} catch { /* A page without storage keeps its setting for this visit. */ }

type Land = {
  id: string
  gain: GainNode
  next: string | null
  loading: boolean
  source: AudioBufferSourceNode | null
  wait: ReturnType<typeof setTimeout> | null
  target: number
}

let ctx: AudioContext | null = null
let out: AudioNode | null = null
let current: Land | null = null
let change: ReturnType<typeof setTimeout> | null = null
let ducked = false
let at: Vec3 | null = null
let unavailable = new Set<string>()
let tracks: Catalog = {}
let watching: Promise<void> | null = null
let received = false

/** Accept subscription rows without interrupting a source already playing. */
export let accept = (rows: Row[]) => {
  received = true
  tracks = catalog(rows)
  if (at) update(at)
  if (current && !current.source && !current.wait) void song(current)
}

let watch = () => {
  if (received || watching) return
  watching = import(new URL('api/client.js', document.baseURI).href)
    .then(({ subscribe }) => {
      subscribe(SONGS, accept)
    })
    .catch((error) => {
      watching = null
      reportError(error)
    })
}

let song = async (land: Land) => {
  if (land.loading || land.source || current != land) return
  land.wait = null
  let songs = tracks[land.id] ?? []
  let selected = track(songs, land.next, unavailable)
  if (!selected?.sha) return
  let sha = selected.sha
  land.loading = true
  try {
    let response = await fetch(new URL(`api/blob/${sha}`, document.baseURI))
    if (!response.ok) {
      throw new Error(`Music: ${response.status} for ${land.id}`)
    }
    let buffer = await ctx!.decodeAudioData(await response.arrayBuffer())
    // A removed or replaced output cannot start after an in-flight fetch.
    if (
      current != land ||
      !tracks[land.id]?.some((song) =>
        song.id == selected.id && song.sha == sha
      )
    ) return
    let source = new AudioBufferSourceNode(ctx!, { buffer })
    land.source = source
    source.connect(land.gain)
    source.onended = () => {
      if (current != land || land.source != source) return
      source.disconnect()
      land.source = null
      let index = songs.findIndex((song) => song.id == selected.id)
      land.next = songs[(index + 1) % songs.length].id
      land.wait = setTimeout(() => void song(land), QUIET * 1000)
    }
    source.start()
  } catch (error) {
    if (!unavailable.has(sha)) {
      unavailable.add(sha)
      reportError(error)
    }
  } finally {
    land.loading = false
    if (current == land && !land.source) {
      let next = track(tracks[land.id] ?? [], land.next, unavailable)
      if (next?.sha && next.sha != sha) void song(land)
    }
  }
}

let enter = (id: string) => {
  let gain = ctx!.createGain()
  gain.gain.value = 0
  gain.connect(out!)
  let land: Land = {
    id,
    gain,
    next: null,
    loading: false,
    source: null,
    wait: null,
    target: -1,
  }
  current = land
  void song(land)
  return land
}

let fade = (land: Land, to: number) => {
  if (Math.abs(to - land.target) < 0.002) return
  land.target = to
  let p = land.gain.gain, t = ctx!.currentTime
  p.cancelScheduledValues(t)
  p.setValueAtTime(p.value, t)
  p.linearRampToValueAtTime(to, t + FADE)
}

let leave = (land: Land) => {
  if (current == land) current = null
  if (land.wait != null) clearTimeout(land.wait)
  if (land.source) {
    land.source.onended = null
    land.source.stop()
    land.source.disconnect()
  }
  land.gain.disconnect()
}

// The nearest region has to lead clearly before taking the song. The ground
// can still blend evenly at a border without changing music every step.
export let heard = (b: Blend, playing: string | null, songs = tracks) =>
  playing == b.b && b.t < HOLD
    ? b.b
    : songs[b.a] || playing == b.a
    ? b.a
    : songs[b.b]
    ? b.b
    : null

let update = (pos: Vec3) => {
  at = pos
  if (!ctx) return
  let b = blend(pos[0], pos[2])
  let id = heard(b, current?.id ?? null)
  if (id == current?.id) {
    if (change != null) clearTimeout(change)
    change = null
    if (current) fade(current, (muted ? 0 : LOUD) * (ducked ? 0.35 : 1))
    return
  }
  if (current) {
    if (!current.source) {
      leave(current)
      if (change != null) clearTimeout(change)
      change = null
    } else if (change == null) {
      fade(current, 0)
      change = setTimeout(() => {
        if (current) leave(current)
        change = null
        if (at) update(at)
      }, FADE * 1000)
    }
  }
  if (!current && id) {
    let next = enter(id)
    fade(next, (muted ? 0 : LOUD) * (ducked ? 0.35 : 1))
  }
}

export let music = {
  get muted() {
    return muted
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
    watch()
    if (at) update(at)
  },
  at: update,
}
