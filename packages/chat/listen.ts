// Listening on a platform's socket for as long as its host lives, whatever
// the platform: the loop a Durable Object (or a process) runs around a
// `holder` (./socket.ts). It opens the socket with the bot's credential,
// beats when it is due, connects again when the platform or a silent beat
// says to, and stops for good only on a close the platform says cannot be
// tried again with that credential. Its host calls `alarm` every so often
// (`WATCH`), which opens the socket again if it dropped while nobody was
// awake (a deploy, an eviction), and reads the credential again: a new one
// starts afresh with it, and none closes the socket.

import { backoff, type Clock, system } from '@yaks/fp'
import type {
  Media,
  Platform,
  Present,
  Press,
  Said,
  Seated,
  Voice,
} from './mod.ts'
import { holder, type Wire } from './socket.ts'

/** The host's open socket, as much of a WebSocket as listening uses. */
export type Socket = Wire & {
  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: (
      event: { data?: unknown; code?: number },
    ) => void | Promise<void>,
  ): void
}

/** Open and accept a Workers socket through its HTTP upgrade. */
export let upgraded = async (
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Socket> => {
  let res = await fetcher(url.replace(/^wss:/, 'https:'), {
    headers: { upgrade: 'websocket' },
  })
  let ws = (res as Response & { webSocket?: Socket & { accept(): void } })
    .webSocket
  if (!ws) {
    await res.body?.cancel()
    throw new Error(`${url} did not open a socket: ${res.status}`)
  }
  ws.accept()
  return ws
}

/** What a host gives a listener. */
export type Hosting = {
  platform: Platform
  /** the bot's credential now; none while it is not kept */
  credential: () => Promise<string | undefined>
  /** open a socket at a `wss://` address */
  open: (url: string) => Promise<Socket>
  /** messages heard, to route */
  heard: (said: Said[]) => Promise<void>
  /** what the platform says of the servers the bot is in, to keep */
  seated?: (servers: Seated) => Promise<void>
  /** who the platform says is about, to keep */
  present?: (present: Present[]) => Promise<void>
  /** controls pressed on the bot's messages, to answer with `credential`,
   * the one the socket is open with */
  pressed?: (pressed: Press[], credential: string) => Promise<void>
  /** who the platform says came into, moved in or left voice rooms */
  voices?: (voices: Voice[]) => Promise<void>
  /** where the platform says the bot's own voice audio goes */
  media?: (media: Media) => Promise<void>
  /** a failure no one asked about, for the host's tracker */
  report: (error: unknown) => void
  /** the host's timers, for a test to drive */
  every?: (ms: number, fn: () => void) => () => void
  later?: (ms: number, fn: () => void) => void
  clock?: Clock
}

/** How often the host's alarm should look that the socket is open. */
export let WATCH = 60_000
let OUTAGE = 120_000

export type Status =
  | { open: true }
  | { open: false; waiting?: string; ended?: string }

export type Listener = {
  /** read the credential, and open the socket now if it is not open; what
   * the host's alarm runs */
  alarm: () => Promise<Status>
  status: () => Status
  /** send `frame` on the open socket, as JSON; false while none is open */
  send: (frame: unknown) => boolean
  /** close it and forget the session, as when its credential changed */
  close: () => void
}

let timers = {
  every: (ms: number, fn: () => void) => {
    let id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
}

/** A listener for `host`'s platform. Nothing opens until `alarm` runs. */
export let listener = (host: Hosting): Listener => {
  let every = host.every ?? timers.every
  let clock = host.clock ?? system
  let held: ReturnType<typeof holder> | undefined
  // the credential the socket opens with, as the last alarm read it
  let token: string | undefined
  let socket: Socket | undefined
  let stopBeat = () => {}
  let status: Status = { open: false }
  let opening: Promise<Status> | undefined
  let retry: { at: number; cancel?: () => void } | undefined
  let outage: { since: number; attempts: number; reported: boolean } | undefined
  // how many times it was closed: a socket or a reconnect begun before the
  // last close is not its any more
  let era = 0

  let drop = () => {
    stopBeat()
    stopBeat = () => {}
    let s = socket
    socket = undefined
    status = { open: false }
    try {
      s?.close(4000)
    } catch { /* it was closing already */ }
  }
  let follow = (s: Socket, next: { every?: number; again?: boolean }) => {
    if (socket != s) return
    if (next.every) {
      stopBeat()
      stopBeat = every(next.every, () => follow(s, held!.beat(s)))
    }
    if (next.again) {
      drop()
      again()
    }
  }
  let cancelRetry = () => {
    retry?.cancel?.()
    retry = undefined
  }
  let again = (ms = 1000) => {
    let next = retry = { at: clock.now() + ms }
    let resume = () => {
      if (retry != next) return
      retry = undefined
      return open()
    }
    if (host.later) host.later(ms, resume)
    else retry.cancel = clock.after(ms, resume)
  }
  let failed = (error: unknown) => {
    let now = clock.now()
    let down = outage ??= { since: now, attempts: 0, reported: false }
    down.attempts++
    again(Math.min(WATCH, backoff(down.attempts)))
    if (down.reported || now - down.since < OUTAGE) return
    down.reported = true
    let why = error instanceof Error ? error.message : String(error)
    host.report(
      new Error(
        `${host.platform.title} could not open its socket after ${down.attempts} attempts: ${why}`,
        { cause: error },
      ),
    )
  }
  // An alarm joins an opening or leaves a pending retry alone until it is due.
  let open = (): Promise<Status> => {
    if (opening) return opening
    if (retry && clock.now() < retry.at) return Promise.resolve(status)
    cancelRetry()
    let pending = connect(era).finally(() => {
      if (opening == pending) opening = undefined
    })
    return opening = pending
  }
  let connect = async (at: number): Promise<Status> => {
    try {
      if (socket) return status
      if (!token) {
        return status = {
          open: false,
          waiting: `no ${host.platform.title} bot is kept yet`,
        }
      }
      let credential = token
      let { pressed } = host
      held ??= holder(host.platform.socket!(token), {
        heard: host.heard,
        seated: host.seated,
        present: host.present,
        voices: host.voices,
        media: host.media,
        ...pressed ? { pressed: (p: Press[]) => pressed(p, credential) } : {},
      })
      let url = held.url()
      let s: Socket
      try {
        s = await host.open(url)
      } catch (error) {
        if (at == era) failed(error)
        return status
      }
      if (at != era) {
        s.close(4000)
        return status
      }
      socket = s
      outage = undefined
      status = { open: true }
      s.addEventListener('message', (event) => {
        if (socket != s) return
        return held!.frame(s, String(event.data)).then(
          (next) => follow(s, next),
          host.report,
        )
      })
      s.addEventListener('close', (event) => {
        if (socket != s) return
        drop()
        let ended = held!.ended(event.code ?? 1006)
        if (ended) {
          held = undefined
          status = { open: false, ended }
          host.report(
            new Error(`${host.platform.title} closed its socket: ${ended}`),
          )
          return
        }
        again()
      })
      return status
    } catch (error) {
      host.report(error)
      if (at == era) drop()
      return status
    }
  }

  let close = () => {
    era++
    opening = undefined
    cancelRetry()
    outage = undefined
    drop()
    held = undefined
  }

  return {
    alarm: async () => {
      let now: string | undefined
      try {
        now = await host.credential()
      } catch (error) {
        host.report(error)
        return status
      }
      if (now != token) {
        close()
        token = now
      }
      return 'ended' in status && status.ended ? status : open()
    },
    status: () => status,
    send: (frame) => {
      if (!socket) return false
      socket.send(JSON.stringify(frame))
      return true
    },
    close,
  }
}
