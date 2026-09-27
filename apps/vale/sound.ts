// Every sound in the vale comes from somewhere, and is heard through one pair
// of ears at the hero, turned the way the camera looks (ears.ts). How each
// sound is made is voices.ts; this is where it is made.
//
// A sound is made at what made it (`From`): at a hero or creature, whose
// source follows them from frame to frame; at a point, for a find or the work
// at a node; or nowhere, straight to the ears, for what is only the player's
// own news: the arpeggio of a level and the chime of a quest. The hearth
// crackles and the water laps as sounds the level keeps making (`keep`), and
// a marsh's frogs call now and then. A voice from another player will be one
// more kept sound: a MediaStreamAudioSourceNode made from their stream and
// kept at their hero's eid follows them as their footsteps do.
//
// Silent until the player first touches a key or the screen, as browsers
// require, and silent for good once muted.
// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import {
  type Ear,
  ear,
  FALLOFF,
  type Falloff,
  hear,
  NEAR,
  QUIET,
} from './ears.ts'
import { ambience, type Noise, noises, where } from './noises.ts'
import type { Frame, Vec3 } from './play.ts'
import type { Vale } from './terrain.ts'
import * as voices from './voices.ts'
import type { Voice } from './voices.ts'

/** Where a sound is made: at the hero or creature with this eid (or a kept
 * sound's id), at a point, or nowhere, straight to the ears. */
export type From = string | Vec3 | null

/** A sound that keeps going into `into` once made, until it is stopped by
 * what this returns. */
export type Keep = (ctx: AudioContext, into: AudioNode) => () => void

// A panner where something is, while it sounds, and `into` it, the loudness
// its falloff has up close: `until` it has sounded its last; `fixed` at a
// point, or following what its id names; `end` stops the sound kept there.
type Source = {
  pan: PannerNode
  into: AudioNode
  until: number
  fixed: boolean
  end?: () => void
}

// How long a source is kept after its last sound: HRTF rings a moment.
let TAIL = 0.5
// How loud each sound a level keeps making is at its source, and how it
// falls away (ears.ts): the fire as the vale's sounds do, and water fast, so
// it is heard at its edge and not across the level.
let LOOP = {
  fire: { loud: 0.45, falloff: FALLOFF },
  water: { loud: 0.12, falloff: NEAR },
  marsh: { loud: 0.15, falloff: NEAR },
}
// A frog calls from a marsh about `every` so many seconds, from somewhere
// `within` so many metres of the water nearest the ears.
let FROG = { every: 7, within: 5 }

let ctx: AudioContext | null = null
// The last stop before the speakers: every source plays into it.
let out: AudioNode | null = null
let loops: Record<keyof typeof LOOP, AudioBuffer> | null = null
let muted = false
try {
  muted = localStorage.getItem('mossvale.quiet') == '1'
} catch { /* a page without storage starts with sound */ }

let ears: Ear | null = null
let spots = new Map<string, Vec3>()
let sources = new Map<string, Source>()
let points = 0
let heard = noises()

// Where the last stop plays: the context's own speakers, or a node the page
// hands `play` (voicebox.ts: a loop the echo canceller hears).
let speakers: AudioNode | null = null

let wake = () => {
  if (ctx || muted) return
  try {
    ctx = new AudioContext()
    // Many sounds at once are held under full scale rather than clipped.
    let limit = new DynamicsCompressorNode(ctx, {
      threshold: -6,
      knee: 6,
      ratio: 12,
      attack: 0.003,
      release: 0.2,
    })
    limit.connect(ctx.destination)
    out = limit
    speakers = ctx.destination
    loops = {
      fire: voices.fire(ctx),
      water: voices.water(ctx),
      marsh: voices.marsh(ctx),
    }
  } catch {
    ctx = null
  }
}
addEventListener('pointerdown', wake, { once: true })
addEventListener('keydown', wake, { once: true })
// A hidden tab keeps no fire crackling.
document.addEventListener('visibilitychange', () => {
  if (!ctx || muted) return
  if (document.hidden) ctx.suspend()
  else ctx.resume()
})

// A source or the ears, put where they are this frame. Set outright, not
// automated: a frame moves them a few centimetres, and a panner whose
// position is automated works its sound out anew at every sample.
let put = (ps: AudioParam[], vs: number[]) =>
  ps.forEach((p, i) => p.value = vs[i])
let move = (pan: PannerNode, at: Vec3) =>
  put([pan.positionX, pan.positionY, pan.positionZ], at)
let listenAt = (l: AudioListener, e: Ear) => {
  if (!l.positionX) {
    // Firefox turns its listener only the old way.
    l.setPosition(...e.at)
    l.setOrientation(...e.forward, ...e.up)
    return
  }
  put([
    l.positionX,
    l.positionY,
    l.positionZ,
    l.forwardX,
    l.forwardY,
    l.forwardZ,
    l.upX,
    l.upY,
    l.upZ,
  ], [...e.at, ...e.forward, ...e.up])
}

let panner = (
  id: string,
  at: Vec3,
  fixed: boolean,
  falloff: Falloff = FALLOFF,
) => {
  let pan = new PannerNode(ctx!, falloff.pan)
  let into = new GainNode(ctx!, { gain: falloff.near })
  move(pan, at)
  into.connect(pan).connect(out!)
  let s: Source = { pan, into, until: 0, fixed }
  sources.set(id, s)
  return s
}

/** Make `v` at `from`: not at all while muted or asleep, or when it would be
 * too faint to hear. */
let make = (from: From, v: Voice) => {
  if (!ctx || !out || muted) return
  if (from == null) return v.play(out)
  let id = typeof from == 'string' ? from : `@${points++}`
  let at = typeof from == 'string' ? spots.get(from) : from
  if (!at || (ears && hear(ears, at).gain * v.loud < QUIET)) return
  let s = sources.get(id) ?? panner(id, at, typeof from != 'string')
  s.until = Math.max(s.until, ctx.currentTime + v.dur + TAIL)
  v.play(s.into)
}

// A kept sound ends: it fades, and its source goes once it has.
let end = (s: Source) => {
  s.end?.()
  s.end = undefined
  s.until = ctx!.currentTime + 1 + TAIL
}

/** Keep a sound going at `id`, where the frames put it, falling away as
 * `falloff` says, until it is let go by what this returns, or what it is at
 * is gone. */
let keep = (id: string, sound: Keep, falloff: Falloff = FALLOFF) => {
  let at = spots.get(id)
  if (!ctx || !at) return () => {}
  let s = sources.get(id) ?? panner(id, at, false, falloff)
  if (s.end) end(s)
  let stop = sound(ctx, s.into)
  s.end = stop
  s.until = Infinity
  return () => {
    if (s.end == stop) end(s)
  }
}

// A level's own sound, looping, faded in, and faded out when it ends.
let loop = (kind: keyof typeof LOOP): Keep => (c, into) => {
  let b = loops![kind]
  let s = new AudioBufferSourceNode(c, { buffer: b, loop: true })
  let g = c.createGain()
  g.gain.setValueAtTime(0, c.currentTime)
  g.gain.linearRampToValueAtTime(LOOP[kind].loud, c.currentTime + 1.5)
  s.connect(g).connect(into)
  s.start(c.currentTime, Math.random() * b.duration)
  return () => {
    g.gain.setTargetAtTime(0, c.currentTime, 0.2)
    s.stop(c.currentTime + 1)
  }
}

let noisy = (n: Noise) =>
  make(
    n.of,
    n.type == 'step'
      ? voices.step(n.plan, n.size)
      : n.type == 'cry'
      ? voices.cry(n.plan, n.size, n.loud)
      : n.type == 'swing'
      ? voices.whiff
      : voices.roll,
  )

export let sound = {
  /** The vale's AudioContext, once a key or a touch has woken it. */
  get context() {
    return ctx
  },
  /** Play everything into `to` rather than the speakers, or into the
   * speakers again with null. */
  play: (to: AudioNode | null) => {
    if (!ctx || !out) return
    let next = to ?? ctx.destination
    if (next == speakers) return
    out.connect(next)
    out.disconnect(speakers!)
    speakers = next
  },
  get muted() {
    return muted
  },
  toggle: () => {
    muted = !muted
    try {
      localStorage.setItem('mossvale.quiet', muted ? '1' : '0')
    } catch { /* kept for this page only */ }
    if (muted) ctx?.suspend()
    else {
      wake()
      ctx?.resume()
    }
    return muted
  },
  /** Each frame: the ears go to the hero `me` of the frame `f`, or to the
   * camera when there is none, and turn the way the camera looks; every
   * source goes where what it follows now is, the world near keeps up its own
   * sounds, and what the hero hears of the frame is made. */
  listen: (
    camera: THREE.Camera,
    v: Vale,
    f: Frame | null,
    me: string | null,
    dt: number,
  ) => {
    if (!ctx) return
    spots = f && me ? where(f, me) : new Map()
    ears = ear(camera, me ? spots.get(me) : undefined)
    listenAt(ctx.listener, ears)
    let around = ambience(v, ears.at)
    for (let a of around) spots.set(a.id, a.at)
    let t = ctx.currentTime
    for (let [id, s] of sources) {
      let at = s.fixed ? undefined : spots.get(id)
      if (at) move(s.pan, at)
      else if (s.end) end(s)
      if (t > s.until) {
        s.pan.disconnect()
        sources.delete(id)
      }
    }
    for (let a of around) {
      if (!sources.get(a.id)?.end) {
        keep(a.id, loop(a.kind), LOOP[a.kind].falloff)
      }
    }
    let bog = around.find((a) => a.kind == 'marsh')
    if (bog && Math.random() < dt / FROG.every) {
      let [x, y, z] = bog.at, off = () => (Math.random() * 2 - 1) * FROG.within
      make([x + off(), y, z + off()], voices.croak())
    }
    if (f && me) heard(f, me, dt).forEach(noisy)
  },
  keep,
  hit: (from: From, great: boolean) => make(from, voices.hit(great)),
  struck: (from: From) => make(from, voices.struck),
  whiff: (from: From) => make(from, voices.whiff),
  roll: (from: From) => make(from, voices.roll),
  dodge: (from: From) => make(from, voices.dodge),
  hurt: (from: From) => make(from, voices.hurt),
  pick: (from: From) => make(from, voices.pick),
  fall: (from: From) => make(from, voices.fall),
  heal: (from: From) => make(from, voices.heal),
  /** A stroke of work at a node or a station, by its trade (trades.ts). */
  stroke: (from: From, trade: string) =>
    make(from, voices.stroke[trade] ?? voices.whiff),
  /** Work done at a node or a station, by its trade. */
  done: (from: From, trade: string) =>
    make(from, voices.done[trade] ?? voices.pick),
  /** A level gained: the player's own news, straight to the ears. */
  level: () => make(null, voices.level),
  /** A quest taken or handed in, or a new land reached: the player's own
   * news, straight to the ears. */
  quest: () => make(null, voices.quest),
  /** A fine piece of gear falling, or coming into the bag, by its rarity:
   * nothing more than a find for an uncommon one. */
  spoil: (from: From, rarity: string) =>
    make(from, voices.spoils[rarity] ?? voices.pick),
}
