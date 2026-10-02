/** Shared Worker entry point for graph duties. @module */
import { type Port, portLink } from '@yaks/sync'

import type { Host, Open, Start } from './types.ts'

let scope = globalThis as unknown as Port & { close: () => void }

let host = Promise.withResolvers<Host>()
host.promise.catch(() => {})
let live: AbortController | undefined
let going: Promise<void> = Promise.resolve()
let start = (event: Event) => {
  let data = (event as MessageEvent<{ start?: Start }>).data
  if (!data?.start) return
  scope.removeEventListener('message', start)
  let given = data.start
  void import(given.module).then((module: { open: Open }) => module.open(given))
    .then(host.resolve, host.reject)
}
scope.addEventListener('message', start)
let link = portLink(scope, {
  receive: (method) => {
    if (method == 'pass') {
      going = host.promise.then((h) => h.duties(AbortSignal.abort()))
      return going
    }
    if (method == 'live') {
      let signal = (live = new AbortController()).signal
      going = host.promise.then((h) => {
        if (!signal.aborted) return h.duties(signal)
      })
      return going
    }
    if (method == 'stop') {
      live?.abort()
      return host.promise.then((h) => h.stop())
    }
    if (method == 'nudge') return host.promise.then((h) => h.nudge())
    if (method == 'close') {
      live?.abort()
      return (async () => {
        let h = await host.promise
        h.stop()
        await going
        await h.close()
        // Reply before closing the control link or its owning Worker.
        setTimeout(() => {
          link.close()
          scope.close()
        }, 0)
      })()
    }
    throw new Error(`unknown thread request: ${method}`)
  },
})
