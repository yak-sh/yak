// Holding a platform's socket, whatever the platform. A `Socket` says in pure
// steps what to do with each frame (mod.ts); the holder runs them over a wire
// its host opens, so the host (a Durable Object, a process on the box) only
// connects, keeps time and closes, and knows no platform.

import type {
  Media,
  Present,
  Press,
  Said,
  Seated,
  Socket,
  Step,
  Voice,
} from './mod.ts'

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

/** What a holder tells of what its socket read: each message `heard`, what
 * the platform says of the servers the bot is in (`seated`), who it says is
 * about (`present`), the controls pressed on the bot's messages
 * (`pressed`), who it says came into, moved in or left voice rooms
 * (`voices`), and where the bot's own voice audio goes (`media`). */
export type Telling = {
  heard: (said: Said[]) => unknown
  seated?: (servers: Seated) => unknown
  present?: (present: Present[]) => unknown
  pressed?: (pressed: Press[]) => unknown
  voices?: (voices: Voice[]) => unknown
  media?: (media: Media) => unknown
}

/**
 * A holder of `socket`, telling `tell` what it reads. The state a socket
 * remembers survives a reconnect, so a platform that resumes a session
 * (Discord's) misses nothing between wires. A frame that is not JSON is
 * passed on as the text it is.
 */
export let holder = <S>(socket: Socket<S>, tell: Telling): Holder => {
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
      // A press is answered within moments, so it is told first.
      if (step.pressed?.length) await tell.pressed?.(step.pressed)
      // Record the voice snapshot before server lookups can let a later
      // voice update overtake it.
      if (step.voices?.length) await tell.voices?.(step.voices)
      if (step.servers) await tell.seated?.(step.servers)
      if (step.present?.length) await tell.present?.(step.present)
      if (step.media) await tell.media?.(step.media)
      if (step.heard?.length) await tell.heard(step.heard)
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
