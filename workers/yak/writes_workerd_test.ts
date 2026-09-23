// The case the write log answers (T-37968), in workerd over Durable Object
// SQLite: on 2026-09-22 jill/coaches refused to start after a deploy and the
// writes its page sent meanwhile were lost. Here the store refuses to boot,
// the page keeps writing, the store is mended and woken as a new incarnation
// (probe-entry.mjs), and every write lands in order, once.
import { assertEquals } from '@std/assert'
import { sha256 } from '@yaks/graph'
import { slow } from '../../bin/testing.ts'
import { handle } from './directory.ts'
import { client, type Kernel, kernel, seed } from './probe.ts'

let sql = async (k: Kernel, store: string, statements: unknown[][]) => {
  let r = await k.at(k.host, '/__probe/sql', {
    method: 'POST',
    body: JSON.stringify({ store, sql: statements }),
  })
  if (!r.ok) throw new Error(`probe sql ${r.status}: ${await r.text()}`)
  return await r.json() as Record<string, unknown>[]
}

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
      await sql(k, store, [[
        "insert into yak_kv (k, v) values ('vocab', 'not json')",
      ]])
      let sent = ['one', 'two', 'three'].map((t, i, all) =>
        titled(eid, t, sha256(i ? all[i - 1] : 'zero'))
      )
      for (let body of sent) {
        let r = await app.post(body)
        assertEquals(r.status, 202)
        assertEquals((await r.json()).pending, true)
      }
      // The fix: the object wakes healthy, and its first request replays.
      await sql(k, store, [["delete from yak_kv where k = 'vocab'"]])
      let [row] = await app.get(`id=${eid}`)
      assertEquals((row.doc as { title: string }).title, 'three')
      assertEquals(
        await sql(k, store, [['select count(*) n from yak_writes']]),
        [
          { n: 0 },
        ],
      )
      // And it writes as it always did.
      let r = await app.post(titled(eid, 'four', sha256('three')))
      assertEquals(r.status, 200)
    } finally {
      await k.stop()
    }
  },
)
