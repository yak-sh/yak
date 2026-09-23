// A store the code before D-37943 wrote, woken by the code after it, in
// workerd over Durable Object SQLite (T-37964). jill/coaches held tool rows at
// the ids `tool:<name>` hashed to and no unique index over the name, and the
// boot refused it before pass 7 could move them. The shape here is that
// store's, synthetic: tool rows at old ids, a newer twin of one at the derived
// id, a call aimed at each, the index absent and the schema stamp stale.
import { assertEquals } from '@std/assert'
import { derivedEid } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { slow } from '../../bin/testing.ts'
import { handle } from './directory.ts'
import { MARKS } from './migrate.ts'
import { client, type Kernel, kernel, seed } from './probe.ts'

// Statements into one store object, which then wakes as a new incarnation
// (probe-entry.mjs); answers the last statement's rows.
let sql = async (k: Kernel, store: string, statements: unknown[][]) => {
  let r = await k.at(k.host, '/__probe/sql', {
    method: 'POST',
    body: JSON.stringify({ store, sql: statements }),
  })
  if (!r.ok) throw new Error(`probe sql ${r.status}: ${await r.text()}`)
  return await r.json() as Record<string, unknown>[]
}

let tool = (eid: string, name: string, call: string) => [
  ['insert into entity (eid) values (?), (?)', eid, call],
  [
    'insert into tool (entity, name) select id, ? from entity where eid = ?',
    name,
    eid,
  ],
  [
    'insert into call (entity, "to") select c.id, t.id from entity c,' +
    ' entity t where c.eid = ? and t.eid = ?',
    call,
    eid,
  ],
]

slow(
  'a store with tools at old ids opens, merges twins and ends indexed',
  async () => {
    let k = await kernel()
    try {
      let { cookie, eids } = await seed(k, [{
        slug: 'jill',
        apps: ['coaches'],
      }])
      let app = client(k, 'jill.yaks.app', 'coaches', cookie)
      assertEquals(await app.get('.tool!'), [])
      let store = handle({ slug: 'jill' }, 'coaches', eids['jill/coaches'])
      await sql(k, store, [
        ['drop index tool_name'],
        ...tool(derivedEid('tool:add_observation'), 'add_observation', 'c1'),
        ...tool(derivedEid('tool:find_observation'), 'find_observation', 'c2'),
        ...tool(toolEid('add_observation'), 'add_observation', 'c3'),
        ["update yak_kv set v = 'older schema' where k = 'schema'"],
        ["update yak_kv set v = 'yak/store/filed/6' where k = 'migrated'"],
      ])
      let calls = await app.get('.call!')
      assertEquals(
        calls.map((c) => (c.call as { to: string }).to).sort(),
        [
          toolEid('add_observation'),
          toolEid('add_observation'),
          toolEid('find_observation'),
        ].sort(),
      )
      assertEquals(
        await sql(k, store, [[
          'select e.eid, t.name from tool t join entity e on e.id = t.entity' +
          ' order by t.name',
        ]]),
        [
          { eid: toolEid('add_observation'), name: 'add_observation' },
          { eid: toolEid('find_observation'), name: 'find_observation' },
        ],
      )
      assertEquals(
        await sql(k, store, [["select v from yak_kv where k = 'migrated'"]]),
        [{ v: MARKS.at(-1) }],
      )
      assertEquals(
        await sql(k, store, [[
          "select name from sqlite_master where type = 'index'" +
          " and name = 'tool_name'",
        ]]),
        [{ name: 'tool_name' }],
      )
      // The woken store still answers.
      assertEquals((await app.get('.tool!')).length, 2)
    } finally {
      await k.stop()
    }
  },
)
