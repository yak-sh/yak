// Every sound in the vale comes from somewhere, and is heard through one pair
// of ears at the hero, turned the way the camera looks (ears.ts). Its voice
// comes from a decoded sample or a procedural fallback (samples.ts,
// voices.ts); this is where it is made.
//
// A sound is made at what made it (`From`): at a hero or creature, whose
// source follows them from frame to frame; at a point, for a find or the work
// at a node; or nowhere, straight to the ears, for what is only the player's
// own news: the arpeggio of a level and the chime of a quest. The hearth
// crackles and the water laps as sounds the level keeps making (`keep`), and
// a marsh's frogs call now and then. A voice from another player is a kept
// MediaStreamAudioSourceNode at their hero's eid and follows them.
//
// Silent until the player first touches a key or the screen, as browsers
// require, and while muted.
// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import { type Ear, ear, NEAR } from '@yaks/stage/ears'
import { bus, duckLevel as fireLevel } from '@yaks/stage/bus'
import { type From, type Keep, sources as sourceBank } from '@yaks/stage/sound'
import { looping, recorded, type Voice } from '@yaks/stage/samples'
import { ambience, type Noise, noises, where } from './noises.ts'
import { music } from './music.ts'
import { load, loaded, watch } from './samples.ts'
import type { Frame, Vec3 } from './play.ts'
import type { Vale } from './terrain.ts'
import * as voices from './voices.ts'

// How loud each sound a level keeps making is at its source, and how it
// falls away (ears.ts): fire and water fade quickly, so neither carries
// across the buildings around a village hearth.
let LOOP = {
  fire: { loud: 0.45, falloff: NEAR },
  forge: { loud: 0.12, falloff: NEAR },
  water: { loud: 0.12, falloff: NEAR },
  surf: { loud: 0.12, falloff: NEAR },
  marsh: { loud: 0.15, falloff: NEAR },
}
// A frog calls from a marsh about `every` so many seconds, from somewhere
// `within` so many metres of the water nearest the ears.
let FROG = { every: 7, within: 5 }

let ctx: AudioContext | null = null
// The last stop before the speakers: all three buses play into it.
let out: AudioNode | null = null
// Existing player settings stay app-owned until T-64325 moves them to the store.
let volume = (name: string, fallback: number, boost = 1) => {
  let key = `mossvale.${name}.level`, value = fallback
  try {
    let saved = localStorage.getItem(key)
    if (saved != null && Number.isFinite(Number(saved))) {
      value = Math.max(0, Math.min(1, Number(saved)))
    }
  } catch { /* This visit still has a volume control. */ }
  return bus(value, {
    boost,
    save: (level) => {
      try {
        localStorage.setItem(key, String(level))
      } catch { /* This visit only. */ }
    },
  })
}
let levels = {
  music: volume('music', 0.6),
  effects: volume('effects', 1),
  voice: volume('voice', 1, 2),
}
type Channel = 'effects' | 'voice'
let destination: Record<Channel, AudioNode | null> = {
  effects: null,
  voice: null,
}
let loops: Record<keyof typeof LOOP, AudioBuffer> | null = null
let fireGains = new Set<GainNode>()
let voiceDucking = false
let muted = false
try {
  muted = localStorage.getItem('mossvale.quiet') == '1'
} catch { /* a page without storage starts with sound */ }

let ears: Ear | null = null
let spots = new Map<string, Vec3>()
let sources: ReturnType<typeof sourceBank<Channel>> | null = null
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
    destination.effects = levels.effects.into(ctx, limit)
    destination.voice = levels.voice.into(ctx, limit)
    sources = sourceBank<Channel>(ctx, {
      effects: destination.effects!,
      voice: destination.voice!,
    }, 'effects')
    speakers = ctx.destination
    loops = {
      fire: voices.fire(ctx),
      forge: voices.fire(ctx),
      water: voices.water(ctx),
      surf: voices.surf(ctx),
      marsh: voices.marsh(ctx),
    }
    void watch()
    music.start(ctx, levels.music.into(ctx, limit))
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

let make = (from: From, voice: Voice, key?: string) => {
  if (!ctx || !out || muted) return
  sources?.make(from, voice, key)
}

let keep = (...args: Parameters<NonNullable<typeof sources>['keep']>) =>
  sources?.keep(...args) ?? (() => {})

// A decoded sample plays through the same source, falloff and effects bus as
// its procedural voice. Until it arrives, the procedural voice still sounds.
let sampled = (name: string, fallback: Voice, gain: number): Voice => {
  let pending = { ...fallback, key: name }
  if (!ctx) return pending
  let b = loaded(ctx, name)
  if (!b) {
    void load(ctx, name)
    return pending
  }
  return recorded(b, fallback, gain, name)
}

// A level's own sound, looping, faded in, and faded out when it ends.
let loop = (kind: keyof typeof LOOP): Keep => (c, into) => {
  // The village fire keeps its own crackles; its recording adds a rush.
  let name = kind == 'fire' ? null : kind
  let ready = name ? loaded(c, name) : undefined
  let b = ready ? kind == 'forge' ? ready : looping(c, ready) : loops![kind]
  let s = new AudioBufferSourceNode(c, { buffer: b, loop: true })
  let g = c.createGain()
  let sourceGain = c.createGain()
  g.gain.setValueAtTime(0, c.currentTime)
  g.gain.linearRampToValueAtTime(LOOP[kind].loud, c.currentTime + 1.5)
  // Fire is a persistent source; duck its own bus, not the voice bus.
  let fire = kind == 'fire' || kind == 'forge' ? c.createGain() : null
  if (fire) {
    fire.gain.value = fireLevel(voiceDucking)
    g.connect(fire).connect(into)
    fireGains.add(fire)
  } else g.connect(into)
  s.connect(sourceGain).connect(g)
  s.start(c.currentTime, Math.random() * b.duration)
  let stopped = false
  if (name && !ready) {
    void load(c, name).then((next) => {
      if (!next || stopped) return
      let old = s, oldGain = sourceGain, at = c.currentTime
      s = new AudioBufferSourceNode(c, {
        buffer: kind == 'forge' ? next : looping(c, next),
        loop: true,
      })
      sourceGain = c.createGain()
      sourceGain.gain.setValueAtTime(0, at)
      sourceGain.gain.linearRampToValueAtTime(1, at + 0.75)
      oldGain.gain.setValueAtTime(1, at)
      oldGain.gain.linearRampToValueAtTime(0, at + 0.75)
      s.connect(sourceGain).connect(g)
      s.start(at, Math.random() * next.duration)
      old.onended = () => {
        old.disconnect()
        oldGain.disconnect()
      }
      old.stop(at + 0.75)
    })
  }
  return () => {
    stopped = true
    g.gain.setTargetAtTime(0, c.currentTime, 0.2)
    s.stop(c.currentTime + 1)
    if (fire) fireGains.delete(fire)
    let last = s, gain = sourceGain
    last.onended = () => {
      last.disconnect()
      gain.disconnect()
      g.disconnect()
      fire?.disconnect()
    }
  }
}

// A creature's chosen design points at its sound rows by eid.
let voiced = (sfx: string | undefined, fallback: Voice, gain: number) => {
  return sfx ? sampled(sfx, fallback, gain) : fallback
}

let noisy = (n: Noise) =>
  make(
    n.of,
    n.type == 'step'
      ? n.gait == 'hero'
        ? sampled('step-hero', voices.step(n.gait, n.size), 0.25)
        : voiced(n.sfx, voices.step(n.gait, n.size), 0.25)
      : n.type == 'cry'
      ? voiced(
        n.sfx,
        voices.cry(n.gait, n.size, n.loud),
        n.loud ? 0.1 : 0.06,
      )
      : n.type == 'swing'
      ? sampled('swing', voices.whiff, 0.25)
      : sampled('roll', voices.roll, 0.25),
    n.type,
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
  music: {
    get level() {
      return levels.music.level
    },
    set: levels.music.set,
    get muted() {
      return music.muted
    },
    toggle: music.toggle,
    duck: music.duck,
  },
  effects: levels.effects,
  voice: levels.voice,
  /** Quiet the fire under audible speech; never attenuate the speaker. */
  duckVoice: (speaking: boolean) => {
    if (voiceDucking == speaking) return
    voiceDucking = speaking
    for (let fire of fireGains) {
      fire.gain.setTargetAtTime(
        fireLevel(speaking),
        fire.context.currentTime,
        0.12,
      )
    }
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
    partySpots: ReadonlyMap<string, Vec3> = new Map(),
  ) => {
    if (!ctx) return
    spots = f && me ? where(f, me) : new Map()
    for (let [id, at] of partySpots) if (!spots.has(id)) spots.set(id, at)
    ears = ear(camera, me ? spots.get(me) : undefined)
    music.at(ears.at)
    let around = ambience(v, ears.at)
    for (let a of around) spots.set(a.id, a.at)
    sources?.listen(ears, spots)
    for (let a of around) {
      if (!sources?.playing(a.id)) {
        keep(a.id, loop(a.kind), LOOP[a.kind].falloff)
      }
    }
    let bog = around.find((a) => a.kind == 'marsh')
    if (bog && Math.random() < dt / FROG.every) {
      let [x, y, z] = bog.at, off = () => (Math.random() * 2 - 1) * FROG.within
      make([x + off(), y, z + off()], sampled('frog', voices.croak(), 0.2))
    }
    if (f && me) heard(f, me, dt).forEach(noisy)
  },
  keep,
  hit: (from: From, great: boolean) =>
    make(from, sampled(great ? 'hit-great' : 'hit', voices.hit(great), 0.35)),
  struck: (from: From) => make(from, sampled('struck', voices.struck, 0.3)),
  whiff: (from: From, family = '') =>
    make(
      from,
      family == 'sword'
        ? sampled('sword', voices.whiff, 0.35)
        : sampled('swing', voices.whiff, 0.25),
      'swing',
    ),
  fire: (from: From) => make(from, sampled('spell', voices.whiff, 0.4)),
  roll: (from: From) => make(from, sampled('roll', voices.roll, 0.25)),
  dodge: (from: From) => make(from, sampled('dodge', voices.dodge, 0.25)),
  hurt: (from: From) => make(from, sampled('hurt', voices.hurt, 0.25)),
  pick: (from: From) => make(from, sampled('pick', voices.pick, 0.25)),
  fall: (from: From) => make(from, sampled('fall', voices.fall, 0.3)),
  heal: (from: From) => make(from, sampled('heal', voices.heal, 0.25)),
  /** A stroke of work at a node or a station, by its trade (trades.ts). */
  stroke: (from: From, trade: string) =>
    make(
      from,
      trade == 'forge' ? sampled('hammer', voices.stroke.forge, 0.45) : sampled(
        `stroke-${trade}`,
        voices.stroke[trade] ?? voices.whiff,
        0.3,
      ),
    ),
  /** Work done at a node or a station, by its trade. */
  done: (from: From, trade: string) =>
    make(
      from,
      sampled(`done-${trade}`, voices.done[trade] ?? voices.pick, 0.3),
    ),
  /** A level gained: the player's own news, straight to the ears. */
  level: () => make(null, sampled('level', voices.level, 0.25)),
  /** A quest taken or handed in, or a new land reached: the player's own
   * news, straight to the ears. */
  quest: () => make(null, sampled('quest', voices.quest, 0.25)),
  /** A fine piece of gear falling, or coming into the bag, by its rarity:
   * nothing more than a find for an uncommon one. */
  spoil: (from: From, rarity: string) =>
    make(
      from,
      sampled(`spoil-${rarity}`, voices.spoils[rarity] ?? voices.pick, 0.25),
    ),
}
