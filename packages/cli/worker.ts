/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
// The other side of ./thread.ts: a worker that composes the graph a config
// names for the duty roles it is handed, as the process that started it, and
// runs those duties until it is told to close.
//
// On the way in it runs one pass of each role nobody else serves, which is all
// a command passing through asks for; told to go live, it keeps at every one
// of them until it is told to stop, which is what a process that stays up asks
// for. Told to close, it runs one last pass over the pool, for what the process
// wrote while the command ran, where the pool is its to work, and closes its
// graph. Its failures go back to the process as messages; the process decides
// what they mean.

import { become } from '@yaks/process'
import { read } from './config.ts'
import { compose, facet, type Role, type Served } from './host.ts'
import type { Heard, Said } from './thread.ts'

let host: Promise<Served> | undefined
let live: AbortController | undefined
// The duty roles this thread works: those nobody else served when it started,
// every one of them once it goes live.
let mine: Role[] = []
let every: Role[] = []
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
    let { config, roles, me, idle } = data.start
    become(me)
    every = roles
    mine = idle ?? roles
    host = compose(read(config), ['graph', ...roles], facet, { joins: true })
    going = host.then((h) => h.duties(AbortSignal.abort(), mine))
      .then(() => tell({ passed: true }), failed)
  } else if ('live' in data) {
    mine = every
    let signal = (live = new AbortController()).signal
    going = going.then(open).then((h) => h.duties(signal))
      .then(() => tell({ stopped: true }), failed)
  } else if ('stop' in data) live?.abort()
  else if ('nudge' in data) host?.then((h) => h.fx.wake(), () => {})
  else if ('close' in data) {
    live?.abort()
    try {
      await going
      let h = await open()
      if (mine.includes('effects')) await h.fx.work(h.graph)
      await h.close()
      tell({ closed: true })
    } catch (error) {
      failed(error)
    }
    self.close()
  }
}
