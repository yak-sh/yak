// Players talking (D-40615): the microphone stays off until the player turns
// it on (T, or the tray's microphone), and every hero on the level within earshot who
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
import { loud, near, TALK } from './voice.ts'
import { voiceMeter } from './voice-meter.ts'
import { micHint, type MicSignal, senderActive } from './mic-health.ts'

// How long a voice that could not be had waits before it is asked again.
let AGAIN = 5000

// @yaks/rtc, loaded the first time anyone speaks or is heard: the vale plays
// without it, and plays on if it cannot be had.
let lib: typeof import('@yaks/rtc') | null = null
let rtc = () => import('@yaks/rtc').then((m) => lib = m)

/** How the microphone stands, as its button shows it. */
export type Mic = 'off' | 'starting' | 'on' | 'denied' | 'missing' | 'spent'

// One voice asked for: the session it comes from, its stream once it arrives
// (null while asked, or when it could not be had, `at` then), and the gain it
// plays through while the engine keeps it.
type Voice = {
  session: string
  heard: Heard | null
  failed: number
  gain: GainNode | null
  analyser: AnalyserNode | null
  let: () => void
  gone: boolean
}

let apart = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** The vale's voices, for the page `net` plays. `told` hears the microphone
 * move, for its button. */
export let voices = (net: Net, told: (m: Mic) => void) => {
  let call: Promise<Call> | null = null
  let as: string | null = null
  // A fresh call must not publish this hero before the previous one clears
  // its presence, even if its join or leave is still in flight.
  let leaving: Promise<void> = Promise.resolve()
  let retire = (old: Promise<Call> | null) => {
    if (old) {
      leaving = leaving.then(() => old.then((c) => c.leave()))
        .catch(() => {})
    }
  }
  let mic: Mic = 'off'
  let track: MediaStreamTrack | null = null
  let sent: { stop: () => Promise<void> } | null = null
  let startedAt = 0
  let lastInput = 0
  let signal: MicSignal | null = null
  let checking = false
  let attempt = 0
  let sending = false
  let checkedAt = 0
  let held = new Map<string, Voice>()
  let local: {
    analyser: AnalyserNode
    source: MediaStreamAudioSourceNode
    silence: GainNode
    context: AudioContext | null
  } | null = null
  let stopMeter = () => {
    if (!local) return
    local.source.disconnect()
    local.analyser.disconnect()
    local.silence.disconnect()
    if (local.context) void local.context.close()
    local = null
  }
  let startMeter = (track: MediaStreamTrack) => {
    stopMeter()
    // The game's context may be asleep if the player has muted its sounds.
    let context = new AudioContext()
    void context.resume().catch(() => {})
    try {
      let source = context.createMediaStreamSource(new MediaStream([track]))
      let analyser = context.createAnalyser()
      analyser.fftSize = 256
      let silence = context.createGain()
      silence.gain.value = 0
      source.connect(analyser).connect(silence).connect(context.destination)
      local = { analyser, source, silence, context }
    } catch (error) {
      void context.close()
      throw error
    }
  }
  let moved = (m: Mic) => told(mic = m)
  let micState = (): Mic => mic
  // End capture immediately, even if an in-flight publish has not returned
  // its stop handle yet. Its completion checks `attempt` and stops itself.
  let releaseMic = () => {
    ++attempt
    signal = null
    sending = false
    let was = sent
    sent = null
    if (track) track.onended = null
    track?.stop()
    stopMeter()
    track = null
    void was?.stop().catch(() => {})
  }

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
    v.analyser?.disconnect()
    void v.heard?.stop().catch(() => {})
  }

  // The call, joined as the hero this tab plays, and joined again if it
  // plays another.
  let joined = (): Promise<Call> => {
    if (call && as == net.hero) return call
    retire(call)
    for (let eid of [...held.keys()]) drop(eid)
    let hero = net.hero
    as = hero
    let made = leaving.then(() => rtc()).then(({ join }) =>
      join({
        entity: hero!,
        write: (b) => net.client.mutate(b),
        change: (s) => {
          if (s == 'limit' && call == made) {
            releaseMic()
            moved('spent')
          }
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
      analyser: null,
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
      let analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser).connect(gain).connect(into)
      v.analyser = analyser
      v.gain = gain
      return () => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1)
        setTimeout(() => src.disconnect(), 500)
        if (v.gain == gain) {
          v.gain = null
          v.analyser = null
        }
        analyser.disconnect()
      }
    }, TALK)
  }

  return {
    get mic() {
      return mic
    },
    /** The browser-chosen input is private to this player's button. */
    get input() {
      return track?.label || null
    },
    /** Sender level plus an active connection and outbound RTP, not merely a
     * lit mic toggle or an echo from our own audio monitor. */
    get sending() {
      return mic == 'on' && sending
    },
    /** Samples at the listener for others, and at the microphone for me.
     * Only my plate diagnoses my device: never infer a peer's mic state. */
    meter: (eid: string) => {
      if (eid != net.hero) {
        let analyser = held.get(eid)?.analyser
        return analyser ? voiceMeter(analyser) : null
      }
      let measured = local?.context?.state == 'running'
        ? voiceMeter(local.analyser)
        : null
      let now = Date.now()
      if (measured?.talking) lastInput = now
      let hint = micHint(mic, track?.readyState ?? null, measured, signal, {
        now,
        startedAt,
        lastInput,
      })
      return { ...measured, hint }
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
      let begun = ++attempt
      if (mic == 'on') {
        releaseMic()
        moved('off')
        return
      }
      let hero = net.hero
      moved('starting')
      let captured: MediaStreamTrack
      try {
        captured = await (await rtc()).microphone()
      } catch (error) {
        if (attempt != begun || micState() != 'starting') return
        return moved(
          error instanceof DOMException &&
            (error.name == 'NotFoundError' ||
              error.name == 'DevicesNotFoundError')
            ? 'missing'
            : 'denied',
        )
      }
      if (micState() != 'starting' || net.hero != hero || attempt != begun) {
        captured.stop()
        if (micState() == 'starting') moved('off')
        return
      }
      track = captured
      // Observe a device disappearing even while publish is still pending.
      captured.onended = () => {
        if (track != captured) return
        ++attempt
        stopMeter()
        track = null
        signal = null
        sending = false
        moved('missing')
        let was = sent
        sent = null
        void was?.stop().catch(() => {})
      }
      if (captured.readyState == 'ended') captured.onended(new Event('ended'))
      if (track != captured) return
      try {
        try {
          startMeter(captured)
        } catch {
          /* Meter may be unavailable; publishing can still work. */
          stopMeter()
        }
        let published = await (await joined()).publish(captured)
        if (micState() != 'starting' || net.hero != hero || attempt != begun) {
          captured.stop()
          void published.stop().catch(() => {})
          if (track == captured) {
            stopMeter()
            track = null
          }
          if (micState() == 'starting' && attempt == begun) moved('off')
          return
        }
        sent = published
        startedAt = lastInput = Date.now()
        signal = null
        sending = false
        checkedAt = 0
        if (captured.readyState == 'ended') {
          captured.onended?.(new Event('ended'))
          return
        }
        moved('on')
      } catch {
        captured.stop()
        if (track == captured) {
          stopMeter()
          track = null
          sent = null
          signal = null
          sending = false
        }
        if (attempt == begun && micState() == 'starting') moved('off')
      }
    },
    /** Each frame: the vale played through the loop while the microphone is
     * on, the voices within earshot asked for, the ones out of it let go, and
     * each one heard placed and faded. */
    tick: (f: Frame) => {
      // The session belongs to the hero that joined it. Never keep a live
      // microphone (or an old RTC presence) when this tab changes heroes.
      if (as && as != net.hero) {
        releaseMic()
        moved('off')
        let old = call
        call = null
        as = null
        retire(old)
        for (let eid of [...held.keys()]) drop(eid)
      }
      // Check the actual sender separately from capture. A lively local trace
      // cannot prove that RTP is leaving this device.
      if (mic == 'on' && call && Date.now() - checkedAt >= 1000 && !checking) {
        checkedAt = Date.now()
        checking = true
        let captured = track, joinedAs = call
        void joinedAs.then((c) => c.diagnose()).then((s) => {
          if (mic != 'on' || track != captured || call != joinedAs) return
          sending = senderActive(signal, s)
          signal = s
        }).catch(() => {
          if (track == captured) sending = false
        }).finally(() => checking = false)
      }
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
      let speaking = [...held.values()].some((v) =>
        v.analyser && (v.gain?.gain.value ?? 0) > 0.02 &&
        voiceMeter(v.analyser).talking
      )
      sound.duckVoice(speaking)
      sound.music.duck(speaking || mic == 'on')
    },
  }
}
