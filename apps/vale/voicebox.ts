// Players talking (D-40615): the microphone stays off until the player turns
// it on (T, or the 🎙 button), and every hero on the level within earshot who
// has theirs on is heard where they stand, through the one spatial engine
// (sound.ts `keep`), as their footsteps are.
//
// The call is @yaks/rtc's, through the app's own ./api/rtc/ door, and joins
// the first time there is anything to say or hear. A hero with their
// microphone on wears `rtc{session, tracks: ['voice']}`, relayed like their
// position, and a page asks for the voices it wants: those within 30 m, let
// go past 34 m so one at the edge does not flap. The space pays for what is
// heard, so nobody is heard out of earshot, and nobody at all while the
// vale's sound is off.
//
// How loud each voice is heard is voice.ts's.
import type { Call, Heard, Loop } from '@yaks/rtc'
import { comp, type Net, str } from './net.ts'
import type { Frame } from './play.ts'
import type { Body } from './sim.ts'
import { sound } from './sound.ts'
import { loud, near } from './voice.ts'

// How long a voice that could not be had waits before it is asked again.
let AGAIN = 5000

// @yaks/rtc, loaded the first time anyone speaks or is heard: the vale plays
// without it, and plays on if it cannot be had.
let lib: typeof import('@yaks/rtc') | null = null
let rtc = () => import('@yaks/rtc').then((m) => lib = m)

/** How the microphone stands, as its button shows it. */
export type Mic = 'off' | 'starting' | 'on' | 'denied' | 'spent'

// One voice asked for: the session it comes from, its stream once it arrives
// (null while asked, or when it could not be had, `at` then), and the gain it
// plays through while the engine keeps it.
type Voice = {
  session: string
  heard: Heard | null
  failed: number
  gain: GainNode | null
  let: () => void
  gone: boolean
}

let apart = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** The vale's voices, for the page `net` plays. `told` hears the microphone
 * move, for its button. */
export let voices = (net: Net, told: (m: Mic) => void) => {
  let call: Promise<Call> | null = null
  let as: string | null = null
  let mic: Mic = 'off'
  let track: MediaStreamTrack | null = null
  let sent: { stop: () => Promise<void> } | null = null
  let held = new Map<string, Voice>()
  let moved = (m: Mic) => told(mic = m)

  // While the microphone is on, the vale plays through a loop the browser's
  // echo canceller hears (@yaks/rtc `loopback`), so a player on speakers does
  // not send the others back their own voices. Moved over once it plays; one
  // that never does leaves the speakers as they were until the microphone is
  // next turned on.
  let loop: Loop | null = null
  let echo = () => {
    let ctx = sound.context
    let want = mic == 'on' && !!ctx && !sound.muted && !!lib
    if (want && !loop) {
      let made = loop = lib!.loopback(ctx!)
      made.ready.then(
        () => loop == made && sound.play(made.into),
        () => made.stop(),
      )
    }
    if (!want && loop) {
      sound.play(null)
      loop.stop()
      loop = null
    }
  }

  let drop = (eid: string) => {
    let v = held.get(eid)
    if (!v) return
    held.delete(eid)
    v.gone = true
    v.let()
    void v.heard?.stop().catch(() => {})
  }

  // The call, joined as the hero this tab plays, and joined again if it
  // plays another.
  let joined = (): Promise<Call> => {
    if (call && as == net.hero) return call
    if (call) void call.then((c) => c.leave()).catch(() => {})
    for (let eid of [...held.keys()]) drop(eid)
    as = net.hero
    let made = rtc().then(({ join }) =>
      join({
        entity: as!,
        write: (b) => net.client.mutate(b),
        change: (s) => {
          if (s == 'limit') moved('spent')
        },
      })
    )
    call = made
    made.catch(() => {
      if (call == made) call = null
    })
    return made
  }

  let hear = async (eid: string, session: string) => {
    let v: Voice = {
      session,
      heard: null,
      failed: 0,
      gain: null,
      let: () => {},
      gone: false,
    }
    held.set(eid, v)
    try {
      v.heard = await (await joined()).hear(session, 'voice')
    } catch { /* asked again in a moment */ }
    if (v.gone) return void v.heard?.stop().catch(() => {})
    if (!v.heard) v.failed = Date.now()
  }

  // A voice into the engine at its speaker, until the engine lets it go
  // (they left the level) or this page does.
  let keep = (eid: string, v: Voice) => {
    let stream = v.heard!.stream
    v.let = sound.keep(eid, (ctx, into) => {
      let src = ctx.createMediaStreamSource(stream)
      let gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(gain).connect(into)
      v.gain = gain
      return () => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1)
        setTimeout(() => src.disconnect(), 500)
        if (v.gain == gain) v.gain = null
      }
    })
  }

  return {
    get mic() {
      return mic
    },
    /** The loop the vale plays through while the microphone is on, if any. */
    get loop() {
      return loop
    },
    /** The voices heard now: whose, their stream, and how loud they play. */
    get heard() {
      return [...held].filter(([, v]) => v.heard).map(([eid, v]) => ({
        eid,
        stream: v.heard!.stream,
        loud: v.gain?.gain.value ?? 0,
      }))
    },
    /** Turn the microphone on or off. Called from a key or a click, so the
     * browser may ask the player for it. */
    toggle: async () => {
      if (mic == 'starting' || !net.hero) return
      if (mic == 'on') {
        let was = sent
        sent = null
        track?.stop()
        track = null
        moved('off')
        await was?.stop().catch(() => {})
        return
      }
      moved('starting')
      try {
        track = await (await rtc()).microphone()
      } catch {
        return moved('denied')
      }
      try {
        sent = await (await joined()).publish(track)
        moved('on')
      } catch {
        track.stop()
        track = null
        moved(mic == 'spent' ? 'spent' : 'off')
      }
    },
    /** Each frame: the vale played through the loop while the microphone is
     * on, the voices within earshot asked for, the ones out of it let go, and
     * each one heard placed and faded. */
    tick: (f: Frame) => {
      echo()
      let want = new Map<string, { session: string; body: Body }>()
      if (!sound.muted && mic != 'spent') {
        for (let o of f.others) {
          let r = comp(net.client.ent(o.eid), 'rtc')
          let session = str(r.session)
          let talks = Array.isArray(r.tracks) && r.tracks.includes('voice')
          let d = apart(f.body, o.body)
          if (session && talks && !r.muted && near(d, held.has(o.eid))) {
            want.set(o.eid, { session, body: o.body })
          }
        }
      }
      let now = Date.now()
      for (let [eid, v] of held) {
        let w = want.get(eid)
        let dead = v.heard ? !v.heard.live : v.failed && now - v.failed > AGAIN
        if (!w || w.session != v.session || dead) drop(eid)
      }
      for (let [eid, w] of want) {
        let v = held.get(eid)
        if (!v) void hear(eid, w.session)
        else if (v.heard) {
          if (!v.gain) keep(eid, v)
          v.gain?.gain.setTargetAtTime(
            loud(w.body, f.body),
            v.gain.context.currentTime,
            0.05,
          )
        }
      }
    },
  }
}
