/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
// The other side of ./thread.ts: a worker that composes the graph a config
// names for the duty roles it is handed, as a host of its own under the name
// the process gave it, and runs those duties until it is told to close.
//
// It either runs one pass of its roles or goes live and keeps at every one
// until told to stop. Live duties do their first pass themselves: putting a
// separate pass in front would let one slow sweep hold every service closed.
// A command passing through never starts it. Told to stop, it winds down as
// any host does (host.ts `stop`): it claims no new run and starts no new step,
// and what is running goes on. Told to close, it closes its graph, which waits
// for what is running to finish; what is left owed is the next worker's.
// Failures go back to the process.

import { become } from '@yaks/process'
import { read } from './config.ts'
import { compose, facet, type Role, type Served } from './host.ts'
import type { Heard, Said } from './thread.ts'

let host: Promise<Served> | undefined
let live: AbortController | undefined
// The duty roles this thread works.
let mine: Role[] = []
let going: Promise<unknown> = Promise.resolve()

let tell = (heard: Heard) => self.postMessage(heard)
let failed = (error: unknown) =>
  tell({
    failed: error instanceof Error
      ? error.stack ?? error.message
      : String(error),
  })

let open = (): Promise<Served> => {
  if (!host) throw new Error('the thread was never started')
  return host
}

self.onmessage = async ({ data }: MessageEvent<Said>) => {
  if ('start' in data) {
    let { config, roles, me } = data.start
    become(me)
    mine = roles
    host = compose(read(config), ['graph', ...roles], facet)
  } else if ('pass' in data) {
    going = open().then((h) => h.duties(AbortSignal.abort(), mine))
      .then(() => tell({ passed: true }), failed)
  } else if ('live' in data) {
    let signal = (live = new AbortController()).signal
    going = open().then((h) => h.duties(signal))
      .then(() => tell({ stopped: true }), failed)
  } else if ('stop' in data) {
    live?.abort()
    host?.then((h) => h.stop(), () => {})
  } else if ('nudge' in data) host?.then((h) => h.fx.wake(), () => {})
  else if ('close' in data) {
    live?.abort()
    try {
      await going
      let h = await open()
      await h.close()
      tell({ closed: true })
    } catch (error) {
      failed(error)
    }
    self.close()
  }
}
