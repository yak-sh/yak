// Calls: a number rang, the provider's commands for it, and the line its
// audio streams over. Providers own their wire formats; these are the shapes
// a host sees, the same for every provider.

/** A call that rang: who called which number, and the provider's id for it. */
export type Ring = { id: string; from: string; to: string; at: string }

/** What a provider is asked to do with a call. */
export type Caller = {
  /** pick up, streaming the call's audio both ways over `stream`, a wss URL */
  answer: (id: string, stream: string) => Promise<void>
  /** refuse a call that rang and was not answered */
  reject: (id: string) => Promise<void>
  /** end an answered call */
  hangup: (id: string) => Promise<void>
}

/** One frame from the call's audio stream, as far as a host need know. */
export type Frame = {
  /** the stream began, for this call */
  start?: { call: string }
  /** what the caller said, as raw samples in the line's format */
  audio?: Uint8Array
  /** the call ended */
  stop?: true
  /** what was sent before a mark has played */
  played?: string
}

/** How a provider's audio stream speaks: what its frames mean, and the
 * frames that play audio to the caller, stop it, and mark where it ends. */
export type Line = {
  format: { encoding: 'mulaw'; rate: number }
  /** what a minute of an answered call costs, its stream included */
  perMinute: number
  frame: (data: string) => Frame
  play: (audio: Uint8Array) => string
  clear: () => string
  mark: (name: string) => string
}
