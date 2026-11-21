// Holding a platform's socket, whatever the platform. A `Socket` says in pure
// steps what to do with each frame (mod.ts); the holder runs them over a wire
// its host opens, so the host (a Durable Object, a process on the box) only
// connects, keeps time and closes, and knows no platform.

import type { Present, Said, Seated, Socket, Step } from './mod.ts'

/** The host's end of an open socket: send a text frame, or close it. */
export type Wire = {
  send: (text: string) => void
  close: (code?: number) => void
}

/** What the host does next: beat every `every` milliseconds from now, or
 * close this wire and open another at `url()`. */
export type Next = { every?: number; again?: boolean }

export type Holder = {
  /** where to connect now: a resumed session's address after a drop */
  url: () => string
  /** a frame that arrived, its text parsed as JSON */
  frame: (wire: Wire, text: string) => Promise<Next>
  /** the beat that is due */
  beat: (wire: Wire) => Next
  /** why a close with `code` cannot be tried again, if it cannot; one the
   * socket answers by changing what it remembers is tried again */
  ended: (code: number) => string | undefined
}

/**
 * A holder of `socket`, telling `heard` each message it reads, `seated`
 * what the platform says of the servers the bot is in, and `present` who
 * it says is about. The state a
 * socket remembers survives a reconnect, so a platform that resumes a session
 * (Discord's) misses nothing between wires. A frame that is not JSON is
 * passed on as the text it is.
 */
export let holder = <S>(
  socket: Socket<S>,
  heard: (said: Said[]) => unknown,
  seated?: (servers: Seated) => unknown,
  present?: (present: Present[]) => unknown,
): Holder => {
  let state = socket.start
  let run = (wire: Wire, step: Step<S>): Next => {
    state = step.state
    for (let f of step.send ?? []) wire.send(JSON.stringify(f))
    return {
      ...step.every ? { every: step.every } : {},
      ...step.again ? { again: true } : {},
    }
  }
  return {
    url: () => socket.url(state),
    frame: async (wire, text) => {
      let frame: unknown
      try {
        frame = JSON.parse(text)
      } catch {
        frame = text
      }
      let step = socket.step(state, frame)
      let next = run(wire, step)
      if (step.servers) await seated?.(step.servers)
      if (step.present?.length) await present?.(step.present)
      if (step.heard?.length) await heard(step.heard)
      return next
    },
    beat: (wire) => run(wire, socket.beat(state)),
    ended: (code) => {
      let changed = socket.closed?.(state, code)
      if (changed === undefined) return socket.ends?.(code)
      state = changed
    },
  }
}
