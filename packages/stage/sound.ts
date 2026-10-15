// Positional sources follow caller-supplied locations, independently of the
// world or graph that supplied them. Fixed points and direct sounds share voices.
import {
  type Ear,
  FALLOFF,
  type Falloff,
  hear,
  QUIET,
  type Vec3,
} from './ears.ts'
import { oneShots, type Voice } from './samples.ts'

/** Where a sound is made: at a moving source identified by a caller-supplied key, at a point, or nowhere, straight to the ears. */
export type From = string | Vec3 | null

/** A sound that keeps going into `into` once made, until it is stopped by
 * what this returns. */
export type Keep = (ctx: AudioContext, into: AudioNode) => () => void

// A panner where something is, while it sounds, and `into` it, the loudness
// its falloff has up close: `until` it has sounded its last; `fixed` at a
// point, or following what its id names; `end` stops the sound kept there.
type Source = {
  id: string
  pan: PannerNode
  into: AudioNode
  until: number
  fixed: boolean
  shots: ReturnType<typeof oneShots>
  end?: () => void
}

/** Sources owned by one audio context, updated with locations each frame. */
export interface Sources<Channel extends string> {
  make(from: From, voice: Voice, key?: string): void
  keep(
    id: string,
    sound: Keep,
    falloff?: Falloff,
    channel?: Channel,
  ): () => void
  playing(id: string, channel?: Channel): boolean
  listen(ears: Ear, locations: ReadonlyMap<string, Vec3>): void
}

/** A source bank for one context and a set of named output buses. */
export let sources = <Channel extends string>(
  ctx: AudioContext,
  destination: Record<Channel, AudioNode>,
  effects: Channel,
): Sources<Channel> => {
  let TAIL = 0.5
  let spots: ReadonlyMap<string, Vec3> = new Map()
  let ears: Ear | null = null
  let sources = new Map<string, Source>()
  let direct = oneShots(destination[effects])
  let points = 0
  let sourceKey = (id: string, channel: Channel) => `${channel}/${id}`
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
    channel: Channel = effects,
  ) => {
    let pan = new PannerNode(ctx, falloff.pan)
    let into = new GainNode(ctx, { gain: falloff.near })
    move(pan, at)
    into.connect(pan).connect(destination[channel])
    let s: Source = {
      id,
      pan,
      into,
      until: 0,
      fixed,
      shots: oneShots(into),
    }
    sources.set(sourceKey(id, channel), s)
    return s
  }

  /** Make `v` at `from`: not at all while muted or asleep, or when it would be
   * too faint to hear. */
  let make = (from: From, v: Voice, key?: string) => {
    if (from == null) return direct.play(v, key)
    let id = typeof from == 'string' ? from : `@${points++}`
    let at = typeof from == 'string' ? spots.get(from) : from
    if (!at || (ears && hear(ears, at).gain * v.loud < QUIET)) return
    let s = sources.get(sourceKey(id, effects)) ??
      panner(id, at, typeof from != 'string')
    s.until = Math.max(s.until, ctx.currentTime + v.dur + TAIL)
    s.shots.play(v, key)
  }

  // A kept sound ends: it fades, and its source goes once it has.
  let end = (s: Source) => {
    s.end?.()
    s.end = undefined
    s.until = ctx.currentTime + 1 + TAIL
  }

  /** Keep a sound going at `id`, where the frames put it, falling away as
   * `falloff` says, until it is let go by what this returns, or what it is at
   * is gone. */
  let keep = (
    id: string,
    sound: Keep,
    falloff: Falloff = FALLOFF,
    channel: Channel = effects,
  ) => {
    let at = spots.get(id)
    if (!at) return () => {}
    let s = sources.get(sourceKey(id, channel)) ??
      panner(id, at, false, falloff, channel)
    if (s.end) end(s)
    let stop = sound(ctx, s.into)
    s.end = stop
    s.until = Infinity
    return () => {
      if (s.end == stop) end(s)
    }
  }

  return {
    make,
    keep,
    playing: (id: string, channel: Channel = effects) =>
      !!sources.get(sourceKey(id, channel))?.end,
    listen: (e: Ear, locations: ReadonlyMap<string, Vec3>) => {
      ears = e
      spots = locations
      listenAt(ctx.listener, e)
      direct.prune()
      let t = ctx.currentTime
      for (let [key, s] of sources) {
        s.shots.prune()
        let at = s.fixed ? undefined : spots.get(s.id)
        if (at) move(s.pan, at)
        else if (s.end) end(s)
        if (t > s.until) {
          s.into.disconnect()
          s.pan.disconnect()
          sources.delete(key)
        }
      }
    },
  }
}
