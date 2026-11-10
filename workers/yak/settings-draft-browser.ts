// The site's settings lend @yaks/draft its authenticated text-only door.
import {
  type BrowserDrafts,
  browserDrafts,
  type BrowserOpts,
} from '@yaks/draft/browser'
import type { Bundle } from '@yaks/graph'

export let settingsDrafts = (
  opts: BrowserOpts & { scope: string },
): BrowserDrafts => {
  let url = new URL('/manage/account/profile', location.href)
  url.search = new URLSearchParams({ 'settings-draft': '1', scope: opts.scope })
    .toString()
  let report = opts.report ?? ((error: unknown) => {
    queueMicrotask(() => {
      throw error
    })
  })
  let listeners = new Set<(rows: Bundle[]) => void>()
  let rows: Bundle[] = []
  let read = fetch(url, { signal: AbortSignal.timeout(10_000) })
    .then(async (response) => {
      if (response.status != 200) {
        throw new Error(
          'Your settings draft could not sync. A recovery copy is kept on this device.',
        )
      }
      let answer = await response.json() as {
        person: string
        bundles: Bundle[]
      }
      rows = answer.bundles
      for (let hear of listeners) hear(rows)
      return answer
    })
  // Identity may already be supplied; the read still reports its own failure.
  read.catch(report)
  let desk = browserDrafts(
    {
      me: () => read,
      apply: async (bundles) => {
        let response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bundles }),
          signal: AbortSignal.timeout(10_000),
        })
        if (response.status != 200) {
          throw new Error(
            'Your settings draft could not sync. A recovery copy is kept on this device.',
          )
        }
        return response.json()
      },
      subscribe: (_query, hear) => {
        listeners.add(hear)
        hear(rows)
        return () => {
          listeners.delete(hear)
        }
      },
    },
    opts.scope,
    { ...opts, report },
  )
  let place = (key: string) => `settings:${opts.scope}:${key}`
  return {
    has: (key) => desk.has(place(key)),
    text: (key) => desk.text(place(key)),
    type: (key, text) => desk.type(place(key), text),
    restore: (key, text, over) => desk.restore(place(key), text, over),
    spend: (key, also) => desk.spend(place(key), also),
    bind: (field, key) => desk.bind(field, place(key)),
    close: () => {
      desk.close()
      listeners.clear()
    },
  }
}
