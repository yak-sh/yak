import type { Eid } from '@yaks/graph'

/** The worker's opening module composes roles over a connection or `port`. */
export type Start<T = unknown> = {
  module: string
  me: Eid
  roles: string[]
  data: T
  port?: MessagePort
}
/** Duties and cleanup composed by the opening module. */
export type Host = {
  duties: (signal: AbortSignal, only?: readonly string[]) => Promise<void>
  nudge: () => void
  stop: () => void
  close: () => void | Promise<void>
}
/** Compose a thread host from its roles and cloneable configuration. */
export type Open<T = unknown> = (start: Start<T>) => Host | Promise<Host>
