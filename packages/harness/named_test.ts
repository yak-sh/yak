import { assertEquals } from '@std/assert'
import { driver } from '@yaks/sqlite/db'
import { type Comp, identityEid } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { toolEid } from '@yaks/tools'
import { NAMED, named, renamed } from './named.ts'
import { open } from './store.ts'

// A file in the old shape: hand-written ids, a model per provider that serves
// it, a fallback transport, and a tool written under two ids.
let old = () => {
  let h = open(':memory:')
  let sql = driver(h.db)
  sql.exec(`delete from harness_upgrade where name = '${NAMED}'`)
  // Before names were identities: nothing held a name unique.
  for (
    let { name } of sql.query(
      "select name from sqlite_schema where type = 'index'" +
        " and tbl_name in ('provider', 'model', 'tool') and sql like '%unique%'",
      [],
    )
  ) sql.exec(`drop index "${name}"`)
  sql.exec('alter table model add column provider integer')
  sql.exec('alter table provider add column serves integer')
  let put = (eid: string, comps: Record<string, Record<string, unknown>>) => {
    let id = Number(
      sql.query('insert into entity (eid) values (?) returning id', [eid])[0]
        .id,
    )
    for (let [t, c] of Object.entries(comps)) {
      let cols = ['entity', ...Object.keys(c)]
      sql.query(
        `insert into "${t}" (${cols.map((k) => `"${k}"`).join(', ')})` +
          ` values (${cols.map(() => '?').join(', ')})`,
        [id, ...cols.slice(1).map((k) => c[k] as string | number)],
      )
    }
    return id
  }
  let openai = put('provider:openai', { provider: { name: 'openai' } })
  let codex = put('p-codex', { provider: { name: 'codex' } })
  put('p-cli', { provider: { name: 'codex-cli', serves: codex } })
  let astra = put('model:gpt-6-astra', {
    model: { name: 'gpt-6-astra', provider: openai },
  })
  let twin = put('m-astra', {
    model: { name: 'gpt-6-astra', provider: codex, label: 'GPT-6 Astra' },
  })
  put('tool:wait', { tool: { name: 'wait' } })
  let wait = put('t-wait', { tool: { name: 'wait', description: 'hold on' } })
  put('s', { session: {} })
  put('e', {
    entry: {
      session: Number(
        sql.query("select id from entity where eid = 's'", [])[0].id,
      ),
    },
    using: { provider: codex, model: twin },
    call: { to: wait },
  })
  put('v', { doc: { title: 'venture' } })
  let v = Number(sql.query("select id from entity where eid = 'v'", [])[0].id)
  put(edgeEid('v', 'contains', 'm-astra'), {
    edge: { from: v, to: twin },
    contains: {},
  })
  return { h, sql, astra }
}

let P = (name: string) => identityEid('provider', [name])
let astra = identityEid('model', ['gpt-6-astra'])

Deno.test('an old file moves onto the ids names derive, once', () => {
  let { h, sql } = old()
  try {
    assertEquals(renamed(sql, h.vocab), { moved: 6, merged: 2 })
    h.store.install()
    assertEquals(named(sql, h.store), 3)
    assertEquals(named(sql, h.store), null)
    assertEquals(renamed(sql, h.vocab), { moved: 0, merged: 0 })
    let [m] = h.store.read('.model&*')
    assertEquals(m.entity.eid, astra)
    assertEquals((m.model as Comp).label, 'GPT-6 Astra')
    assertEquals(
      h.store.read('.serves&*').map((b) => [
        (b.edge as Comp).from,
        (b.serves as Comp).name,
      ]).sort(),
      [
        [P('codex'), 'gpt-6-astra'],
        [P('codex-cli'), 'gpt-6-astra'],
        [P('openai'), 'gpt-6-astra'],
      ].sort(),
    )
    let [e] = h.store.read('.entry&*')
    assertEquals(e.using, {
      provider: P('codex'),
      model: astra,
      effort: null,
      instructions: null,
    })
    assertEquals((e.call as Comp).to, toolEid('wait'))
    assertEquals(h.store.read('.tool&*').map((b) => b.entity.eid), [
      toolEid('wait'),
    ])
    assertEquals(h.store.read('.contains&*').map((b) => b.entity.eid), [
      edgeEid('v', 'contains', astra),
    ])
    let cols = (t: string) =>
      sql.query(`pragma table_info(${t})`, []).map((c) => c.name)
    assertEquals(cols('model').includes('provider'), false)
    assertEquals(cols('provider').includes('serves'), false)
  } finally {
    h.close()
  }
})
