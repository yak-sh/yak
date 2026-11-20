// Listening on a platform's socket for as long as its host lives, whatever
// the platform: the loop a Durable Object (or a process) runs around a
// `holder` (./socket.ts). It opens the socket with the bot's credential,
// beats when it is due, connects again when the platform or a silent beat
// says to, and stops for good only on a close the platform says cannot be
// tried again with that credential. Its host calls `alarm` every so often
// (`WATCH`), which opens the socket again if it dropped while nobody was
// awake: a deploy, an eviction.

import type { Platform, Said } from './mod.ts'
import { holder, type Wire } from './socket.ts'

/** The host's open socket, as much of a WebSocket as listening uses. */
export type Socket = Wire & {
  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: (event: { data?: unknown; code?: number }) => void,
  ): void
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
  /** a failure no one asked about, for the host's tracker */
  report: (error: unknown) => void
  /** the host's timers, for a test to drive */
  every?: (ms: number, fn: () => void) => () => void
  later?: (ms: number, fn: () => void) => void
}

/** How often the host's alarm should look that the socket is open. */
export let WATCH = 60_000

export type Status =
  | { open: true }
  | { open: false; waiting?: string; ended?: string }

export type Listener = {
  /** open the socket now if it is not open; what the host's alarm runs */
  alarm: () => Promise<Status>
  status: () => Status
  /** close it and forget the session, as when its credential changed */
  close: () => void
}

let timers = {
  every: (ms: number, fn: () => void) => {
    let id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  later: (ms: number, fn: () => void) => void setTimeout(fn, ms),
}

/** A listener for `host`'s platform. Nothing opens until `alarm` runs. */
export let listener = (host: Hosting): Listener => {
  let every = host.every ?? timers.every
  let later = host.later ?? timers.later
  let held: ReturnType<typeof holder> | undefined
  let socket: Socket | undefined
  let stopBeat = () => {}
  let status: Status = { open: false }
  let opening: Promise<Status> | undefined

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
  let follow = (next: { every?: number; again?: boolean }) => {
    if (next.every) {
      stopBeat()
      let s = socket!
      stopBeat = every(next.every, () => follow(held!.beat(s)))
    }
    if (next.again) {
      drop()
      later(1000, () => void open())
    }
  }
  // One opening at a time: an alarm while one is under way joins it.
  let open = (): Promise<Status> =>
    opening ??= connect().finally(() => opening = undefined)
  let connect = async (): Promise<Status> => {
    try {
      if (socket) return status
      let token = await host.credential()
      if (!token) {
        return status = {
          open: false,
          waiting: `no ${host.platform.title} bot is kept yet`,
        }
      }
      held ??= holder(host.platform.socket!(token), host.heard)
      let s = await host.open(held.url())
      socket = s
      status = { open: true }
      s.addEventListener('message', (event) => {
        if (socket != s) return
        held!.frame(s, String(event.data)).then(follow, host.report)
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
        later(1000, () => void open())
      })
      return status
    } catch (error) {
      host.report(error)
      drop()
      return status
    }
  }

  return {
    alarm: () =>
      'ended' in status && status.ended ? Promise.resolve(status) : open(),
    status: () => status,
    close: () => {
      drop()
      held = undefined
    },
  }
}
