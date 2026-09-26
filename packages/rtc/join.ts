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

/** How often the lease is renewed, in milliseconds: twice a lease. */
export let RENEW = 30_000

/** A microphone as a voice wants it. */
export let microphone = async (): Promise<MediaStreamTrack> =>
  (await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })).getAudioTracks()[0]

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

let wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

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
      signal: AbortSignal.timeout(15_000),
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

  let pc: RTCPeerConnection
  let sent = new Map<
    string,
    { track: MediaStreamTrack; tx: RTCRtpTransceiver }
  >()
  let heard = new Set<{ dead: boolean }>()
  let muted = false
  let talking = false

  let wear = () =>
    opts.write([{
      entity: { eid: opts.entity },
      rtc: sent.size
        ? { session, tracks: [...sent.keys()], muted, talking }
        : { session, tracks: [], muted, talking: false },
    }])

  let open = async () => {
    key = ''
    let { iceServers } = await ask('POST', 'ice')
    let opened = await ask('POST', 'sessions/new')
    session = opened.sessionId
    key = opened.key
    pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
    let mine = pc
    let lost: ReturnType<typeof setTimeout> | undefined
    pc.onconnectionstatechange = () => {
      if (mine != pc || state == 'left') return
      clearTimeout(lost)
      if (pc.connectionState == 'failed') void rebuild()
      // A connection that drops often comes back by itself; one that stays
      // down is rebuilt.
      if (pc.connectionState == 'disconnected') {
        lost = setTimeout(() => mine == pc && void rebuild(), 5000)
      }
    }
  }

  let push = async (track: MediaStreamTrack, name: string) => {
    let tx = pc.addTransceiver(track, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: BITRATE }],
    })
    await pc.setLocalDescription(await pc.createOffer())
    let res = await ask('POST', on('/tracks/new'), {
      sessionDescription: pc.localDescription,
      tracks: [{ location: 'local', mid: tx.mid, trackName: name }],
    })
    await pc.setRemoteDescription(res.sessionDescription)
    sent.set(name, { track, tx })
  }

  // Close transceivers on this session: stopped here, offered, answered. The
  // last live one is closed without an offer, since an offer with every
  // section stopped has no BUNDLE group, and max-bundle refuses it.
  let close = async (txs: RTCRtpTransceiver[]) => {
    let mids = txs.map((tx) => tx.mid).filter(Boolean)
    for (let tx of txs) tx.stop()
    if (!mids.length || pc.connectionState == 'closed') return
    let tracks = mids.map((mid) => ({ mid }))
    let left = pc.getTransceivers().some((t) =>
      t.mid && t.direction != 'stopped'
    )
    if (!left) {
      return void await ask('PUT', on('/tracks/close'), { tracks, force: true })
    }
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

  let rebuilding: Promise<void> | null = null
  let rebuild = () =>
    rebuilding ??= serial(async () => {
      moved('lost')
      for (let h of heard) h.dead = true
      heard.clear()
      let tracks = [...sent].map(([name, { track }]) => ({ name, track }))
      sent.clear()
      pc.close()
      for (let tries = 0; state != 'left'; tries++) {
        try {
          await open()
          for (let t of tracks) await push(t.track, t.name)
          wear()
          moved('live')
          return
        } catch (e) {
          if (e instanceof Refused && e.code == 'limit') return moved('limit')
          await wait(Math.min(30_000, 1000 * 2 ** tries))
        }
      }
    }).finally(() => rebuilding = null)

  let renew = async () => {
    if (state == 'left' || rebuilding) return
    try {
      await ask('POST', on('/renew'))
      moved('live')
      wear()
    } catch (e) {
      if (!(e instanceof Refused)) return
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
    let now = voice && !muted ? voiced(level, talking) : false
    if (now != talking) {
      talking = now
      wear()
    }
  }

  try {
    await open()
  } catch (e) {
    if (e instanceof Refused) moved(e.code == 'limit' ? 'limit' : 'refused')
    throw e
  }
  moved('live')
  wear()
  let renewing = setInterval(renew, RENEW)
  let hearing = setInterval(() => void listen().catch(() => {}), 200)

  let call: Call = {
    get session() {
      return session
    },
    get state() {
      return state
    },
    publish: (track, name = 'voice') =>
      serial(async () => {
        await push(track, name)
        wear()
        return {
          name,
          stop: () =>
            serial(async () => {
              let held = sent.get(name)
              if (!held || held.track != track) return
              sent.delete(name)
              wear()
              await close([held.tx])
            }),
        }
      }),
    mute: (on) => {
      muted = on
      for (let { track } of sent.values()) track.enabled = !on
      if (on) talking = false
      wear()
    },
    hear: (from, name) =>
      serial(async () => {
        if (state == 'left' || state == 'limit') return null
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
        let mark = { dead: false }
        heard.add(mark)
        let at = pc
        return {
          stream,
          get live() {
            return !mark.dead
          },
          stop: () =>
            serial(async () => {
              el.srcObject = null
              if (mark.dead) return
              mark.dead = true
              heard.delete(mark)
              if (at == pc) await close([tx])
            }),
        }
      }),
    // After whatever negotiation is in flight, so none lands on a closed
    // connection.
    leave: () =>
      serial(() => {
        clearInterval(renewing)
        clearInterval(hearing)
        moved('left')
        for (let h of heard) h.dead = true
        heard.clear()
        sent.clear()
        pc.close()
        opts.write([{ entity: { eid: opts.entity }, rtc: null }])
        return Promise.resolve()
      }),
  }
  return call
}
