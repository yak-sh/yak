// External blob preparation must leave the graph's write lock free, and a
// writer that read before preparation must still pass the transactional guard.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, Stale, token } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { blobs } from './plugin.ts'
import { address, decode, memoryBlobs } from './store.ts'
import { blog } from './testing.ts'

for (let method of ['has', 'put'] as const) {
  for (let stale of [false, true]) {
    test(`external blob ${method} frees the writer lock (${stale ? 'stale' : 'accepted'})`, async () => {
      let dir = Deno.makeTempDirSync({ prefix: 'yaks-prepare-' })
      let a = open(`${dir}/graph.sqlite`)
      let db = storage(a, blog)
      db.install()
      let b = open(`${dir}/graph.sqlite`)
      b.query({ t: 'pragma', name: 'busy_timeout', value: 0 })
      let bytes = memoryBlobs()
      let started = Promise.withResolvers<void>()
      let release = Promise.withResolvers<void>()
      let slow = blobs(blog, {
        ...bytes,
        [method]: async (sha: string, value: Uint8Array) => {
          started.resolve()
          await release.promise
          return method == 'has' ? bytes.has(sha) : bytes.put(sha, value)
        },
      })
      let g = graph({ storage: db, vocab: blog, plugins: [slow] })
      let writer = graph({ storage: storage(b, blog), vocab: blog })
      let pending: ReturnType<typeof g.apply> | undefined
      try {
        writer.apply([{ entity: { eid: 'post' }, post: { title: 'before' } }])
        pending = g.apply([{
          entity: { eid: 'post' },
          post: { body: 'prepared text' },
          ...(stale ? { $was: { post: { title: token('before') } } } : {}),
        }])
        await started.promise
        await writer.apply([{
          entity: { eid: 'post' },
          post: { title: 'concurrent write' },
        }])
        assertEquals(db.get(['post'])[0].post, {
          title: 'concurrent write',
          body: null,
          author: null,
        })
        release.resolve()
        if (stale) await assertRejects(async () => await pending, Stale)
        else {
          let out = await pending
          assertEquals(out?.[0].post, { body: 'prepared text' })
          assertEquals(db.get(['post'])[0].post, {
            title: 'concurrent write',
            body: address('prepared text'),
            author: null,
          })
        }
        assertEquals(
          decode((await bytes.get(address('prepared text')))!),
          'prepared text',
        )
      } finally {
        release.resolve()
        await Promise.resolve(pending).catch(() => {})
        b.close()
        a.close()
        Deno.removeSync(dir, { recursive: true })
      }
    })
  }
}
