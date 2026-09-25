// The case the write log answers (T-37968), in workerd over Durable Object
// SQLite: on 2026-09-22 jill/coaches refused to start after a deploy and the
// writes its page sent meanwhile were lost. Here the store refuses to boot,
// the page keeps writing, the store is mended and woken as a new incarnation
// (probe-entry.mjs), and every write lands in order, once.
import { assertEquals } from '@std/assert'
import { sha256 } from '@yaks/graph'
import { slow } from '../../bin/testing.ts'
import { handle } from './directory.ts'
import { client, kernel, planted, seed } from './probe.ts'
import { as, by, count, select, table } from '@yaks/sql'
import { slotted } from './testing.ts'

let titled = (eid: string, title: string, was?: string) => ({
  entities: [{
    entity: { eid },
    doc: { title },
    ...(was ? { $was: { doc: { title: was } } } : {}),
  }],
})

slow(
  'writes sent to a store that refuses to boot land in order once it is mended',
  async () => {
    let k = await kernel()
    try {
      let { cookie, eids } = await seed(k, [{
        slug: 'jill',
        apps: ['coaches'],
      }])
      let app = client(k, 'jill.yaks.app', 'coaches', cookie)
      let store = handle({ slug: 'jill' }, 'coaches', eids['jill/coaches'])
      let eid = crypto.randomUUID()
      await app.applied(titled(eid, 'zero'))
      // The bad deploy: the object wakes over a vocabulary it cannot load.
      await planted(k, store, slotted('vocab', 'not json'))
      let sent = ['one', 'two', 'three'].map((t, i, all) =>
        titled(eid, t, sha256(i ? all[i - 1] : 'zero'))
      )
      for (let body of sent) {
        let r = await app.post(body)
        assertEquals(r.status, 202)
        assertEquals((await r.json()).pending, true)
      }
      // The fix: the object wakes healthy, and its first request replays.
      await planted(k, store, {
        t: 'delete',
        from: 'yak_kv',
        where: by({ k: 'vocab' }),
      })
      let [row] = await app.get(`id=${eid}`)
      assertEquals((row.doc as { title: string }).title, 'three')
      let writes = select({
        cols: [as(count(), 'n')],
        from: table('yak_writes'),
      })
      assertEquals(await planted(k, store, writes), [{ n: 0 }])
      // And it writes as it always did.
      let r = await app.post(titled(eid, 'four', sha256('three')))
      assertEquals(r.status, 200)
    } finally {
      await k.stop()
    }
  },
)
