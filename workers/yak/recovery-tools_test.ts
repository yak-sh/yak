import { cleanup, equal, ok, test, throws } from '@yaks/testing'
import { short } from '@yaks/id'
import { accepted, connector, fresh, seed, signIn, unique } from './probe.ts'

let k = await fresh()
cleanup(() => k.stop())
let space = unique('recovery')
let other = unique('recovery')
let them = await seed(k, [
  { slug: other, apps: ['shelf'] },
  { slug: space, apps: ['notes'] },
])
let owner = connector(k, them.cookie)
let trash = them.eids[`${space}/notes`]
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
    if (q == '.app.trashed') {
      ok(no.startsWith('unknown property: app.trashed'), no)
      ok(no.includes('a component is no property of another'), no)
      ok(no.includes('.app&.trashed for presence'), no)
    }
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

test('graph_query keeps the vocabulary’s guidance for uses', async () => {
  let refused = (app: string, q: string) =>
    admin.tool('graph_query', { app, q }).then(
      () => '',
      (e: Error) => e.message,
    )
  let unknown = await refused(`${other}/shelf`, '.uses')
  ok(unknown.startsWith('unknown prop: .uses'), unknown)
  ok(unknown.includes('vocab.json'), unknown)
  let property = await refused('yak/platform', '.uses.connection')
  ok(property.includes('a component is no property of another'), property)
  ok(property.includes('.uses&.connection for presence'), property)
})

test('graph_query gives a working rewrite for person.email and qualifies session', async () => {
  let ask = (q: string) => admin.tool('graph_query', { app: 'yak/platform', q })
  let { message } = await throws(
    () => ask(`.person.email=${them.email}&.limit=1`),
    'unknown property: person.email',
  ) as Error
  let corrected = `.person&.email.address=${them.email}&.limit=1`
  ok(message.includes(corrected), message)
  let rows = JSON.parse(await ask(corrected))
  equal(rows.map((r: { entity: { eid: string } }) => r.entity.eid), [
    them.person,
  ])

  let session = await throws(
    () => ask('.session&.limit=1'),
    '.session is a property',
  ) as Error
  for (let field of ['support.session', 'tool_refusal.session']) {
    let corrected = `.${field}&.limit=1`
    ok(session.message.includes(corrected), session.message)
    ok(Array.isArray(JSON.parse(await ask(corrected))))
  }
})

test('graph_query explains how to scope a query with .in', async () => {
  let { message } = await throws(
    () => owner.tool('graph_query', { app: `${other}/shelf`, q: '.in' }),
    '.in=',
  ) as Error
  let q = `.doc&.in=${other}/shelf`
  ok(message.includes(q), message)
  ok(Array.isArray(JSON.parse(await owner.tool('graph_query', { q }))))
})

test('app tools share short ids for live and trashed apps', async () => {
  let app = short(them.eids[`${other}/shelf`])
  let bare = app.slice(1)
  await owner.tool('app_files', { app, op: 'list' })
  await throws(
    () => owner.tool('app_delete', { space, app: bare }),
    `no app ${bare} in ${space}`,
  )
  let deleted = await owner.tool('app_delete', { space: other, app: bare })
  ok(deleted.includes(them.eids[`${other}/shelf`]), deleted)
  let restored = await owner.tool('app_restore', { app: bare })
  ok(restored.includes(`${other}/shelf is back`), restored)
})
