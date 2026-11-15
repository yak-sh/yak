import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, seed } from './probe.ts'

let k = await kernel()
let owner = await seed(k, [{ slug: 'injection-victim', apps: ['notes'] }])
let stranger = await seed(k, [{ slug: 'injection-owner', apps: [] }])
let agent = connector(k, stranger.cookie)
let injected = `injection-victim)|(.member.person=${stranger.person}`

for (
  let [name, args] of [
    ['graph_apply', {
      entities: [{
        entity: { eid: '$intrusion' },
        doc: { title: 'intrusion' },
      }],
    }],
    ['app_files', { op: 'list' }],
    ['app_delete', {}],
    ['app_restore', {}],
    ['app_rollback', { version: 1 }],
  ] as const
) {
  test(`an injected space cannot admit a stranger to ${name}`, async () => {
    let out = await agent.call('tools/call', {
      name,
      arguments: { ...args, space: injected, app: 'notes' },
    })
    equal(out.isError, true)
    ok(out.content[0].text.includes(`no space ${injected}`))
  })
}

test('a refused injection leaves the victim app intact and its owner admitted', async () => {
  let app = await k.dir.app((await k.dir.space('injection-victim'))!, 'notes')
  equal(app?.trashed, null)
  let out = await connector(k, owner.cookie).call('tools/call', {
    name: 'app_files',
    arguments: { space: 'injection-victim', app: 'notes', op: 'list' },
  })
  equal(out.isError, undefined)
})
