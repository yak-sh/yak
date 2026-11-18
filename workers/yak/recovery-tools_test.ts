import { cleanup, equal, ok, test, throws } from '@yaks/testing'
import { accepted, connector, fresh, seed, signIn, unique } from './probe.ts'

let k = await fresh()
cleanup(() => k.stop())
let space = unique('recovery')
let them = await seed(k, [{ slug: space, apps: ['notes'] }])
let owner = connector(k, them.cookie)
let guest = await signIn(k)
await owner.tool('member_add', { space, email: guest.email, role: 'editor' })
await accepted(k, guest.email, guest.cookie)
let editor = connector(k, guest.cookie)
await owner.tool('graph_apply', {
  space,
  app: 'notes',
  bundles: [{ entity: { eid: '$row' }, doc: { title: 'Saved' } }],
})
await owner.tool('app_delete', { space, app: 'notes' })
let trash = await owner.narrow(
  'app_list',
  { space },
  '.result[0].output.value.spaces[0].trash[0].eid',
) as string

test('an owner inspects a trashed store by its slug or listed eid without restoring it', async () => {
  for (let app of ['notes', trash]) {
    equal(
      await owner.narrow(
        'store_inspect',
        { space, app },
        '.result[0].output.value | has("physical")',
      ),
      true,
    )
    ok(
      (await owner.narrow(
        'store_writes',
        { space, app, recent: true },
        '.result[0].output.value.writes | length',
      ) as number) > 0,
    )
  }
  equal(
    await owner.narrow(
      'app_list',
      { space },
      '.result[0].output.value.spaces[0].trash[0].eid',
    ),
    trash,
  )
  equal(
    (await k.at(`${space}.yaks.app`, '/notes/api/query?q=.doc')).status,
    404,
  )
})

test('an editor cannot inspect a trashed store or its retained writes', async () => {
  for (let name of ['store_inspect', 'store_writes']) {
    await throws(
      () => editor.tool(name, { space, app: trash }),
      `not the owner of ${space}`,
    )
  }
})

let admin = connector(k, k.owner.cookie)
for (let q of ['.app&.tombstone', '.app.trashed']) {
  test(`a directory query of ${q} teaches a query that lists the trashed app`, async () => {
    let no = await admin.tool('graph_query', { app: 'yak/platform', q })
      .then(() => '', (e: Error) => e.message)
    let suggestion = /send q: '([^']+)'/.exec(no)?.[1]
    ok(suggestion, no)
    let rows = JSON.parse(
      await admin.tool('graph_query', {
        app: 'yak/platform',
        q: suggestion,
      }),
    )
    ok(rows.some((r: { entity: { eid: string } }) => r.entity.eid == trash))
  })
}
