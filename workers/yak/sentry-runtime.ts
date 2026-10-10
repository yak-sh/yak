// Runtime retention for the shared reporter's bounded repeat windows.
import { waitUntil } from 'cloudflare:workers'
import { options as configure } from './sentry.ts'
import type { Env } from './env.ts'

export let options = (env: Partial<Env>) =>
  configure(env, {
    now: Date.now,
    after: (ms, run) => {
      let resolve: () => void
      let pending = new Promise<void>((done) => resolve = done)
      let firing = false
      let timer = setTimeout(() => {
        firing = true
        void run().finally(resolve)
      }, ms)
      waitUntil(pending)
      return () => {
        clearTimeout(timer)
        if (!firing) resolve()
      }
    },
  })
