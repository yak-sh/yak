// The Purger's pacing (purge.ts `purger`): purges spend Cloudflare's bucket,
// wait a token out when it is empty, and carry every tag owed meanwhile.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Cache, cleared, purger, SPREAD, Unpurged } from './purge.ts'

// A Site that refuses the purges `refuses` names (by count) for rate, on a
// clock that moves only when the purger waits and as each purge is
// acknowledged, `ack` past its send. Every purge is held in flight until `go`,
// and `flying` settles once the first one is.
let site = (refuses: number[] = [], ack = 0) => {
  let t = 0, sent: { at: number; tags: string[] }[] = []
  let held = Promise.withResolvers<void>()
  let flying = Promise.withResolvers<void>()
  let purge = purger(
    {
      purge: async (tags) => {
        let refused = refuses.includes(sent.length)
        sent.push({ at: t, tags })
        flying.resolve()
        await held.promise
        t += ack
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
  return {
    purge,
    sent,
    go: () => held.resolve(),
    flying: flying.promise,
    now: () => t,
  }
}

test('a full bucket purges at once, and an empty one waits a token', async () => {
  let { purge, sent, go } = site()
  go()
  for (let i = 0; i < 26; i++) await purge([`app:${i}`])
  assertEquals(sent.slice(24).map((s) => s.at), [0, 12_000])
})

test('a refused purge waits a token and goes again with what was owed since', async () => {
  let { purge, sent, go, flying } = site([0])
  let first = purge(['app:a'])
  await flying
  let later = purge(['app:b'])
  go()
  await Promise.all([first, later])
  assertEquals(sent, [
    { at: 0, tags: ['app:a'] },
    { at: 12_000, tags: ['app:a', 'app:b'] },
  ])
})

test('the third refusal is reported to every writer waiting on it', async () => {
  let { purge, sent, go, flying } = site([0, 1, 2])
  let first = purge(['app:a'])
  await flying
  let later = purge(['app:b'])
  go()
  await Promise.all([first, later].map((p) => assertRejects(() => p, Unpurged)))
  assertEquals(sent.map((s) => s.at), [0, 12_000, 24_000])
  // The next writer starts afresh once a token is back.
  await purge(['app:c'])
  assertEquals(sent.at(-1), { at: 36_000, tags: ['app:c'] })
})

test('a purge asked to spread resolves SPREAD past the send it shares, its acknowledgement inside the wait', async () => {
  let { purge, sent, go, now } = site([], 300)
  go()
  let at = (p: Promise<void>) => p.then(now)
  let [plain, spread] = await Promise.all([
    at(purge(['app:a'])),
    at(purge(['app:b'], true)),
  ])
  assertEquals([sent.length, plain, spread], [1, 300, SPREAD])
})

test('cache owners keep separate batches while sharing the account quota', async () => {
  let t = 0
  let sent: { cache: Cache | undefined; keys: string[]; at: number }[] = []
  let purge = purger(
    {
      purge: (keys, cache) => {
        sent.push({ keys, cache, at: t })
        return Promise.resolve({ success: true, errors: [] })
      },
    },
    (ms) => Promise.resolve(void (t += ms)),
    () => t,
  )
  for (let i = 0; i < 24; i++) await purge([`app:${i}`])
  await Promise.all([
    purge(['app:last']),
    purge(['/a/config.php'], false, 'files'),
    purge(['/b/file.png'], false, 'files'),
  ])
  assertEquals(sent.slice(24), [
    { cache: 'site', keys: ['app:last'], at: 0 },
    { cache: 'files', keys: ['/a/config.php', '/b/file.png'], at: 12_000 },
  ])
})

test('the owning cache receives its paths and a refused purge stays refused', async () => {
  let options: unknown[] = []
  let result = { success: false, errors: [{ code: 1134, message: 'limited' }] }
  let cache = {
    purge: (o: unknown) => {
      options.push(o)
      return Promise.resolve(result)
    },
  }
  assertEquals(
    await cleared(cache, { pathPrefixes: ['/a/config.php'] }),
    result,
  )
  assertEquals(options, [{ pathPrefixes: ['/a/config.php'] }])
  assertEquals((await cleared(undefined, { tags: ['app:a'] })).success, false)
})
