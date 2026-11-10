/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { type Port, portLink } from '@yaks/sync/port'
import { copy, type Copying } from './copy.ts'
import { copyFile } from './copy_file.ts'
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
      open: (slug) => copyFile(to, slug),
      out: async (line) => {
        await link.request('out', line, { timeout: null })
      },
      stopping: stopping.signal,
    })
  },
})
