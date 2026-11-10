/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import * as fs from '@yaks/file/io'
import { open } from '@yaks/sqlite/db'
import { type Port, portLink } from '@yaks/sync/port'
import { copy, type Copying } from './copy.ts'
import { copyErrors, type CopyPage, type CopyPlan } from './copy_thread.ts'

let stopping = new AbortController()
let link = portLink(self as unknown as Port, {
  ...copyErrors,
  receive: async (method, value) => {
    if (method == 'stop') return stopping.abort()
    if (method != 'run') throw new Error(`unknown copy request: ${method}`)
    let { spaces, to } = value as CopyPlan
    await copy({
      spaces,
      page: async (space, asked) =>
        await link.request('page', { space, asked } satisfies CopyPage, {
          timeout: null,
        }) as Copying,
      open: (slug) => {
        let path = `${to}/${slug}.db`
        for (let file of [path, `${path}-wal`, `${path}-shm`]) {
          try {
            fs.removeSync(file)
          } catch (error) {
            if (!fs.isNotFound(error)) throw error
          }
        }
        return open(path, { wal: false })
      },
      out: async (line) => {
        await link.request('out', line, { timeout: null })
      },
      stopping: stopping.signal,
    })
  },
})
