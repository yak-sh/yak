/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { compose, facet } from './host.ts'
import type { Config } from './config.ts'
import { type Port, portLink } from '@yaks/sync/port'

let stopping = new AbortController()
let link = portLink(self as unknown as Port, {
  receive: async (method, value) => {
    if (method == 'stop') return stopping.abort()
    if (method != 'run') throw new Error(`unknown upkeep request: ${method}`)
    let host = await compose(value as Config, ['graph'], facet, {
      process: false,
    })
    try {
      await host.upkeep(stopping.signal, (error, work) => {
        void link.request(
          work,
          error instanceof Error ? error.stack ?? error.message : String(error),
          { timeout: null },
        )
      })
    } finally {
      await host.close()
    }
  },
})
