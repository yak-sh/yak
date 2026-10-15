// The Purger's pacing (purge.ts `purger`): purges spend Cloudflare's bucket,
// wait a token out when it is empty, and carry every tag owed meanwhile.
import { test, tick } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { purger, Unpurged } from './purge.ts'

// A Site that refuses the purges `refuses` names (by count) for rate, on a
// clock that moves only when the purger waits. Every purge is held in flight
// until `go`.
let site = (refuses: number[] = []) => {
  let t = 0, sent: { at: number; tags: string[] }[] = []
  let held = Promise.withResolvers<void>()
  let purge = purger(
    {
      purge: async (tags) => {
        let refused = refuses.includes(sent.length)
        sent.push({ at: t, tags })
        await held.promise
        return (refused
          ? {
            success: false,
            errors: [{ code: 1134, message: 'rate limit reached' }],
          }
          : { success: true, errors: [] })
      },
    },
    (ms) => Promise.resolve(void (t += ms)),
    () => t,
  )
  return { purge, sent, go: () => held.resolve() }
}

test('a full bucket purges at once, and an empty one waits a token', async () => {
  let { purge, sent, go } = site()
  go()
  for (let i = 0; i < 26; i++) await purge([`app:${i}`])
  assertEquals(sent.slice(24).map((s) => s.at), [0, 12_000])
})

test('a refused purge waits a token and goes again with what was owed since', async () => {
  let { purge, sent, go } = site([0])
  let first = purge(['app:a'])
  await tick()
  let later = purge(['app:b'])
  go()
  await Promise.all([first, later])
  assertEquals(sent, [
    { at: 0, tags: ['app:a'] },
    { at: 12_000, tags: ['app:a', 'app:b'] },
  ])
})

test('the third refusal is reported to every writer waiting on it', async () => {
  let { purge, sent, go } = site([0, 1, 2])
  let first = purge(['app:a'])
  await tick()
  let later = purge(['app:b'])
  go()
  await Promise.all([first, later].map((p) => assertRejects(() => p, Unpurged)))
  assertEquals(sent.map((s) => s.at), [0, 12_000, 24_000])
  // The next writer starts afresh once a token is back.
  await purge(['app:c'])
  assertEquals(sent.at(-1), { at: 36_000, tags: ['app:c'] })
})
