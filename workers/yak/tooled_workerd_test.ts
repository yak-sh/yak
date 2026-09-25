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
import { FILED, MARKS } from './migrate.ts'
import { client, kernel, planted, seed } from './probe.ts'
import { by, col, insert, select, table } from '@yaks/sql'
import { id, owners, row, slotOf, slotted } from './testing.ts'

let tool = (eid: string, name: string, call: string) => [
  insert('entity', { eid }, { eid: call }),
  row('tool', eid, { name }),
  row('call', call, { to: id(eid) }),
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
      assertEquals(await app.get('.tool'), [])
      let store = handle({ slug: 'jill' }, 'coaches', eids['jill/coaches'])
      await planted(
        k,
        store,
        { t: 'drop', kind: 'index', name: 'tool_name' },
        ...tool(derivedEid('tool:add_observation'), 'add_observation', 'c1'),
        ...tool(derivedEid('tool:find_observation'), 'find_observation', 'c2'),
        ...tool(toolEid('add_observation'), 'add_observation', 'c3'),
        slotted('schema', 'older schema'),
        slotted('migrated', FILED),
      )
      let calls = await app.get('.call')
      assertEquals(
        calls.map((c) => (c.call as { to: string }).to).sort(),
        [
          toolEid('add_observation'),
          toolEid('add_observation'),
          toolEid('find_observation'),
        ].sort(),
      )
      assertEquals(
        await planted(k, store, owners('tool', ['name'], 'name')),
        [
          { eid: toolEid('add_observation'), name: 'add_observation' },
          { eid: toolEid('find_observation'), name: 'find_observation' },
        ],
      )
      assertEquals(
        await planted(k, store, slotOf('migrated')),
        [{ v: MARKS.at(-1) }],
      )
      assertEquals(
        await planted(
          k,
          store,
          select({
            cols: [col('name')],
            from: table('sqlite_schema'),
            where: by({ type: 'index', name: 'tool_name' }),
          }),
        ),
        [{ name: 'tool_name' }],
      )
      // The woken store still answers.
      assertEquals((await app.get('.tool')).length, 2)
    } finally {
      await k.stop()
    }
  },
)
