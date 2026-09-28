// The page half: one RTCPeerConnection to Cloudflare Realtime, reached
// through the app's door (./door.ts), and the `rtc` component the page wears
// while it speaks.
//
// A call is one Realtime session. `publish` sends a track from it and names
// the track in `rtc`, which the relay carries to everyone watching the entity
// (@yaks/sync); `hear` asks for another session's track and hands back its
// stream. Nobody holds a room: a page hears the voices it asks for, and a
// voice goes quiet for everyone when the tab that wore it closes, since the
// relay clears `rtc` with the connection.
//
// The call keeps itself up. It renews its lease through the door about every
// half minute and re-writes `rtc` with it, so a listener that missed it hears
// it again. A connection that fails, or a lease the door no longer holds, is a
// new session: the call opens one, publishes again and says `lost` for the
// voices it heard, which the page asks for again. A voice going quiet never
// stops the page.
//
// A call opens with its voice already in place: the first section of the
// connection is a sender named `voice`, silent until a microphone is
// published into it, and never closed while the call lasts. The first section
// is the BUNDLE tag, which carries the connection's one transport; closing it
// makes Chrome start a new transport, which Realtime takes for a disconnected
// session. So turning the microphone off and on again swaps the sender's track
// and asks Realtime nothing, and every other section, a voice heard or another
// track sent, can come and go.
//
// Chrome plays a remote track that feeds only Web Audio as silence: the
// stream must also play through a media element, muted if the page plays it
// some other way. So every stream `hear` hands back is already playing
// through a muted <audio>.

import type { Bundle } from '@yaks/graph'
import { KEY } from './door.ts'

/** How a call stands. `limit` is the space's allowance used up: the lease
 * runs out and the voices go quiet until it lifts. `refused` is a caller the
 * app does not let speak. */
export type State = 'joining' | 'live' | 'limit' | 'refused' | 'lost' | 'left'

export type Opts = {
  /** the entity the page speaks as, which wears `rtc` */
  entity: string
  /** how the page writes a bundle into its graph */
  write: (bundles: Bundle[]) => unknown
  /** the app's Realtime door: `./api/rtc/` beside the page unless named */
  door?: string | URL
  /** told whenever the call's state moves */
  change?: (state: State) => void
  fetch?: typeof fetch
}

/** A snapshot of the actual microphone sender, not a promise that a listener
 * hears it. A null statistic means this browser does not expose that field. */
export type MicSignal = {
  ready: boolean
  enabled: boolean
  connected: boolean
  level: number | null
  energy: number | null
  duration: number | null
  packets: number | null
}

/** A track the call publishes. */
export type Published = { name: string; stop: () => Promise<void> }

/** A track the call hears: its stream, while `live`. */
export type Heard = {
  stream: MediaStream
  readonly live: boolean
  stop: () => Promise<void>
}

export type Call = {
  readonly session: string
  readonly state: State
  publish: (track: MediaStreamTrack, name?: string) => Promise<Published>
  mute: (muted: boolean) => void
  /** Inspect the published sender, for local input and transport guidance. */
  diagnose: (name?: string) => Promise<MicSignal | null>
  hear: (session: string, track: string) => Promise<Heard | null>
  leave: () => Promise<void>
}

/** A door's refusal, with its code: `limit`, `not_found`, `not_yours`. */
export class Refused extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = 'Refused'
    this.code = code
    this.status = status
  }
}

/** What Opus is capped at, in bits a second: a voice, not a song. */
export let BITRATE = 32_000

/** The track a call opens with, silent until a microphone is published into
 * it: the name `publish` takes unless told another. */
export let VOICE = 'voice'

/** How often the lease is renewed, in milliseconds: twice a lease. */
export let RENEW = 30_000

/** A microphone as a voice wants it. */
export let microphone = async (): Promise<MediaStreamTrack> => {
  let stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  let track = stream.getAudioTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new DOMException('No audio input was returned', 'NotFoundError')
  }
  return track
}

/**
 * Whether a microphone is hearing a voice, from its level (0 to 1) and
 * whether it was a moment ago: it starts above one line and stops below a
 * lower one, so a voice between the two does not flicker.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { voiced } from './join.ts'
 *
 * assertEquals(voiced(0.2, false), true)
 * assertEquals(voiced(0.03, false), false)
 * assertEquals(voiced(0.03, true), true)
 * assertEquals(voiced(0.005, true), false)
 * ```
 */
export let voiced = (level: number, was: boolean) =>
  level >= (was ? 0.01 : 0.04)

/** Open a call: a session at Realtime, through the app's door. */
export let join = async (opts: Opts): Promise<Call> => {
  let door = new URL(opts.door ?? 'api/rtc/', document.baseURI)
  let send = opts.fetch ?? fetch.bind(globalThis)
  let state: State = 'joining'
  let moved = (s: State) => {
    if (s == state) return
    state = s
    opts.change?.(s)
  }

  let leaving = new AbortController()
  let hasLeft = () => leaving.signal.aborted
  let session = ''
  let key = ''
  let ask = async (method: string, path: string, body?: unknown) => {
    let res = await send(new URL(path, door), {
      method,
      credentials: 'same-origin',
      headers: {
        ...(key ? { [KEY]: key } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(15_000), leaving.signal]),
    })
    let said = await res.json().catch(() => null)
    if (!res.ok) {
      let e = said?.error ?? {}
      throw new Refused(
        e.code ?? 'unavailable',
        e.message ?? `the door answered ${res.status}`,
        res.status,
      )
    }
    return said
  }
  let on = (path = '') => `sessions/${session}${path}`

  // One negotiation at a time: each is an offer and an answer, and a second
  // started before the first settles would answer the wrong offer.
  let queue: Promise<unknown> = Promise.resolve()
  let serial = <T>(fn: () => Promise<T>): Promise<T> => {
    let next = queue.then(fn, fn)
    queue = next.catch(() => {})
    return next
  }

  let pc!: RTCPeerConnection
  let voice: RTCRtpTransceiver
  let sent = new Map<
    string,
    { track: MediaStreamTrack; tx: RTCRtpTransceiver }
  >()
  let heard = new Set<{ dead: boolean; detach: () => void }>()
  let cancelBackoff: (() => void) | null = null
  let muted = false
  let talking = false

  // Graph writes may be asynchronous. Keep their order even when an older
  // publication is still settling as a call leaves and another joins.
  let writes: Promise<void> = Promise.resolve()
  let writePresence = (rtc: Bundle['rtc']) => {
    let next = writes.then(() =>
      opts.write([{
        entity: { eid: opts.entity },
        rtc,
      }])
    ).then(() => {})
    writes = next.catch(() => {})
    return next
  }
  let wear = () =>
    hasLeft() ? Promise.resolve() : writePresence(
      sent.size
        ? { session, tracks: [...sent.keys()], muted, talking }
        : { session, tracks: [], muted, talking: false },
    )

  let open = async () => {
    key = ''
    let { iceServers } = await ask('POST', 'ice')
    if (hasLeft()) return
    let opened = await ask('POST', 'sessions/new')
    if (hasLeft()) return
    session = opened.sessionId
    key = opened.key
    pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
    let mine = pc
    let lost: ReturnType<typeof setTimeout> | undefined
    pc.onconnectionstatechange = () => {
      if (mine != pc || hasLeft()) return
      clearTimeout(lost)
      if (pc.connectionState == 'failed') void rebuild()
      // A connection that drops often comes back by itself; one that stays
      // down is rebuilt.
      if (pc.connectionState == 'disconnected') {
        lost = setTimeout(() => mine == pc && void rebuild(), 5000)
      }
    }
    voice = await sender(null, VOICE)
    if (hasLeft()) pc.close()
  }

  // A sender section, offered and answered as a local track of the session.
  let sender = async (track: MediaStreamTrack | null, name: string) => {
    let tx = pc.addTransceiver(track ?? 'audio', {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: BITRATE }],
    })
    await pc.setLocalDescription(await pc.createOffer())
    let res = await ask('POST', on('/tracks/new'), {
      sessionDescription: pc.localDescription,
      tracks: [{ location: 'local', mid: tx.mid, trackName: name }],
    })
    await pc.setRemoteDescription(res.sessionDescription)
    return tx
  }

  let push = async (track: MediaStreamTrack, name: string) => {
    let previous = sent.get(name)
    let live = () => track.readyState != 'ended'
    let tx = name == VOICE ? voice : await sender(track, name)
    if (
      hasLeft() || !live() ||
      (previous && sent.get(name) != previous)
    ) {
      if (tx != voice) tx.stop()
      return
    }
    if (tx == voice) await voice.sender.replaceTrack(track)
    if (
      hasLeft() || !live() ||
      (previous && sent.get(name) != previous)
    ) {
      await tx.sender.replaceTrack(null).catch(() => {})
      if (tx != voice) tx.stop()
      return
    }
    sent.set(name, { track, tx })
  }

  // Close transceivers on this session: stopped here, offered, answered. The
  // voice's section is never among them, so the offer keeps its BUNDLE tag.
  let close = async (txs: RTCRtpTransceiver[]) => {
    let mids = txs.map((tx) => tx.mid).filter(Boolean)
    for (let tx of txs) tx.stop()
    if (!mids.length || pc.connectionState == 'closed') return
    let tracks = mids.map((mid) => ({ mid }))
    await pc.setLocalDescription(await pc.createOffer())
    let res = await ask('PUT', on('/tracks/close'), {
      tracks,
      sessionDescription: pc.localDescription,
      force: false,
    })
    if (res.sessionDescription) {
      await pc.setRemoteDescription(res.sessionDescription)
    }
  }

  // Leave does not wait for a failing connection's backoff or negotiations.
  let backoff = (ms: number) =>
    new Promise<void>((resolve) => {
      let timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        if (cancelBackoff == done) cancelBackoff = null
        resolve()
      }
      cancelBackoff = done
    })

  let rebuilding: Promise<void> | null = null
  let rebuild = () =>
    rebuilding ??= serial(async () => {
      moved('lost')
      for (let h of heard) {
        h.dead = true
        h.detach()
      }
      heard.clear()
      pc.close()
      for (let tries = 0; !hasLeft(); tries++) {
        try {
          await open()
          if (hasLeft()) {
            pc.close()
            return
          }
          // A stopped input is removed from sent immediately, even while
          // the rebuild is awaiting a failing door or its backoff.
          for (let [name, { track }] of [...sent]) {
            if (hasLeft()) return
            if (sent.get(name)?.track == track) await push(track, name)
          }
          if (hasLeft()) return
          await wear()
          if (hasLeft()) return
          moved('live')
          return
        } catch (e) {
          if (hasLeft()) return
          if (e instanceof Refused && e.code == 'limit') return moved('limit')
          await backoff(Math.min(30_000, 1000 * 2 ** tries))
        }
      }
    }).finally(() => rebuilding = null)

  let renew = async () => {
    if (hasLeft() || rebuilding) return
    try {
      await ask('POST', on('/renew'))
      if (hasLeft()) return
      moved('live')
      await wear()
    } catch (e) {
      if (hasLeft() || !(e instanceof Refused)) return
      if (e.code == 'limit') moved('limit')
      else if (e.status == 404) void rebuild()
    }
  }

  // How loud the microphone is, off the sender's own statistics, so nothing
  // here needs an AudioContext.
  let listen = async () => {
    let voice = [...sent.values()][0]
    let level = 0
    if (voice && !muted) {
      for (let r of (await voice.tx.sender.getStats()).values()) {
        if (r.type == 'media-source' && typeof r.audioLevel == 'number') {
          level = r.audioLevel
        }
      }
    }
    if (hasLeft()) return
    let now = voice && !muted ? voiced(level, talking) : false
    if (now != talking) {
      talking = now
      await wear()
    }
  }

  try {
    await open()
  } catch (e) {
    if (e instanceof Refused) moved(e.code == 'limit' ? 'limit' : 'refused')
    throw e
  }
  try {
    await wear()
  } catch (error) {
    // An asynchronous graph refusal during setup must not leave an open RTC
    // session with no Call handle that could close it.
    leaving.abort()
    pc.close()
    throw error
  }
  if (hasLeft()) {
    pc.close()
    throw new Error('The call has left')
  }
  moved('live')
  let renewing = setInterval(renew, RENEW)
  let hearing = setInterval(() => void listen().catch(() => {}), 200)

  let call: Call = {
    get session() {
      return session
    },
    get state() {
      return state
    },
    publish: (track, name = VOICE) =>
      serial(async () => {
        if (hasLeft()) throw new Error('The call has left')
        await push(track, name)
        if (hasLeft() || track.readyState == 'ended') {
          let held = sent.get(name)
          if (held?.track == track) {
            sent.delete(name)
            await held.tx.sender.replaceTrack(null).catch(() => {})
          }
          throw new Error('The call or microphone has ended')
        }
        try {
          await wear()
          if (hasLeft()) throw new Error('The call has left')
        } catch (error) {
          // If the graph refuses the write, do not strand a sender without
          // a stop handle. The media is detached even if renegotiation fails.
          let held = sent.get(name)
          if (held?.track == track) {
            sent.delete(name)
            if (held.tx == voice) await voice.sender.replaceTrack(null)
            else await close([held.tx]).catch(() => {})
          }
          throw error
        }
        return {
          name,
          stop: async () => {
            let held = sent.get(name)
            if (!held || held.track != track) return
            sent.delete(name)
            // Presence and outgoing audio must go away now, not after a
            // reconnect's 30-second backoff in the negotiation queue.
            if (held.tx == voice) {
              await held.tx.sender.replaceTrack(null).catch(() => {})
            } else {
              // Stop sending even if a reconnection holds the negotiation queue.
              held.tx.stop()
              let at = pc
              void serial(async () => {
                if (!hasLeft() && at == pc) await close([held.tx])
              }).catch(() => {})
            }
            await wear()
          },
        }
      }),
    diagnose: async (name = VOICE) => {
      let selected = sent.get(name)
      if (!selected) return null
      let stats = await selected.tx.sender.getStats()
      let level: number | null = null
      let energy: number | null = null
      let duration: number | null = null
      let packets: number | null = null
      for (let r of stats.values()) {
        if (r.type == 'media-source') {
          if (typeof r.audioLevel == 'number') level = r.audioLevel
          if (typeof r.totalAudioEnergy == 'number') energy = r.totalAudioEnergy
          if (typeof r.totalSamplesDuration == 'number') {
            duration = r.totalSamplesDuration
          }
        }
        if (
          r.type == 'outbound-rtp' && r.kind == 'audio' &&
          typeof r.packetsSent == 'number'
        ) packets = r.packetsSent
      }
      return {
        ready: selected.track.readyState == 'live',
        enabled: selected.track.enabled,
        connected: pc.connectionState == 'connected',
        level,
        energy,
        duration,
        packets,
      }
    },
    mute: (on) => {
      muted = on
      for (let { track } of sent.values()) track.enabled = !on
      if (on) talking = false
      void wear().catch(() => {})
    },
    hear: (from, name) =>
      serial(async () => {
        if (hasLeft() || state == 'limit') return null
        let res = await ask('POST', on('/tracks/new'), {
          tracks: [{ location: 'remote', sessionId: from, trackName: name }],
        })
        let got = res.tracks?.[0]
        if (!got?.mid || got.errorCode) return null
        await pc.setRemoteDescription(res.sessionDescription)
        await pc.setLocalDescription(await pc.createAnswer())
        await ask('PUT', on('/renegotiate'), {
          sessionDescription: pc.localDescription,
        })
        let tx = pc.getTransceivers().find((t) => t.mid == got.mid)
        if (!tx) return null
        let stream = new MediaStream([tx.receiver.track])
        let el = new Audio()
        el.muted = true
        el.srcObject = stream
        el.play().catch(() => {})
        let mark = {
          dead: false,
          detach: () => {
            el.srcObject = null
          },
        }
        heard.add(mark)
        let at = pc
        return {
          stream,
          get live() {
            return !mark.dead
          },
          stop: () =>
            serial(async () => {
              mark.detach()
              if (mark.dead) return
              mark.dead = true
              heard.delete(mark)
              if (at == pc && !hasLeft()) await close([tx])
            }),
        }
      }),
    // Leave cannot wait behind a reconnect's backoff or a stuck door.
    // Its caller may immediately join again as this hero; the presence write
    // is performed before this promise settles.
    leave: async () => {
      if (hasLeft()) return
      clearInterval(renewing)
      clearInterval(hearing)
      moved('left')
      leaving.abort()
      cancelBackoff?.()
      for (let h of heard) {
        h.dead = true
        h.detach()
      }
      heard.clear()
      sent.clear()
      pc.close()
      await writePresence(null)
    },
  }
  return call
}
